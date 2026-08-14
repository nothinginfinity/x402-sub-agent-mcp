import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import worker from '../worker.js';

globalThis.crypto ||= webcrypto;
globalThis.btoa ||= value => Buffer.from(value, 'binary').toString('base64');
globalThis.atob ||= value => Buffer.from(value, 'base64').toString('binary');

const ORIGIN = 'https://x402.test';
const REDIRECT_URI = 'https://client.example/callback';
const LOGIN_PASSWORD = 'correct horse battery staple';
const STATIC_TOKEN = 'legacy-static-token';

function auditEvents(env, event) {
  return env.DB.table('oauth_audit_log').filter(row => !event || row.event === event);
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sha256B64url(value) {
  return createHash('sha256').update(value).digest('base64url');
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function splitCsv(value) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let quote = null;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (quote) {
      if (ch === quote && value[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

function compareValues(left, op, right) {
  // ISO timestamp / string comparisons are lexicographic, matching SQLite
  // TEXT ordering for the ISO 8601 timestamps this recorder stores.
  const a = String(left);
  const b = String(right);
  switch (op) {
    case '>=': return a >= b;
    case '<=': return a <= b;
    case '<': return a < b;
    case '>': return a > b;
    default: return false;
  }
}

function projectRow(row, select) {
  if (select === '*') return clone(row);
  const out = {};
  for (const expression of splitCsv(select)) {
    const match = /^([\w.]+)(?:\s+AS\s+(\w+))?$/i.exec(expression);
    if (!match) throw new Error('Unsupported SELECT expression in test D1 mock: ' + expression);
    const source = match[1].split('.').at(-1);
    out[match[2] || source] = row[source];
  }
  return out;
}

const PRIMARY_KEYS = {
  oauth_subjects: 'subject',
  oauth_clients: 'client_id',
  oauth_auth_codes: 'code',
  oauth_access_tokens: 'token_hash',
  oauth_refresh_tokens: 'token_hash',
  oauth_audit_log: 'id',
  oauth_trace_events: 'id',
  oauth_trace_config: 'name',
  agents: 'agent_id',
  agent_credentials: 'id',
  agent_wallets: 'id',
  agent_permissions: 'id',
  agent_budgets: 'id',
  agent_context_audit: 'id'
};

class MemoryD1 {
  constructor() {
    this.tables = new Map();
    this.lock = Promise.resolve();
  }

  table(name) {
    if (!this.tables.has(name)) this.tables.set(name, []);
    return this.tables.get(name);
  }

  prepare(sql) {
    return new MemoryStatement(this, sql);
  }

  async batch(statements) {
    return this.atomic(async () => {
      const results = [];
      for (const statement of statements) results.push(await statement.run({ skipAtomic: true }));
      return results;
    });
  }

  async atomic(fn) {
    const previous = this.lock;
    let release;
    this.lock = new Promise(resolve => { release = resolve; });
    await previous;
    try { return await fn(); } finally { release(); }
  }
}

class MemoryStatement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql.replace(/\s+/g, ' ').trim();
    this.params = params;
  }

  bind(...params) {
    return new MemoryStatement(this.db, this.sql, params);
  }

  async first() {
    const rows = await this.#select();
    return rows[0] || null;
  }

  async all() {
    return { results: await this.#select() };
  }

  async run(options = {}) {
    if (options.skipAtomic) return this.#mutate();
    return this.db.atomic(async () => this.#mutate());
  }

  async #select() {
    const joinMatch = /^SELECT t\.\*, c\.client_name FROM oauth_access_tokens t LEFT JOIN oauth_clients c ON c\.client_id = t\.client_id WHERE t\.token_hash = \?$/i.exec(this.sql);
    if (joinMatch) {
      const token = this.db.table('oauth_access_tokens').find(row => row.token_hash === this.params[0]);
      if (!token) return [];
      const client = this.db.table('oauth_clients').find(row => row.client_id === token.client_id);
      return [{ ...clone(token), client_name: client?.client_name || null }];
    }

    const agentCredentialJoinMatch = /^SELECT ac\.agent_id FROM agent_credentials ac JOIN agents ag ON ag\.agent_id = ac\.agent_id WHERE ac\.credential_type = 'bearer_token' AND ac\.credential_key = \? AND ac\.status = 'active' AND ag\.status = 'active'$/i.exec(this.sql);
    if (agentCredentialJoinMatch) {
      const credential = this.db.table('agent_credentials').find(row => row.credential_type === 'bearer_token' && row.credential_key === this.params[0] && row.status === 'active');
      if (!credential) return [];
      const agent = this.db.table('agents').find(row => row.agent_id === credential.agent_id && row.status === 'active');
      return agent ? [{ agent_id: credential.agent_id }] : [];
    }

    const match = /^SELECT (.+?) FROM (\w+)(?: WHERE (.+?))?(?: ORDER BY .+?)?(?: LIMIT (\?|\d+))?$/i.exec(this.sql);
    if (!match) throw new Error('Unsupported SELECT in test D1 mock: ' + this.sql);
    const [, select, tableName, whereClause, limitToken] = match;
    // Pre-bind the WHERE predicates ONCE, in clause order, so placeholder
    // params are consumed a single time -- not re-consumed per row (the naive
    // per-row mutation silently mis-binds any query that scans >1 row).
    let whereParamIndex = 0;
    const predicates = whereClause ? whereClause.split(/\s+AND\s+/i).map(clause => {
      let m = /^(\w+) = \?$/.exec(clause);
      if (m) return { column: m[1], op: '=', value: this.params[whereParamIndex++] };
      m = /^(\w+) = (\d+)$/.exec(clause);
      if (m) return { column: m[1], op: '=num', value: Number(m[2]) };
      m = /^(\w+) = '([^']*)'$/.exec(clause);
      if (m) return { column: m[1], op: '=str', value: m[2] };
      m = /^(\w+) != '([^']+)'$/.exec(clause);
      if (m) return { column: m[1], op: '!=str', value: m[2] };
      m = /^(\w+) (>=|<=|<|>) \?$/.exec(clause);
      if (m) return { column: m[1], op: m[2], value: this.params[whereParamIndex++] };
      m = /^(\w+) IS NOT NULL$/i.exec(clause);
      if (m) return { column: m[1], op: 'notnull' };
      m = /^(\w+) IN \((.+)\)$/i.exec(clause);
      if (m) {
        const values = splitCsv(m[2]).map(token => {
          if (token === '?') return this.params[whereParamIndex++];
          const quoted = /^'([^']*)'$/.exec(token);
          if (quoted) return quoted[1];
          if (/^\d+$/.test(token)) return Number(token);
          throw new Error('Unsupported IN value in test D1 mock: ' + token);
        });
        return { column: m[1], op: 'in', values };
      }
      throw new Error('Unsupported WHERE clause in test D1 mock: ' + clause);
    }) : [];
    let rows = this.db.table(tableName).filter(row => predicates.every(p => {
      switch (p.op) {
        case '=': return row[p.column] === p.value;
        case '=num': return Number(row[p.column]) === p.value;
        case '=str': return String(row[p.column]) === p.value;
        case '!=str': return row[p.column] !== p.value;
        case 'notnull': return row[p.column] != null;
        case 'in': return p.values.some(value => String(value) === String(row[p.column]));
        case '>=': case '<=': case '<': case '>': return compareValues(row[p.column], p.op, p.value);
        default: return false;
      }
    }));
    if (/ORDER BY created_at DESC/i.test(this.sql)) rows = rows.toSorted((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    if (/ORDER BY priority ASC/i.test(this.sql)) rows = rows.toSorted((a, b) => Number(a.priority || 0) - Number(b.priority || 0));
    if (/ORDER BY timestamp DESC/i.test(this.sql)) rows = rows.toSorted((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
    if (/ORDER BY timestamp ASC/i.test(this.sql)) rows = rows.toSorted((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
    if (limitToken) {
      const limit = limitToken === '?' ? Number(this.params.at(-1)) : Number(limitToken);
      rows = rows.slice(0, limit);
    }
    return rows.map(row => projectRow(row, select));
  }

  async #mutate() {
    const upsertPrefix = /^INSERT\s+INTO\s+(\w+)\s*\((.+?)\)\s*VALUES\s*\((.+?)\)\s*ON\s+CONFLICT\s*\(/i.exec(this.sql);
    let match = null;
    if (upsertPrefix) {
      const conflictStart = upsertPrefix[0].length;
      let depth = 1;
      let quote = null;
      let conflictEnd = -1;
      for (let i = conflictStart; i < this.sql.length; i++) {
        const ch = this.sql[i];
        if (quote) {
          if (ch === quote && this.sql[i - 1] !== '\\') quote = null;
          continue;
        }
        if (ch === "'" || ch === '"') { quote = ch; continue; }
        if (ch === '(') depth++;
        else if (ch === ')' && --depth === 0) { conflictEnd = i; break; }
      }
      if (conflictEnd < 0) throw new Error('Unbalanced UPSERT conflict target in test D1 mock: ' + this.sql);
      if (conflictEnd >= 0) {
        const suffix = this.sql.slice(conflictEnd + 1).trim();
        const markerMatch = /DO UPDATE SET\s+/i.exec(suffix);
        if (!markerMatch) throw new Error('Unsupported UPSERT suffix in test D1 mock: ' + suffix);
        const beforeUpdate = suffix.slice(0, markerMatch.index).trim();
        if (beforeUpdate && !/^WHERE\s+/i.test(beforeUpdate)) throw new Error('Unsupported UPSERT conflict predicate in test D1 mock: ' + beforeUpdate);
        const conflictWhereText = /^WHERE\s+/i.test(beforeUpdate) ? beforeUpdate.replace(/^WHERE\s+/i, '') : null;
        const updateAndWhereText = suffix.slice(markerMatch.index + markerMatch[0].length);
        match = [this.sql, upsertPrefix[1], upsertPrefix[2], upsertPrefix[3], this.sql.slice(conflictStart, conflictEnd), conflictWhereText, updateAndWhereText];
      }
    }
    if (/^INSERT\s+INTO\b/i.test(this.sql) && /\bON\s+CONFLICT\b/i.test(this.sql) && !upsertPrefix) throw new Error('Unsupported UPSERT prefix in test D1 mock: ' + this.sql);
    if (upsertPrefix && !match) throw new Error('Unsupported UPSERT syntax in test D1 mock: ' + this.sql);
    if (match) {
      const [, tableName, columnsText, valuesText, conflictText, conflictWhereText, updateAndWhereText] = match;
      const trailingWhereMatch = /\s+WHERE\s+(\w+\.\w+\s*=\s*excluded\.\w+)\s*$/i.exec(updateAndWhereText);
      const updateText = trailingWhereMatch ? updateAndWhereText.slice(0, trailingWhereMatch.index) : updateAndWhereText;
      const updateWhereText = trailingWhereMatch ? trailingWhereMatch[1] : null;
      const columns = splitCsv(columnsText);
      const values = splitCsv(valuesText);
      if (columns.length !== values.length) throw new Error('UPSERT column/value count mismatch in test D1 mock: ' + this.sql);
      let paramIndex = 0;
      const row = {};
      columns.forEach((column, index) => {
        const token = values[index];
        if (token === '?') row[column] = this.params[paramIndex++];
        else if (/^NULL$/i.test(token)) row[column] = null;
        else if (/^'([^']*)'$/.test(token)) row[column] = token.slice(1, -1);
        else if (/^\d+$/.test(token)) row[column] = Number(token);
        else throw new Error('Unsupported UPSERT value in test D1 mock: ' + token);
      });
      const conflictColumns = splitCsv(conflictText).map(column => {
        const coalesce = /^COALESCE\((\w+),\s*'[^']*'\)$/i.exec(column);
        return coalesce ? coalesce[1] : column;
      });
      if (conflictColumns.some(column => !/^\w+$/.test(column))) throw new Error('Unsupported UPSERT conflict target in test D1 mock: ' + conflictText);
      if (conflictWhereText && !/^\w+\s*=\s*'[^']*'$/i.test(conflictWhereText)) throw new Error('Unsupported UPSERT conflict predicate in test D1 mock: ' + conflictWhereText);
      const table = this.db.table(tableName);
      const conflictPredicate = conflictWhereText ? /^(\w+)\s*=\s*'([^']*)'$/i.exec(conflictWhereText) : null;
      const existing = table.find(candidate => conflictColumns.every(column => candidate[column] === row[column]) && (!conflictPredicate || String(candidate[conflictPredicate[1]]) === conflictPredicate[2]));
      if (!existing) {
        table.push(row);
        return { meta: { changes: 1 } };
      }
      if (updateWhereText && !/^\w+\.\w+\s*=\s*excluded\.\w+$/i.test(updateWhereText)) throw new Error('Unsupported UPSERT update predicate in test D1 mock: ' + updateWhereText);
      if (/\s+WHERE\s+/i.test(updateText)) throw new Error('Unsupported UPSERT update predicate in test D1 mock: ' + updateText);
      if (updateWhereText) {
        const guard = /^(\w+)\.(\w+)\s*=\s*excluded\.(\w+)$/i.exec(updateWhereText);
        if (guard && existing[guard[2]] !== row[guard[3]]) return { meta: { changes: 0 } };
      }
      for (const clause of splitCsv(updateText)) {
        const updateMatch = /^(\w+) = excluded\.(\w+)$/i.exec(clause);
        if (!updateMatch) throw new Error('Unsupported UPSERT setter in test D1 mock: ' + clause);
        existing[updateMatch[1]] = row[updateMatch[2]];
      }
      return { meta: { changes: 1 } };
    }

    match = /^INSERT INTO (\w+) \((.+?)\) VALUES \((.+?)\)$/i.exec(this.sql);
    if (match) {
      const [, tableName, columnsText, valuesText] = match;
      const columns = splitCsv(columnsText);
      const values = splitCsv(valuesText);
      let paramIndex = 0;
      const row = {};
      columns.forEach((column, index) => {
        const token = values[index];
        if (token === '?') row[column] = this.params[paramIndex++];
        else if (/^NULL$/i.test(token)) row[column] = null;
        else if (/^'([^']*)'$/.test(token)) row[column] = token.slice(1, -1);
        else if (/^\d+$/.test(token)) row[column] = Number(token);
        else throw new Error('Unsupported INSERT value in test D1 mock: ' + token);
      });
      const table = this.db.table(tableName);
      const key = PRIMARY_KEYS[tableName];
      if (key && Object.hasOwn(row, key) && table.some(existing => existing[key] === row[key])) {
        throw new Error('UNIQUE constraint failed: ' + tableName + '.' + key);
      }
      if (tableName === 'agent_credentials' && table.some(existing =>
        existing.credential_type === row.credential_type && existing.credential_key === row.credential_key)) {
        throw new Error('UNIQUE constraint failed: agent_credentials.credential_type, agent_credentials.credential_key');
      }
      table.push(row);
      return { meta: { changes: 1 } };
    }

    match = /^UPDATE (\w+) SET (.+?) WHERE (.+)$/i.exec(this.sql);
    match = /^UPDATE (\w+) SET (.+?) WHERE (.+)$/i.exec(this.sql);
    if (match) {
      const [, tableName, setText, whereText] = match;
      const setClauses = splitCsv(setText);
      let paramIndex = 0;
      const setters = setClauses.map(clause => {
        let m = /^(\w+) = \?$/.exec(clause);
        if (m) return { column: m[1], value: this.params[paramIndex++] };
        m = /^(\w+) = (\d+)$/.exec(clause);
        if (m) return { column: m[1], value: Number(m[2]) };
        m = /^(\w+) = '([^']*)'$/.exec(clause);
        if (m) return { column: m[1], value: m[2] };
        m = /^(\w+) = NULL$/i.exec(clause);
        if (m) return { column: m[1], value: null };
        m = /^(\w+) = \1 \+ 1$/.exec(clause);
        if (m) return { column: m[1], increment: 1 };
        throw new Error('Unsupported UPDATE setter in test D1 mock: ' + clause);
      });
      const whereClauses = whereText.split(/\s+AND\s+/i).map(clause => {
        let m = /^(\w+) = \?$/.exec(clause);
        if (m) return { column: m[1], op: '=', value: this.params[paramIndex++] };
        m = /^(\w+) = (\d+)$/.exec(clause);
        if (m) return { column: m[1], op: '=', value: Number(m[2]) };
        m = /^(\w+) = '([^']*)'$/.exec(clause);
        if (m) return { column: m[1], op: '=', value: m[2] };
        m = /^(\w+) IN \((.+)\)$/i.exec(clause);
        if (m) return { column: m[1], op: 'in', values: splitCsv(m[2]).map(value => value.replace(/^'|'$/g, '')) };
        throw new Error('Unsupported UPDATE predicate in test D1 mock: ' + clause);
      });
      let changes = 0;
      for (const row of this.db.table(tableName)) {
        if (!whereClauses.every(condition => condition.op === 'in'
          ? condition.values.includes(String(row[condition.column]))
          : row[condition.column] === condition.value)) continue;
        for (const setter of setters) {
          if (setter.increment) row[setter.column] = Number(row[setter.column] || 0) + setter.increment;
          else row[setter.column] = setter.value;
        }
        changes++;
      }
      return { meta: { changes } };
    }

    match = /^DELETE FROM (\w+) WHERE (.+)$/i.exec(this.sql);
    if (match) {
      const [, tableName, whereText] = match;
      let paramIndex = 0;
      const predicates = whereText.split(/\s+AND\s+/i).map(clause => {
        let m = /^(\w+) = \?$/.exec(clause);
        if (m) return { column: m[1], op: '=', value: this.params[paramIndex++] };
        m = /^(\w+) (>=|<=|<|>) \?$/.exec(clause);
        if (m) return { column: m[1], op: m[2], value: this.params[paramIndex++] };
        throw new Error('Unsupported DELETE predicate in test D1 mock: ' + clause);
      });
      const table = this.db.table(tableName);
      let changes = 0;
      for (let i = table.length - 1; i >= 0; i--) {
        const row = table[i];
        const keep = !predicates.every(p => p.op === '=' ? row[p.column] === p.value : compareValues(row[p.column], p.op, p.value));
        if (!keep) { table.splice(i, 1); changes++; }
      }
      return { meta: { changes } };
    }

    throw new Error('Unsupported mutation in test D1 mock: ' + this.sql);
  }
}

