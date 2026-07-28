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
  return value.split(',').map(part => part.trim()).filter(Boolean);
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

  async run() {
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
      throw new Error('Unsupported WHERE clause in test D1 mock: ' + clause);
    }) : [];
    let rows = this.db.table(tableName).filter(row => predicates.every(p => {
      switch (p.op) {
        case '=': return row[p.column] === p.value;
        case '=num': return Number(row[p.column]) === p.value;
        case '=str': return String(row[p.column]) === p.value;
        case '!=str': return row[p.column] !== p.value;
        case 'notnull': return row[p.column] != null;
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
    let match = /^INSERT INTO (\w+) \((.+?)\) VALUES \((.+?)\)$/i.exec(this.sql);
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
    if (match) {
      const [, tableName, setText, whereText] = match;
      const setClauses = splitCsv(setText);
      let paramIndex = 0;
      const setters = setClauses.map(clause => {
        let m = /^(\w+) = \?$/.exec(clause);
        if (m) return { column: m[1], value: this.params[paramIndex++] };
        m = /^(\w+) = (\d+)$/.exec(clause);
        if (m) return { column: m[1], value: Number(m[2]) };
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
        throw new Error('Unsupported UPDATE predicate in test D1 mock: ' + clause);
      });
      let changes = 0;
      for (const row of this.db.table(tableName)) {
        if (!whereClauses.every(condition => row[condition.column] === condition.value)) continue;
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
  return {
    DB: new MemoryD1(),
    OAUTH_LOGIN_PASSWORD: LOGIN_PASSWORD,
    MCP_AUTH_TOKEN: STATIC_TOKEN,
    WORKER_NAME: 'x402-test'
  };
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
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: overrides.clientId || client.client_id,
    redirect_uri: redirectUri,
    scope,
    state: 'state-123',
    code_challenge: challenge,
    code_challenge_method: overrides.challengeMethod || 'S256',
    resource,
    password: overrides.password || LOGIN_PASSWORD
  });
  if (overrides.grantAdmin) params.set('grant_admin', '1');
  const response = await request(env, '/authorize', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params,
    redirect: 'manual'
  });
  return { response, verifier, redirectUri };
}

async function issueAuthorizationCode(env, client, overrides = {}) {
  const result = await authorize(env, client, overrides);
  assert.equal(result.response.status, 302);
  const location = new URL(result.response.headers.get('location'));
  assert.equal(location.origin + location.pathname, REDIRECT_URI);
  return { code: location.searchParams.get('code'), verifier: result.verifier, redirectUri: result.redirectUri };
}

async function exchangeCode(env, client, grant, overrides = {}) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: overrides.clientId || client.client_id,
    code: grant.code,
    redirect_uri: overrides.redirectUri || grant.redirectUri,
    code_verifier: overrides.verifier || grant.verifier
  });
  if (overrides.clientSecret) body.set('client_secret', overrides.clientSecret);
  return json(await request(env, '/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  }));
}

async function refresh(env, client, token, overrides = {}) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: overrides.clientId || client.client_id,
    refresh_token: token
  });
  return json(await request(env, '/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  }));
}

async function mcp(env, bearer, method, params = {}) {
  return json(await request(env, '/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + bearer },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  }));
}

test('authorization-server metadata publishes the protected resource list', async () => {
  const env = makeEnv();
  const { response, body } = await json(await request(env, '/.well-known/oauth-authorization-server'));
  assert.equal(response.status, 200);
  assert.deepEqual(body.protected_resources, [ORIGIN, ORIGIN + '/mcp']);
});

test('authorization-code success stores only a digest and authorizes a read tool', async () => {
  const env = makeEnv();
  const client = await registerClient(env);
  const grant = await issueAuthorizationCode(env, client);
  const stored = env.DB.table('oauth_auth_codes')[0];
  assert.equal(stored.code, sha256Hex(grant.code));
  assert.notEqual(stored.code, grant.code);

  const { response, body } = await exchangeCode(env, client, grant);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.match(body.access_token, /^[A-Za-z0-9_-]+$/);
  assert.ok(body.refresh_token);

  const listed = await mcp(env, body.access_token, 'tools/call', { name: 'subagent_status', arguments: {} });
  assert.equal(listed.response.status, 200);
  assert.equal(listed.body.result.isError, false);
});

test('PKCE failure consumes the one-time code and returns invalid_grant', async () => {
  const env = makeEnv();
  const client = await registerClient(env);
  const grant = await issueAuthorizationCode(env, client);
  const failed = await exchangeCode(env, client, grant, { verifier: 'wrong-verifier'.repeat(6) });
  assert.equal(failed.response.status, 400);
  assert.equal(failed.body.error, 'invalid_grant');
  assert.match(failed.body.error_description, /code_verifier/);
  assert.equal(env.DB.table('oauth_auth_codes')[0].used, 1);
});

test('expired authorization code is rejected', async () => {
  const env = makeEnv();
  const client = await registerClient(env);
  const grant = await issueAuthorizationCode(env, client);
  env.DB.table('oauth_auth_codes')[0].expires_at = new Date(Date.now() - 1000).toISOString();
  const result = await exchangeCode(env, client, grant);
  assert.equal(result.response.status, 400);
  assert.equal(result.body.error, 'invalid_grant');
  assert.match(result.body.error_description, /expired/);
  const events = auditEvents(env, 'authorization_code_expired');
  assert.equal(events.length, 1);
  assert.equal(events[0].client_id, client.client_id);
  assert.equal(events[0].detail, 'atomic claim rejected');
});

test('authorization code replay fails after the first successful redemption', async () => {
  const env = makeEnv();
  const client = await registerClient(env);
  const grant = await issueAuthorizationCode(env, client);
  const first = await exchangeCode(env, client, grant);
  assert.equal(first.response.status, 200);
  const second = await exchangeCode(env, client, grant);
  assert.equal(second.response.status, 400);
  assert.equal(second.body.error, 'invalid_grant');
  const events = auditEvents(env, 'authorization_code_replay');
  assert.equal(events.length, 1);
  assert.equal(events[0].client_id, client.client_id);
  assert.equal(events[0].detail, 'atomic claim rejected');
});

test('concurrent redemption race yields exactly one token response and audits the losing attempt', async () => {
  const env = makeEnv();
  const client = await registerClient(env);
  const grant = await issueAuthorizationCode(env, client);
  const results = await Promise.all([
    exchangeCode(env, client, grant),
    exchangeCode(env, client, grant)
  ]);
  assert.equal(results.filter(result => result.response.status === 200).length, 1);
  assert.equal(results.filter(result => result.response.status === 400 && result.body.error === 'invalid_grant').length, 1);
  const events = auditEvents(env, 'authorization_code_replay');
  assert.equal(events.length, 1);
  assert.equal(events[0].client_id, client.client_id);
});

test('refresh token rotates and preserves its family', async () => {
  const env = makeEnv();
  const client = await registerClient(env);
  const grant = await issueAuthorizationCode(env, client);
  const issued = await exchangeCode(env, client, grant);
  const rotated = await refresh(env, client, issued.body.refresh_token);
  assert.equal(rotated.response.status, 200, JSON.stringify(rotated.body));
  assert.notEqual(rotated.body.refresh_token, issued.body.refresh_token);
  const rows = env.DB.table('oauth_refresh_tokens');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].family_id, rows[1].family_id);
  assert.ok(rows[0].rotated_at);
});

test('refresh replay revokes the token family and subject access tokens', async () => {
  const env = makeEnv();
  const client = await registerClient(env);
  const grant = await issueAuthorizationCode(env, client);
  const issued = await exchangeCode(env, client, grant);
  const rotated = await refresh(env, client, issued.body.refresh_token);
  assert.equal(rotated.response.status, 200);
  const replay = await refresh(env, client, issued.body.refresh_token);
  assert.equal(replay.response.status, 400);
  assert.match(replay.body.error_description, /family revoked/);
  assert.ok(env.DB.table('oauth_refresh_tokens').every(row => row.revoked === 1));
  assert.ok(env.DB.table('oauth_access_tokens').every(row => row.revoked === 1));
});

test('invalid client is rejected by authorize and token endpoints', async () => {
  const env = makeEnv();
  const fake = { client_id: 'missing-client' };
  const auth = await authorize(env, fake);
  assert.equal(auth.response.status, 400);
  assert.match(await auth.response.text(), /invalid_client/);

  const result = await exchangeCode(env, fake, { code: 'bogus', verifier: 'v'.repeat(64), redirectUri: REDIRECT_URI });
  assert.equal(result.response.status, 401);
  assert.equal(result.body.error, 'invalid_client');
});

test('invalid redirect URI is rejected without redirecting to the attacker URI', async () => {
  const env = makeEnv();
  const client = await registerClient(env);
  const result = await authorize(env, client, { redirectUri: 'https://attacker.example/callback' });
  assert.equal(result.response.status, 400);
  assert.equal(result.response.headers.get('location'), null);
  assert.match(await result.response.text(), /redirect_uri not registered/);
});

test('invalid scope is negotiated down to the compatibility-safe read default', async () => {
  const env = makeEnv();
  const client = await registerClient(env, { client_name: 'Claude.ai' });
  const grant = await issueAuthorizationCode(env, client, { scope: 'claudeai unknown:scope' });
  const stored = env.DB.table('oauth_auth_codes')[0];
  assert.equal(stored.scope, 'wallet:read offline_access');
  const issued = await exchangeCode(env, client, grant);
  assert.equal(issued.response.status, 200);
  assert.equal(issued.body.scope, 'wallet:read offline_access');
});

test('resource indicator accepts canonical origin and /mcp, rejects foreign resources', async () => {
  const env = makeEnv();
  const client = await registerClient(env);
  for (const resource of [ORIGIN, ORIGIN + '/', ORIGIN + '/mcp', ORIGIN + '/mcp/']) {
    const result = await authorize(env, client, { resource });
    assert.equal(result.response.status, 302, resource);
  }
  const denied = await authorize(env, client, { resource: 'https://foreign.example/mcp' });
  assert.equal(denied.response.status, 302);
  const location = new URL(denied.response.headers.get('location'));
  assert.equal(location.searchParams.get('error'), 'invalid_target');
});

test('static bearer compatibility retains full tool access', async () => {
  const env = makeEnv();
  const result = await mcp(env, STATIC_TOKEN, 'tools/call', { name: 'subagent_status', arguments: {} });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.result.isError, false);
});

