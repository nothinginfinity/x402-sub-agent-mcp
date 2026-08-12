-- 0015: agent_caller_bindings — maps an external service's caller_id to a canonical agent_id.
--
-- Fixes the "identity-table divergence" bug class documented in this ROADMAP as Finding #3
-- (2026-08-02) and recurred again 2026-08-11 in x402-cairnstone: an external service cached a
-- wallet_id/address locally per caller_id, which went stale silently on every wallet
-- reassignment on this side. Applied live via direct D1 query 2026-08-11/12; this file
-- documents/reproduces that live change for a fresh environment.
--
-- source+caller_id -> agent_id is deliberately the ONLY thing this table maps. The actual
-- wallet resolution (agent_id -> current active wallet) still goes through the existing,
-- unchanged agent_wallets table via the shared selectActiveWallet() helper — this table does
-- not duplicate wallet data, only identity mapping, which changes far less often than wallets
-- do and is owned exactly once, here.
CREATE TABLE IF NOT EXISTS agent_caller_bindings (
  id         TEXT PRIMARY KEY,
  source     TEXT NOT NULL,           -- owning external service, e.g. 'x402-cairnstone'
  caller_id  TEXT NOT NULL,           -- that service's own caller identity string
  agent_id   TEXT NOT NULL REFERENCES agents(agent_id),
  status     TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source, caller_id)
);
CREATE INDEX IF NOT EXISTS idx_agent_caller_bindings_agent_id ON agent_caller_bindings(agent_id);

-- Seed: migrates the mapping x402-cairnstone previously hardcoded in its own local
-- agent_identity table (the source of the 2026-08-11 bug).
INSERT INTO agent_caller_bindings (id, source, caller_id, agent_id, status, created_at, updated_at)
VALUES
  ('acb_seed_claude_jared',  'x402-cairnstone', 'claude:jared',  'claude-pilot',  'active', '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:00.000Z'),
  ('acb_seed_chatgpt_jared', 'x402-cairnstone', 'chatgpt:jared', 'chatgpt-pilot', 'active', '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:00.000Z')
ON CONFLICT(source, caller_id) DO NOTHING;