function makeEnv() {
  const env = {
    DB: new MemoryD1(),
    OAUTH_LOGIN_PASSWORD: LOGIN_PASSWORD,
    MCP_AUTH_TOKEN: STATIC_TOKEN,
    WORKER_NAME: 'x402-test',
    AFO_X402: 'test-circle-key',
    CIRCLE_ENTITY_SECRET: '00'.repeat(32),
    CIRCLE_WALLET_SET_ID: 'test-wallet-set'
  };
  const ts = nowIsoTest();
  env.DB.table('workspaces').push({ workspace_id: 'workspace-test', owner_subject: 'operator', environment: 'testnet', status: 'active', created_at: ts, updated_at: ts });
  env.DB.table('workspace_wallets').push({ workspace_wallet_id: 'ww-test', workspace_id: 'workspace-test', circle_wallet_id: 'wallet-test', display_name: 'Test Wallet', wallet_address: '0x1111111111111111111111111111111111111111', network: 'base-sepolia', allocation_status: 'available', created_at: ts, updated_at: ts });
  return env;
}

function stubCircleWallet(walletId, address = '0x1111111111111111111111111111111111111111', blockchain = 'BASE-SEPOLIA') {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = String(input);
    if (url.includes('/wallets/' + walletId)) {
      return new Response(JSON.stringify({ data: { wallet: { id: walletId, address, blockchain } } }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    return originalFetch(input);
  };
  return () => { globalThis.fetch = originalFetch; };
}

async function adminOAuthToken(env, clientName = 'ChatGPT provisioning test') {
  const client = await registerClient(env, { client_name: clientName });
  const grant = await issueAuthorizationCode(env, client, {
    scope: 'wallet:read wallet:transfer:testnet offline_access',
    grantAdmin: true
  });
  const issued = await exchangeCode(env, client, grant);
  assert.equal(issued.response.status, 200, JSON.stringify(issued.body));
  return issued.body.access_token;
}

async function request(env, path, init = {}) {
  return worker.fetch(new Request(ORIGIN + path, init), env);
}

async function json(response) {
  const body = await response.json();
  return { response, body };
}

async function registerClient(env, overrides = {}) {
  const payload = {
    client_name: 'ChatGPT integration test',
    redirect_uris: [REDIRECT_URI],
    token_endpoint_auth_method: 'none',
    ...overrides
  };
  const { response, body } = await json(await request(env, '/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  }));
  assert.equal(response.status, 201, JSON.stringify(body));
  return body;
}

async function authorize(env, client, overrides = {}) {
  const verifier = overrides.verifier || 'v'.repeat(64);
  const challenge = overrides.challenge || sha256B64url(verifier);
  const scope = overrides.scope ?? 'wallet:read offline_access';
  const resource = overrides.resource ?? ORIGIN + '/mcp';
  const redirectUri = overrides.redirectUri || REDIRECT_URI;
  const subject = (env.DB.table('oauth_subjects')[0] && env.DB.table('oauth_subjects')[0].subject) || 'operator';
  if (!env.DB.table('oauth_subjects').length) env.DB.table('oauth_subjects').push({ subject, password_hash: LOGIN_PASSWORD, created_at: nowIsoTest() });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope,
    resource,
    state: overrides.state || 'state-1'
  });
  return { params, verifier };
}

async function issueAuthorizationCode(env, client, overrides = {}) {
  const { params, verifier } = await authorize(env, client, overrides);
  const loginForm = new URLSearchParams({
    ...Object.fromEntries(params),
    password: LOGIN_PASSWORD,
    consent: 'allow',
    ...(overrides.grantAdmin ? { grant_admin: '1' } : {})
  });
  const { response, body } = await json(await request(env, '/authorize', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: loginForm.toString()
  }));
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.safe_redirect, true, JSON.stringify(body));
  const redirectUrl = new URL(body.redirect_uri);
  const code = redirectUrl.searchParams.get('code');
  assert.ok(code, JSON.stringify(body));
  return { code, verifier, redirectUri: overrides.redirectUri || REDIRECT_URI };
}