// ===================================================================
// OAuth Flight Recorder (V1.4.6) tests
// ===================================================================

function traceEvents(env, filter) {
  return env.DB.table('oauth_trace_events').filter(row => !filter || filter(row));
}

async function adminGrant(env, overrides = {}) {
  // A full-access (mcp:admin) OAuth token, obtained the only sanctioned way:
  // the consent-page checkbox. Used to reach the admin-gated trace tools.
  const client = await registerClient(env, { client_name: overrides.client_name || 'Claude.ai' });
  const grant = await issueAuthorizationCode(env, client, { grantAdmin: true, scope: overrides.scope || 'wallet:read offline_access' });
  const issued = await exchangeCode(env, client, grant);
  assert.equal(issued.response.status, 200, JSON.stringify(issued.body));
  return { client, token: issued.body.access_token };
}

test('flight recorder writes a hashed, secret-free trail across a full successful flow', async () => {
  const env = makeEnv();
  const client = await registerClient(env, { client_name: 'ChatGPT' });
  const grant = await issueAuthorizationCode(env, client);
  const issued = await exchangeCode(env, client, grant);
  assert.equal(issued.response.status, 200);

  const events = traceEvents(env);
  assert.ok(events.length >= 3, 'expected discovery/authorize/token trace events');

  // The full-flow markers must be present.
  const types = new Set(events.map(e => e.event_type));
  assert.ok(types.has('login_ok'));
  assert.ok(types.has('token_issued'));

  // SECURITY INVARIANT: no raw secret ever lands in the recorder. The raw
  // code, verifier, and access/refresh tokens must not appear in any column.
  const secrets = [grant.code, grant.verifier, issued.body.access_token, issued.body.refresh_token].filter(Boolean);
  for (const row of events) {
    const serialized = JSON.stringify(row);
    for (const secret of secrets) {
      assert.ok(!serialized.includes(secret), 'raw secret leaked into trace event: ' + row.event_type);
    }
  }
  // The stored authorization_code_hash must be the DIGEST, not the raw code.
  const codeIssued = events.find(e => e.event_type === 'login_ok');
  assert.equal(codeIssued.authorization_code_hash, sha256Hex(grant.code));

  // client_ip / user_agent hashing: when a UA is present it is stored hashed.
  const withUa = events.find(e => e.user_agent_hash);
  if (withUa) assert.match(withUa.user_agent_hash, /^[0-9a-f]{64}$/);
});

