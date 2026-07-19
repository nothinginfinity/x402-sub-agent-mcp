-- V1.3A: settlement-asset metadata and display-denomination metadata.
-- Purely descriptive/reference tables — schema and metadata only, no
-- change to how evaluate_request computes or requires payment. Applied
-- directly to the live D1 database first (faster than the deploy
-- pipeline); committed here so a fresh environment stays in sync.
--
-- settlement_assets: describes an external asset/network combination
-- (e.g. USDC on base) that this Worker already settles through — issuer,
-- network, decimals, facilitator, provider, status, jurisdiction notes.
-- This is documentation/lookup metadata, not a new settlement path.
--
-- display_denominations: a human-readable label (Penny, Nickel, Quarter,
-- Dollar, Mill, ...) mapped to an exact atomic_value (integer string,
-- smallest units of the referenced settlement asset). Changing a label
-- must never change the atomic amount. marketing_only defaults to 1
-- (true) — a denomination is a display convenience, never automatically
-- a separate token, liability, or redemption right. See
-- docs/AGENT-OPERATING-BALANCES.md for the full model.
--
-- Neither table is wired into money movement. The existing
-- internal_tokens table remains what it always was — a registry of
-- company-owned facilitator/asset configs for routing — and must not be
-- reinterpreted as a customer-money ledger or proof this project issued
-- a stablecoin.

CREATE TABLE IF NOT EXISTS settlement_assets (
  id                 TEXT PRIMARY KEY,
  asset              TEXT NOT NULL,
  network            TEXT NOT NULL,
  decimals           INTEGER NOT NULL DEFAULT 6,
  facilitator_url    TEXT,
  provider           TEXT,
  status             TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'testnet' | 'deprecated'
  jurisdiction_notes TEXT,
  enabled            INTEGER NOT NULL DEFAULT 1,
  note               TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS display_denominations (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  symbol               TEXT,
  atomic_value         TEXT NOT NULL,   -- integer string; never a float
  settlement_asset_ref TEXT,            -- references settlement_assets.id (soft ref, no FK enforcement)
  locale               TEXT,
  singular_label       TEXT,
  plural_label         TEXT,
  marketing_only       INTEGER NOT NULL DEFAULT 1,
  enabled              INTEGER NOT NULL DEFAULT 1,
  note                 TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_settlement_assets_lookup ON settlement_assets(network, asset);
CREATE INDEX IF NOT EXISTS idx_denom_settlement_ref ON display_denominations(settlement_asset_ref);
