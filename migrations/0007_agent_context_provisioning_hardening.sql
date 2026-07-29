ALTER TABLE agent_wallets ADD COLUMN wallet_id TEXT;

UPDATE agent_wallets
SET wallet_id = wallet_address
WHERE wallet_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_wallets_active_wallet_id
ON agent_wallets(wallet_id, network, asset)
WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_wallets_active_address
ON agent_wallets(wallet_address, network, asset)
WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_permissions_unique
ON agent_permissions(
  agent_id,
  capability,
  effect,
  COALESCE(network, ''),
  COALESCE(asset, '')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_budgets_active_unique
ON agent_budgets(agent_id, network, asset, period)
WHERE status = 'active';