test('oauth_trace_get reconstructs one flow as an ordered timeline', async () => {
  const env = makeEnv();
  const { token } = await adminGrant(env);
  // Drive one correlated flow through /mcp using an explicit trace id header.
  const traceId = 'trace-e2e-1';
  const headers = { 'content-type': 'application/json', authorization: 'Bearer ' + token, 'x-oauth-trace-id': traceId };
  await request(env, '/mcp', { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) });
  await request(env, '/mcp', { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) });
  await request(env, '/mcp', { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'oauth_trace_get', arguments: { trace_id: traceId } } }) });

  const listed = await mcp(env, token, 'tools/call', { name: 'oauth_trace_get', arguments: { trace_id: traceId } });
  assert.equal(listed.response.status, 200);
  const payload = JSON.parse(listed.body.result.content[0].text);
  assert.equal(payload.found, true);
  assert.equal(payload.trace_id, traceId);
  const timelineTypes = payload.timeline.map(e => e.event);
  assert.ok(timelineTypes.includes('initialize'));
  assert.ok(timelineTypes.includes('tools_list'));
  // Timeline must be non-decreasing in time.
  const times = payload.timeline.map(e => e.at);
  assert.deepEqual(times, [...times].sort());
});

test('flight recorder captures a replay attempt as a replay-outcome event', async () => {
  const env = makeEnv();
  const client = await registerClient(env);
  const grant = await issueAuthorizationCode(env, client);
  await exchangeCode(env, client, grant);
  await exchangeCode(env, client, grant); // replay
  const replays = traceEvents(env, r => r.outcome === 'replay');
  assert.ok(replays.length >= 1, 'expected a replay-outcome trace event');
  assert.equal(replays[0].authorization_code_hash, sha256Hex(grant.code));
  assert.equal(replays[0].error, 'invalid_grant');
});

