# x402-sub-agent-mcp

**A Cloudflare Workers + MCP payment policy engine for the [x402 protocol](https://github.com/x402-foundation/x402).**
Coupons, enterprise pricing tiers, internal tokens, and general
pay-per-route rules — managed conversationally by an LLM, enforced by a
single `evaluate_request` call.

Status: **V1 shipped and verified end-to-end** (real EIP-712 signing,
real facilitator round-trips, real Cloudflare deploy). See
[ROADMAP.md](./ROADMAP.md) for what's next, including the enterprise
reserve membership model described below.

---

## Table of contents

- [Overview & motivation](#overview--motivation)
- [Architecture](#architecture)
- [Repo layout](#repo-layout)
- [Setup & deployment](#setup--deployment)
- [Testing](#testing)
- [MCP tools reference](#mcp-tools-reference)
- [Usage examples](#usage-examples)
- [Agent operating balances & branded denomination UX (future design)](#agent-operating-balances--branded-denomination-ux-future-design)
- [Enterprise reserve membership model (design, not yet built)](#enterprise-reserve-membership-model-design-not-yet-built)
- [Security notes & limitations](#security-notes--limitations)
- [Contributing / extending](#contributing--extending)

---

## Overview & motivation

x402 lets any HTTP resource charge per request using the `402 Payment
Required` status code and stablecoin micropayments — no accounts, no
API keys, no human checkout. The protocol itself only defines the
*handshake* (challenge → sign → verify → settle). It doesn't define
*policy*: who gets a free trial, who's on a negotiated enterprise rate,
which routes cost what, or how you'd answer "how much has this account
spent this month?"

**x402-sub-agent-mcp is that policy layer.** It's a single Cloudflare
Worker that:

- Owns the pricing rules, coupons, enterprise tiers, and usage log for
  every x402-protected route across your account (one source of truth,
  not one copy per Worker).
- Exposes that as **MCP tools**, so an LLM (Claude, Grok, whatever) can
  manage pricing conversationally — *"give acme-corp a flat $0.001/call
  rate and require Web Bot Auth"* — without touching code or deploying
  anything.
- Exposes a single **`evaluate_request`** tool that any protected
  resource Worker calls per-request to get back a structured decision:
  let it through, here's a 402 challenge, or here's the settlement
  receipt.
- Never holds private keys. Signature verification and on-chain
  settlement are always delegated to an **x402 facilitator** — a real
  one for production, or the included **mock facilitator** for testing
  the whole flow without touching a blockchain.

If you're building several paywalled Workers, this is the thing they
all `fetch()` (or service-bind to) instead of each reinventing pricing
logic.

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

**Components:**

| Piece | What it is | Repo |
|---|---|---|
| `x402-sub-agent-mcp` | This repo. Policy engine + MCP server. Owns D1. | you are here |
| A real facilitator | Verifies signatures and settles on-chain. Not ours — `x402.org/facilitator`, Coinbase's CDP facilitator, or self-hosted. | external |
| `x402-mock-facilitator` | Test-only facilitator: real EIP-712 signature verification, fake settlement. No gas, no funds needed. | [nothinginfinity/x402-mock-facilitator](https://github.com/nothinginfinity/x402-mock-facilitator) |
| Protected resource Worker(s) | Whatever you're actually charging for. Calls `evaluate_request`, nothing else. | your other repos |

The **protected Worker never talks to a facilitator directly** — it
delegates verify/settle to this sub-agent, which also logs every
outcome to `usage_events`.

### Data model (D1)

| Table | Purpose |
|---|---|
| `payment_rules` | Route pattern → price/asset/network/payTo, plus `auth_required`/`bot_auth_required` flags |
| `coupons` | Free/trial/discount codes, optionally scoped to a route pattern and/or `caller_id`, with use limits and expiry |
| `pricing_tiers` | Per-`caller_id` overrides: flat rate or per-compute-unit rate, plus identity/bot-auth requirements |
| `internal_tokens` | Custom asset/network/scheme registrations, optionally with your own `facilitator_url` |
| `usage_events` | Append-only log of every `evaluate_request` outcome — the source for `get_usage_stats` |

## Repo layout

```
worker.js                    single-file Worker: MCP server (/mcp) + REST fallback (/call) + policy engine
wrangler.jsonc                Cloudflare config: D1 binding, vars, service binding to the mock facilitator
migrations/0001_initial.sql   D1 schema for all five tables above
.github/workflows/deploy.yml  push-to-deploy via wrangler-action — no local CLI required
docs/DEPLOY.md                step-by-step setup, written for doing this entirely from an iPhone
docs/MCP-TOOL-CALLS.md        example tool-call payloads
README.md                     this file
ROADMAP.md                    where this is headed, including the enterprise reserve membership model
```

`worker.js` is intentionally dependency-free and single-file — same
pattern as the rest of the AFO sub-agent fleet. It bundles to ~34KB.

## Setup & deployment

Full step-by-step (including doing every step from an iPhone with no
local terminal) lives in [docs/DEPLOY.md](./docs/DEPLOY.md). Summary:

1. **Create a D1 database** (`x402-sub-agent-db`) and run
   `migrations/0001_initial.sql` against it — either via the Cloudflare
   dashboard's D1 console, or `wrangler d1 execute` if you have a CLI.
2. **Put the database ID in `wrangler.jsonc`** under `d1_databases`.
3. **Add two GitHub Actions secrets** to this repo:
   `CLOUDFLARE_API_TOKEN` (needs Workers Scripts: Edit + D1: Edit) and
   `CLOUDFLARE_ACCOUNT_ID`.
4. **Push to `main`** (or run the workflow manually from the Actions
   tab). `.github/workflows/deploy.yml` runs `wrangler deploy` — no
   local `npm`/`wrangler` install needed.
5. Verify with `GET /status` on the deployed URL — you want
   `"bindings": { "DB": true }`.

### Service bindings (for talking to sibling Workers)

Cloudflare blocks a Worker on `*.workers.dev` from `fetch()`-ing another
`*.workers.dev` subdomain directly (**error 1042**). If you're pointing
`facilitator_url` at another Worker you own on `workers.dev` (like the
included mock facilitator), add a
[Service Binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)
in `wrangler.jsonc`:

```jsonc
"services": [
  { "binding": "MOCK_FACILITATOR", "service": "x402-mock-facilitator" }
]
```

and register the hostname → binding-name mapping in the
`WORKERS_DEV_SERVICE_BINDINGS` constant near the top of `worker.js`.
`facilitatorCall()` checks that map first and falls back to a plain
`fetch()` for anything else — which is all you need for a facilitator
on the public internet or on a custom domain (custom-domain-to-custom-domain
and workers.dev-to-custom-domain calls aren't affected by 1042).

### Custom domains

If you'd rather avoid the service-binding dance entirely, put both
Workers on a Cloudflare-managed custom domain (Workers → your worker →
Triggers → Custom Domains) instead of the shared `workers.dev`
subdomain. Fetching between two custom-domain hostnames doesn't hit
error 1042.

## Testing

### Mock flow (no funds needed) — verified working

1. Deploy [x402-mock-facilitator](https://github.com/nothinginfinity/x402-mock-facilitator)
   alongside this worker.
2. Register it as an internal token:
   ```json
   { "name": "register_internal_token", "arguments": {
       "name": "Mock USD (test only)", "network": "base-sepolia", "asset": "MOCKUSD",
       "asset_address": "0x000000000000000000000000000000000000dEaD",
       "facilitator_url": "https://x402-mock-facilitator.<your-subdomain>.workers.dev"
   }}
   ```
3. Create a rule pointed at it, sign a real EIP-712
   `TransferWithAuthorization` payload with any throwaway keypair (no
   funds required — the mock facilitator never checks balance), and
   call `evaluate_request` with `x_payment` + `facilitator_url` set to
   the mock. You'll get a real `402` on the first call and a real
   signature-verified `200 paid` on the retry.

This proves out rule matching, the 402 handshake, header round-tripping,
and verify/settle proxying — everything except actual token custody.

### Real USDC flow (next step, not yet exercised)

1. Fund a real wallet with testnet USDC on Base Sepolia via
   [Circle's faucet](https://faucet.circle.com).
2. Sign the same `TransferWithAuthorization` structure, but with the
   **real USDC contract** as `verifyingContract`
   (`0x036CbD53842c5426634e7929541eC2318f3dCF7e` on Base Sepolia).
3. Point `evaluate_request`'s `facilitator_url` at
   `https://x402.org/facilitator` (the default) instead of the mock.
4. Same tool calls, same code path — only the domain and facilitator
   change.

Mainnet is the same again with the mainnet USDC address
(`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` on Base) and a
production facilitator (Coinbase's CDP facilitator, or self-hosted).

## MCP tools reference

All tools are available at `POST /mcp` (JSON-RPC 2.0, with SSE framing
when the client sends `Accept: text/event-stream`) and as a plain REST
fallback at `POST /call` with `{"name": "...", "arguments": {...}}`.

| Tool | Purpose |
|---|---|
| `subagent_status` | Health check: bindings, facilitator default, tool list |
| `create_payment_rule` / `list_payment_rules` / `update_payment_rule` / `delete_payment_rule` | Manage protected-route rules |
| `issue_coupon` / `list_coupons` / `revoke_coupon` / `redeem_coupon` | Free/trial/discount codes |
| `create_pricing_tier` / `list_pricing_tiers` / `update_pricing_tier` | Per-account enterprise pricing |
| `register_internal_token` / `list_internal_tokens` | Custom assets/networks/facilitators |
| `evaluate_request` | **The one every protected Worker calls per-request** |
| `verify_payment` / `settle_payment` | Direct facilitator proxy (mostly for testing/debugging) |
| `get_usage_stats` / `record_usage_event` | Spend and access analytics |

Full input schemas are served live at `GET /tools` and `tools/list` over
MCP — treat that as the source of truth over this table.

## Usage examples

See [docs/MCP-TOOL-CALLS.md](./docs/MCP-TOOL-CALLS.md) for a fuller
set. Quick taste:

**Protect a route:**
```json
{ "name": "create_payment_rule", "arguments": {
    "pattern": "/api/premium/*", "price_usd": 0.01,
    "pay_to": "0xYourWalletAddress", "description": "Premium dataset access"
}}
```

**Give one customer a negotiated rate:**
```json
{ "name": "create_pricing_tier", "arguments": {
    "name": "Acme Corp enterprise", "caller_id": "acme-corp",
    "scope_pattern": "/api/premium/*", "price_usd": 0.002, "requires_identity": true
}}
```

**Evaluate an incoming request (called by a protected Worker):**
```json
{ "name": "evaluate_request", "arguments": {
    "path": "/api/premium/dataset.json", "method": "GET", "caller_id": "acme-corp",
    "x_payment": "<base64 X-PAYMENT header value, omit on the first attempt>"
}}
```

## Agent operating balances & branded denomination UX (future design)

The long-term payment product has two customer funding concepts that must remain separate:

| Concept | Economic behavior | This Worker's role |
|---|---|---|
| **Agent operating balance** | A consumable prepaid balance used for tool calls, data, compute, workflows, and developer services. Spending reduces the balance. | Authorize a maximum amount, meter actual usage, route x402 payment, and record a receipt from signed external balance or settlement state. |
| **Enterprise membership reserve** | Refundable principal committed for a defined term to unlock fixed service entitlements and preferred overage pricing. Ordinary tool calls do not consume the reserve principal. | Check the active plan and remaining entitlement, then fall through to metered overage when needed. |

The settlement asset beneath an operating balance may eventually be USDC, USDT, a tokenized deposit, fiat held by an approved provider, or another asset that has passed the custody, accounting, technical, and jurisdictional gates. The asset remains external to this Worker.

A branded **Penny**, **Nickel**, **Quarter**, or **Mill** can be a human-readable pricing and marketing denomination mapped to one underlying atomic ledger. A mill is $0.001. These names should normally be display metadata, not separate transferable tokens or separate customer liabilities. Machines receive integer atomic amounts; humans may see `$0.80`, `80 cents`, or `3 quarters + 1 nickel`.

Early versions must not issue a proprietary redeemable stablecoin. They should use:

- an approved external settlement asset;
- an integer-based internal accounting unit;
- signed authorization, reservation, commit, release, and receipt events; and
- branded denomination metadata at the UI and discovery layers.

A future on-chain branded unit may be researched only through a separate issuer/custody/legal project or an approved issuing partner. Branding does not change the underlying financial classification. Product language must not call a private stablecoin **government-backed**, **government-issued**, **official**, **insured**, or **deposit-protected** unless that exact claim has been independently verified for the specific asset, issuer, account structure, and jurisdiction. Holding government securities in reserves is not the same as a government guarantee.

The intended architecture is an **agent commerce operating system**: identity, budgets, policy, metering, receipts, tool discovery, and payment routing. This repo remains its policy plane; it does not become the wallet, stablecoin issuer, custodian, treasury manager, developer bank, or payout processor.

See [docs/AGENT-OPERATING-BALANCES.md](./docs/AGENT-OPERATING-BALANCES.md) for the staged architecture, terminology, accounting examples, and marketing guardrails.

## Enterprise reserve membership model (design, not yet built)

This is the intended enterprise product direction (see
[ROADMAP.md](./ROADMAP.md) for the build order). The model is a
**refundable capital reserve that unlocks discounted, metered access to
AI tools, data, compute, and custom workflows**. It is not an investment
product and it is not a yield-sharing program.

### Product definition

An enterprise customer commits a refundable reserve for a defined
contract term. In exchange, the customer receives fixed service rights:

- a negotiated set of tools, routes, datasets, seats, and workflow
  permissions;
- a fixed monthly or annual included-usage entitlement;
- a contractual discount or preferred overage rate; and
- normal x402 billing after the entitlement is exhausted.

The customer is **not** promised interest, APY, a share of treasury
income, profit participation, ownership, governance rights, or an
entitlement that changes with investment performance. Any return earned
on company-managed treasury assets belongs to the company. The company
also bears treasury losses, liquidity risk, custody costs, and the
obligation to return the contractual principal.

Use **reserve membership** or **membership reserve** in product and code
language. Avoid presenting the enterprise customer as an investor or
the reserve as an appreciating stake.

### Enterprise and investor products are separate

| Enterprise reserve membership | Investor product |
|---|---|
| Purchases service access | Supplies risk capital seeking a return |
| Fixed contractual entitlements | Yield, equity, profit share, or governance may apply |
| No member-facing APY or profit expectation | Requires its own legal and offering structure |
| Refund governed by the service contract | Redemption/return governed by investment documents |
| Lives in this access-policy product | Must use a separate entity, repo, contracts, data model, and customer flow |

Combining the two would contaminate the enterprise model. Terms such as
"investor," "return," "yield share," and "capital appreciation" must
not appear in enterprise membership marketing or entitlement logic.

### Required system boundary

The reserve product must be split into independent layers:

1. **Membership service** — contracts, organizations, seats, plans,
   term dates, cancellation eligibility, and service entitlements.
2. **Custody or escrow provider** — holds refundable principal and
   executes approved funding and refund instructions.
3. **Treasury service** — manages company-approved cash, Treasury,
   money-market, or other positions; members never own portfolio shares.
4. **Accounting ledger** — records principal as a refundable liability,
   treasury income as company income, and every movement with
   double-entry reconciliation.
5. **x402 policy engine** — this repo; consumes signed entitlement
   attestations, meters usage, and charges overages.

`x402-sub-agent-mcp` must remain a policy and bookkeeping layer, not a
wallet, bank, escrow contract, broker, investment fund, or treasury
manager. It should know that an account has an active plan and a
remaining entitlement. It should not know that a member "owns" vault
shares or has accrued yield.

### Economics

The intended pricing relationship is:

```text
enterprise price = base service fee + metered usage - fixed reserve-tier discount
```

A representative contract could use a $25,000 refundable reserve, a
12- or 24-month commitment, fixed included usage, a fixed platform-fee
discount, and x402 overage billing. The discount and entitlement are
set by contract and do not float with Treasury rates or protocol yield.

Treasury income is a possible **margin enhancer**, not the economic
foundation for unlimited AI usage. Refundable principal remains a
liability, and the platform must be able to honor refunds even if rates
fall, assets lose value, or many customers cancel together.

### How x402 fits

The x402 integration is narrower and safer than the original stake
proposal:

- `evaluate_request` checks an active `plan_entitlement` before ordinary
  per-call pricing.
- Entitlement-covered requests short-circuit to `200`; consumption is
  recorded against a fixed period budget.
- Overage falls through to the existing x402 challenge, verify, settle,
  and usage-log flow.
- Membership activation is based on a signed funding attestation from
  the external membership/custody layer, not on this Worker receiving
  or controlling funds.
- Cancellation creates a request for the external custody workflow.
  A refund is **not** the facilitator `/settle` operation run in reverse;
  it needs authenticated approvals, destination validation,
  idempotency, compliance checks, reconciliation, and failure recovery.

None of the reserve, custody, treasury, cancellation, or refund
capabilities exist in V1. The first implementation should use synthetic
or testnet funding attestations and fixed entitlements only. Real
customer principal must wait for the security work, contracts,
accounting, regulatory analysis, and custody structure described in the
roadmap.

## Security notes & limitations

- **No caller authentication on this Worker's own MCP/REST surface.**
  Anyone who finds the URL can currently create rules/coupons/tiers.
  Put this behind Cloudflare Access, a shared-secret header check, or
  your MCP client's own auth before exposing it beyond trusted callers.
- **Raw SQL is never exposed as a tool.** All writes go through
  parameterized statements in `worker.js` — there is no `query_d1`-style
  escape hatch.
- **`pay_to` and `asset_address` are taken as given.** V1 doesn't
  validate checksum or format. Double-check them yourself before
  pointing a rule at a real wallet.
- **The mock facilitator never checks balance.** A signature from an
  empty wallet passes `/verify` and `/settle` there. It proves the x402
  plumbing works; it proves nothing about custody. Don't mistake a
  green mock-flow test for a green real-money test.
- **`mode: 'upto'` is stored but not yet enforced.** V1's
  `evaluate_request` treats `upto` rules identically to `exact` — see
  the roadmap.
- This worker holds no private keys and never will by design — signing
  happens client-side (or in your own signing script/service), and
  settlement is always delegated to a facilitator.

## Contributing / extending

This is a single-file Worker on purpose — it's meant to be easy to read
top-to-bottom and patch from a phone. If you're extending it:

1. Keep new tools in the same `toolSchemas` + `callTool()` switch
   pattern — an LLM discovers tools generically from `tools/list`, so a
   new capability just needs a schema entry and a handler function.
2. Any new persisted concept gets its own table in
   `migrations/000N_*.sql`, following the existing
   `id / created_at / updated_at` convention.
3. Run `node --check worker.js` and an `esbuild --bundle` dry run
   before pushing — this catches syntax and bundling issues before a
   failed deploy does.
4. If a new tool needs to reach another Worker you own, check whether
   it's `workers.dev` (needs a service binding, see above) or a custom
   domain (doesn't).
