-- V1.4.5 Stage 1: minimal single-user OAuth 2.1 compatibility layer.
-- Additive only. Does not touch payment_rules, coupons, pricing_tiers,
-- internal_tokens, settlement_assets, display_denominations, or usage_events.
-- One-time state (auth codes, refresh-token families, revocations) lives
-- here in D1, not KV, for real transactional guarantees.

CREATE TABLE IF NOT EXISTS oauth_subjects (
  subject TEXT PRIMARY KEY,               -- opaque 128-bit random, lowercase 32-hex; never derived from name/email/wallet/IP/device
  label TEXT,                             -- human note only, e.g. 'jared'
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,                      -- ISO timestamp; login blocked until this passes
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_name TEXT,
  client_secret_hash TEXT,                -- SHA-256 hex; NULL for public (PKCE-only, auth_method='none') clients
  redirect_uris TEXT NOT NULL,            -- JSON array, exact-match only
  token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
  grant_types TEXT NOT NULL DEFAULT '["authorization_code","refresh_token"]',
  response_types TEXT NOT NULL DEFAULT '["code"]',
  registration_source TEXT NOT NULL DEFAULT 'dcr',   -- 'dcr' | 'manual' (manual = pre-registered fallback)
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_auth_codes (
  code TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT,
  code_challenge TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL,    -- always 'S256' this stage; plain/none rejected before insert
  used INTEGER NOT NULL DEFAULT 0,        -- one-time; claimed via atomic UPDATE ... WHERE used = 0
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_access_tokens (
  token_hash TEXT PRIMARY KEY,            -- SHA-256 hex of the raw token; raw value never stored
  client_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT,                          -- audience binding (expected origin)
  revoked INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT,
  rotated_at TEXT,                        -- set once this token has been exchanged; a second use is a replay
  revoked INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_audit_log (
  id TEXT PRIMARY KEY,
  event TEXT NOT NULL,       -- login_ok | login_fail | client_registered | code_issued | token_issued
                              -- | refresh_rotated | refresh_replay_detected | tool_call | scope_denied
  subject TEXT,
  client_id TEXT,
  tool_name TEXT,
  detail TEXT,                -- never raw secrets/tokens; identifiers and outcomes only
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_refresh_family ON oauth_refresh_tokens(family_id);
CREATE INDEX IF NOT EXISTS idx_oauth_access_expires ON oauth_access_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_refresh_expires ON oauth_refresh_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_auth_codes_expires ON oauth_auth_codes(expires_at);