test('flight recorder captures an expired authorization code', async () => {
  const env = makeEnv();
  const client = await registerClient(env);
  const grant = await issueAuthorizationCode(env, client);
  env.DB.table('oauth_auth_codes')[0].expires_at = new Date(Date.now() - 1000).toISOString();
  await exchangeCode(env, client, grant);
  const expired = traceEvents(env, r => r.outcome === 'expired');
  assert.ok(expired.length >= 1, 'expected an expired-outcome trace event');
});

test('flight recorder captures a PKCE failure distinctly', async () => {
  const env = makeEnv();
  const client = await registerClient(env);
  const grant = await issueAuthorizationCode(env, client);
  await exchangeCode(env, client, grant, { verifier: 'wrong-verifier'.repeat(6) });
  const pkce = traceEvents(env, r => r.event_type === 'pkce_failure');
  assert.equal(pkce.length, 1);
  assert.equal(pkce[0].outcome, 'pkce_failure');
});

test('flight recorder captures a resource mismatch at authorize', async () => {
  const env = makeEnv();
  const client = await registerClient(env);
  await authorize(env, client, { resource: 'https://foreign.example/mcp' });
  const mismatch = traceEvents(env, r => r.outcome === 'resource_mismatch');
  assert.ok(mismatch.length >= 1, 'expected a resource_mismatch trace event');
  assert.equal(mismatch[0].error, 'invalid_target');
});

test('flight recorder captures an unauthorized MCP request', async () => {
  const env = makeEnv();
  const res = await mcp(env, 'not-a-real-token', 'initialize', {});
  assert.equal(res.response.status, 401);
  const unauth = traceEvents(env, r => r.event_type === 'unauthorized');
  assert.ok(unauth.length >= 1);
  assert.equal(unauth[0].outcome, 'unauthorized');
  assert.equal(unauth[0].http_status, 401);
});

test('flight recorder distinguishes a wallet authorization failure', async () => {
  const env = makeEnv();
  // A read-only OAuth token (no admin, no transfer scope) calling a wallet tool.
  const client = await registerClient(env, { client_name: 'ChatGPT' });
  const grant = await issueAuthorizationCode(env, client, { scope: 'wallet:read offline_access' });
  const issued = await exchangeCode(env, client, grant);
  const denied = await mcp(env, issued.body.access_token, 'tools/call', { name: 'circle_transfer', arguments: { wallet_id: 'w', destination_address: '0x0', amount: '0.01' } });
  assert.equal(denied.response.status, 403);
  const walletFail = traceEvents(env, r => r.event_type === 'wallet_authz_fail');
  assert.equal(walletFail.length, 1);
  assert.equal(walletFail[0].outcome, 'denied');
});

