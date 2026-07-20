// x402-sub-agent-mcp
// MCP tool server that manages x402 payment policy (coupons, enterprise
// tiers, internal tokens, protected-route rules) for other AFO Workers,
// and evaluates individual requests against that policy.
//
// This worker does NOT hold private keys and never touches raw payment
// signatures beyond forwarding them to a facilitator's /verify and
// /settle endpoints. It is a policy + bookkeeping layer, not a wallet.
//
// Protocol notes (x402, mid-2026):
//   - 402 response body: { x402Version, error, accepts: PaymentRequirements[] }
//   - Client resend header: X-PAYMENT  (base64 JSON PaymentPayload)
//   - Server success header: X-PAYMENT-RESPONSE (base64 JSON settlement)
//   - Facilitator: POST /verify, POST /settle, GET /supported
// Always re-check https://github.com/x402-foundation/x402 before relying
// on this for real mainnet money movement — the protocol is still young
// and facilitator wire formats vary slightly between providers.

const VERSION = '0.2.0';
const WORKER = 'x402-sub-agent-mcp';
const X402_VERSION = 1;
const DEFAULT_FACILITATOR = 'https://x402.org/facilitator';

// Known ERC-20 addresses for convenience auto-fill. Always verify against
// https://developers.circle.com/stablecoins/usdc-contract-addresses before
// trusting these for mainnet traffic — one wrong character loses funds.
const KNOWN_ASSETS = {
  'base:USDC': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  'base-sepolia:USDC': '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
};

// Public RPC endpoints used only for the optional balance pre-check in
// evaluateRequest() below. Best-effort and read-only — never used for
// anything that requires trust (verification/settlement always goes
// through the facilitator). A network with no entry here just skips the
// pre-check and relies on the facilitator's /verify as V1 always did.
const KNOWN_RPCS = {
  'base': 'https://mainnet.base.org',
  'base-sepolia': 'https://sepolia.base.org'
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id'
};

function j(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...CORS, 'content-type': 'application/json;charset=utf-8', 'cache-control': 'no-store' }
  });
}

async function readJson(req) {
  try { return await req.json(); } catch { return {}; }
}

function clean(v) { return String(v == null ? '' : v).trim(); }
function bool01(v) { return v ? 1 : 0; }
function nowIso() { return new Date().toISOString(); }
function uid(prefix) { return (prefix ? prefix + '_' : '') + crypto.randomUUID().replace(/-/g, '').slice(0, 20); }
function limitNum(v, dflt, min, max) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : dflt;
}

function randomCode(prefix) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return (prefix || 'CPN') + '-' + out;
}

// ---- route pattern matching ------------------------------------------
// Supports exact paths and trailing/embedded `*` glob wildcards, e.g.
// "/api/premium/*" or "/datasets/*/download".
function matchPattern(pattern, path) {
  if (!pattern) return false;
  if (pattern === '*') return true;
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + escaped + '$').test(path);
}

// ---- money helpers ------------------------------------------------------
// USD-decimal convenience -> smallest-unit atomic string (default 6dp, USDC).
function toAtomic(usd, decimals) {
  const d = Number.isFinite(decimals) ? decimals : 6;
  const n = Number(usd);
  if (!Number.isFinite(n) || n < 0) throw new Error('price_usd must be a non-negative number');
  return BigInt(Math.round(n * Math.pow(10, d))).toString();
}

function assetAddress(network, asset, override) {
  if (override) return override;
  return KNOWN_ASSETS[network + ':' + asset] || null;
}

// ---- address validation --------------------------------------------
// Strict hex-format check only: 0x + exactly 40 hex chars, and not the
// null address. This is NOT full EIP-55 checksum verification — that
// needs Keccak-256, which isn't in Workers' Web Crypto and would mean
// pulling in a crypto library, breaking this worker's intentional
// zero-dependency, single-file design. Format validation still catches
// the realistic failure modes: wrong length, missing 0x, stray
// whitespace, non-hex characters, pasting the wrong kind of string
// entirely. It will NOT catch a single transposed character that keeps
// valid hex shape and case — only a real checksum library catches that.
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const NULL_ADDRESS = '0x0000000000000000000000000000000000000000';

function assertValidAddress(value, label) {
  const v = clean(value);
  if (!ADDRESS_RE.test(v)) {
    throw new Error(`${label} must be a 0x-prefixed 40-hex-character address (got: ${v || '(empty)'})`);
  }
  if (v.toLowerCase() === NULL_ADDRESS) {
    throw new Error(`${label} cannot be the null address (0x000...000) — this is almost always a mistake`);
  }
  return v;
}

function assertValidAddressIfPresent(value, label) {
  const v = clean(value);
  return v ? assertValidAddress(v, label) : null;
}

// ---- D1 helpers -----------------------------------------------------
function requireDb(env) {
  if (!env.DB) throw new Error('D1 binding DB is not configured on this Worker');
  return env.DB;
}
async function dbAll(env, sql, params = []) {
  const res = await requireDb(env).prepare(sql).bind(...params).all();
  return res.results || [];
}
async function dbFirst(env, sql, params = []) {
  return await requireDb(env).prepare(sql).bind(...params).first();
}
async function dbRun(env, sql, params = []) {
  return await requireDb(env).prepare(sql).bind(...params).run();
}

