-- 0010: Add the unique constraints the provisionAgentContextSelf upserts target.
-- The deployed worker.js batch uses:
--   agent_permissions: ON CONFLICT(agent_id, capability, effect, COALESCE(network,''), COALESCE(asset,''))
--   agent_budgets:     ON CONFLICT(agent_id, network, asset, period) WHERE status='active'
-- Migration 0006 only created non-unique lookup indexes, so these ON CONFLICT clauses had no
-- matching unique constraint. Additive only; tables contain no conflicting rows at apply time.
-- Renumbered from 0008 (2026-07-29) to resolve a filename-number collision with 0008_lease_integrity.sql.

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_permissions_unique
  ON agent_permissions(agent_id, capability, effect, COALESCE(network, ''), COALESCE(asset, ''));

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_budgets_unique_active
  ON agent_budgets(agent_id, network, asset, period)
  WHERE status = 'active';
