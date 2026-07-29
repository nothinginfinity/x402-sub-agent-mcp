-- 0007: Add wallet_id to agent_wallets and the partial unique index the
-- provisionAgentContextSelf upsert targets: ON CONFLICT(wallet_id, network, asset) WHERE status='active'.
-- Additive only; existing rows keep NULL wallet_id.

ALTER TABLE agent_wallets ADD COLUMN wallet_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_wallets_walletid_active
  ON agent_wallets(wallet_id, network, asset)
  WHERE status = 'active';
