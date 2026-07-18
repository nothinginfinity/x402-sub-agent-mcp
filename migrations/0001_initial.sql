-- x402-sub-agent-mcp: initial schema
-- Idempotent: safe to run against a fresh D1 database. This is a NEW
-- database for this sub-agent, so CREATE TABLE IF NOT EXISTS is fine here
-- (unlike ALTER-ordering concerns on pre-existing production tables).

CREATE TABLE IF NOT EXISTS payment_rules (
  id            TEXT PRIMARY KEY,
  pattern       TEXT NOT NULL,              -- e.g. /api/premium/*  or exact path
  method        TEXT NOT NULL DEFAULT '*',  -- '*' or GET/POST/...
  mode          TEXT NOT NULL DEFAULT 'exact', -- 'exact' | 'upto'
  price_atomic  TEXT NOT NULL DEFAULT '0',  -- integer string, smallest unit of `asset`
  asset         TEXT NOT NULL DEFAULT 'USDC',
  asset_address TEXT,                       -- ERC-20 contract address; auto-filled for known assets
  network       TEXT NOT NULL DEFAULT 'base', -- 'base' | 'base-sepolia' | ...
  pay_to        TEXT NOT NULL,              -- wallet address receiving payment
  auth_required     INTEGER NOT NULL DEFAULT 0, -- require caller_id / authenticated account
  bot_auth_required  INTEGER NOT NULL DEFAULT 0, -- require Web Bot Auth / verified agent identity
  description   TEXT,
  priority      INTEGER NOT NULL DEFAULT 100, -- lower = evaluated first when patterns overlap
  enabled       INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS coupons (
  id            TEXT PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  kind          TEXT NOT NULL DEFAULT 'free', -- 'free' | 'trial' | 'discount'
  discount_pct  REAL,                       -- only used when kind = 'discount'
  scope_pattern TEXT NOT NULL DEFAULT '*',  -- limits which route pattern(s) the coupon applies to
  caller_id     TEXT,                       -- optional: restrict to one caller/account
  max_uses      INTEGER,                    -- null = unlimited
  uses_count    INTEGER NOT NULL DEFAULT 0,
  expires_at    TEXT,                       -- ISO datetime, null = no expiry
  revoked       INTEGER NOT NULL DEFAULT 0,
  note          TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pricing_tiers (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  caller_id          TEXT NOT NULL,         -- account/customer identifier this tier applies to
  scope_pattern      TEXT NOT NULL DEFAULT '*',
  price_atomic       TEXT,                  -- flat override price (smallest unit)
  price_mode         TEXT NOT NULL DEFAULT 'flat', -- 'flat' | 'compute'
  compute_rate_atomic TEXT,                 -- price per compute unit when price_mode = 'compute'
  requires_identity  INTEGER NOT NULL DEFAULT 0,
  requires_bot_auth  INTEGER NOT NULL DEFAULT 0,
  enabled            INTEGER NOT NULL DEFAULT 1,
  note               TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS internal_tokens (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  scheme          TEXT NOT NULL DEFAULT 'exact', -- x402 `scheme` value
  network         TEXT NOT NULL,
  asset           TEXT NOT NULL,
  asset_address   TEXT,
  facilitator_url TEXT,                     -- company-run facilitator, overrides default
  enabled         INTEGER NOT NULL DEFAULT 1,
  note            TEXT,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_events (
  id           TEXT PRIMARY KEY,
  ts           TEXT NOT NULL,
  route        TEXT NOT NULL,
  method       TEXT NOT NULL,
  caller_id    TEXT,
  outcome      TEXT NOT NULL,               -- 'free_rule' | 'coupon_free' | 'coupon_discount' | 'paid' | 'denied' | 'challenge_402'
  price_atomic TEXT,
  asset        TEXT,
  network      TEXT,
  coupon_code  TEXT,
  tier_id      TEXT,
  payment_id   TEXT,                        -- tx hash / facilitator settlement id
  note         TEXT
);

CREATE INDEX IF NOT EXISTS idx_rules_pattern   ON payment_rules(pattern);
CREATE INDEX IF NOT EXISTS idx_rules_enabled   ON payment_rules(enabled, priority);
CREATE INDEX IF NOT EXISTS idx_coupons_code    ON coupons(code);
CREATE INDEX IF NOT EXISTS idx_tiers_caller    ON pricing_tiers(caller_id);
CREATE INDEX IF NOT EXISTS idx_usage_ts        ON usage_events(ts);
CREATE INDEX IF NOT EXISTS idx_usage_route     ON usage_events(route);