// =======================================================================
// Payment rules
// =======================================================================
async function createPaymentRule(env, a) {
  const pattern = clean(a.pattern);
  if (!pattern) throw new Error('pattern is required, e.g. /api/premium/*');
  const payTo = assertValidAddress(a.pay_to, 'pay_to');
  const network = clean(a.network) || 'base';
  const asset = clean(a.asset) || 'USDC';
  const explicitAssetAddress = assertValidAddressIfPresent(a.asset_address, 'asset_address');
  const priceAtomic = a.price_atomic != null ? clean(a.price_atomic) : toAtomic(a.price_usd || 0, a.decimals);
  const id = uid('rule');
  const ts = nowIso();
  await dbRun(env, `INSERT INTO payment_rules
      (id, pattern, method, mode, price_atomic, asset, asset_address, network, pay_to,
       auth_required, bot_auth_required, description, priority, enabled, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, pattern, clean(a.method) || '*', clean(a.mode) || 'exact', priceAtomic, asset,
      assetAddress(network, asset, explicitAssetAddress), network, payTo,
      bool01(a.auth_required), bool01(a.bot_auth_required), clean(a.description) || null,
      Number.isFinite(Number(a.priority)) ? Number(a.priority) : 100, 1, ts, ts]);
  return { ok: true, rule: await dbFirst(env, 'SELECT * FROM payment_rules WHERE id = ?', [id]) };
}

async function listPaymentRules(env, a) {
  const q = clean(a.query).toLowerCase();
  const rows = await dbAll(env, 'SELECT * FROM payment_rules ORDER BY priority ASC, created_at DESC LIMIT ?',
    [limitNum(a.limit, 200, 1, 500)]);
  const filtered = q ? rows.filter(r => String(r.pattern).toLowerCase().includes(q)) : rows;
  return { ok: true, count: filtered.length, rules: filtered };
}

async function updatePaymentRule(env, a) {
  const id = clean(a.id);
  if (!id) throw new Error('id is required');
  const existing = await dbFirst(env, 'SELECT * FROM payment_rules WHERE id = ?', [id]);
  if (!existing) return { ok: false, error: 'rule not found', id };
  const fields = ['pattern', 'method', 'mode', 'asset', 'network', 'description'];
  const sets = [];
  const params = [];
  for (const f of fields) {
    if (a[f] != null) { sets.push(f + ' = ?'); params.push(clean(a[f])); }
  }
  if (a.pay_to != null) { sets.push('pay_to = ?'); params.push(assertValidAddress(a.pay_to, 'pay_to')); }
  if (a.asset_address != null) { sets.push('asset_address = ?'); params.push(assertValidAddress(a.asset_address, 'asset_address')); }
  if (a.price_atomic != null) { sets.push('price_atomic = ?'); params.push(clean(a.price_atomic)); }
  else if (a.price_usd != null) { sets.push('price_atomic = ?'); params.push(toAtomic(a.price_usd, a.decimals)); }
  if (a.priority != null) { sets.push('priority = ?'); params.push(Number(a.priority)); }
  if (a.enabled != null) { sets.push('enabled = ?'); params.push(bool01(a.enabled)); }
  if (a.auth_required != null) { sets.push('auth_required = ?'); params.push(bool01(a.auth_required)); }
  if (a.bot_auth_required != null) { sets.push('bot_auth_required = ?'); params.push(bool01(a.bot_auth_required)); }
  if (!sets.length) return { ok: false, error: 'no updatable fields provided' };
  sets.push('updated_at = ?'); params.push(nowIso());
  params.push(id);
  await dbRun(env, `UPDATE payment_rules SET ${sets.join(', ')} WHERE id = ?`, params);
  return { ok: true, rule: await dbFirst(env, 'SELECT * FROM payment_rules WHERE id = ?', [id]) };
}

async function deletePaymentRule(env, a) {
  const id = clean(a.id);
  if (!id) throw new Error('id is required');
  await dbRun(env, 'DELETE FROM payment_rules WHERE id = ?', [id]);
  return { ok: true, deleted: id };
}

// =======================================================================
// Coupons / free-trial tokens
// =======================================================================
async function issueCoupon(env, a) {
  const kind = clean(a.kind) || 'free'; // free | trial | discount
  if (!['free', 'trial', 'discount'].includes(kind)) throw new Error("kind must be 'free', 'trial', or 'discount'");
  if (kind === 'discount' && !(Number(a.discount_pct) > 0 && Number(a.discount_pct) <= 100)) {
    throw new Error('discount_pct (1-100) is required when kind is discount');
  }
  const code = clean(a.code) || randomCode(kind === 'trial' ? 'TRIAL' : kind.toUpperCase());
  let expiresAt = clean(a.expires_at) || null;
  if (!expiresAt && Number.isFinite(Number(a.expires_in_days))) {
    expiresAt = new Date(Date.now() + Number(a.expires_in_days) * 86400000).toISOString();
  }
  const id = uid('cpn');
  const ts = nowIso();
  await dbRun(env, `INSERT INTO coupons
      (id, code, kind, discount_pct, scope_pattern, caller_id, max_uses, uses_count, expires_at, revoked, note, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,0,?,0,?,?,?)`,
    [id, code, kind, kind === 'discount' ? Number(a.discount_pct) : null, clean(a.scope_pattern) || '*',
      clean(a.caller_id) || null, Number.isFinite(Number(a.max_uses)) ? Number(a.max_uses) : null,
      expiresAt, clean(a.note) || null, ts, ts]);
  return { ok: true, coupon: await dbFirst(env, 'SELECT * FROM coupons WHERE id = ?', [id]) };
}

async function listCoupons(env, a) {
  const rows = await dbAll(env, 'SELECT * FROM coupons ORDER BY created_at DESC LIMIT ?', [limitNum(a.limit, 200, 1, 500)]);
  const activeOnly = a.active_only !== false;
  const now = Date.now();
  const filtered = rows.filter(c => {
    if (!activeOnly) return true;
    if (c.revoked) return false;
    if (c.expires_at && new Date(c.expires_at).getTime() < now) return false;
    if (c.max_uses != null && c.uses_count >= c.max_uses) return false;
    return true;
  });
  return { ok: true, count: filtered.length, coupons: filtered };
}

async function revokeCoupon(env, a) {
  const code = clean(a.code);
  const id = clean(a.id);
  if (!code && !id) throw new Error('code or id is required');
  const where = id ? 'id = ?' : 'code = ?';
  await dbRun(env, `UPDATE coupons SET revoked = 1, updated_at = ? WHERE ${where}`, [nowIso(), id || code]);
  return { ok: true, revoked: id || code };
}

function couponValidity(coupon, path) {
  if (!coupon) return { valid: false, reason: 'coupon not found' };
  if (coupon.revoked) return { valid: false, reason: 'coupon revoked' };
  if (coupon.expires_at && new Date(coupon.expires_at).getTime() < Date.now()) return { valid: false, reason: 'coupon expired' };
  if (coupon.max_uses != null && coupon.uses_count >= coupon.max_uses) return { valid: false, reason: 'coupon usage limit reached' };
  if (path && !matchPattern(coupon.scope_pattern || '*', path)) return { valid: false, reason: 'coupon does not cover this route' };
  return { valid: true };
}

async function redeemCouponTool(env, a) {
  const code = clean(a.code);
  if (!code) throw new Error('code is required');
  const coupon = await dbFirst(env, 'SELECT * FROM coupons WHERE code = ?', [code]);
  const check = couponValidity(coupon, clean(a.path));
  if (!check.valid) return { ok: false, error: check.reason, code };
  await dbRun(env, 'UPDATE coupons SET uses_count = uses_count + 1, updated_at = ? WHERE id = ?', [nowIso(), coupon.id]);
  await logUsage(env, {
    route: clean(a.path) || coupon.scope_pattern, method: clean(a.method) || '*', caller_id: clean(a.caller_id) || null,
    outcome: coupon.kind === 'discount' ? 'coupon_discount' : 'coupon_free', coupon_code: code
  });
  return { ok: true, coupon: { ...coupon, uses_count: coupon.uses_count + 1 } };
}

// =======================================================================
// Enterprise / custom pricing tiers
// =======================================================================
async function createPricingTier(env, a) {
  const callerId = clean(a.caller_id);
  if (!callerId) throw new Error('caller_id is required (the account/customer this tier applies to)');
  const priceMode = clean(a.price_mode) || 'flat';
  const id = uid('tier');
  const ts = nowIso();
  const priceAtomic = a.price_atomic != null ? clean(a.price_atomic) : (a.price_usd != null ? toAtomic(a.price_usd, a.decimals) : null);
  await dbRun(env, `INSERT INTO pricing_tiers
      (id, name, caller_id, scope_pattern, price_atomic, price_mode, compute_rate_atomic,
       requires_identity, requires_bot_auth, enabled, note, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,1,?,?,?)`,
    [id, clean(a.name) || (callerId + ' tier'), callerId, clean(a.scope_pattern) || '*', priceAtomic, priceMode,
      clean(a.compute_rate_atomic) || null, bool01(a.requires_identity), bool01(a.requires_bot_auth),
      clean(a.note) || null, ts, ts]);
  return { ok: true, tier: await dbFirst(env, 'SELECT * FROM pricing_tiers WHERE id = ?', [id]) };
}

async function listPricingTiers(env, a) {
  const callerId = clean(a.caller_id);
  const rows = callerId
    ? await dbAll(env, 'SELECT * FROM pricing_tiers WHERE caller_id = ? ORDER BY created_at DESC', [callerId])
    : await dbAll(env, 'SELECT * FROM pricing_tiers ORDER BY created_at DESC LIMIT ?', [limitNum(a.limit, 200, 1, 500)]);
  return { ok: true, count: rows.length, tiers: rows };
}

async function updatePricingTier(env, a) {
  const id = clean(a.id);
  if (!id) throw new Error('id is required');
  const sets = [];
  const params = [];
  if (a.name != null) { sets.push('name = ?'); params.push(clean(a.name)); }
  if (a.scope_pattern != null) { sets.push('scope_pattern = ?'); params.push(clean(a.scope_pattern)); }
  if (a.price_atomic != null) { sets.push('price_atomic = ?'); params.push(clean(a.price_atomic)); }
  else if (a.price_usd != null) { sets.push('price_atomic = ?'); params.push(toAtomic(a.price_usd, a.decimals)); }
  if (a.price_mode != null) { sets.push('price_mode = ?'); params.push(clean(a.price_mode)); }
  if (a.compute_rate_atomic != null) { sets.push('compute_rate_atomic = ?'); params.push(clean(a.compute_rate_atomic)); }
  if (a.requires_identity != null) { sets.push('requires_identity = ?'); params.push(bool01(a.requires_identity)); }
  if (a.requires_bot_auth != null) { sets.push('requires_bot_auth = ?'); params.push(bool01(a.requires_bot_auth)); }
  if (a.enabled != null) { sets.push('enabled = ?'); params.push(bool01(a.enabled)); }
  if (!sets.length) return { ok: false, error: 'no updatable fields provided' };
  sets.push('updated_at = ?'); params.push(nowIso());
  params.push(id);
  await dbRun(env, `UPDATE pricing_tiers SET ${sets.join(', ')} WHERE id = ?`, params);
  return { ok: true, tier: await dbFirst(env, 'SELECT * FROM pricing_tiers WHERE id = ?', [id]) };
}

// =======================================================================
// Internal / company-owned tokens
// =======================================================================
async function registerInternalToken(env, a) {
  const name = clean(a.name);
  const network = clean(a.network);
  const asset = clean(a.asset);
  if (!name || !network || !asset) throw new Error('name, network, and asset are required');
  const assetAddr = assertValidAddressIfPresent(a.asset_address, 'asset_address');
  const id = uid('tok');
  await dbRun(env, `INSERT INTO internal_tokens
      (id, name, scheme, network, asset, asset_address, facilitator_url, enabled, note, created_at)
     VALUES (?,?,?,?,?,?,?,1,?,?)`,
    [id, name, clean(a.scheme) || 'exact', network, asset, assetAddr,
      clean(a.facilitator_url) || null, clean(a.note) || null, nowIso()]);
  return { ok: true, token: await dbFirst(env, 'SELECT * FROM internal_tokens WHERE id = ?', [id]) };
}

async function listInternalTokens(env, a) {
  const rows = await dbAll(env, 'SELECT * FROM internal_tokens ORDER BY created_at DESC LIMIT ?', [limitNum(a.limit, 200, 1, 500)]);
  return { ok: true, count: rows.length, tokens: rows };
}

// =======================================================================
// Settlement assets & display denominations (V1.3A — display/policy
// abstraction only; see docs/AGENT-OPERATING-BALANCES.md).
//
// Both tables below are descriptive metadata. Registering a settlement
// asset or a display denomination does NOT create a new settlement path,
// a customer balance, or a token — it only labels/describes assets this
// Worker already settles through (settlement_assets) or maps a
// human-readable unit onto an exact atomic value of one of those assets
// (display_denominations). Neither table is read by verifyPayment,
// settlePayment, or facilitatorCall. The existing internal_tokens table
// is unrelated to this and remains a facilitator-routing registry, not a
// customer-money ledger.
// =======================================================================
async function registerSettlementAsset(env, a) {
  const asset = clean(a.asset);
  const network = clean(a.network);
  if (!asset || !network) throw new Error('asset and network are required');
  const decimals = Number.isFinite(Number(a.decimals)) ? Number(a.decimals) : 6;
  const id = uid('sasset');
  const ts = nowIso();
  await dbRun(env, `INSERT INTO settlement_assets
      (id, asset, network, decimals, facilitator_url, provider, status, jurisdiction_notes, enabled, note, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,1,?,?,?)`,
    [id, asset, network, decimals, clean(a.facilitator_url) || null, clean(a.provider) || null,
      clean(a.status) || 'active', clean(a.jurisdiction_notes) || null, clean(a.note) || null, ts, ts]);
  return { ok: true, settlement_asset: await dbFirst(env, 'SELECT * FROM settlement_assets WHERE id = ?', [id]) };
}

async function listSettlementAssets(env, a) {
  const rows = await dbAll(env, 'SELECT * FROM settlement_assets ORDER BY created_at DESC LIMIT ?', [limitNum(a.limit, 200, 1, 500)]);
  return { ok: true, count: rows.length, settlement_assets: rows };
}

async function updateSettlementAsset(env, a) {
  const id = clean(a.id);
  if (!id) throw new Error('id is required');
  const sets = [];
  const params = [];
  const fields = ['facilitator_url', 'provider', 'status', 'jurisdiction_notes', 'note'];
  for (const f of fields) {
    if (a[f] != null) { sets.push(f + ' = ?'); params.push(clean(a[f])); }
  }
  if (a.decimals != null) { sets.push('decimals = ?'); params.push(Number(a.decimals)); }
  if (a.enabled != null) { sets.push('enabled = ?'); params.push(bool01(a.enabled)); }
  if (!sets.length) return { ok: false, error: 'no updatable fields provided' };
  sets.push('updated_at = ?'); params.push(nowIso());
  params.push(id);
  await dbRun(env, `UPDATE settlement_assets SET ${sets.join(', ')} WHERE id = ?`, params);
  return { ok: true, settlement_asset: await dbFirst(env, 'SELECT * FROM settlement_assets WHERE id = ?', [id]) };
}

// atomic_value is always an integer string (smallest units of the
// referenced settlement asset) — never a float, per the canonical unit
// model. A mill is 1000 microunits ($0.001) on a 6-decimal asset.
async function registerDisplayDenomination(env, a) {
  const name = clean(a.name);
  const atomicValue = clean(a.atomic_value);
  if (!name) throw new Error('name is required, e.g. Penny, Nickel, Quarter, Dollar, Mill');
  if (!/^\d+$/.test(atomicValue)) throw new Error('atomic_value is required and must be a non-negative integer string (never a float)');
  const id = uid('denom');
  const ts = nowIso();
  await dbRun(env, `INSERT INTO display_denominations
      (id, name, symbol, atomic_value, settlement_asset_ref, locale, singular_label, plural_label, marketing_only, enabled, note, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,1,?,?,?)`,
    [id, name, clean(a.symbol) || null, atomicValue, clean(a.settlement_asset_ref) || null, clean(a.locale) || null,
      clean(a.singular_label) || null, clean(a.plural_label) || null, a.marketing_only === false ? 0 : 1,
      clean(a.note) || null, ts, ts]);
  return { ok: true, denomination: await dbFirst(env, 'SELECT * FROM display_denominations WHERE id = ?', [id]) };
}

async function listDisplayDenominations(env, a) {
  const rows = await dbAll(env, 'SELECT * FROM display_denominations ORDER BY created_at DESC LIMIT ?', [limitNum(a.limit, 200, 1, 500)]);
  return { ok: true, count: rows.length, denominations: rows };
}

async function updateDisplayDenomination(env, a) {
  const id = clean(a.id);
  if (!id) throw new Error('id is required');
  const sets = [];
  const params = [];
  if (a.name != null) { sets.push('name = ?'); params.push(clean(a.name)); }
  if (a.symbol != null) { sets.push('symbol = ?'); params.push(clean(a.symbol)); }
  if (a.atomic_value != null) {
    const av = clean(a.atomic_value);
    if (!/^\d+$/.test(av)) throw new Error('atomic_value must be a non-negative integer string');
    sets.push('atomic_value = ?'); params.push(av);
  }
  if (a.settlement_asset_ref != null) { sets.push('settlement_asset_ref = ?'); params.push(clean(a.settlement_asset_ref)); }
  if (a.locale != null) { sets.push('locale = ?'); params.push(clean(a.locale)); }
  if (a.singular_label != null) { sets.push('singular_label = ?'); params.push(clean(a.singular_label)); }
  if (a.plural_label != null) { sets.push('plural_label = ?'); params.push(clean(a.plural_label)); }
  if (a.marketing_only != null) { sets.push('marketing_only = ?'); params.push(bool01(a.marketing_only)); }
  if (a.enabled != null) { sets.push('enabled = ?'); params.push(bool01(a.enabled)); }
  if (a.note != null) { sets.push('note = ?'); params.push(clean(a.note)); }
  if (!sets.length) return { ok: false, error: 'no updatable fields provided' };
  sets.push('updated_at = ?'); params.push(nowIso());
  params.push(id);
  await dbRun(env, `UPDATE display_denominations SET ${sets.join(', ')} WHERE id = ?`, params);
  return { ok: true, denomination: await dbFirst(env, 'SELECT * FROM display_denominations WHERE id = ?', [id]) };
}

// Purely additive, opt-in display info derived from an existing
// denomination's atomic_value. Never called unless the caller explicitly
// passes display_denomination_id to evaluate_request, and never affects
// priceAtomic, accepts[], or the x402 payment requirement itself.
async function buildDisplayAmount(env, denominationId, priceAtomic) {
  const id = clean(denominationId);
  if (!id) return null;
  const denom = await dbFirst(env, 'SELECT * FROM display_denominations WHERE id = ? AND enabled = 1', [id]);
  if (!denom) return null;
  const unit = BigInt(denom.atomic_value);
  if (unit <= 0n) return null;
  const price = BigInt(priceAtomic || '0');
  const wholeUnits = price / unit;
  const remainderAtomic = (price % unit).toString();
  const label = (wholeUnits === 1n ? (denom.singular_label || denom.name) : (denom.plural_label || denom.name + 's'));
  return {
    denomination_id: denom.id,
    name: denom.name,
    symbol: denom.symbol,
    atomic_value: denom.atomic_value,
    settlement_asset_ref: denom.settlement_asset_ref,
    marketing_only: !!denom.marketing_only,
    whole_units: wholeUnits.toString(),
    remainder_atomic: remainderAtomic,
    label: `${wholeUnits.toString()} ${label}` + (remainderAtomic !== '0' ? ` + ${remainderAtomic} atomic remainder` : '')
  };
}

// =======================================================================
// Facilitator proxy (verify / settle)
// =======================================================================
function decodePaymentHeader(b64) {
  if (!b64) return null;
  try { return JSON.parse(atob(b64)); } catch { return b64; } // fall back to raw string if not base64 JSON
}

// Cloudflare blocks a Worker on *.workers.dev from fetch()-ing another
// *.workers.dev subdomain directly (error 1042). Known sibling workers.dev
// facilitators get routed through a Service Binding instead; anything else
// (the public internet, or a facilitator on a custom domain) uses a plain
// fetch() as normal.
const WORKERS_DEV_SERVICE_BINDINGS = {
  'x402-mock-facilitator.jaredtechfit.workers.dev': 'MOCK_FACILITATOR'
};

// Best-effort ERC-20 balanceOf() read via a public RPC. Returns null
// (never throws) on any failure — this is a fast-fail optimization,
// not a trust boundary; the facilitator's /verify remains the
// authoritative check regardless of what this returns.
async function getOnChainBalance(rpcUrl, tokenAddress, ownerAddress) {
  try {
    const ownerHex = ownerAddress.toLowerCase().replace(/^0x/, '').padStart(64, '0');
    const data = '0x70a08231' + ownerHex;
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: tokenAddress, data }, 'latest'] })
    });
    const json = await res.json();
    if (!json || !json.result || json.result === '0x') return null;
    return BigInt(json.result);
  } catch (e) {
    return null;
  }
}

async function facilitatorCall(env, facilitatorUrl, path, body) {
  const base = clean(facilitatorUrl) || env.X402_FACILITATOR_URL || DEFAULT_FACILITATOR;
  const url = base.replace(/\/$/, '') + path;
  const req = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  let res;
  try {
    const bindingName = WORKERS_DEV_SERVICE_BINDINGS[new URL(base).hostname];
    res = bindingName && env[bindingName] ? await env[bindingName].fetch(url, req) : await fetch(url, req);
  } catch (e) {
    return { httpStatus: 0, httpOk: false, facilitator: base, data: { raw: 'fetch failed: ' + String(e.message || e) } };
  }
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { httpStatus: res.status, httpOk: res.ok, facilitator: base, data };
}

async function verifyPayment(env, a) {
  const paymentPayload = a.payment_payload || decodePaymentHeader(clean(a.x_payment));
  if (!paymentPayload) throw new Error('x_payment (X-PAYMENT header value) or payment_payload is required');
  if (!a.payment_requirements) throw new Error('payment_requirements is required (the accepts[] entry the client is paying against)');
  const result = await facilitatorCall(env, a.facilitator_url, '/verify', {
    x402Version: X402_VERSION, paymentPayload, paymentRequirements: a.payment_requirements
  });
  return { ok: true, verify: result };
}

async function settlePayment(env, a) {
  const paymentPayload = a.payment_payload || decodePaymentHeader(clean(a.x_payment));
  if (!paymentPayload) throw new Error('x_payment (X-PAYMENT header value) or payment_payload is required');
  if (!a.payment_requirements) throw new Error('payment_requirements is required');
  const settleStart = Date.now();
  const result = await facilitatorCall(env, a.facilitator_url, '/settle', {
    x402Version: X402_VERSION, paymentPayload, paymentRequirements: a.payment_requirements
  });
  const settleLatencyMs = Date.now() - settleStart;
  if (result.data && result.data.success) {
    await logUsage(env, {
      route: a.payment_requirements.resource || 'unknown', method: clean(a.method) || '*',
      caller_id: clean(a.caller_id) || null, outcome: 'paid',
      price_atomic: a.payment_requirements.maxAmountRequired, asset: a.payment_requirements.asset,
      network: a.payment_requirements.network, payment_id: result.data.txHash || null,
      facilitator_latency_ms: settleLatencyMs, facilitator_http_status: result.httpStatus, facilitator_url: result.facilitator
    });
  }
  return { ok: true, settle: result };
}

// =======================================================================
// Core: evaluate a request against policy (rules -> coupon -> tier -> payment)
// =======================================================================
function buildAccepts(rule, priceAtomic, payTo, path, description) {
  return [{
    scheme: 'exact',
    network: rule.network,
    maxAmountRequired: priceAtomic,
    resource: path,
    description: description || rule.description || '',
    mimeType: 'application/json',
    payTo: payTo || rule.pay_to,
    maxTimeoutSeconds: 60,
    asset: rule.asset_address || assetAddress(rule.network, rule.asset, null) || rule.asset,
    // `name`/`version` are the EIP-712 domain fields a facilitator needs to
    // reconstruct the signing domain and verify the signature (this is the
    // spec's actual field naming, confirmed against a live facilitator
    // response of "invalid_exact_evm_missing_eip712_domain" without it).
    // USDC and EURC (Circle's FiatTokenV2) both use version "2".
    extra: { name: rule.asset, version: '2', decimals: 6 }
  }];
}

async function logUsage(env, fields) {
  try {
    await dbRun(env, `INSERT INTO usage_events
        (id, ts, route, method, caller_id, outcome, price_atomic, asset, network, coupon_code, tier_id, payment_id, note,
         duration_ms, facilitator_latency_ms, facilitator_http_status, facilitator_url)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [uid('evt'), nowIso(), fields.route || '', fields.method || '*', fields.caller_id || null, fields.outcome,
        fields.price_atomic || null, fields.asset || null, fields.network || null, fields.coupon_code || null,
        fields.tier_id || null, fields.payment_id || null, fields.note || null,
        fields.duration_ms != null ? Math.round(fields.duration_ms) : null,
        fields.facilitator_latency_ms != null ? Math.round(fields.facilitator_latency_ms) : null,
        fields.facilitator_http_status != null ? fields.facilitator_http_status : null,
        fields.facilitator_url || null]);
  } catch (e) {
    // Usage logging must never break the evaluate/settle path.
  }
}

