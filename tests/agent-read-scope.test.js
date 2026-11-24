// X1: per-agent bearers may read only their own wallets (circle_list_wallets, circle_get_wallet_balance,
// circle_get_transaction). Real migrations on node:sqlite; only Circle's HTTP API is mocked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import worker from '../worker.js';

globalThis.crypto ||= webcrypto;

const db = new DatabaseSync(':memory:');
const migDir = new URL('../migrations/', import.meta.url);
// 0015 seeds caller bindings for agents that only exist in production; load migrations without FK checks.
db.exec('PRAGMA foreign_keys=OFF');
for (const f of readdirSync(migDir).filter(f => f.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(f, migDir), 'utf8'));
db.exec('PRAGMA foreign_keys=ON');
const prepare = sql => {
  const bind = (...p) => {
    const st = db.prepare(sql);
    return { first: async () => st.get(...p) ?? null, all: async () => ({ results: st.all(...p) }), run: async () => { const m = st.run(...p); return { meta: { changes: m.changes } }; } };
  };
  return { bind, ...bind() };
};
const STATIC = 'static-admin-token';
const env = { DB: { prepare, batch: async qs => Promise.all(qs.map(q => q.run())) }, MCP_AUTH_TOKEN: STATIC, AFO_X402: 'circle-test-key', CIRCLE_ENTITY_SECRET: 'x', WORKER_NAME: 'x402-sub-agent-mcp' };

// ---- mock Circle API ----
const wallets = {
  'w-a': { id: 'w-a', address: '0x' + 'a'.repeat(40), blockchain: 'BASE-SEPOLIA', walletSetId: 'set-1' },
  'w-b': { id: 'w-b', address: '0x' + 'b'.repeat(40), blockchain: 'BASE-SEPOLIA', walletSetId: 'set-1' },
  'w-c': { id: 'w-c', address: '0x' + 'c'.repeat(40), blockchain: 'BASE-SEPOLIA', walletSetId: 'set-1' }
};
const txs = { 'tx-a': { id: 'tx-a', walletId: 'w-a', amounts: ['0.01'] }, 'tx-b': { id: 'tx-b', walletId: 'w-b', amounts: ['5'] } };
const circleCalls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (!u.startsWith('https://api.circle.com/')) return realFetch(url, opts);
  circleCalls.push(u);
  const path = u.replace('https://api.circle.com/v1/w3s', '');
  const json = o => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
  let m;
  if (path.startsWith('/wallets?')) return json({ data: { wallets: Object.values(wallets) } });
  if ((m = path.match(/^\/wallets\/([^/]+)\/balances$/))) return json({ data: { tokenBalances: [{ token: { symbol: 'USDC' }, amount: m[1] === 'w-b' ? '19.9' : '0.07' }] } });
  if ((m = path.match(/^\/wallets\/([^/]+)$/))) return wallets[m[1]] ? json({ data: { wallet: wallets[m[1]] } }) : new Response('{}', { status: 404 });
  if ((m = path.match(/^\/transactions\/([^/]+)$/))) return txs[m[1]] ? json({ data: { transaction: txs[m[1]] } }) : new Response('{}', { status: 404 });
  return new Response('{}', { status: 404 });
};

const sha = v => createHash('sha256').update(v).digest('hex');
const now = new Date().toISOString();
function agent(id, walletIds, token) {
  db.prepare(`INSERT INTO agents(agent_id,display_name,status,created_at,updated_at) VALUES(?,?, 'active',?,?)`).run(id, id, now, now);
  db.prepare(`INSERT INTO agent_credentials(id,agent_id,credential_type,credential_key,status,created_at,updated_at) VALUES(?,?, 'bearer_token',?, 'active',?,?)`).run('c-' + id, id, sha(token), now, now);
  for (const w of walletIds) db.prepare(`INSERT INTO agent_wallets(id,agent_id,wallet_address,network,asset,status,created_at,updated_at,wallet_id) VALUES(?,?,?, 'base-sepolia','USDC','active',?,?,?)`).run('aw-' + id + w, id, wallets[w].address, now, now, w);
}
agent('agent-a', ['w-a'], 'afo_x402_token_for_agent_a_0001');
agent('agent-b', ['w-b'], 'afo_x402_token_for_agent_b_0002');