async function exchangeCode(env, client, grant) {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code: grant.code,
    redirect_uri: grant.redirectUri,
    client_id: client.client_id,
    code_verifier: grant.verifier
  });
  return json(await request(env, '/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString()
  }));
}

async function adminGrant(env) {
  const client = await registerClient(env, { client_name: 'ChatGPT admin test' });
  const grant = await issueAuthorizationCode(env, client, { scope: 'wallet:read offline_access mcp:admin', grantAdmin: true });
  const issued = await exchangeCode(env, client, grant);
  assert.equal(issued.response.status, 200, JSON.stringify(issued.body));
  return { token: issued.body.access_token, client };
}

async function mcp(env, token, method, params = {}) {
  const { response, body } = await json(await request(env, '/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  }));
  return { response, body };
}

test('discovery documents publish the resource metadata used for MCP auth', async () => {
  const env = makeEnv();
  const { response, body } = await json(await request(env, '/.well-known/oauth-protected-resource'));
  assert.equal(response.status, 200);
  assert.equal(body.resource, ORIGIN + '/mcp');
  assert.deepEqual(body.scopes_supported, ['wallet:read', 'wallet:transfer:testnet', 'offline_access', 'mcp:admin']);
});

test('dynamic client registration issues a client_id without a secret for public clients', async () => {
  const env = makeEnv();
  const body = await registerClient(env);
  assert.ok(body.client_id);
  assert.equal(body.token_endpoint_auth_method, 'none');
  assert.equal(body.client_secret, undefined);
});

test('PKCE is mandatory: missing code_challenge is rejected before login', async () => {
  const env = makeEnv();
  const client = await registerClient(env);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: REDIRECT_URI,
    scope: 'wallet:read'
  });
  const { response, body } = await json(await request(env, '/authorize?' + params.toString()));
  assert.equal(response.status, 400);
  assert.match(body.error || '', /invalid_request/);
});

