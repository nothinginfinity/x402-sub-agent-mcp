-- Agent Context Phase 1: canonical agent identity, credential mapping, wallet assignment,
-- permission policy, and spend limits. Additive only; no existing tables are modified.

CREATE TABLE IF NOT EXISTS agents (
  agent_id TEXT PRIMARY KEY,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_credentials (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  credential_type TEXT NOT NULL,
  credential_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_credentials_unique
  ON agent_credentials(credential_type, credential_key);
CREATE INDEX IF NOT EXISTS idx_agent_credentials_agent
  ON agent_credentials(agent_id);

CREATE TABLE IF NOT EXISTS agent_wallets (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  network TEXT NOT NULL,
  asset TEXT NOT NULL DEFAULT 'USDC',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_wallets_agent
  ON agent_wallets(agent_id, network, asset);

CREATE TABLE IF NOT EXISTS agent_permissions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  effect TEXT NOT NULL DEFAULT 'allow',
  network TEXT,
  asset TEXT,
  max_amount_atomic TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_permissions_lookup
  ON agent_permissions(agent_id, capability, network, asset);

CREATE TABLE IF NOT EXISTS agent_budgets (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  network TEXT NOT NULL,
  asset TEXT NOT NULL,
  period TEXT NOT NULL DEFAULT 'lifetime',
  limit_atomic TEXT NOT NULL,
  spent_atomic TEXT NOT NULL DEFAULT '0',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_budgets_lookup
  ON agent_budgets(agent_id, network, asset, period);

CREATE TABLE IF NOT EXISTS agent_context_audit (
  id TEXT PRIMARY KEY,
  agent_id TEXT,
  credential_type TEXT,
  credential_key TEXT,
  capability TEXT,
  outcome TEXT NOT NULL,
  error_code TEXT,
  wallet_address TEXT,
  network TEXT,
  asset TEXT,
  amount_atomic TEXT,
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_context_audit_agent
  ON agent_context_audit(agent_id, created_at);