test('oauth_trace_list filters by outcome and folds into traces', async () => {
  const env = makeEnv();
  const { token } = await adminGrant(env);
  // Generate a replay so there is a known error outcome to filter on.
  const client = await registerClient(env);
  const grant = await issueAuthorizationCode(env, client);
  await exchangeCode(env, client, grant);
  await exchangeCode(env, client, grant);

  const res = await mcp(env, token, 'tools/call', { name: 'oauth_trace_list', arguments: { outcome: 'replay' } });
  const payload = JSON.parse(res.body.result.content[0].text);
  assert.equal(payload.ok, true);
  assert.ok(payload.events.every(e => e.outcome === 'replay'));
  assert.ok(payload.traces.length >= 1);
});

test('oauth_trace_analyze surfaces a likely cause and suggested fix', async () => {
  const env = makeEnv();
  const { token } = await adminGrant(env);
  // Create a PKCE failure under a known trace id via the /token path is not
  // header-correlated (browser step), so drive a header-correlated unauthorized
  // flow instead and analyze it.
  const traceId = 'trace-analyze-1';
  await request(env, '/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer bad-token', 'x-oauth-trace-id': traceId },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'subagent_status', arguments: {} } })
  });
  const res = await mcp(env, token, 'tools/call', { name: 'oauth_trace_analyze', arguments: { trace_id: traceId } });
  const payload = JSON.parse(res.body.result.content[0].text);
  assert.equal(payload.found, true);
  assert.ok(payload.likely_client_issue.length >= 1);
  assert.ok(payload.suggested_fix.length >= 1);
});

test('oauth_trace_prune deletes only events older than the retention window', async () => {
  const env = makeEnv();
  const { token } = await adminGrant(env);
  const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
  const recent = nowIsoTest();
  env.DB.table('oauth_trace_events').push(
    { id: 'old1', trace_id: 't-old', timestamp: old, event_type: 'discovery', created_at: old },
    { id: 'new1', trace_id: 't-new', timestamp: recent, event_type: 'discovery', created_at: recent }
  );
  const res = await mcp(env, token, 'tools/call', { name: 'oauth_trace_prune', arguments: { retention_days: '30' } });
  const payload = JSON.parse(res.body.result.content[0].text);
  assert.equal(payload.ok, true);
  assert.ok(payload.deleted >= 1);
  const remaining = env.DB.table('oauth_trace_events').map(r => r.id);
  assert.ok(!remaining.includes('old1'));
  assert.ok(remaining.includes('new1'));
});

test('trace tools are unreachable for a non-admin OAuth token', async () => {
  const env = makeEnv();
  const client = await registerClient(env, { client_name: 'ChatGPT' });
  const grant = await issueAuthorizationCode(env, client, { scope: 'wallet:read offline_access' });
  const issued = await exchangeCode(env, client, grant);
  const denied = await mcp(env, issued.body.access_token, 'tools/call', { name: 'oauth_trace_list', arguments: {} });
  assert.equal(denied.response.status, 403);
});

function seedAgentContext(env, overrides = {}) {
  const agentId = overrides.agent_id || 'agent-1';
  const subject = overrides.subject || 'subject-1';
  const walletId = overrides.wallet_id || 'wallet-1';
  const credentialType = overrides.credential_type || 'oauth_subject';
  const credentialKey = overrides.credential_key || subject;
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
  const result = await mcp(env, STATIC_TOKEN, 'tools/list');
  assert.ok(result.body.result.tools.some(tool => tool.name === 'resolve_agent_context'));
});

test('OAuth subject resolves to an agent through MCP', async () => {
  const env = makeEnv();
  const client = await registerClient(env, { client_name: 'ChatGPT' });
  const grant = await issueAuthorizationCode(env, client, { grantAdmin: true });
  const issued = await exchangeCode(env, client, grant);
  const subject = env.DB.table('oauth_access_tokens')[0].subject;
  seedAgentContext(env, { subject });
  const result = await mcp(env, issued.body.access_token, 'tools/call', { name: 'resolve_agent_context', arguments: {} });
  assert.equal(toolPayload(result).agent_id, 'agent-1');
});