async function findMatchingRule(env, path, method) {
  const rows = await dbAll(env, 'SELECT * FROM payment_rules WHERE enabled = 1 ORDER BY priority ASC, created_at ASC LIMIT 500');
  for (const rule of rows) {
    if (rule.method !== '*' && rule.method.toUpperCase() !== String(method || 'GET').toUpperCase()) continue;
    if (matchPattern(rule.pattern, path)) return rule;
  }
  return null;
}

// If the caller didn't pass facilitator_url explicitly, check whether a
// registered internal_token matches this rule's network/asset and has
// its own facilitator_url — if so, use that as the default instead of
// silently falling through to the global default facilitator. This is
// what makes register_internal_token do something beyond bookkeeping.
// Falling short of that, check settlement_assets the same way: it's
// general "this is how we settle this asset" metadata (V1.3A), whereas
// internal_tokens represents a more deliberate, specific company-owned
// override, so internal_tokens is checked first and wins on conflict.
// A settlement_asset with status 'deprecated' is skipped even if
// enabled, since 'deprecated' is a stronger signal than 'enabled' that
// it shouldn't be actively routed through. An explicit facilitator_url
// passed by the caller always wins over both of these.
async function resolveFacilitatorUrl(env, explicit, network, asset) {
  const given = clean(explicit);
  if (given) return given;
  const token = await dbFirst(env,
    'SELECT facilitator_url FROM internal_tokens WHERE network = ? AND asset = ? AND enabled = 1 AND facilitator_url IS NOT NULL ORDER BY created_at DESC LIMIT 1',
    [network, asset]);
  if (token && token.facilitator_url) return token.facilitator_url;
  const settlementAsset = await dbFirst(env,
    "SELECT facilitator_url FROM settlement_assets WHERE network = ? AND asset = ? AND enabled = 1 AND status != 'deprecated' AND facilitator_url IS NOT NULL ORDER BY created_at DESC LIMIT 1",
    [network, asset]);
  if (settlementAsset && settlementAsset.facilitator_url) return settlementAsset.facilitator_url;
  return explicit;
}