async function call(token, name, args) {
  const r = await worker.fetch(new Request('https://x402.test/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }), env, { waitUntil() {} });
  const body = await r.json();
  return { http: r.status, data: body.result ? JSON.parse(body.result.content[0].text) : null, rpc: body };
}
const A = 'afo_x402_token_for_agent_a_0001';

test('X1: an agent bearer lists only its own wallets', async () => {
  const r = await call(A, 'circle_list_wallets', { wallet_set_id: 'set-1' });
  assert.equal(r.data.ok, true, JSON.stringify(r.data));
  assert.deepEqual(r.data.result.data.wallets.map(w => w.id), ['w-a']);
  assert.equal(r.data.scoped_to_agent, 'agent-a');
  assert.ok(!circleCalls.some(u => u.includes('/wallets?')), 'the account-wide wallet list is never fetched for an agent');
});

test("X1: an agent bearer reads its own balance but not another wallet's", async () => {
  const own = await call(A, 'circle_get_wallet_balance', { wallet_id: 'w-a' });
  assert.equal(own.data.ok, true);assert.equal(own.data.result.data.tokenBalances[0].amount, '0.07');
  circleCalls.length = 0;
  const other = await call(A, 'circle_get_wallet_balance', { wallet_id: 'w-b' });
  assert.equal(other.data.ok, false);assert.equal(other.data.error, 'wallet_not_assigned');
  assert.ok(!JSON.stringify(other.data).includes('19.9'));assert.equal(circleCalls.length, 0, 'Circle is not even asked');
});

test("X1: an agent bearer reads its own transactions but not another wallet's", async () => {
  const own = await call(A, 'circle_get_transaction', { transaction_id: 'tx-a' });
  assert.equal(own.data.ok, true);assert.equal(own.data.result.data.transaction.walletId, 'w-a');
  const other = await call(A, 'circle_get_transaction', { transaction_id: 'tx-b' });
  assert.equal(other.data.ok, false);assert.equal(other.data.error, 'transaction_not_owned');
  assert.ok(!JSON.stringify(other.data).includes('w-b'), "another wallet's transaction is not returned");
  const missing = await call(A, 'circle_get_transaction', { transaction_id: 'tx-none' });
  assert.equal(missing.data.ok, false);assert.equal(missing.data.error, 'transaction_not_owned');
});

test('X1: a revoked agent wallet is no longer readable', async () => {
  db.prepare(`UPDATE agent_wallets SET status='inactive' WHERE agent_id='agent-a'`).run();
  const r = await call(A, 'circle_list_wallets', {});
  assert.deepEqual(r.data.result.data.wallets, []);
  assert.equal((await call(A, 'circle_get_wallet_balance', { wallet_id: 'w-a' })).data.error, 'wallet_not_assigned');
  db.prepare(`UPDATE agent_wallets SET status='active' WHERE agent_id='agent-a'`).run();
});

test('X1: the static admin token is unchanged (account-wide reads still work)', async () => {
  const list = await call(STATIC, 'circle_list_wallets', { wallet_set_id: 'set-1' });
  assert.deepEqual(list.data.result.data.wallets.map(w => w.id), ['w-a', 'w-b', 'w-c']);
  assert.equal((await call(STATIC, 'circle_get_wallet_balance', { wallet_id: 'w-b' })).data.ok, true);
  assert.equal((await call(STATIC, 'circle_get_transaction', { transaction_id: 'tx-b' })).data.ok, true);
});

test('X1: agent bearers still cannot reach admin tools', async () => {
  const r = await call(A, 'list_payment_rules', {});
  assert.equal(r.http, 403);
});
