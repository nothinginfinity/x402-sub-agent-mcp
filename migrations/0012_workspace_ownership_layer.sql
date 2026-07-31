-- V1.4.6 Phase 2 (schema freeze): workspace-based ownership layer.
-- Additive only. Introduces two tables and adds ONE nullable column to
-- oauth_authorization_sessions. Touches no other existing table or column.
--
-- REFRAMING: Circle is an INVENTORY PROVIDER, not an ownership authority.
--   existence   -> Circle (queried live; never the stored source of truth)
--   allocation  -> workspace_wallets (which workspace holds a wallet, its status)
--   assignment  -> existing agent_wallets / session path (which agent may use it)
-- The workspace, not the Circle account, is the ownership boundary.
--
-- FOREIGN KEYS (deliberate, matches house pattern): this database declares NO
-- foreign keys on any of its ~15 existing tables, even though PRAGMA foreign_keys
-- is on in some sessions. D1's pragma is not guaranteed across every access path
-- and declared FKs complicate the table rebuilds SQLite requires for later ALTERs.
-- We do NOT declare FKs here either. oauth_subjects.subject and both new PKs are
-- PRIMARY KEYs so FKs would be POSSIBLE -- we choose not to, on purpose. Orphan
-- protection is enforced EXPLICITLY instead: seed/apply-time preflight verifies
-- the workspace exists before allocating and asserts zero orphans and zero
-- cross-workspace conflicts. If FKs are ever adopted, adopt them database-wide.
--
-- ENVIRONMENT vs NETWORK (review point #5, #2): environment is NOT literally a
-- network. 'testnet' MAPS to allowed networks (testnet -> {base-sepolia}) and
-- 'mainnet' -> {base}; that mapping is enforced in SERVER code at selection time,
-- NOT at the column level. The network column intentionally uses only a NONEMPTY
-- check, not an enumerated CHECK, so supporting another Circle network or provider
-- later needs no table rebuild. Network vocabulary is a server-validation concern.
--
-- Timestamps are ISO-8601 TEXT throughout, matching every other table here.

CREATE TABLE IF NOT EXISTS workspaces (
  workspace_id   TEXT PRIMARY KEY,                 -- 'ws_' + random
  owner_subject  TEXT NOT NULL,                    -- oauth_subjects.subject (not a declared FK; see header)
  name           TEXT NOT NULL,
  environment    TEXT NOT NULL DEFAULT 'testnet'
                   CHECK (environment IN ('testnet','mainnet')),
  status         TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','disabled')),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workspaces_owner ON workspaces(owner_subject);

CREATE TABLE IF NOT EXISTS workspace_wallets (
  workspace_wallet_id TEXT PRIMARY KEY,            -- 'wsw_' + random
  workspace_id        TEXT NOT NULL,               -- workspaces.workspace_id (not a declared FK; orphan-protected explicitly)
  provider            TEXT NOT NULL DEFAULT 'circle',
  circle_wallet_id    TEXT NOT NULL,               -- provider wallet id; the value the session stores as selected_wallet_id
  wallet_address      TEXT NOT NULL,               -- cached from Circle; Circle re-verified live at consume
  network             TEXT NOT NULL CHECK (length(network) > 0),  -- nonempty only; env<->network mapping enforced in server code, not here
  asset               TEXT NOT NULL DEFAULT 'USDC',
  display_name        TEXT,                        -- dropdown label; STORED selection value is always circle_wallet_id, never this
  allocation_status   TEXT NOT NULL DEFAULT 'available'
                        CHECK (allocation_status IN ('available','assigned','disabled','archived')),  -- 'archived' included now: expanding a SQLite CHECK later needs a table rebuild
  funding_status      TEXT NOT NULL DEFAULT 'unknown'
                        CHECK (funding_status IN ('unknown','unfunded','funding','funded','depleted','refill_pending','funding_failed')),
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

-- A given provider wallet is allocated to at most one workspace at a time.
-- UNIQUE on (provider, circle_wallet_id), anticipating future providers
-- (review point #8). Column rename to provider_wallet_id deferred to avoid churn.
CREATE UNIQUE INDEX IF NOT EXISTS uidx_workspace_wallets_provider_wallet
  ON workspace_wallets(provider, circle_wallet_id);
-- Consent-page inventory query, filterable by allocation status.
CREATE INDEX IF NOT EXISTS idx_workspace_wallets_ws_status
  ON workspace_wallets(workspace_id, allocation_status);

-- One-time additive column (review point #1): pins the chosen workspace onto the
-- authorization session so Phase 3's Agent Context write need not re-derive it.
-- NOT idempotent and intentionally no IF NOT EXISTS. A pre-flight check at apply
-- time asserts the column is absent first and STOPS on an unexpected existing
-- column rather than masking it.
ALTER TABLE oauth_authorization_sessions ADD COLUMN workspace_id TEXT;
