-- V1.4.6 OAuth Flight Recorder.
-- Additive only. Introduces a single append-only trace table that makes an
-- entire OAuth flow reproducible from one trace_id WITHOUT ever storing a
-- secret. Every credential-shaped value is stored as a SHA-256 hex digest;
-- raw bearer tokens, refresh tokens, authorization codes, client secrets,
-- and PKCE verifiers are NEVER written here.
--
-- Does not touch oauth_subjects, oauth_clients, oauth_auth_codes,
-- oauth_access_tokens, oauth_refresh_tokens, oauth_audit_log, payment_rules,
-- coupons, pricing_tiers, internal_tokens, settlement_assets,
-- display_denominations, or usage_events. oauth_audit_log stays as the
-- coarse human-readable event log; oauth_trace_events is the fine-grained,
-- correlated, timing-aware flight recorder built for cross-client debugging.

CREATE TABLE IF NOT EXISTS oauth_trace_events (
  id TEXT PRIMARY KEY,                    -- unique per event (uid('otr'))
  trace_id TEXT NOT NULL,                 -- one value per OAuth flow; correlates authorize -> token -> initialize -> tools/list -> tool calls
  timestamp TEXT NOT NULL,                -- ISO 8601 event time
  event_type TEXT NOT NULL,               -- e.g. discovery, authorize_view, login_ok, token_issued, initialize, tools_list, tool_call, replay, expired, resource_mismatch, pkce_failure, unauthorized, wallet_authz_fail
  client_id TEXT,                         -- OAuth client_id when known
  grant_type TEXT,                        -- authorization_code | refresh_token | null
  resource TEXT,                          -- RFC 8707 resource indicator / audience when present
  session_id TEXT,                        -- Mcp-Session-Id when the client supplied one
  request_id TEXT,                        -- JSON-RPC id or a per-request uid, for lining events up with client logs
  http_status INTEGER,                    -- HTTP status returned to the caller
  latency_ms INTEGER,                     -- server-measured handling time for this event
  client_ip_hash TEXT,                    -- SHA-256 hex of client IP; never the raw IP
  user_agent_hash TEXT,                   -- SHA-256 hex of User-Agent; never the raw UA string
  authorization_code_hash TEXT,           -- SHA-256 hex of the auth code (same digest already stored in oauth_auth_codes.code); never the raw code
  refresh_token_hash TEXT,                -- SHA-256 hex of the refresh token; never the raw token
  outcome TEXT,                           -- ok | error | denied | replay | expired | mismatch | unauthorized
  error TEXT,                             -- generic error label (e.g. invalid_grant); never a secret
  metadata_json TEXT,                     -- small JSON blob of non-secret extras (scope, driver, tool_name, method, ...)
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_trace_trace_id ON oauth_trace_events(trace_id);
CREATE INDEX IF NOT EXISTS idx_oauth_trace_timestamp ON oauth_trace_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_oauth_trace_client ON oauth_trace_events(client_id);
CREATE INDEX IF NOT EXISTS idx_oauth_trace_event_type ON oauth_trace_events(event_type);
CREATE INDEX IF NOT EXISTS idx_oauth_trace_outcome ON oauth_trace_events(outcome);

-- Configurable retention. A single-row table keyed by name so the value can
-- be tuned live via oauth_trace_set_retention without a schema change. The
-- default of 30 days keeps a month of flows for debugging while bounding
-- growth; the prune tool (or a scheduled trigger) deletes anything older.
CREATE TABLE IF NOT EXISTS oauth_trace_config (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO oauth_trace_config (name, value, updated_at)
VALUES ('retention_days', '30', '2026-07-27T00:00:00.000Z');
