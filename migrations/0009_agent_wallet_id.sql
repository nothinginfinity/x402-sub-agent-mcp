-- 0009: Add wallet_id to agent_wallets and the partial unique index the
-- provisionAgentContextSelf upsert targets: ON CONFLICT(wallet_id, network, asset) WHERE status='active'.
-- Additive only; existing rows keep NULL wallet_id.
-- Renumbered from 0007 (2026-07-29) to resolve a filename-number collision with 0007_leases.sql.

ALTER TABLE agent_wallets ADD COLUMN wallet_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_wallets_walletid_active
  ON agent_wallets(wallet_id, network, asset)
  WHERE status = 'active';