test('authorization code exchange issues a bearer token scoped as granted', async () => {
  const env = makeEnv();
  const client = await registerClient(env);
  const grant = await issueAuthorizationCode(env, client, { scope: 'wallet:read offline_access' });
  const { response, body } = await exchangeCode(env, client, grant);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.ok(body.access_token);
  assert.equal(body.token_type, 'Bearer');
  assert.equal(body.scope, 'wallet:read offline_access');
  assert.ok(body.refresh_token);
});

test('an authorization code cannot be redeemed twice (replay protection)', async () => {
  const env = makeEnv();
  const client = await registerClient(env);
  const grant = await issueAuthorizationCode(env, client, { scope: 'wallet:read offline_access' });
  const first = await exchangeCode(env, client, grant);
  assert.equal(first.response.status, 200, JSON.stringify(first.body));
  const second = await exchangeCode(env, client, grant);
  assert.equal(second.response.status, 400);
  assert.match(second.body.error || '', /invalid_grant/);
});

test('client-requested mcp:admin scope is stripped unless explicitly granted via the consent checkbox', async () => {
  const env = makeEnv();
  const client = await registerClient(env);
  const grant = await issueAuthorizationCode(env, client, { scope: 'wallet:read mcp:admin offline_access' });
  const issued = await exchangeCode(env, client, grant);
  assert.equal(issued.response.status, 200, JSON.stringify(issued.body));
  assert.doesNotMatch(issued.body.scope, /mcp:admin/);
});