async function findTier(env, callerId, path) {
  if (!callerId) return null;
  const rows = await dbAll(env, 'SELECT * FROM pricing_tiers WHERE caller_id = ? AND enabled = 1 ORDER BY created_at DESC', [callerId]);
  return rows.find(t => matchPattern(t.scope_pattern || '*', path)) || null;
}

async function evaluateRequest(env, a) {
  const requestStart = Date.now();
  const path = clean(a.path);
  const method = (clean(a.method) || 'GET').toUpperCase();
  if (!path) throw new Error('path is required');
  const callerId = clean(a.caller_id) || null;

  const rule = await findMatchingRule(env, path, method);
  if (!rule) {
    return { ok: true, status: 200, access: 'unprotected', reason: 'no matching payment rule for this route' };
  }

  let discountPct;
  let appliedCouponCode;

  // 1. Coupon check
  if (a.coupon_code) {
    const coupon = await dbFirst(env, 'SELECT * FROM coupons WHERE code = ?', [clean(a.coupon_code)]);
    const check = couponValidity(coupon, path);
    if (check.valid) {
      if (coupon.kind === 'free' || coupon.kind === 'trial') {
        await dbRun(env, 'UPDATE coupons SET uses_count = uses_count + 1, updated_at = ? WHERE id = ?', [nowIso(), coupon.id]);
        await logUsage(env, { route: path, method, caller_id: callerId, outcome: 'coupon_free', coupon_code: coupon.code, duration_ms: Date.now() - requestStart });
        return { ok: true, status: 200, access: 'coupon', coupon_kind: coupon.kind, coupon_code: coupon.code };
      }
      // discount: fall through to paid flow with an adjusted price
      discountPct = coupon.discount_pct;
      appliedCouponCode = coupon.code;
    } else {
      // Invalid coupon supplied: don't silently ignore it, surface why.
      return { ok: true, status: 402, access: 'denied', reason: 'invalid_coupon: ' + check.reason };
    }
  }

  // 2. Tier check (may override price and add identity/bot-auth requirements)
  const tier = await findTier(env, callerId, path);
  let priceAtomic = rule.price_atomic;
  let payTo = rule.pay_to;
  let requiresIdentity = !!rule.auth_required;
  let requiresBotAuth = !!rule.bot_auth_required;
  let tierId = null;
  if (tier) {
    tierId = tier.id;
    if (tier.price_mode === 'flat' && tier.price_atomic != null) priceAtomic = tier.price_atomic;
    if (tier.price_mode === 'compute' && a.compute_units != null && tier.compute_rate_atomic != null) {
      priceAtomic = (BigInt(tier.compute_rate_atomic) * BigInt(Math.max(0, Math.round(Number(a.compute_units))))).toString();
    }
    requiresIdentity = requiresIdentity || !!tier.requires_identity;
    requiresBotAuth = requiresBotAuth || !!tier.requires_bot_auth;
  }
  if (typeof discountPct === 'number') {
    priceAtomic = (BigInt(priceAtomic) * BigInt(100 - discountPct) / 100n).toString();
  }

  // Variable/"upto" pricing: for an 'upto' rule, price_atomic (after any
  // tier/discount adjustment above) is a ceiling, not a fixed charge. If
  // the caller reports actual usage via actual_amount_atomic, charge
  // that instead — clamped so it can never exceed the ceiling and never
  // go negative. Rules default to the ceiling (identical to 'exact')
  // when no actual amount is reported, so this stays fully backward
  // compatible with callers that don't participate in metering.
  if (rule.mode === 'upto' && a.actual_amount_atomic != null) {
    const ceiling = BigInt(priceAtomic);
    let actual = null;
    try { actual = BigInt(clean(a.actual_amount_atomic)); } catch { /* ignore malformed input, fall back to ceiling */ }
    if (actual !== null && actual >= 0n) {
      priceAtomic = (actual > ceiling ? ceiling : actual).toString();
    }
  }

  if (requiresIdentity && !callerId) {
    return { ok: true, status: 401, access: 'denied', reason: 'this route requires an authenticated caller_id before payment is evaluated' };
  }
  if (requiresBotAuth && !a.bot_auth_verified) {
    return { ok: true, status: 401, access: 'denied', reason: 'this route requires Web Bot Auth / verified agent identity (bot_auth_verified=true) before payment is evaluated' };
  }

  if (BigInt(priceAtomic || '0') === 0n) {
    await logUsage(env, { route: path, method, caller_id: callerId, outcome: 'free_rule', tier_id: tierId, duration_ms: Date.now() - requestStart });
    return { ok: true, status: 200, access: tierId ? 'free_tier' : 'free_rule', tier_id: tierId, price_atomic: '0', asset: rule.asset, network: rule.network };
  }

  const accepts = buildAccepts(rule, priceAtomic, payTo, path);

  // 3. Payment already attached?
  if (a.x_payment) {
    const paymentPayload = decodePaymentHeader(clean(a.x_payment));

    // Best-effort on-chain balance pre-check: if we can resolve a known
    // RPC for this network and the payer's balance is clearly below the
    // price, fail fast with a clear reason instead of spending a round
    // trip on the facilitator. Never blocks on RPC failure or an
    // unrecognized network/asset — the facilitator's /verify remains
    // authoritative either way.
    const rpcUrl = KNOWN_RPCS[rule.network];
    const payerAddress = paymentPayload && paymentPayload.payload && paymentPayload.payload.authorization && paymentPayload.payload.authorization.from;
    const tokenAddress = accepts[0].asset;
    if (rpcUrl && payerAddress && /^0x[0-9a-fA-F]{40}$/.test(String(tokenAddress))) {
      const balance = await getOnChainBalance(rpcUrl, tokenAddress, payerAddress);
      if (balance !== null && balance < BigInt(priceAtomic)) {
        await logUsage(env, { route: path, method, caller_id: callerId, outcome: 'denied', price_atomic: priceAtomic, tier_id: tierId, note: 'insufficient_balance_precheck', duration_ms: Date.now() - requestStart });
        return {
          ok: true, status: 402, access: 'denied',
          reason: `insufficient on-chain balance: payer has ${balance.toString()} but needs ${priceAtomic} (atomic units, ${rule.asset} on ${rule.network})`,
          x402Version: X402_VERSION, accepts
        };
      }
    }

    const facilitatorUrl = await resolveFacilitatorUrl(env, a.facilitator_url, rule.network, rule.asset);

    const verifyStart = Date.now();
    const verify = await facilitatorCall(env, facilitatorUrl, '/verify', {
      x402Version: X402_VERSION, paymentPayload, paymentRequirements: accepts[0]
    });
    const verifyLatencyMs = Date.now() - verifyStart;
    if (!(verify.data && verify.data.isValid !== false && verify.httpOk)) {
      await logUsage(env, {
        route: path, method, caller_id: callerId, outcome: 'denied', price_atomic: priceAtomic, tier_id: tierId, note: 'verify_failed',
        duration_ms: Date.now() - requestStart, facilitator_latency_ms: verifyLatencyMs,
        facilitator_http_status: verify.httpStatus, facilitator_url: verify.facilitator
      });
      return { ok: true, status: 402, access: 'denied', reason: 'payment verification failed', verify: verify.data, x402Version: X402_VERSION, accepts };
    }
    const settleStart = Date.now();
    const settle = await facilitatorCall(env, facilitatorUrl, '/settle', {
      x402Version: X402_VERSION, paymentPayload, paymentRequirements: accepts[0]
    });
    const settleLatencyMs = Date.now() - settleStart;
    const outcome = settle.data && settle.data.success ? 'paid' : 'denied';
    await logUsage(env, {
      route: path, method, caller_id: callerId, outcome, price_atomic: priceAtomic, asset: rule.asset,
      network: rule.network, coupon_code: appliedCouponCode || null, tier_id: tierId,
      payment_id: settle.data && settle.data.txHash || null,
      duration_ms: Date.now() - requestStart, facilitator_latency_ms: verifyLatencyMs + settleLatencyMs,
      facilitator_http_status: settle.httpStatus, facilitator_url: settle.facilitator
    });
    if (outcome !== 'paid') {
      return { ok: true, status: 402, access: 'denied', reason: 'settlement failed', settle: settle.data, x402Version: X402_VERSION, accepts };
    }
    return {
      ok: true, status: 200, access: 'paid', settlement: settle.data, tier_id: tierId, coupon_code: appliedCouponCode || null,
      price_atomic: priceAtomic, asset: rule.asset, network: rule.network,
      display: await buildDisplayAmount(env, a.display_denomination_id, priceAtomic)
    };
  }

  // 4. No payment attached yet: return the 402 challenge.
  await logUsage(env, { route: path, method, caller_id: callerId, outcome: 'challenge_402', price_atomic: priceAtomic, tier_id: tierId, duration_ms: Date.now() - requestStart });
  return {
    ok: true, status: 402, access: 'payment_required', x402Version: X402_VERSION, error: 'X-PAYMENT-REQUIRED', accepts,
    price_atomic: priceAtomic, asset: rule.asset, network: rule.network,
    display: await buildDisplayAmount(env, a.display_denomination_id, priceAtomic)
  };
}

