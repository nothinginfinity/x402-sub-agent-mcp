-- 0016: executed_drafts — U5 idempotency and audit trail for controlled
-- execution of Agent Wallets Console action drafts (x402-action-draft-v1).
--
-- draft_id is the sole idempotency key. A UNIQUE constraint on draft_id
-- means a retried execute_action_draft call for the same draft can never
-- result in a second circle_gasless_transfer: the first INSERT claims the
-- row (status='pending') before any signing/submission is attempted, and
-- every subsequent call for that draft_id reads the existing row instead
-- of re-executing. Once a draft_id reaches 'executed' or 'failed' it is
-- terminal — a genuine retry requires a new draft (new draft_id) from the
-- Cockpit, not a mutation of this row. This is deliberate: no code path
-- in this migration or its consumers re-attempts a signed transfer.
--
-- Applied live via direct D1 query 2026-08-13/14; this file documents/
-- reproduces that live change for a fresh environment.
CREATE TABLE IF NOT EXISTS executed_drafts (
  draft_id            TEXT PRIMARY KEY,
  agent_id            TEXT,                    -- resolved at claim time; null only for pre-resolution rejections
  status               TEXT NOT NULL,           -- 'pending' | 'executed' | 'failed' | 'rejected'
  network              TEXT NOT NULL,
  asset                TEXT NOT NULL,
  amount_atomic        TEXT NOT NULL,
  destination_address  TEXT NOT NULL,
  tx_hash              TEXT,
  error_detail          TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_executed_drafts_agent_id ON executed_drafts(agent_id);
CREATE INDEX IF NOT EXISTS idx_executed_drafts_status ON executed_drafts(status);