test('mcp:admin is granted only when the consent-page checkbox is submitted', async () => {
  const env = makeEnv();
  const client = await registerClient(env);
  const grant = await issueAuthorizationCode(env, client, { scope: 'wallet:read offline_access', grantAdmin: true });
  const issued = await exchangeCode(env, client, grant);
  assert.equal(issued.response.status, 200, JSON.stringify(issued.body));
  assert.match(issued.body.scope, /mcp:admin/);
});

test('a refresh token can mint a new access token and rotates the refresh token', async () => {
  const env = makeEnv();
  const client = await registerClient(env);
  const grant = await issueAuthorizationCode(env, client, { scope: 'wallet:read offline_access' });
  const issued = await exchangeCode(env, client, grant);
  const refreshForm = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: issued.body.refresh_token, client_id: client.client_id });
  const { response, body } = await json(await request(env, '/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: refreshForm.toString()
  }));
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.ok(body.access_token);
  assert.ok(body.refresh_token);
  assert.notEqual(body.refresh_token, issued.body.refresh_token);
});

test('a reused (already-rotated) refresh token is rejected', async () => {
  const env = makeEnv();
  const client = await registerClient(env);
  const grant = await issueAuthorizationCode(env, client, { scope: 'wallet:read offline_access' });
  const issued = await exchangeCode(env, client, grant);
  const refreshForm = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: issued.body.refresh_token, client_id: client.client_id });
  await request(env, '/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: refreshForm.toString() });
  const { response, body } = await json(await request(env, '/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: refreshForm.toString()
  }));
  assert.equal(response.status, 400);
  assert.match(body.error || '', /invalid_grant/);
});

test('an MCP call with no bearer token is rejected', async () => {
  const env = makeEnv();
  const { response, body } = await json(await request(env, '/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
  }));
  assert.equal(response.status, 401);
  assert.match(body.error || '', /invalid_token|unauthorized/);
});

test('tools/list is reachable with a valid bearer token', async () => {
  const env = makeEnv();
  const client = await registerClient(env);
  const grant = await issueAuthorizationCode(env, client, { scope: 'wallet:read offline_access' });
  const issued = await exchangeCode(env, client, grant);
  const result = await mcp(env, issued.body.access_token, 'tools/list');
  assert.equal(result.response.status, 200);
  assert.ok(result.body.result.tools.some(tool => tool.name === 'resolve_agent_context'));
});

test('wallet:read OAuth subject resolves to its token-time Agent Context binding without mcp:admin', async () => {
  const env = makeEnv();
  const client = await registerClient(env, { client_name: 'ChatGPT' });
  const grant = await issueAuthorizationCode(env, client, { scope: 'wallet:read offline_access' });
  const issued = await exchangeCode(env, client, grant);
  const boundCredential = env.DB.table('agent_credentials').find(row => row.credential_type === 'oauth_subject_sha256' && row.status === 'active');
  assert.ok(boundCredential, 'token exchange should establish an OAuth Agent Context credential');
  const result = await mcp(env, issued.body.access_token, 'tools/call', { name: 'resolve_agent_context', arguments: {} });
  assert.equal(result.response.status, 200);
  assert.equal(toolPayload(result).agent_id, boundCredential.agent_id);
});

test('wallet:read alone cannot invoke circle_gasless_transfer', async () => {
  const env = makeEnv();
  const client = await registerClient(env, { client_name: 'ChatGPT' });
  const grant = await issueAuthorizationCode(env, client, { scope: 'wallet:read offline_access' });
  const issued = await exchangeCode(env, client, grant);
  const denied = await mcp(env, issued.body.access_token, 'tools/call', { name: 'circle_gasless_transfer', arguments: { destination_address: '0x2222222222222222222222222222222222222222', amount: '0.000001', blockchain: 'BASE-SEPOLIA' } });
  assert.equal(denied.response.status, 403);
});

test('wallet:transfer:testnet reaches Agent Context permission enforcement for circle_gasless_transfer', async () => {
  const env = makeEnv();
  const client = await registerClient(env, { client_name: 'ChatGPT' });
  const grant = await issueAuthorizationCode(env, client, { scope: 'wallet:transfer:testnet offline_access' });
  const issued = await exchangeCode(env, client, grant);
  const result = await mcp(env, issued.body.access_token, 'tools/call', { name: 'circle_gasless_transfer', arguments: { destination_address: '0x2222222222222222222222222222222222222222', amount: '0.500001', blockchain: 'BASE-SEPOLIA' } });
  assert.equal(result.response.status, 200);
  assert.equal(toolPayload(result).error_code, 'permission_denied');
});