// =======================================================================
// Usage stats
// =======================================================================
async function getUsageStats(env, a) {
  const days = limitNum(a.days, 7, 1, 365);
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const rows = await dbAll(env, 'SELECT * FROM usage_events WHERE ts >= ? ORDER BY ts DESC LIMIT 5000', [since]);
  const byOutcome = {};
  const byRoute = {};
  let paidAtomicTotal = 0n;
  let facilitatorLatencySum = 0;
  let facilitatorLatencyCount = 0;
  let facilitatorLatencyMax = 0;
  for (const r of rows) {
    byOutcome[r.outcome] = (byOutcome[r.outcome] || 0) + 1;
    byRoute[r.route] = (byRoute[r.route] || 0) + 1;
    if (r.outcome === 'paid' && r.price_atomic) {
      try { paidAtomicTotal += BigInt(r.price_atomic); } catch { /* skip non-numeric */ }
    }
    if (r.facilitator_latency_ms != null) {
      facilitatorLatencySum += r.facilitator_latency_ms;
      facilitatorLatencyCount += 1;
      if (r.facilitator_latency_ms > facilitatorLatencyMax) facilitatorLatencyMax = r.facilitator_latency_ms;
    }
  }
  return {
    ok: true, window_days: days, event_count: rows.length, by_outcome: byOutcome,
    top_routes: Object.entries(byRoute).sort((a2, b2) => b2[1] - a2[1]).slice(0, 20),
    paid_atomic_total: paidAtomicTotal.toString(),
    facilitator_latency_ms: facilitatorLatencyCount
      ? { avg: Math.round(facilitatorLatencySum / facilitatorLatencyCount), max: facilitatorLatencyMax, sample_count: facilitatorLatencyCount }
      : null,
    recent_events: rows.slice(0, limitNum(a.recent, 25, 0, 200))
  };
}

