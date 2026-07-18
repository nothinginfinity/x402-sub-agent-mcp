# x402-sub-agent-mcp

AFO sub-agent MCP that manages **x402 payment policy** for any resource
behind Cloudflare — coupons/free trials, enterprise pricing tiers,
internal/company tokens, and general protected-route rules — and exposes
a single `evaluate_request` tool that other Workers call per-request to
decide "let it through / charge this / here's the 402 challenge."

It is a **policy + bookkeeping layer**, not a wallet: it never holds
private keys. Payment verification and on-chain settlement are always
delegated to an x402 facilitator (`/verify`, `/settle`), which this
worker proxies and logs.

## Why a separate sub-agent instead of embedding this in every Worker

Every AFO Worker that wants to charge for a route would otherwise need
its own copy of pricing logic, coupon bookkeeping, and facilitator
plumbing. Instead:

1. This worker owns the D1 tables (`payment_rules`, `coupons`,
   `pricing_tiers`, `internal_tokens`, `usage_events`) — one source of
   truth for pricing across the whole account.
2. A protected resource Worker calls `evaluate_request` (via this
   worker's `/mcp` JSON-RPC, or a plain `fetch` to `/call`) with the
   incoming path/method/caller/coupon/`X-PAYMENT` header, and gets back
   a structured decision it can act on directly.
3. An LLM (Claude, Grok, etc.) can manage pricing conversationally —
   "give account acme-corp a flat $0.001/call rate on `/api/premium/*`
   and require Web Bot Auth" — via the MCP tools below, without needing
   file/deploy access to the protected Worker at all.

## Architecture

```
Client ──(1) request──▶ Protected Worker ──(2) evaluate_request──▶ x402-sub-agent-mcp
                              │                                          │
                              │◀── 200 or 402 + accepts[] ───────────────┘
                              │
Client ◀── 402 { accepts } ──┘   (if payment required and none attached yet)
Client ──(3) retry + X-PAYMENT header──▶ Protected Worker ──▶ evaluate_request (again, with x_payment)
                                                                    │
                                                        facilitator /verify + /settle
                                                                    │
                              │◀── 200 + settlement ────────────────┘
Client ◀── 200 + resource ───┘
```

The **protected Worker never talks to the facilitator directly** — it
delegates verify/settle to this sub-agent, which also logs the event to
`usage_events` for stats.

## What V1 covers

- **Coupons / free-trial tokens** — `issue_coupon` with `kind: free |
  trial | discount`, optional scope (route pattern), optional
  `caller_id` binding, `max_uses`, and `expires_at` / `expires_in_days`.
- **Enterprise / custom pricing tiers** — `create_pricing_tier` per
  `caller_id`: flat override price or per-compute-unit rate, plus
  `requires_identity` / `requires_bot_auth` flags that `evaluate_request`
  enforces before even getting to payment.
- **Internal / company-owned tokens** — `register_internal_token` records
  a custom asset/network/scheme and optionally your own
  `facilitator_url`, so a payment rule or tier can settle against an
  internal facilitator instead of the public one.
- **General management** — `create_payment_rule` protects a route
  pattern (`/api/premium/*`) with an exact or "up to" price; `evaluate_request`
  is the one-call decision endpoint; `get_usage_stats` summarizes spend
  and access outcomes.

Default facilitator: `https://x402.org/facilitator` (public, good for
testing on Base Sepolia). Point `X402_FACILITATOR_URL` at Coinbase's CDP
facilitator or a self-hosted one for production/mainnet — see
`docs/DEPLOY.md`.

## Files

```
worker.js                 single-file Worker: MCP server + REST fallback + policy engine
wrangler.jsonc             Cloudflare config (D1 binding, vars)
migrations/0001_initial.sql D1 schema: payment_rules, coupons, pricing_tiers, internal_tokens, usage_events
.github/workflows/deploy.yml  push-to-deploy via wrangler-action (iPhone-friendly — no local CLI needed)
docs/DEPLOY.md              step-by-step setup from an iPhone
docs/MCP-TOOL-CALLS.md      example tool calls an LLM would make
```

## Security notes for V1

- `query_d1`-style raw SQL is **not** exposed as a tool — all writes go
  through parameterized statements in `worker.js`.
- The worker itself does not authenticate MCP callers — put it behind
  Cloudflare Access, a shared-secret header check in `fetch()`, or your
  MCP client's own auth before exposing it beyond trusted callers.
- `pay_to` addresses and `asset_address` values are taken as given;
  double-check them yourself before pointing real routes at real wallets.
  V1 does not validate checksum/format.

## Version 2 ideas

See the end of `docs/DEPLOY.md` for the recommended follow-up list
(Cloudflare Rules-expression integration, Monetization Gateway, signed
coupon JWTs instead of DB rows, per-tier rate limiting via Durable
Objects, multi-facilitator failover, webhook on settlement).
