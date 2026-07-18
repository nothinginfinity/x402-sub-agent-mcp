# Roadmap

Where `x402-sub-agent-mcp` is now, and where it's headed. Organized by
milestone rather than a fixed calendar, since this is a solo project and
dates would just be wrong.

- [V1 — shipped](#v1--shipped)
- [V1.1–V1.2 — near-term](#v11v12--near-term)
- [V1.3 — agent operating balances & denomination UX](#v13--agent-operating-balances--denomination-ux)
- [V2 — enterprise reserve memberships (mid-term)](#v2--enterprise-reserve-memberships-mid-term)
- [V3+ — longer-term](#v3--longer-term)
- [Risks & open questions](#risks--open-questions)

---

## V1 — shipped ✅

Everything below is built, deployed, and verified against a live
worker — not aspirational.

- Real x402 handshake: `402` challenge with a spec-shaped `accepts[]`,
  `X-PAYMENT` header round-trip, `X-PAYMENT-RESPONSE`-equivalent
  settlement result.
- Rule engine: route-pattern matching (glob), method filtering,
  priority ordering, `exact`/`upto` price modes (`upto` stored but not
  yet differentiated in enforcement — see V1.1 below).
- Coupons: `free` / `trial` / `discount` kinds, scoped to a route
  pattern and/or `caller_id`, with use-count limits and expiry.
- Enterprise pricing tiers: flat or per-compute-unit rate per
  `caller_id`, with `requires_identity` / `requires_bot_auth` gates
  enforced *before* payment is even evaluated.
- Internal/company token registration, with per-token
  `facilitator_url` override.
- Usage logging (`usage_events`) and `get_usage_stats` aggregation.
- Full MCP surface (19 tools) over both JSON-RPC (`/mcp`, with correct
  SSE framing for clients that request it) and plain REST (`/call`).
- **Mock facilitator** (`x402-mock-facilitator`): real EIP-712/EIP-3009
  signature verification via `viem`, fake settlement — lets the whole
  flow be tested with zero gas, zero faucet, zero deployed contract.
- Hit and fixed a real Cloudflare Workers gotcha along the way: error
  1042 (`*.workers.dev` can't `fetch()` a sibling `*.workers.dev`
  Worker) — fixed with a Service Binding, generalized so any future
  sibling-Worker facilitator gets the same treatment.
- Verified end-to-end: rule creation → `402` → real signature → real
  verification → settlement → `200 paid`, with the event correctly
  logged.

## V1.1–V1.2 — near-term

Small, concrete, no new concepts — mostly closing gaps V1 knowingly
left open.

- [ ] **Switch default testing to real testnet USDC.** Sign against the
      real Base Sepolia USDC contract via `x402.org/facilitator`
      instead of (or alongside) the mock, using the same throwaway
      wallet, funded via Circle's faucet. First real balance-aware test.
- [ ] **Basic on-chain balance checks.** Right now `evaluate_request`
      trusts the facilitator's `/verify` response entirely — add an
      optional pre-check (RPC `balanceOf` call) so a request with an
      obviously-insufficient balance can fail fast with a clearer error
      before hitting the facilitator round-trip.
- [ ] **Enforce `mode: 'upto'` for real.** Currently stored but treated
      identically to `exact`. Needs: resource Worker reports actual
      usage after the fact, sub-agent settles a variable amount up to
      the ceiling. Blocks any per-compute-unit or metered pricing from
      being fully honest.
- [ ] **Improve logging detail.** `usage_events` currently logs
      outcome + price but not request duration, facilitator latency, or
      HTTP status from the facilitator call — useful for debugging slow
      or flaky facilitators in production.
- [ ] **Link `internal_tokens` into rule evaluation automatically.**
      Right now `register_internal_token` is pure bookkeeping —
      `evaluate_request` only uses a custom facilitator if you pass
      `facilitator_url` explicitly per-call. Add a lookup so a rule
      whose `network`/`asset` matches a registered internal token picks
      up that token's `facilitator_url` by default.
- [ ] **Basic MCP-surface auth.** Shared-secret header check at minimum,
      ahead of anything real touching this worker's rule/coupon/tier
      tools.
- [ ] **Address validation.** Checksum/format validation on `pay_to` and
      `asset_address` at write time, not just "trust the caller."

## V1.3 — agent operating balances & denomination UX

Model the consumable payment side of the agent economy without turning this Worker into a wallet, bank, custodian, stablecoin issuer, or canonical customer-balance ledger.

The product distinction is mandatory:

- **Agent operating balance:** consumable prepaid value. Tool calls reduce it.
- **Enterprise membership reserve:** refundable principal for a fixed term. Ordinary tool calls do not reduce it; the reserve unlocks fixed entitlements and preferred pricing.
- **Settlement asset:** the external asset or payment rail used to fund, settle, or redeem balances.
- **Branded denomination:** a display and marketing label mapped to atomic value; it is not automatically a separate token or liability.

A single balance may be shown as dollars, cents, a Penny/Nickel/Quarter interface, or machine-readable atomic units. A mill is $0.001. Human presentation must never alter settlement math.

### V1.3A — display and policy abstraction

- [ ] Add explicit settlement-asset metadata: asset identifier, network, decimals, facilitator, provider, status, and jurisdiction notes.
- [ ] Add display-denomination metadata such as `name`, `symbol`, `atomic_value`, `settlement_asset_ref`, and `marketing_only`.
- [ ] Keep all arithmetic integer-based. Never use floating-point values as the canonical balance or settlement amount.
- [ ] Let `evaluate_request` return both machine amounts and optional human-display amounts without changing the x402 payment requirement.
- [ ] Do not reinterpret the existing `internal_tokens` table as a customer-money ledger or proof that this project issued a stablecoin.

### V1.3B — synthetic/testnet operating-balance flow

- [ ] Build or connect a separate mock balance service with signed `authorize`, `reserve`, `commit`, `release`, and `get_receipt` operations.
- [ ] Keep the canonical balance and double-entry ledger outside this policy Worker. This Worker may cache signed authorization state and settlement receipts only.
- [ ] Add idempotency keys, expiration, replay protection, maximum-spend limits, and partial-usage settlement.
- [ ] Test the lifecycle: fund synthetic account → authorize ceiling → execute tool → commit actual usage → release remainder → reconcile receipt.
- [ ] Support budget policies per agent, organization, tool, route, time period, and maximum single transaction.

### V1.3C — approved settlement partner pilot

This stage begins only after the security and legal gates relevant to stored value, custody, payment transmission, sanctions, fraud, accounting, refunds, and unclaimed property have written answers.

- [ ] Integrate one approved external asset and provider first rather than launching a proprietary token.
- [ ] Treat USDC, USDT, tokenized deposits, fiat accounts, and any later asset as different adapters with different issuer, custody, redemption, availability, and jurisdiction rules.
- [ ] Use signed provider attestations and receipts. Do not place custody credentials, private keys, or canonical customer balances in this Worker.
- [ ] Reconcile customer liabilities, processor/custodian assets, platform fees, compute expense, developer payables, and withdrawals in an independent accounting service.
- [ ] Prohibit claims that an asset is government-backed, government-issued, official, insured, or deposit-protected unless the exact claim is verified for that asset, issuer, account structure, and jurisdiction.

### V1.3D — marketplace and developer settlement

- [ ] Keep tool discovery, pricing, authorization, usage attribution, developer payable calculation, and actual payout as separate services or modules.
- [ ] Begin with first-party tools and a small approved partner set before open marketplace onboarding.
- [ ] Record platform fee and developer payable independently for every call.
- [ ] Add dispute, refund, fraud, sanctions, tax-document, and negative-balance workflows before broad developer payouts.

### Optional branded on-chain unit research — separate project

A future branded Penny, Quarter, or other on-chain unit may be useful for distribution and marketing, but it is not required for sub-cent x402 pricing. Research it only through a separate issuer/custody/legal project or an approved issuing partner. Branding must not be used to imply government backing, deposit insurance, independent redemption rights, or a new asset when the product is only a display denomination mapped to an existing settlement asset.

See [docs/AGENT-OPERATING-BALANCES.md](./docs/AGENT-OPERATING-BALANCES.md) for the full conceptual architecture.

## V2 — enterprise reserve memberships (mid-term)

The V2 product is a **refundable enterprise membership reserve** that
unlocks fixed service entitlements and discounted, metered access. It
is not a yield-sharing product, and it is not an investor account.

The core design rule is permanent: **this Worker remains the access
policy engine. It does not custody customer funds, manage a treasury,
execute refunds, or attribute investment positions to members.**

### V2 launch gates

No production code may accept real membership principal until all of
the following have written, reviewable answers:

- [ ] **Security gate:** complete MCP authentication, role-based access,
      signed administrative requests, replay protection, idempotency,
      address validation, and immutable audit events.
- [ ] **Legal gate:** obtain jurisdiction-specific analysis of the
      service contract, money-transmission facts, prepaid-membership or
      club-deposit rules, stablecoin treatment, AML/KYC obligations,
      unclaimed property, tax, and accounting.
- [ ] **Custody gate:** select a regulated or counsel-approved custody,
      escrow, bank, or brokerage structure with segregated records and
      a defined refund workflow.
- [ ] **Contract gate:** define reserve amount, term, cancellation
      eligibility, refund timing, fees, included services, overage
      pricing, suspension rights, insolvency treatment, and dispute
      handling without implying a return on capital.
- [ ] **Liquidity gate:** establish a reserve buffer, maturity ladder,
      concentration limits, stress tests, and a refund service-level
      objective that can be met during correlated cancellations.
- [ ] **Accounting gate:** implement double-entry treatment in which
      refundable principal is a liability, not revenue, and treasury
      earnings and losses are recorded separately.

These gates do not block V1.1/V1.2 or a synthetic V2 prototype. They do
block real customer custody.

### V2A — synthetic/testnet entitlement prototype

Build the membership and access logic first with synthetic records or
signed testnet attestations. No real principal, treasury assets, or
refund transactions are involved.

#### Data model owned by this policy service

- [ ] `membership_plans`: `id`, `name`, `reserve_requirement_atomic`,
      `asset`, `network`, `term_days`, `included_usage_atomic`,
      `discount_bps`, `overage_policy`, `scope_pattern`, `enabled`,
      `created_at`, `updated_at`.
- [ ] `membership_agreements`: `id`, `caller_id`, `plan_id`,
      `term_starts_at`, `term_ends_at`, `status`
      (`pending`/`active`/`cancelling`/`closed`),
      `funding_attestation_id`, `created_at`, `updated_at`.
- [ ] `funding_attestations`: signed references from the external
      membership/custody layer: `id`, `provider`, `external_ref`,
      `principal_atomic`, `asset`, `network`, `status`, `verified_at`,
      `payload_hash`, `signature`. This is evidence of funding, not a
      custody ledger.
- [ ] `plan_entitlements`: per-`caller_id` and agreement period:
      included budget, consumed budget, period start/end, reset time,
      scope, and status. Entitlements are fixed by the plan and contract,
      not calculated from APY or portfolio performance.
- [ ] `cancellation_requests`: `id`, `agreement_id`, `requested_at`,
      `eligible_at`, `external_ref`, `status`, `refund_attestation_id`.
      This tracks workflow state; it never initiates a transfer.
- [ ] `entitlement_events`: append-only grant, consume, reset, suspend,
      cancellation, and attestation-verification events for audit and
      reconciliation.

Do **not** add `yield_positions`, member vault shares, accrued member
yield, or per-member treasury allocation to this database.

#### MCP tools

- [ ] `create_membership_plan`, `list_membership_plans`, and
      `update_membership_plan`.
- [ ] `register_funding_attestation` — verify and record a signed
      external attestation; never accept raw custody credentials or
      private keys.
- [ ] `activate_membership` — bind a verified attestation to a caller,
      plan, and fixed term.
- [ ] `get_membership_status` — return principal reference, term,
      entitlement, consumption, cancellation eligibility, and external
      workflow status; never return APY, accrued yield, or vault shares.
- [ ] `calculate_plan_entitlement` — pure function based only on plan
      terms and contract overrides, not yield assumptions.
- [ ] `request_membership_cancellation` — create an authenticated,
      idempotent request for the external membership/custody workflow.
- [ ] `record_refund_attestation` — reconcile a signed external refund
      result and close the agreement when appropriate.
- [ ] Extend `evaluate_request` to check `plan_entitlements` before
      coupons, negotiated per-call pricing, and ordinary x402 payment.
      Covered usage returns `200`; overage follows the current x402
      path.

#### Architecture boundary

Implement five distinct layers:

1. **Membership service:** contracts, organizations, seats, plans,
   terms, cancellations, and entitlements.
2. **Custody/escrow provider:** receives and returns principal.
3. **Treasury service:** manages company-approved assets and liquidity.
4. **Accounting ledger:** reconciles liabilities, cash, treasury
   positions, income, losses, and refunds using double entry.
5. **x402 policy engine:** this repo; authorizes access and charges
   overages from signed entitlement state.

Only signed, minimal attestations cross into this Worker. Treasury
positions and customer-money movement stay outside it.

### V2B — controlled real-customer pilot

After every launch gate is satisfied:

- [ ] Start with U.S. enterprise customers in a deliberately limited
      jurisdictional footprint rather than opening globally.
- [ ] Use a regulated or counsel-approved custodian/escrow arrangement;
      do not hold customer reserves in a general Worker-controlled
      wallet.
- [ ] Prefer a simple, liquid treasury policy for the first pilot. Test
      company-owned funds before investing customer-backed reserves.
      Do not start with automated DeFi routing.
- [ ] Match reserve duration and refund notice to the liquidity and
      maturity profile of the underlying assets; keep a documented
      liquid buffer rather than investing 100%.
- [ ] Make entitlements and discounts fixed by contract. Do not market
      APY, expected return, foregone yield, or performance-linked access.
- [ ] Verify custody and refund webhooks cryptographically, require
      approval controls, and reconcile every external transaction to the
      accounting ledger and policy state.
- [ ] Run cancellation, custodian-outage, stablecoin-depeg, rate-shock,
      and mass-refund simulations before expanding the pilot.

### Enterprise pricing in x402 terms

- [ ] Map reserve membership plans onto fixed `plan_entitlements`,
      scoped route permissions, and negotiated `pricing_tiers`.
- [ ] Choose overage behavior explicitly: x402 micropayment, invoiced
      enterprise overage, manual top-up, or graceful rate limiting.
- [ ] Keep the relationship independent of treasury performance:

      `enterprise price = base service fee + metered usage - fixed reserve-tier discount`

Treasury income may improve platform margin, but it is not the source of
or formula for a member's entitlement.

### Investor product separation

Any product that offers yield, equity, profit participation, governance,
or an expectation of return is an **investor product**, not a membership
tier. It must use a separate entity, legal analysis, contracts,
marketing, repo, database, and onboarding flow. It is outside V2 and
must never reuse enterprise membership language or data.

## V3+ — longer-term

Bigger, riskier, or lower-priority than V2 — roughly ordered by how
likely they are to matter soon, not by size.

- [ ] **Signed entitlement tokens.** Let protected Workers validate
      short-lived membership grants at the edge without a D1 round-trip,
      while preserving revocation and consumption accounting.
- [ ] **Custody-provider adapters.** Normalize funding, cancellation,
      and refund attestations across approved banks, custodians, escrow
      providers, or brokerages.
- [ ] **Independent accounting service.** Maintain the double-entry
      ledger, reconciliation jobs, exception queues, and signed
      accounting attestations outside the policy Worker.
- [ ] **Treasury service for company-controlled policy.** Liquidity
      ladders, concentration limits, maturity matching, counterparty
      health, and approval workflows belong in a separate service.
      Tokenized Treasuries or DeFi may be evaluated later, but not as the
      initial customer-reserve pilot and never as member-owned positions.
- [ ] **Analytics dashboard.** Visualize active agreements,
      entitlements, usage, liabilities, refund queues, reserve coverage,
      and operational exceptions without exposing private custody data.
- [ ] **Multi-token support beyond USDC.** EURC or other assets only
      after the custody, accounting, and jurisdictional treatment is
      explicit for each asset and network.
- [ ] **Cloudflare Rules-expression / Monetization Gateway
      integration.** Push route matching to the edge before a request
      reaches a Worker.
- [ ] **Real Web Bot Auth verification.** Verify HTTP Message
      Signatures rather than trusting a caller-supplied boolean.
- [ ] **Signed coupon tokens.** Validate trials at the edge without a D1
      round-trip.
- [ ] **Multi-facilitator failover.** Retry against a secondary
      facilitator if the primary times out or degrades.
- [ ] **Separate investor-product research.** Explore only through a
      dedicated project after specialist legal review; do not add it to
      this Worker's membership surface.

## Risks & open questions

This section is design guidance, not legal, tax, accounting, custody, or
investment advice. Classification depends on the actual contracts,
marketing, fund flows, counterparties, jurisdictions, and operational
control — not the name used in code.

- **Money-transmission analysis is fact-specific.** A refundable
  deposit taken for the provider's own non-financial service and
  returned to the same customer may present different facts from
  accepting value for transmission to another person or location.
  Direct custody, pooling, conversion, cross-border use, or movement
  into third-party protocols materially increases the complexity. Get a
  written analysis before accepting real principal.
- **Removing member-facing yield improves but does not settle the
  securities analysis.** The enterprise terms and marketing must avoid
  an expectation of profit, performance-linked benefits, transferable
  interests, governance rights, or language that treats the member as
  an investor.
- **Prepaid-membership and refundable-deposit rules may apply.** State
  law can require trust accounts, escrow, bonding, disclosures,
  cancellation rights, or other protections. Scope the first pilot to
  jurisdictions that have been reviewed.
- **Custody and insolvency protection are central.** A platform wallet
  creates commingling, operational, bankruptcy, key-management, and
  customer-trust risk. Segregated custody records and clear beneficial
  ownership/claim treatment must be resolved contractually and
  operationally.
- **Refund timing and asset liquidity must match.** Direct T-bills can
  carry sale-before-maturity risk; money-market funds have settlement
  and gate mechanics; stablecoins can depeg or be frozen; tokenized
  funds add transfer and eligibility constraints; DeFi adds smart
  contract, oracle, liquidation, and protocol-governance risk.
- **Mass cancellations create run risk.** Model correlated withdrawals,
  custodian outages, settlement delays, and asset impairment. Maintain a
  liquid buffer and do not promise instant refunds against less-liquid
  assets.
- **Refunds are a high-risk payment workflow.** Require authenticated
  requests, destination validation, sanctions and fraud controls,
  approval thresholds, idempotency, transaction limits,
  reconciliation, and recovery for partial failures.
- **Accounting must be correct from day one.** Refundable principal is
  generally modeled as a liability rather than service revenue;
  treasury earnings, losses, service fees, and refunds need separate
  ledger treatment confirmed by qualified professionals.
- **Unclaimed property and dormancy require policy.** Define contact,
  dormancy, notice, and escheatment handling before accounts can remain
  inactive for long periods.
- **International expansion multiplies obligations.** Do not infer that
  a U.S. structure works for customers, custodians, or assets in other
  countries.
- **Operating balances and membership reserves are different liabilities.** A spendable balance decreases through purchases and may create developer payables; a membership reserve remains refundable under its service contract. Do not combine them in product language, accounting, liquidity assumptions, or customer dashboards.
- **Branding does not change legal or accounting substance.** Calling a unit a Penny, Quarter, credit, token, point, or membership balance does not determine its classification. Transferability, redemption, custody, third-party acceptance, fund flows, and marketing control the real analysis.
- **Government-backing and insurance claims require exact support.** Reserve assets that include government securities do not make a privately issued stablecoin government-backed. Do not imply sovereign issuance, guarantee, FDIC/SIPC protection, or equivalent protection unless it actually applies to the specific customer claim.
- **Economics must survive low rates and zero treasury income.** At
  ordinary reserve sizes, treasury income is modest. The service should
  be viable from its fees and metered usage; reserve earnings are a
  margin enhancer, not the primary revenue source.
- **Security compromise could become a financial event.** Complete
  authentication, authorization, signing, audit, replay protection,
  separation of duties, incident response, and key/custodian controls
  before connecting policy state to real funding status.

V1.1/V1.2 and the synthetic V2A entitlement prototype may proceed
without custody. A real V2B pilot begins only after the launch gates have
written approvals, verified integrations, and tested operational
controls.