test('static bearer resolves using the SHA-256 digest, not the raw token', async () => {
  const env = makeEnv();
  seedAgentContext(env, { credential_type: 'bearer_token', credential_key: sha256Hex(STATIC_TOKEN) });
  const result = await mcp(env, STATIC_TOKEN, 'tools/call', { name: 'resolve_agent_context', arguments: {} });
  const payload = toolPayload(result);
  assert.equal(payload.agent_id, 'agent-1');
  assert.equal(env.DB.table('agent_credentials')[0].credential_key, sha256Hex(STATIC_TOKEN));
  assert.notEqual(env.DB.table('agent_credentials')[0].credential_key, STATIC_TOKEN);
});

test('unknown credential fails closed', async () => {
  const env = makeEnv();
  const result = await mcp(env, STATIC_TOKEN, 'tools/call', { name: 'resolve_agent_context', arguments: {} });
  assert.equal(toolPayload(result).error_code, 'unknown_agent');
});

test('corrupt duplicate credential rows injected outside schema validation produce ambiguous_identity', async () => {
  const env = makeEnv();
  const digest = sha256Hex(STATIC_TOKEN);
  seedAgentContext(env, { credential_type: 'bearer_token', credential_key: digest });
  env.DB.table('agents').push({ agent_id: 'agent-2', display_name: 'Agent Two', status: 'active', created_at: nowIsoTest(), updated_at: nowIsoTest() });
  env.DB.table('agent_credentials').push({ id: 'corrupt-duplicate', agent_id: 'agent-2', credential_type: 'bearer_token', credential_key: digest, status: 'active', created_at: nowIsoTest(), updated_at: nowIsoTest() });
  const result = await mcp(env, STATIC_TOKEN, 'tools/call', { name: 'resolve_agent_context', arguments: {} });
  assert.equal(toolPayload(result).error_code, 'ambiguous_identity');
});

test('disabled agent fails closed', async () => {
  const env = makeEnv();
  seedAgentContext(env, { credential_type: 'bearer_token', credential_key: sha256Hex(STATIC_TOKEN), agent_status: 'disabled' });
  const result = await mcp(env, STATIC_TOKEN, 'tools/call', { name: 'resolve_agent_context', arguments: {} });
  assert.equal(toolPayload(result).error_code, 'disabled_agent');
});

test('missing or mismatched wallet fails closed', async () => {
  const env = makeEnv();
  seedAgentContext(env, { credential_type: 'bearer_token', credential_key: sha256Hex(STATIC_TOKEN), wallet: false });
  let result = await mcp(env, STATIC_TOKEN, 'tools/call', { name: 'resolve_agent_context', arguments: {} });
  assert.equal(toolPayload(result).error_code, 'wallet_not_assigned');
  env.DB.table('agent_wallets').push({ id: 'aw-2', agent_id: 'agent-1', wallet_address: 'wallet-x', network: 'base', asset: 'USDC', status: 'active' });
  result = await mcp(env, STATIC_TOKEN, 'tools/call', { name: 'resolve_agent_context', arguments: { network: 'base-sepolia', asset: 'USDC' } });
  assert.equal(toolPayload(result).error_code, 'wallet_not_assigned');
});

test('missing capability, explicit deny, and permission maximum return permission_denied', async () => {
  const env = makeEnv();
  seedAgentContext(env, { credential_type: 'bearer_token', credential_key: sha256Hex(STATIC_TOKEN), permission: false });
  let result = await mcp(env, STATIC_TOKEN, 'tools/call', { name: 'resolve_agent_context', arguments: {} });
  assert.equal(toolPayload(result).error_code, 'permission_denied');
  env.DB.table('agent_permissions').push({ id: 'deny', agent_id: 'agent-1', capability: 'resolve_agent_context', effect: 'deny', network: null, asset: null });
  result = await mcp(env, STATIC_TOKEN, 'tools/call', { name: 'resolve_agent_context', arguments: {} });
  assert.equal(toolPayload(result).error_code, 'permission_denied');
  env.DB.table('agent_permissions').length = 0;
});

test('permission-specific maximum amount is enforced', async () => {
  const env = makeEnv();
  seedAgentContext(env, { credential_type: 'bearer_token', credential_key: sha256Hex(STATIC_TOKEN), max_amount_atomic: '9' });
  const result = await mcp(env, STATIC_TOKEN, 'tools/call', { name: 'resolve_agent_context', arguments: { amount_atomic: '10' } });
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

function nowIsoTest() { return new Date().toISOString(); }