async function recordUsageEvent(env, a) {
  if (!a.route || !a.outcome) throw new Error('route and outcome are required');
  await logUsage(env, a);
  return { ok: true, recorded: true };
}

// =======================================================================
// Circle Developer-Controlled Wallets (V1.4 pilot, testnet-only)
// =======================================================================
// Real MPC-custodied wallets via Circle's Developer-Controlled Wallets
// API, added to test the Case-2 (autonomous agent) signing path the
// ROADMAP explicitly deferred until a concrete use case existed. This
// is that use case: a small, real, on-chain-verifiable pilot before
// deciding whether/how to scale the agent roster with real wallets.
// Only two secrets are ever used: AFO_X402 (the Circle API key,
// Bearer-authed on every call) and CIRCLE_ENTITY_SECRET (a 32-byte hex
// value registered with Circle once; a FRESH RSA-OAEP-encrypted
// ciphertext of it is required on every mutating call, so it's
// re-encrypted per call below rather than cached). Neither this Worker
// nor Claude ever sees a raw private key -- Circle's MPC network holds
// key shares, this Worker only ever sends signing/creation requests.
const CIRCLE_API_BASE = 'https://api.circle.com/v1/w3s';
const CIRCLE_FAUCET_URL = 'https://api.circle.com/v1/faucet/drips';
const DEFAULT_CIRCLE_BLOCKCHAIN = 'BASE-SEPOLIA';

function requireCircleEnv(env) {
  if (!env.AFO_X402) throw new Error('Circle API key (secret AFO_X402) is not configured on this Worker');
  if (!env.CIRCLE_ENTITY_SECRET) throw new Error('CIRCLE_ENTITY_SECRET is not configured on this Worker -- register an entity secret with Circle first');
}

function hexToBytes(hex) {
  const h = clean(hex).replace(/^0x/, '');
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(h.substr(i * 2, 2), 16);
  return bytes;
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(binary);
}

