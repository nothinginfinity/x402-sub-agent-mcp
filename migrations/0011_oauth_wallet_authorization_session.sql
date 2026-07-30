-- V1.4.6 Phase 0: OAuth-time wallet assignment — authorization session table.
-- Additive only. Does not touch oauth_subjects, oauth_clients, oauth_auth_codes,
-- oauth_access_tokens, oauth_refresh_tokens, agents, agent_wallets, agent_budgets,
-- agent_permissions, agent_credentials, or agent_context_audit.
--
-- Purpose: carry the operator's wallet + budget choices made ON the consent page
-- through the authorize -> token round-trip as SERVER-OWNED state, so the choice is
-- never re-derived from an unsigned client parameter at token exchange. Consumed
-- atomically at token exchange (claimed via UPDATE ... WHERE consumed = 0), then the
-- Agent Context write (agent + wallet + budget + permission + credential + audit)
-- happens in one transaction. One-time, security-critical state -> D1, not KV, for
-- real transactional guarantees (same reasoning as 0004's auth codes / refresh
-- families).
--
-- Timestamps are ISO-8601 TEXT throughout, matching every other table in this DB.
-- Wallet-ID fields carry the Circle wallet ID (the stored key); the human-friendly
-- name is display-only and is NOT stored here.

CREATE TABLE IF NOT EXISTS oauth_authorization_sessions (
  authorization_session_id TEXT PRIMARY KEY,   -- opaque 128-bit random, lowercase 32-hex; the handle threaded through authorize->token
  oauth_client_id          TEXT NOT NULL,       -- the connecting client (e.g. ChatGPT's DCR client); references oauth_clients.client_id
  oauth_subject            TEXT NOT NULL,       -- authenticated operator subject; references oauth_subjects.subject
  user_id                  TEXT,                -- operator identity for wallet-ownership scoping; single-user today, kept explicit for later multi-operator
  selected_wallet_id       TEXT,                -- CIRCLE wallet id chosen on the consent page; NULL until step 4 (selection) completes
  budget_atomic            TEXT,                -- lifetime budget ceiling, integer atomic string (/^\d+$/); maps to agent_budgets.limit_atomic
  transfer_max_atomic      TEXT,                -- per-transfer maximum, integer atomic string (/^\d+$/); enforced on circle_gasless_transfer
  allowed_asset            TEXT NOT NULL DEFAULT 'USDC',        -- maps to agent_budgets.asset / agent_wallets.asset
  allowed_network          TEXT NOT NULL DEFAULT 'base-sepolia',-- TESTNET ONLY at this stage; validated against a testnet allowlist before insert/consume
  budget_expires_at        TEXT,                -- OPTIONAL operator-chosen budget expiry (ISO); distinct from this row's own TTL. NULL = no expiry
  scopes                   TEXT NOT NULL,       -- JSON array of granted scopes, same shape as oauth_auth_codes.scope content
  state                    TEXT,                -- OAuth state echoed back to the client; validated at redirect
  code_challenge           TEXT NOT NULL,       -- PKCE challenge (S256 only this stage; plain/none rejected before insert)
  code_challenge_method    TEXT NOT NULL DEFAULT 'S256',
  redirect_uri             TEXT NOT NULL,       -- exact-match redirect, same discipline as oauth_auth_codes
  resource                 TEXT,                -- audience/resource binding (expected <origin>/mcp)
  auth_code                TEXT,                -- the one-time code issued for this session (step 7); links session <-> oauth_auth_codes.code
  ownership_validated      INTEGER NOT NULL DEFAULT 0,   -- 1 only after selected_wallet_id is server-side confirmed owned by user_id; consume MUST refuse if 0
  consumed                 INTEGER NOT NULL DEFAULT 0,   -- one-time; claimed at token exchange via atomic UPDATE ... WHERE consumed = 0
  consumed_at              TEXT,                -- ISO; set when consumed flips to 1
  status                   TEXT NOT NULL DEFAULT 'pending', -- pending | selected | authorized | consumed | expired | cancelled (advisory; consumed/expires_at are authoritative)
  expires_at               TEXT NOT NULL,       -- this session's OWN short TTL (ISO); abandoned sessions expire even if never consumed
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL
);

-- Expiry sweep + fast lookup of live sessions.
CREATE INDEX IF NOT EXISTS idx_oauth_authz_sessions_expires ON oauth_authorization_sessions(expires_at);
-- Resolve a session from the auth code at token exchange.
CREATE INDEX IF NOT EXISTS idx_oauth_authz_sessions_auth_code ON oauth_authorization_sessions(auth_code);
-- Scope wallet lists / existing-assignment lookups per operator.
CREATE INDEX IF NOT EXISTS idx_oauth_authz_sessions_subject ON oauth_authorization_sessions(oauth_subject);
