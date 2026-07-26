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
    let paramIndex = 0;
    let rows = this.db.table(tableName).filter(row => {
      if (!whereClause) return true;
      const clauses = whereClause.split(/\s+AND\s+/i);
      return clauses.every(clause => {
        let m = /^(\w+) = \?$/.exec(clause);
        if (m) return row[m[1]] === this.params[paramIndex++];
        m = /^(\w+) != '([^']+)'$/.exec(clause);
        if (m) return row[m[1]] !== m[2];
        m = /^(\w+) IS NOT NULL$/i.exec(clause);
        if (m) return row[m[1]] != null;
        throw new Error('Unsupported WHERE clause in test D1 mock: ' + clause);
      });
    });
    if (/ORDER BY created_at DESC/i.test(this.sql)) rows = rows.toSorted((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    if (/ORDER BY priority ASC/i.test(this.sql)) rows = rows.toSorted((a, b) => Number(a.priority || 0) - Number(b.priority || 0));
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
      const key = ['client_id', 'code', 'token_hash', 'subject', 'id'].find(column => Object.hasOwn(row, column));
      if (key && table.some(existing => existing[key] === row[key])) throw new Error('UNIQUE constraint failed: ' + tableName + '.' + key);
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
        m = /^(\w+) = \1 \+ 1$/.exec(clause);
        if (m) return { column: m[1], increment: 1 };
        throw new Error('Unsupported UPDATE setter in test D1 mock: ' + clause);
      });
      const whereClauses = whereText.split(/\s+AND\s+/i).map(clause => {
        let m = /^(\w+) = \?$/.exec(clause);
        if (m) return { column: m[1], value: this.params[paramIndex++] };
        m = /^(\w+) = (\d+)$/.exec(clause);
        if (m) return { column: m[1], value: Number(m[2]) };
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
});

test('concurrent redemption race yields exactly one token response', async () => {
  const env = makeEnv();
  const client = await registerClient(env);
  const grant = await issueAuthorizationCode(env, client);
  const results = await Promise.all(Array.from({ length: 8 }, () => exchangeCode(env, client, grant)));
  assert.equal(results.filter(result => result.response.status === 200).length, 1);
  assert.equal(results.filter(result => result.response.status === 400 && result.body.error === 'invalid_grant').length, 7);
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