test('wallet:transfer:testnet does not expose admin tools and mcp:admin still does', async () => {
  const env = makeEnv();
  const client = await registerClient(env, { client_name: 'ChatGPT' });
  const grant = await issueAuthorizationCode(env, client, { scope: 'wallet:transfer:testnet offline_access' });
  const issued = await exchangeCode(env, client, grant);
  const denied = await mcp(env, issued.body.access_token, 'tools/call', { name: 'oauth_trace_list', arguments: {} });
  assert.equal(denied.response.status, 403);
  const { token } = await adminGrant(env);
  const allowed = await mcp(env, token, 'tools/call', { name: 'oauth_trace_list', arguments: {} });
  assert.equal(allowed.response.status, 200);
});

test('static bearer resolves using the SHA-256 digest, not the raw token', async () => {
  const env = makeEnv();
  seedAgentContext(env, { credential_type: 'bearer_token', credential_key: sha256Hex(STATIC_TOKEN) });
  const result = await mcp(env, STATIC_TOKEN, 'tools/call', { name: 'resolve_agent_context', arguments: {} });
  const payload = toolPayload(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.agent_id, 'agent-1');
});

test('resolve_agent_context reports unknown_agent when no credential row matches', async () => {
  const env = makeEnv();
  const result = await mcp(env, STATIC_TOKEN, 'tools/call', { name: 'resolve_agent_context', arguments: {} });
  const payload = toolPayload(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error_code, 'unknown_agent');
});

test('resolve_agent_context reports disabled_agent when the agent is not active', async () => {
  const env = makeEnv();
  seedAgentContext(env, { credential_type: 'bearer_token', credential_key: sha256Hex(STATIC_TOKEN), agent_status: 'disabled' });
  const result = await mcp(env, STATIC_TOKEN, 'tools/call', { name: 'resolve_agent_context', arguments: {} });
  assert.equal(toolPayload(result).error_code, 'disabled_agent');
});

test('resolve_agent_context reports wallet_not_assigned when no wallet is active', async () => {
  const env = makeEnv();
  seedAgentContext(env, { credential_type: 'bearer_token', credential_key: sha256Hex(STATIC_TOKEN), wallet: false });
  const result = await mcp(env, STATIC_TOKEN, 'tools/call', { name: 'resolve_agent_context', arguments: {} });
  assert.equal(toolPayload(result).error_code, 'wallet_not_assigned');
});

test('resolve_agent_context reports ambiguous_identity with two active wallets and resolves with a confirming address', async () => {
  const env = makeEnv();
  seedAgentContext(env, { credential_type: 'bearer_token', credential_key: sha256Hex(STATIC_TOKEN) });
  env.DB.table('agent_wallets').push({ id: 'aw-2', agent_id: 'agent-1', wallet_address: 'wallet-2', network: 'base-sepolia', asset: 'USDC', status: 'active', created_at: nowIsoTest(), updated_at: nowIsoTest() });
  let result = await mcp(env, STATIC_TOKEN, 'tools/call', { name: 'resolve_agent_context', arguments: {} });
  assert.equal(toolPayload(result).error_code, 'ambiguous_identity');
  result = await mcp(env, STATIC_TOKEN, 'tools/call', { name: 'resolve_agent_context', arguments: { wallet_address: 'wallet-2' } });
  assert.equal(toolPayload(result).ok, true);
});

test('resolve_agent_context reports permission_denied without an allow permission and enforces the max amount', async () => {
  const env = makeEnv();
  seedAgentContext(env, { credential_type: 'bearer_token', credential_key: sha256Hex(STATIC_TOKEN), permission: false });
  let result = await mcp(env, STATIC_TOKEN, 'tools/call', { name: 'resolve_agent_context', arguments: {} });
  assert.equal(toolPayload(result).error_code, 'permission_denied');

  const env2 = makeEnv();
  seedAgentContext(env2, { credential_type: 'bearer_token', credential_key: sha256Hex(STATIC_TOKEN), max_amount_atomic: '100' });
  result = await mcp(env2, STATIC_TOKEN, 'tools/call', { name: 'resolve_agent_context', arguments: { amount_atomic: '1000' } });
  assert.equal(toolPayload(result).error_code, 'permission_denied');
});

test('exhausted budget returns budget_exhausted and valid context succeeds', async () => {
  const env = makeEnv();
  seedAgentContext(env, { credential_type: 'bearer_token', credential_key: sha256Hex(STATIC_TOKEN), limit_atomic: '10', spent_atomic: '10' });
  let result = await mcp(env, STATIC_TOKEN, 'tools/call', { name: 'resolve_agent_context', arguments: { amount_atomic: '1' } });
  assert.equal(toolPayload(result).error_code, 'budget_exhausted');
  env.DB.table('agent_budgets')[0].spent_atomic = '0';
  result = await mcp(env, STATIC_TOKEN, 'tools/call', { name: 'resolve_agent_context', arguments: { amount_atomic: '1' } });
  assert.equal(toolPayload(result).ok, true);
});

test('successful and denied Agent Context decisions write secret-free audit rows', async () => {
  const env = makeEnv();
  seedAgentContext(env, { credential_type: 'bearer_token', credential_key: sha256Hex(STATIC_TOKEN) });
  await mcp(env, STATIC_TOKEN, 'tools/call', { name: 'resolve_agent_context', arguments: {} });
  env.DB.table('agent_permissions')[0].effect = 'deny';
  await mcp(env, STATIC_TOKEN, 'tools/call', { name: 'resolve_agent_context', arguments: {} });
  const rows = env.DB.table('agent_context_audit');
  assert.ok(rows.some(row => row.outcome === 'allowed'));
  assert.ok(rows.some(row => row.outcome === 'denied'));
  assert.ok(rows.every(row => !JSON.stringify(row).includes(STATIC_TOKEN)));
});

