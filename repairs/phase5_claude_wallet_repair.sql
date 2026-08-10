UPDATE agent_wallets
SET status = 'archived', updated_at = datetime('now')
WHERE agent_id = 'claude-pilot'
  AND wallet_id = '84c64a17-46f5-55d1-a329-57c74509282d'
  AND network = 'base-sepolia'
  AND asset = 'USDC'
  AND status = 'active';

UPDATE agent_wallets
SET status = 'active', updated_at = datetime('now')
WHERE agent_id = 'claude-pilot'
  AND wallet_id = 'd2a9ac97-393f-5784-9c47-ef0968239911'
  AND network = 'base-sepolia'
  AND asset = 'USDC'
  AND status = 'active';

UPDATE workspace_wallets
SET allocation_status = 'archived', updated_at = datetime('now')
WHERE circle_wallet_id = '84c64a17-46f5-55d1-a329-57c74509282d'
  AND allocation_status IN ('assigned','available');

UPDATE workspace_wallets
SET allocation_status = 'assigned', updated_at = datetime('now')
WHERE circle_wallet_id = 'd2a9ac97-393f-5784-9c47-ef0968239911'
  AND allocation_status IN ('assigned','available');
