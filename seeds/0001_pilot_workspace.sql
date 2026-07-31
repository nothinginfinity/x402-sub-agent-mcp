-- V1.4.6 Phase 2 PILOT SEED (data, not schema).
-- LOCATION (review point #3): lives under seeds/, NOT in the numbered migrations/
-- sequence, resolving the contradiction that a universal migration must not carry
-- Jared-specific pilot data. A fresh production or tenant deployment runs the
-- migrations but does NOT run this seed. It exists solely to make today's single
-- operator workspace-aware.
--
-- Ground truth captured live 2026-07-30 (balances actually read via Circle):
--   owner subject : 2aa5be6b0793372d5c46857c24ae47a8  (sole oauth_subjects row)
--   wallet set    : afo-agent-pilot 7dc8fcf9-bb7b-530b-9ca1-5d88b317b20e
--   6b3af813  0xa486...  19.8425 USDC  not agent-bound -> available
--   84c64a17  0xbb8e...  20      USDC  not agent-bound -> available
--   42d46f75  0x07e7...  0.05    USDC  agent-bound(active) -> assigned
--   b31057a8  0xa3b8...  0.1075  USDC  agent-bound(active) -> assigned
--
-- FUNDING_STATUS IS ADVISORY AND TIME-SENSITIVE (review point #5): all four are
-- seeded 'funded' because their USDC balances were positively read at the
-- 2026-07-30T~07:50Z / 12:07Z balance-check times recorded above. Circle remains
-- authoritative for balance; later reconciliation may move any of these to
-- depleted/unfunded/etc. This column is a cached hint for UI, never a settlement
-- input.
--
-- CONFLICT SAFETY (review point #4): these are PLAIN INSERTs, not upserts. On a
-- real conflict they RAISE:
--   * a second workspace row with the same workspace_id -> PRIMARY KEY violation
--   * any wallet already allocated (same provider,circle_wallet_id) -> UNIQUE
--     index violation, INCLUDING a cross-workspace attempt.
-- The apply procedure runs explicit owner/allocation preflight queries and ABORTS
-- on any mismatch BEFORE these inserts, and applies the workspace + four wallet
-- rows atomically. Re-running this seed after a successful apply is EXPECTED to
-- error (rows already present) -- that is correct, not a regression; it is not
-- written to be idempotent.

INSERT INTO workspaces
  (workspace_id, owner_subject, name, environment, status, created_at, updated_at)
VALUES
  ('ws_jared_dev_0001', '2aa5be6b0793372d5c46857c24ae47a8', 'Jared Development Workspace',
   'testnet', 'active', '2026-07-30T22:20:00.000Z', '2026-07-30T22:20:00.000Z');

INSERT INTO workspace_wallets
  (workspace_wallet_id, workspace_id, provider, circle_wallet_id, wallet_address, network, asset, display_name, allocation_status, funding_status, created_at, updated_at)
VALUES
  ('wsw_pilot_0001', 'ws_jared_dev_0001', 'circle', '6b3af813-59c5-57e9-9dcf-bde05fc24aa2', '0xa4861a74f7b0cc58d5bda4a37ef64194dc4fac60', 'base-sepolia', 'USDC', 'Dev Wallet 0xa486 (19.84 USDC)', 'available', 'funded', '2026-07-30T22:20:00.000Z', '2026-07-30T22:20:00.000Z'),
  ('wsw_pilot_0002', 'ws_jared_dev_0001', 'circle', '84c64a17-46f5-55d1-a329-57c74509282d', '0xbb8e196a59a43dbbb60ec25320ea4e135e808dc7', 'base-sepolia', 'USDC', 'Dev Wallet 0xbb8e (20 USDC)',    'available', 'funded', '2026-07-30T22:20:00.000Z', '2026-07-30T22:20:00.000Z'),
  ('wsw_pilot_0003', 'ws_jared_dev_0001', 'circle', '42d46f75-9450-5ed7-99ee-ec8ec9aaf15b', '0x07e733df670746ddc0918fe17994087b6accd35e', 'base-sepolia', 'USDC', 'Agent Wallet 0x07e7',            'assigned',  'funded', '2026-07-30T22:20:00.000Z', '2026-07-30T22:20:00.000Z'),
  ('wsw_pilot_0004', 'ws_jared_dev_0001', 'circle', 'b31057a8-3aec-5c42-9d03-f477e742afec', '0xa3b8d584302b8f4004aef518bc7ed2f43abf2c8d', 'base-sepolia', 'USDC', 'Agent Wallet 0xa3b8',            'assigned',  'funded', '2026-07-30T22:20:00.000Z', '2026-07-30T22:20:00.000Z');