test('U1 internal fleet projection returns secret-free authoritative current and archived wallet state', async () => {
  const env = makeEnv();
  seedAgentContext(env, { credential_type: 'bearer_token', credential_key: sha256Hex(STATIC_TOKEN), max_amount_atomic: '10000', limit_atomic: '100000', spent_atomic: '2500' });
  const active = env.DB.table('agent_wallets')[0];
  active.wallet_id = 'wallet-current';
  active.wallet_address = '0x1111111111111111111111111111111111111111';
  env.DB.table('agent_wallets').push({ id: 'aw-old', agent_id: 'agent-1', wallet_id: 'wallet-archived', wallet_address: '0x2222222222222222222222222222222222222222', network: 'base-sepolia', asset: 'USDC', status: 'archived', created_at: nowIsoTest(), updated_at: nowIsoTest() });
  env.DB.table('agent_permissions').push({ id: 'perm-transfer', agent_id: 'agent-1', capability: 'circle_gasless_transfer', effect: 'allow', network: 'base-sepolia', asset: 'USDC', max_amount_atomic: '10000', created_at: nowIsoTest(), updated_at: nowIsoTest() });
  env.DB.table('agent_caller_bindings').push({ id: 'binding-1', source: 'x402-cairnstone', caller_id: 'chatgpt:jared', agent_id: 'agent-1', status: 'active', created_at: nowIsoTest(), updated_at: nowIsoTest() });
  env.DB.table('workspace_wallets').push({ workspace_wallet_id: 'ww-current', workspace_id: 'workspace-test', circle_wallet_id: 'wallet-current', display_name: 'ChatGPT Current', wallet_address: active.wallet_address, network: 'base-sepolia', allocation_status: 'assigned', created_at: nowIsoTest(), updated_at: nowIsoTest() });

  const result = await mcp(env, STATIC_TOKEN, 'tools/call', { name: 'internal_get_agent_fleet', arguments: { network: 'base-sepolia', asset: 'USDC' } });
  assert.equal(result.response.status, 200);
  const payload = toolPayload(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.environment, 'testnet');
  assert.equal(payload.agents.length, 1);
  assert.equal(payload.agents[0].runtime_provider, 'chatgpt');
  assert.equal(payload.agents[0].current_wallet_id, 'wallet-current');
  assert.equal(payload.agents[0].current_wallet_relationship_state, 'verified');
  assert.equal(payload.agents[0].archived_wallet_count, 1);
  assert.equal(payload.agents[0].budgets[0].remaining_atomic, '97500');
  assert.equal(payload.agents[0].transfer_capability.transfer_max_atomic, '10000');
  assert.equal(payload.wallets.find(wallet => wallet.wallet_id === 'wallet-current').alias, 'ChatGPT Current');
  assert.equal(payload.wallets.find(wallet => wallet.wallet_id === 'wallet-archived').lifecycle_status, 'archived');
  const serialized = JSON.stringify(payload);
  assert.ok(!serialized.includes(STATIC_TOKEN));
  assert.ok(!serialized.includes(sha256Hex(STATIC_TOKEN)));
});

test('U1 internal fleet projection preserves conflicting and unavailable wallet relationship states', async () => {
  const env = makeEnv();
  seedAgentContext(env, { credential_type: 'bearer_token', credential_key: sha256Hex(STATIC_TOKEN) });
  const first = env.DB.table('agent_wallets')[0];
  first.wallet_id = 'wallet-one';
  first.wallet_address = '0x1111111111111111111111111111111111111111';
  env.DB.table('agent_wallets').push({ id: 'aw-two', agent_id: 'agent-1', wallet_id: 'wallet-two', wallet_address: '0x2222222222222222222222222222222222222222', network: 'base-sepolia', asset: 'USDC', status: 'active', created_at: nowIsoTest(), updated_at: nowIsoTest() });

  let result = await mcp(env, STATIC_TOKEN, 'tools/call', { name: 'internal_get_agent_fleet', arguments: {} });
  let payload = toolPayload(result);
  assert.equal(payload.agents[0].current_wallet_relationship_state, 'conflicting');
  assert.equal(payload.agents[0].current_wallet_id, null);

  env.DB.table('agent_wallets').forEach(wallet => { wallet.status = 'archived'; });
  result = await mcp(env, STATIC_TOKEN, 'tools/call', { name: 'internal_get_agent_fleet', arguments: {} });
  payload = toolPayload(result);
  assert.equal(payload.agents[0].current_wallet_relationship_state, 'unavailable');
  assert.equal(payload.agents[0].current_wallet_id, null);
});

test('U1 internal fleet projection is hidden from ordinary wallet:read OAuth scope', async () => {
  const env = makeEnv();
  const client = await registerClient(env, { client_name: 'ChatGPT' });
  const grant = await issueAuthorizationCode(env, client, { scope: 'wallet:read offline_access' });
  const issued = await exchangeCode(env, client, grant);
  const denied = await mcp(env, issued.body.access_token, 'tools/call', { name: 'internal_get_agent_fleet', arguments: {} });
  assert.equal(denied.response.status, 403);
  const listed = await mcp(env, STATIC_TOKEN, 'tools/list');
  assert.ok(!listed.body.result.tools.some(tool => tool.name === 'internal_get_agent_fleet'));
});

test('execute_action_draft rejects unsupported draft kinds without touching Agent Context', async () => {
  const env = makeEnv();
  const { token } = await adminGrant(env);
  const result = await mcp(env, token, 'tools/call', {
    name: 'execute_action_draft',
    arguments: { draft: { draft_id: 'draft-rp-1', kind: 'request_payment', destination_address: '0x2222222222222222222222222222222222222222', amount_atomic: '1000' } }
  });
  const payload = toolPayload(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error, 'unsupported_draft_kind');
  assert.equal(payload.draft_id, 'draft-rp-1');
  assert.equal(env.DB.table('executed_drafts').length, 0);
});

test('execute_action_draft replays an existing terminal row instead of re-executing', async () => {
  const env = makeEnv();
  const { token } = await adminGrant(env);
  const ts = nowIsoTest();
  env.DB.table('executed_drafts').push({
    draft_id: 'draft-replay-1', agent_id: 'agent-1', status: 'executed', network: 'base-sepolia', asset: 'USDC',
    amount_atomic: '1000', destination_address: '0x2222222222222222222222222222222222222222',
    tx_hash: '0xdeadbeef', error_detail: null, created_at: ts, updated_at: ts
  });
  const result = await mcp(env, token, 'tools/call', {
    name: 'execute_action_draft',
    arguments: { draft: { draft_id: 'draft-replay-1', kind: 'send', destination_address: '0x2222222222222222222222222222222222222222', amount_atomic: '1000' } }
  });
  const payload = toolPayload(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.replayed, true);
  assert.equal(payload.lifecycle, 'executed');
  assert.equal(payload.tx_hash, '0xdeadbeef');
  // Still exactly one row -- no second attempt was made for this draft_id.
  assert.equal(env.DB.table('executed_drafts').length, 1);
});

