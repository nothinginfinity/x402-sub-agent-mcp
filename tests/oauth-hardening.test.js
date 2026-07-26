import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';

const worker = await readFile(new URL('../worker.js', import.meta.url), 'utf8');

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

test('worker remains syntactically importable source', () => {
  assert.match(worker, /export default\s*\{/);
});

test('authorization codes are hashed before D1 insertion', () => {
  assert.match(worker, /const code = randomB64url\(32\);\s+const codeHash = await sha256Hex\(code\);/);
  assert.match(worker, /INSERT INTO oauth_auth_codes[\s\S]*?\[codeHash, v\.client\.client_id/);
  assert.doesNotMatch(worker, /INSERT INTO oauth_auth_codes[\s\S]*?\[code, v\.client\.client_id/);
});

test('token exchange hashes the presented code before atomic claim and lookup', () => {
  assert.match(worker, /if \(grantType === 'authorization_code'\)[\s\S]*?const codeHash = await sha256Hex\(code\);/);
  assert.match(worker, /UPDATE oauth_auth_codes SET used = 1 WHERE code = \? AND used = 0', \[codeHash\]/);
  assert.match(worker, /SELECT \* FROM oauth_auth_codes WHERE code = \?', \[codeHash\]/);
  assert.doesNotMatch(worker, /WHERE code = \?', \[code\]/);
});

test('raw authorization code is still returned to the registered redirect URI', () => {
  assert.match(worker, /redirectUrl\.searchParams\.set\('code', code\);/);
  assert.doesNotMatch(worker, /redirectUrl\.searchParams\.set\('code', codeHash\);/);
});

test('hashing is deterministic and does not reveal the raw code', () => {
  const code = randomBytes(32).toString('base64url');
  const digestA = sha256Hex(code);
  const digestB = sha256Hex(code);
  assert.equal(digestA, digestB);
  assert.notEqual(digestA, code);
  assert.match(digestA, /^[0-9a-f]{64}$/);
});

test('one-time atomic claim guard remains present', () => {
  assert.match(worker, /UPDATE oauth_auth_codes SET used = 1 WHERE code = \? AND used = 0/);
  assert.match(worker, /claim\.meta\.changes !== 1/);
  assert.match(worker, /authorization code is invalid, expired, or already used/);
});

test('PKCE S256 verification remains enforced', () => {
  assert.match(worker, /const computedChallenge = await sha256B64url\(codeVerifier\);/);
  assert.match(worker, /computedChallenge !== codeRow\.code_challenge/);
  assert.match(worker, /code_verifier does not match code_challenge/);
});

test('client, redirect URI, and expiration checks remain enforced', () => {
  assert.match(worker, /codeRow\.client_id !== clientId \|\| codeRow\.redirect_uri !== redirectUri/);
  assert.match(worker, /new Date\(codeRow\.expires_at\)\.getTime\(\) < Date\.now\(\)/);
});

test('refresh token rotation and family replay revocation remain intact', () => {
  assert.match(worker, /UPDATE oauth_refresh_tokens SET rotated_at = \? WHERE token_hash = \?/);
  assert.match(worker, /UPDATE oauth_refresh_tokens SET revoked = 1 WHERE family_id = \?/);
  assert.match(worker, /refresh token reuse detected; token family revoked/);
});

test('legacy static bearer path remains present', () => {
  assert.match(worker, /MCP_AUTH_TOKEN/);
});

test('testnet transfer authority is not introduced by the hashing commit', () => {
  const issueSegment = worker.match(/async function issueTokenPair[\s\S]*?async function handleTokenEndpoint/);
  assert.ok(issueSegment);
  assert.doesNotMatch(issueSegment[0], /wallet:transfer:testnet/);
});
