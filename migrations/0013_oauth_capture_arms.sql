-- V1.5.6: OAuth-family binding as a first-class admin tool — capture-on-first-connect arms.
-- Additive only. Does not touch oauth_subjects, oauth_clients, oauth_auth_codes,
-- oauth_access_tokens, oauth_refresh_tokens, oauth_authorization_sessions, agents,
-- agent_wallets, agent_budgets, agent_permissions, agent_credentials, or
-- agent_context_audit.
--
-- Purpose: back admin_bind_oauth_identity(agent_id, family) with passive
-- capture-on-first-connect (design decision iii-a, ROADMAP V1.5.6). An admin arms a
-- pending binding for a client FAMILY (claude | chatgpt | perplexity) toward an
-- explicit, already-active agent_id. The NEXT OAuth session for that family which
-- hits resolve_agent_context's no-credential (unknown_agent) branch atomically
-- consumes the arm and writes the family's oauth_subject_sha256 credential via the
-- existing attachAgentCredential() path — completing the binding with no further
-- operator action. resolve_agent_context stays read-only for already-bound
-- identities; it only writes on this arm-consume path.
--
-- Consume discipline mirrors 0011's authorization sessions: claimed atomically via
-- UPDATE ... WHERE status = 'armed' (single guarded statement) so a race between two
-- concurrent first-connects captures exactly once; the loser sees zero changed rows
-- and simply proceeds (by then the credential exists and re-resolve succeeds).
--
-- One active arm per family is enforced by a PARTIAL UNIQUE INDEX on
-- (family) WHERE status = 'armed'. Consumed/cancelled/expired arms are retained as an
-- audit trail and do not block re-arming the same family later.
--
-- family values are the trusted buckets from worker.js CLIENT_FAMILY_BY_DOMAIN; the
-- 'cid:' client_id fallback is intentionally NOT armable (capture only targets real,
-- unanimous, known families — never a per-client isolation bucket).
--
-- Timestamps are ISO-8601 TEXT throughout, matching every other table in this DB.

CREATE TABLE IF NOT EXISTS oauth_capture_arms (
  id            TEXT PRIMARY KEY,               -- uid('ocarm'); opaque row id
  family        TEXT NOT NULL,                  -- trusted client family: claude | chatgpt | perplexity (NEVER a cid: fallback)
  agent_id      TEXT NOT NULL,                  -- target agent to bind on first connect; must be an active agents.agent_id at arm time
  status        TEXT NOT NULL DEFAULT 'armed',  -- armed | consumed | cancelled ; 'armed' is the only capturable state
  armed_by      TEXT,                           -- caller_id of the mcp:admin operator who armed this (audit; e.g. claude:ffdc2f88...)
  consumed_by   TEXT,                           -- credential_key (sha256(subject:fam:<family>)) that consumed the arm; set when status -> consumed
  consumed_at   TEXT,                           -- ISO; set when status flips to consumed
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- At most one ARMED arm per family at a time. Non-armed rows are unconstrained so the
-- same family can be re-armed after a prior arm is consumed or cancelled.
CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_capture_arms_family_armed
  ON oauth_capture_arms(family) WHERE status = 'armed';

-- Lookup by target agent (e.g. "what is this agent armed for") and by status.
CREATE INDEX IF NOT EXISTS idx_oauth_capture_arms_agent
  ON oauth_capture_arms(agent_id);