test('execute_action_draft surfaces resolution_failed and records a rejected row when the caller has no transfer permission', async () => {
  const env = makeEnv();
  seedAgentContext(env, { credential_type: 'bearer_token', credential_key: sha256Hex(STATIC_TOKEN), capability: 'resolve_agent_context' });
  const wallet = env.DB.table('agent_wallets')[0];
  wallet.wallet_id = 'wallet-current';
  wallet.wallet_address = '0x1111111111111111111111111111111111111111';
  const result = await mcp(env, STATIC_TOKEN, 'tools/call', {
    name: 'execute_action_draft',
    arguments: { draft: { draft_id: 'draft-noperm-1', kind: 'send', destination_address: '0x2222222222222222222222222222222222222222', amount_atomic: '1000' } }
  });
  const payload = toolPayload(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error, 'resolution_failed');
  assert.equal(payload.draft_id, 'draft-noperm-1');
  const row = env.DB.table('executed_drafts').find(r => r.draft_id === 'draft-noperm-1');
  assert.equal(row.status, 'rejected');
  assert.equal(row.agent_id, null);
});

test('execute_action_draft rejects on wallet drift when the declared source wallet no longer matches the fresh resolution', async () => {
  const env = makeEnv();
  seedAgentContext(env, { credential_type: 'bearer_token', credential_key: sha256Hex(STATIC_TOKEN), capability: 'circle_gasless_transfer', max_amount_atomic: '10000', limit_atomic: '100000', spent_atomic: '0' });
  const wallet = env.DB.table('agent_wallets')[0];
  wallet.wallet_id = 'wallet-current';
  wallet.wallet_address = '0x1111111111111111111111111111111111111111';
  const result = await mcp(env, STATIC_TOKEN, 'tools/call', {
    name: 'execute_action_draft',
    arguments: {
      draft: {
        draft_id: 'draft-drift-1', kind: 'send',
        // Declares a DIFFERENT wallet than what fresh resolution returns --
        // simulates a reassignment between draft creation and execution.
        source_wallet_id: 'wallet-stale',
        destination_address: '0x2222222222222222222222222222222222222222',
        amount_atomic: '1000'
      }
    }
  });
  const payload = toolPayload(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error, 'resolution_drifted');
  assert.equal(payload.agent_id, 'agent-1');
  const row = env.DB.table('executed_drafts').find(r => r.draft_id === 'draft-drift-1');
  assert.equal(row.status, 'rejected');
  assert.equal(row.error_detail, 'resolution_drifted');
});

function seedAgentContext(env, overrides = {}) {
  const agentId = overrides.agent_id || 'agent-1';
  const subject = overrides.subject || 'subject-1';
  const walletId = overrides.wallet_id || 'wallet-1';
  const credentialType = overrides.credential_type || 'oauth_subject_sha256';
  const credentialKey = overrides.credential_key || sha256Hex(subject);
  const ts = nowIsoTest();
  env.DB.table('agents').push({ agent_id: agentId, display_name: 'Agent One', status: overrides.agent_status || 'active', created_at: ts, updated_at: ts });
  env.DB.table('agent_credentials').push({ id: 'cred-1', agent_id: agentId, credential_type: credentialType, credential_key: credentialKey, status: 'active', created_at: ts, updated_at: ts });
  if (overrides.wallet !== false) env.DB.table('agent_wallets').push({ id: 'aw-1', agent_id: agentId, wallet_address: walletId, network: overrides.network || 'base-sepolia', asset: overrides.asset || 'USDC', status: 'active', created_at: ts, updated_at: ts });
  if (overrides.permission !== false) env.DB.table('agent_permissions').push({ id: 'perm-1', agent_id: agentId, capability: overrides.capability || 'resolve_agent_context', effect: overrides.effect || 'allow', network: overrides.permission_network ?? null, asset: overrides.permission_asset ?? null, max_amount_atomic: overrides.max_amount_atomic ?? null, created_at: ts, updated_at: ts });
  if (overrides.budget !== false) env.DB.table('agent_budgets').push({ id: 'budget-1', agent_id: agentId, network: overrides.network || 'base-sepolia', asset: overrides.asset || 'USDC', period: 'lifetime', limit_atomic: overrides.limit_atomic || '1000000', spent_atomic: overrides.spent_atomic || '0', status: 'active', created_at: ts, updated_at: ts });
  return { agentId, subject, walletId };
}

function toolPayload(result) {
  return JSON.parse(result.body.result.content[0].text);
}

test('resolve_agent_context appears in tools/list', async () => {
  const env = makeEnv();
  const { token } = await adminGrant(env);
  const result = await mcp(env, token, 'tools/list');
  assert.ok(result.body.result.tools.some(tool => tool.name === 'resolve_agent_context'));
});

test('Phase 5.1 OAuth scope map exposes only the intended Agent Context wallet tools', async () => {
  const fs = await import('node:fs/promises');
  const source = await fs.readFile(new URL('../worker.js', import.meta.url), 'utf8');
  assert.match(source, /'wallet:read': \['subagent_status', 'resolve_agent_context', 'circle_list_wallet_sets', 'circle_list_wallets', 'circle_get_wallet_balance', 'circle_get_transaction'\]/);
  assert.match(source, /'wallet:transfer:testnet': \['circle_gasless_transfer', 'execute_action_draft'\]/);
  assert.doesNotMatch(source, /'wallet:transfer:testnet': \[[^\]]*circle_transfer'/);
});

test('authorization-server metadata publishes the protected resource list', async () => {
  const env = makeEnv();
  const { response, body } = await json(await request(env, '/.well-known/oauth-authorization-server'));
  assert.equal(response.status, 200);
  assert.deepEqual(body.protected_resources, [ORIGIN, ORIGIN + '/mcp']);
});

function nowIsoTest() { return new Date().toISOString(); }