function pemToDer(pem) {
  const b64 = pem.replace(/-----BEGIN [^-]+-----/, '').replace(/-----END [^-]+-----/, '').replace(/\s+/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function circleFetch(env, method, path, body) {
  requireCircleEnv(env);
  const res = await fetch(CIRCLE_API_BASE + path, {
    method,
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env.AFO_X402 },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { httpStatus: res.status, httpOk: res.ok, data };
}

// Circle mandates a FRESH entitySecretCiphertext on every mutating call
// -- reusing one is rejected -- so this re-fetches Circle's current RSA
// public key and re-encrypts on every call rather than caching a
// ciphertext. The public key itself changes rarely, but re-fetching is
// cheap and avoids ever serving a stale key after a rotation.
async function getCircleEntitySecretCiphertext(env) {
  requireCircleEnv(env);
  const pubKeyResp = await circleFetch(env, 'GET', '/config/entity/publicKey');
  const pem = pubKeyResp.data && pubKeyResp.data.data && pubKeyResp.data.data.publicKey;
  if (!pem) throw new Error('Could not fetch Circle entity public key: ' + JSON.stringify(pubKeyResp.data));
  const key = await crypto.subtle.importKey('spki', pemToDer(pem), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  const secretBytes = hexToBytes(env.CIRCLE_ENTITY_SECRET);
  const ciphertext = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, secretBytes);
  return bytesToBase64(new Uint8Array(ciphertext));
}

async function circleCreateWalletSet(env, a) {
  const name = clean(a.name) || ('afo-set-' + Date.now());
  const entitySecretCiphertext = await getCircleEntitySecretCiphertext(env);
  const resp = await circleFetch(env, 'POST', '/developer/walletSets', {
    idempotencyKey: crypto.randomUUID(), name, entitySecretCiphertext
  });
  return { ok: resp.httpOk, http_status: resp.httpStatus, result: resp.data };
}

async function circleListWalletSets(env, a) {
  const resp = await circleFetch(env, 'GET', '/developer/walletSets?pageSize=' + limitNum(a.limit, 25, 1, 100));
  return { ok: resp.httpOk, http_status: resp.httpStatus, result: resp.data };
}

async function circleCreateWallets(env, a) {
  const walletSetId = clean(a.wallet_set_id);
  if (!walletSetId) throw new Error('wallet_set_id is required (create one via circle_create_wallet_set first)');
  const blockchain = clean(a.blockchain) || DEFAULT_CIRCLE_BLOCKCHAIN;
  const count = limitNum(a.count, 1, 1, 20);
  const entitySecretCiphertext = await getCircleEntitySecretCiphertext(env);
  const resp = await circleFetch(env, 'POST', '/developer/wallets', {
    idempotencyKey: crypto.randomUUID(), walletSetId, blockchains: [blockchain], count, entitySecretCiphertext
  });
  return { ok: resp.httpOk, http_status: resp.httpStatus, result: resp.data };
}

async function circleListWallets(env, a) {
  const params = new URLSearchParams();
  if (clean(a.wallet_set_id)) params.set('walletSetId', clean(a.wallet_set_id));
  params.set('pageSize', String(limitNum(a.limit, 50, 1, 100)));
  const resp = await circleFetch(env, 'GET', '/wallets?' + params.toString());
  return { ok: resp.httpOk, http_status: resp.httpStatus, result: resp.data };
}

async function circleGetWalletBalance(env, a) {
  const walletId = clean(a.wallet_id);
  if (!walletId) throw new Error('wallet_id is required');
  const resp = await circleFetch(env, 'GET', '/wallets/' + walletId + '/balances');
  return { ok: resp.httpOk, http_status: resp.httpStatus, result: resp.data };
}

// Testnet-only faucet drip. Circle rate-limits this to 20 USDC per
// address per blockchain every 2 hours -- fine for pilot funding, not a
// bulk-funding mechanism for a full roster.
async function circleFundWallet(env, a) {
  const address = assertValidAddress(a.address, 'address');
  const blockchain = clean(a.blockchain) || DEFAULT_CIRCLE_BLOCKCHAIN;
  requireCircleEnv(env);
  const res = await fetch(CIRCLE_FAUCET_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env.AFO_X402 },
    body: JSON.stringify({ address, blockchain, usdc: a.usdc === false ? false : true, native: a.native === false ? false : true })
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { ok: res.ok, http_status: res.status, result: data };
}

async function circleTransfer(env, a) {
  const walletId = clean(a.wallet_id);
  if (!walletId) throw new Error('wallet_id (source) is required');
  const destinationAddress = assertValidAddress(a.destination_address, 'destination_address');
  const amount = clean(a.amount);
  if (!amount || !Number.isFinite(Number(amount)) || Number(amount) <= 0) throw new Error('amount is required and must be a positive DECIMAL USDC string, e.g. "0.01" -- not atomic units');
  const blockchain = clean(a.blockchain) || DEFAULT_CIRCLE_BLOCKCHAIN;
  const tokenAddress = assetAddress(blockchain.toLowerCase(), 'USDC', clean(a.token_address) || null);
  if (!tokenAddress) throw new Error(`No known USDC token address for blockchain '${blockchain}' -- pass token_address explicitly`);
  const entitySecretCiphertext = await getCircleEntitySecretCiphertext(env);
  // Note: the raw REST endpoint's field names differ from the SDK's
  // client-method parameter names (which the earlier version of this
  // function mistakenly followed) -- confirmed empirically against a
  // live 400 response: the wire format wants a flat `blockchain` field
  // paired with `tokenAddress` (not `tokenBlockchain`), and a top-level
  // `feeLevel` string (not a nested `fee: {type, config}` object).
  const resp = await circleFetch(env, 'POST', '/developer/transactions/transfer', {
    idempotencyKey: crypto.randomUUID(), walletId, tokenAddress, blockchain,
    destinationAddress, amounts: [amount],
    feeLevel: clean(a.fee_level) || 'MEDIUM',
    entitySecretCiphertext
  });
  return { ok: resp.httpOk, http_status: resp.httpStatus, result: resp.data };
}

async function circleGetTransaction(env, a) {
  const transactionId = clean(a.transaction_id);
  if (!transactionId) throw new Error('transaction_id is required');
  const resp = await circleFetch(env, 'GET', '/transactions/' + transactionId);
  return { ok: resp.httpOk, http_status: resp.httpStatus, result: resp.data };
}

// =======================================================================
// MCP plumbing
// =======================================================================
function status(env) {
  return {
    ok: true,
    worker: WORKER,
    deployed_as: env.WORKER_NAME || null,
    version: VERSION,
    mode: 'x402_policy_engine',
    facilitator_default: env.X402_FACILITATOR_URL || DEFAULT_FACILITATOR,
    bindings: { DB: !!env.DB, AI: !!env.AI, WORKER_NAME: !!env.WORKER_NAME, AFO_X402: !!env.AFO_X402, CIRCLE_ENTITY_SECRET: !!env.CIRCLE_ENTITY_SECRET },
    auth_configured: !!env.MCP_AUTH_TOKEN,
    tools: toolSchemas.map(t => t.name)
  };
}

const obj = (properties, required) => ({ type: 'object', properties, required: required || [] });
const str = { type: 'string' };
const num = { type: 'number' };
const boolT = { type: 'boolean' };

const toolSchemas = [
  { name: 'subagent_status', description: 'Health check: bindings, facilitator default, and tool list.', inputSchema: obj({}) },

  { name: 'create_payment_rule', description: 'Protect a route pattern (e.g. /api/premium/*) with an x402 price. Provide price_usd (converted to atomic units) or price_atomic directly.',
    inputSchema: obj({ pattern: str, method: str, mode: str, price_usd: num, price_atomic: str, decimals: num, asset: str, asset_address: str, network: str, pay_to: str, auth_required: boolT, bot_auth_required: boolT, description: str, priority: num }, ['pattern', 'pay_to']) },
  { name: 'list_payment_rules', description: 'List protected-route rules, optionally filtered by a substring of the pattern.', inputSchema: obj({ query: str, limit: num }) },
  { name: 'update_payment_rule', description: 'Patch an existing payment rule by id (price, enabled, priority, etc).', inputSchema: obj({ id: str, pattern: str, method: str, mode: str, price_usd: num, price_atomic: str, decimals: num, asset: str, network: str, pay_to: str, description: str, priority: num, enabled: boolT, auth_required: boolT, bot_auth_required: boolT }, ['id']) },
  { name: 'delete_payment_rule', description: 'Remove a payment rule by id.', inputSchema: obj({ id: str }, ['id']) },

  { name: 'issue_coupon', description: "Issue a coupon: kind='free' (zero-price access), 'trial' (same as free, semantically a trial), or 'discount' (discount_pct off the matched rule's price). Optionally scope to one route pattern, one caller_id, a use-count limit, and/or an expiry.",
    inputSchema: obj({ code: str, kind: str, discount_pct: num, scope_pattern: str, caller_id: str, max_uses: num, expires_at: str, expires_in_days: num, note: str }) },
  { name: 'list_coupons', description: 'List coupons. active_only (default true) filters out revoked/expired/exhausted coupons.', inputSchema: obj({ limit: num, active_only: boolT }) },
  { name: 'revoke_coupon', description: 'Revoke a coupon by code or id.', inputSchema: obj({ code: str, id: str }) },
  { name: 'redeem_coupon', description: 'Manually validate and redeem a coupon (increments its use count). evaluate_request does this automatically when coupon_code is passed; use this tool mainly for manual testing.', inputSchema: obj({ code: str, path: str, method: str, caller_id: str }, ['code']) },

  { name: 'create_pricing_tier', description: "Create an enterprise/custom pricing tier for one caller_id: flat price override or per-compute-unit rate, plus optional identity/Web-Bot-Auth requirements.",
    inputSchema: obj({ name: str, caller_id: str, scope_pattern: str, price_usd: num, price_atomic: str, decimals: num, price_mode: str, compute_rate_atomic: str, requires_identity: boolT, requires_bot_auth: boolT, note: str }, ['caller_id']) },
  { name: 'list_pricing_tiers', description: 'List pricing tiers, optionally filtered to one caller_id.', inputSchema: obj({ caller_id: str, limit: num }) },
  { name: 'update_pricing_tier', description: 'Patch an existing pricing tier by id.', inputSchema: obj({ id: str, name: str, scope_pattern: str, price_usd: num, price_atomic: str, decimals: num, price_mode: str, compute_rate_atomic: str, requires_identity: boolT, requires_bot_auth: boolT, enabled: boolT }, ['id']) },

  { name: 'register_internal_token', description: 'Register a company-owned token / internal payment scheme (custom asset + network, optionally your own facilitator_url).', inputSchema: obj({ name: str, scheme: str, network: str, asset: str, asset_address: str, facilitator_url: str, note: str }, ['name', 'network', 'asset']) },
  { name: 'list_internal_tokens', description: 'List registered internal tokens.', inputSchema: obj({ limit: num }) },

  { name: 'register_settlement_asset', description: 'Register descriptive metadata (provider, status, jurisdiction notes) for an external asset/network this Worker already settles through. Does not create a new settlement path.', inputSchema: obj({ asset: str, network: str, decimals: num, facilitator_url: str, provider: str, status: str, jurisdiction_notes: str, note: str }, ['asset', 'network']) },
  { name: 'list_settlement_assets', description: 'List registered settlement-asset metadata.', inputSchema: obj({ limit: num }) },
  { name: 'update_settlement_asset', description: 'Patch settlement-asset metadata by id.', inputSchema: obj({ id: str, facilitator_url: str, provider: str, status: str, jurisdiction_notes: str, decimals: num, note: str, enabled: boolT }, ['id']) },
  { name: 'register_display_denomination', description: 'Register a human-readable display/marketing unit (e.g. Penny, Nickel, Quarter, Dollar, Mill) mapped to an exact atomic_value. Never a separate token or liability — display only.', inputSchema: obj({ name: str, symbol: str, atomic_value: str, settlement_asset_ref: str, locale: str, singular_label: str, plural_label: str, marketing_only: boolT, note: str }, ['name', 'atomic_value']) },
  { name: 'list_display_denominations', description: 'List registered display denominations.', inputSchema: obj({ limit: num }) },
  { name: 'update_display_denomination', description: 'Patch a display denomination by id. Changing a label never changes the atomic amount.', inputSchema: obj({ id: str, name: str, symbol: str, atomic_value: str, settlement_asset_ref: str, locale: str, singular_label: str, plural_label: str, marketing_only: boolT, note: str, enabled: boolT }, ['id']) },

  { name: 'evaluate_request', description: "ONE-CALL policy decision for a single incoming request. Given path/method (+ optional caller_id, coupon_code, x_payment header value, bot_auth_verified, compute_units, actual_amount_atomic), returns either status 200 with the access reason (unprotected/free_rule/free_tier/coupon/paid) or status 402/401 with the x402 `accepts` challenge to hand back to the caller. actual_amount_atomic only applies to rules with mode='upto': it reports real usage so the rule's stored price acts as a ceiling rather than a fixed charge (clamped so it never exceeds the ceiling); omit it and an 'upto' rule behaves like 'exact'. facilitator_url is optional: if omitted, resolution falls through explicit facilitator_url -> a registered internal_token matching the rule's network/asset -> a registered settlement_asset matching the rule's network/asset (skipped if status='deprecated') -> the global default facilitator; the first one found wins. Machine amounts (price_atomic/asset/network) are always included on priced outcomes; passing display_denomination_id additionally returns a human-readable 'display' block (via a registered display denomination) without changing the machine amount or the x402 payment requirement itself. This is what a protected Worker should call per-request.",
    inputSchema: obj({ path: str, method: str, caller_id: str, coupon_code: str, x_payment: str, bot_auth_verified: boolT, compute_units: num, actual_amount_atomic: str, facilitator_url: str, display_denomination_id: str }, ['path']) },
  { name: 'verify_payment', description: 'Proxy a raw X-PAYMENT payload + payment_requirements to the facilitator /verify endpoint.', inputSchema: obj({ x_payment: str, payment_payload: obj({}), payment_requirements: obj({}), facilitator_url: str }, ['payment_requirements']) },
  { name: 'settle_payment', description: 'Proxy a raw X-PAYMENT payload + payment_requirements to the facilitator /settle endpoint and log the outcome.', inputSchema: obj({ x_payment: str, payment_payload: obj({}), payment_requirements: obj({}), facilitator_url: str, caller_id: str, method: str }, ['payment_requirements']) },

  { name: 'get_usage_stats', description: 'Summarize usage_events over a trailing window: counts by outcome, top routes, total paid (atomic units), and recent events.', inputSchema: obj({ days: num, recent: num }) },
  { name: 'record_usage_event', description: 'Manually log a usage event (route, outcome, etc) — for cases where settlement happened outside evaluate_request/settle_payment.', inputSchema: obj({ route: str, method: str, caller_id: str, outcome: str, price_atomic: str, asset: str, network: str, coupon_code: str, tier_id: str, payment_id: str, note: str }, ['route', 'outcome']) },

  { name: 'circle_create_wallet_set', description: 'Create a Circle Developer-Controlled Wallets "wallet set" (a named group of MPC wallets sharing one HD seed). Create one before creating wallets. Testnet/sandbox only in this deployment.',
    inputSchema: obj({ name: str }) },
  { name: 'circle_list_wallet_sets', description: 'List existing Circle wallet sets.', inputSchema: obj({ limit: num }) },
  { name: 'circle_create_wallets', description: 'Create one or more real Circle-custodied (MPC) wallets inside a wallet_set_id, on a given blockchain (default BASE-SEPOLIA). Each wallet gets a real on-chain address; no private key is ever exposed to this Worker. count defaults to 1, max 20 per call.',
    inputSchema: obj({ wallet_set_id: str, count: num, blockchain: str }, ['wallet_set_id']) },
  { name: 'circle_list_wallets', description: 'List Circle wallets, optionally filtered to one wallet_set_id.', inputSchema: obj({ wallet_set_id: str, limit: num }) },
  { name: 'circle_get_wallet_balance', description: "Get a Circle wallet's on-chain token balances (by wallet_id).", inputSchema: obj({ wallet_id: str }, ['wallet_id']) },
  { name: 'circle_fund_wallet', description: "Testnet-only: request free testnet USDC (and native gas token, by default) for a wallet address from Circle's faucet. Rate-limited by Circle to 20 USDC per address per blockchain every 2 hours.",
    inputSchema: obj({ address: str, blockchain: str, usdc: boolT, native: boolT }, ['address']) },
  { name: 'circle_transfer', description: 'Send a real on-chain USDC transfer from a Circle-custodied wallet (wallet_id) to any address, on a given blockchain (default BASE-SEPOLIA). amount is a DECIMAL USDC string (e.g. "0.01"), not atomic units. Returns a transaction id -- poll circle_get_transaction for the on-chain tx hash once it confirms (verifiable on a block explorer like basescan).',
    inputSchema: obj({ wallet_id: str, destination_address: str, amount: str, blockchain: str, token_address: str, fee_level: str }, ['wallet_id', 'destination_address', 'amount']) },
  { name: 'circle_get_transaction', description: 'Look up a Circle transaction by id -- returns status and, once confirmed, the on-chain txHash you can check on a block explorer.', inputSchema: obj({ transaction_id: str }, ['transaction_id']) }
];

async function callTool(env, name, args) {
  const a = args || {};
  switch (name) {
    case 'subagent_status': return status(env);
    case 'create_payment_rule': return createPaymentRule(env, a);
    case 'list_payment_rules': return listPaymentRules(env, a);
    case 'update_payment_rule': return updatePaymentRule(env, a);
    case 'delete_payment_rule': return deletePaymentRule(env, a);
    case 'issue_coupon': return issueCoupon(env, a);
    case 'list_coupons': return listCoupons(env, a);
    case 'revoke_coupon': return revokeCoupon(env, a);
    case 'redeem_coupon': return redeemCouponTool(env, a);
    case 'create_pricing_tier': return createPricingTier(env, a);
    case 'list_pricing_tiers': return listPricingTiers(env, a);
    case 'update_pricing_tier': return updatePricingTier(env, a);
    case 'register_internal_token': return registerInternalToken(env, a);
    case 'list_internal_tokens': return listInternalTokens(env, a);
    case 'register_settlement_asset': return registerSettlementAsset(env, a);
    case 'list_settlement_assets': return listSettlementAssets(env, a);
    case 'update_settlement_asset': return updateSettlementAsset(env, a);
    case 'register_display_denomination': return registerDisplayDenomination(env, a);
    case 'list_display_denominations': return listDisplayDenominations(env, a);
    case 'update_display_denomination': return updateDisplayDenomination(env, a);
    case 'evaluate_request': return evaluateRequest(env, a);
    case 'verify_payment': return verifyPayment(env, a);
    case 'settle_payment': return settlePayment(env, a);
    case 'get_usage_stats': return getUsageStats(env, a);
    case 'record_usage_event': return recordUsageEvent(env, a);
    case 'circle_create_wallet_set': return circleCreateWalletSet(env, a);
    case 'circle_list_wallet_sets': return circleListWalletSets(env, a);
    case 'circle_create_wallets': return circleCreateWallets(env, a);
    case 'circle_list_wallets': return circleListWallets(env, a);
    case 'circle_get_wallet_balance': return circleGetWalletBalance(env, a);
    case 'circle_fund_wallet': return circleFundWallet(env, a);
    case 'circle_transfer': return circleTransfer(env, a);
    case 'circle_get_transaction': return circleGetTransaction(env, a);
    default: throw new Error('Unknown tool: ' + name);
  }
}

// MCP clients (including Claude's interactive tool-call path) send
// `Accept: application/json, text/event-stream` and expect SSE framing
// back on the Streamable HTTP transport. Returning plain JSON to that
// Accept header causes the client to silently abandon the session right
// after `initialize`. wantsSse() + mcpResponse() detect that and frame
// the same JSON-RPC payload as a single SSE `message` event when asked.
function wantsSse(req) {
  const accept = req.headers.get('accept') || '';
  return accept.includes('text/event-stream');
}

function mcpResponse(req, payload) {
  if (!wantsSse(req)) return j(payload);
  const body = 'event: message\ndata: ' + JSON.stringify(payload) + '\n\n';
  return new Response(body, {
    status: 200,
    headers: { ...CORS, 'content-type': 'text/event-stream;charset=utf-8', 'cache-control': 'no-store' }
  });
}

// --- Auth -----------------------------------------------------------
// Every tool here can create/modify pricing rules, coupons, tiers, and
// tokens (or trigger real facilitator calls), so tool invocation is
// gated behind a shared secret (Cloudflare secret MCP_AUTH_TOKEN, never
// a plain wrangler.jsonc var). Health/status/tool-schema discovery stay
// public since they carry no sensitive data and are useful for
// unauthenticated deploy verification. If MCP_AUTH_TOKEN isn't set yet,
// every guarded call fails closed rather than silently running open.
function extractBearer(req) {
  const auth = req.headers.get('authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  return m ? m[1].trim() : null;
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function isAuthed(req, env) {
  if (!env.MCP_AUTH_TOKEN) return false;
  const token = extractBearer(req);
  return !!token && timingSafeEqual(token, env.MCP_AUTH_TOKEN);
}

function authErrorPayload(env) {
  const configured = !!env.MCP_AUTH_TOKEN;
  return {
    ok: false,
    error: configured
      ? 'unauthorized: missing or invalid Authorization: Bearer <token> header'
      : 'unauthorized: MCP_AUTH_TOKEN is not configured on this Worker yet, so all tool calls are denied by default'
  };
}

async function handleMcp(req, env) {
  const rpc = await readJson(req);
  const id = rpc.id == null ? null : rpc.id;
  try {
    if (rpc.method === 'initialize') {
      return mcpResponse(req, { jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: WORKER, version: VERSION } } });
    }
    if (rpc.method === 'notifications/initialized') {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (rpc.method === 'ping') return mcpResponse(req, { jsonrpc: '2.0', id, result: {} });
    if (rpc.method === 'tools/list') return mcpResponse(req, { jsonrpc: '2.0', id, result: { tools: toolSchemas } });
    if (rpc.method === 'tools/call') {
      if (!isAuthed(req, env)) {
        return mcpResponse(req, { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(authErrorPayload(env), null, 2) }], isError: true } });
      }
      let result;
      try {
        result = await callTool(env, rpc.params && rpc.params.name, (rpc.params && rpc.params.arguments) || {});
      } catch (e) {
        result = { ok: false, error: String(e.message || e) };
      }
      return mcpResponse(req, { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: result && result.ok === false } });
    }
    return mcpResponse(req, { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
  } catch (e) {
    return mcpResponse(req, { jsonrpc: '2.0', id, error: { code: -32603, message: String(e.message || e) } });
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    try {
      if (url.pathname === '/' || url.pathname === '/status' || url.pathname === '/health') return j(status(env));
      if (url.pathname === '/tools') return j({ ok: true, tools: toolSchemas });
      if (url.pathname === '/mcp') return handleMcp(req, env);
      if (req.method === 'POST' && url.pathname === '/call') {
        if (!isAuthed(req, env)) return j(authErrorPayload(env), 401);
        const body = await readJson(req);
        try { return j(await callTool(env, body.name, body.arguments || {})); }
        catch (e) { return j({ ok: false, error: String(e.message || e) }, 200); }
      }
      return j({ ok: false, error: 'not_found', worker: WORKER }, 404);
    } catch (e) {
      return j({ ok: false, error: String(e.message || e), worker: WORKER }, 500);
    }
  }
};
