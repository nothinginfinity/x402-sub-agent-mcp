# Roadmap

Where `x402-sub-agent-mcp` is now, and where it's headed. Organized by
milestone rather than a fixed calendar, since this is a solo project and
dates would just be wrong.

- [V1 — shipped](#v1--shipped)
- [V1.1–V1.2 — near-term](#v11v12--near-term)
- [V2 — stake-based memberships (mid-term)](#v2--stake-based-memberships-mid-term)
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

## V2 — stake-based memberships (mid-term)

The bigger idea from the README: refundable USDC stakes that earn yield,
subsidize usage, and convert what's currently pure pay-per-call into an
optional membership layer on top. This is a genuinely new product
surface, not a refactor of V1 — treat it as additive.

### New data model
- [ ] `stakes` table: `id`, `caller_id`, `principal_atomic`, `asset`,
      `network`, `deposited_at`, `status` (`active`/`withdrawing`/`closed`),
      `escrow_address`, `yield_strategy_id`.
- [ ] `yield_positions` table: tracks where a stake's principal is
      currently deployed (which protocol, which pool/vault, entry
      timestamp, entry price/share count) — needed for accurate accrued-yield
      accounting per stake, since stakes will pool into shared vaults in
      practice rather than each getting isolated on-chain positions.
- [ ] `usage_allowances` table: per-`caller_id` monthly budget derived
      from stake size, current period's consumed amount, reset date.

### New tools
- [ ] `deposit_stake` — record an incoming stake deposit (after
      facilitator settlement confirms the transfer into escrow).
- [ ] `withdraw_stake` — initiate principal return; needs a cooldown /
      time-lock policy, not instant withdrawal, both for yield-source
      liquidity reasons and fraud/abuse resistance.
- [ ] `get_stake_status` — principal, accrued yield to date, current
      usage allowance, allowance consumed this period.
- [ ] `calculate_usage_allowance` — pure function: stake size + yield
      rate + subsidy split → monthly allowance. Should be callable
      standalone (for showing a prospective member "here's what a $500
      stake gets you") as well as internally by `evaluate_request`.
- [ ] Extend `evaluate_request` to check `usage_allowances` *before*
      falling through to normal per-call pricing — allowance-covered
      usage should short-circuit straight to `200` the same way a free
      coupon does today.

### Yield automation
- [ ] Decide and document the actual yield venue(s) — Aave, Morpho, and
      Ondo are named as candidates in the README; each has different
      integration complexity (Aave/Morpho are on-chain money markets
      with real-time composable yield; Ondo's tokenized treasuries are a
      different risk/liquidity profile entirely). This needs a real
      decision, not just a list, before any code gets written.
- [ ] Build (or integrate) the actual deposit-into-yield-source
      mechanism. This is the one piece of V2 that isn't a natural
      extension of existing x402 primitives — it's real DeFi protocol
      integration, likely needs its own sub-agent rather than living in
      this worker.
- [ ] Yield accrual accounting: how often is yield calculated and
      attributed per stake (real-time via share price, daily snapshot,
      etc.)? Affects both the `yield_positions` schema and how
      `get_stake_status` computes "accrued yield to date."

### Membership tiers in x402 terms
- [ ] Map stake tiers ($100 / $500 / $1,000+) onto `pricing_tiers`-style
      rows with a `min_stake_atomic` requirement instead of (or in
      addition to) `caller_id`-specific overrides.
- [ ] Decide overage behavior precisely: auto-charge via x402
      micropayment against a linked payment method, require manual
      top-up, or degrade gracefully (rate-limit, not block)? This is a
      product decision, not just an engineering one.

## V3+ — longer-term

Bigger, riskier, or lower-priority than V2 — roughly ordered by how
likely they are to matter soon, not by size.

- [ ] **Multi-token support beyond USDC.** EURC, other stablecoins,
      possibly non-stable assets for the internal-token use case.
- [ ] **On-chain escrow / smart contracts for stakes.** V2 as scoped
      above can run with this sub-agent (or a paired custodial service)
      holding stakes in a controlled wallet — which is simpler to ship
      but means members are trusting the platform's custody, not a
      contract. A real escrow contract (time-locked, member-withdrawable
      by design, yield-source-integrated) removes that trust assumption
      but is a much bigger build (audited Solidity, not a Worker
      change).
- [ ] **Analytics dashboard.** Visual layer over `usage_events` /
      `stakes` / `yield_positions` — total value locked, yield
      generated vs. distributed, per-tier retention, etc. Probably a
      separate Worker or a Cloudflare Pages app reading from the same D1.
- [ ] **Production yield automation.** Auto-rebalancing across yield
      sources for best risk-adjusted rate, automated compounding,
      alerting on yield-source health (e.g., a money market's
      utilization spiking).
- [ ] **Governance features.** If this grows into something
      multi-stakeholder (not just one operator), decisions like "which
      yield sources are approved" or "what's the subsidy split"
      probably need some kind of transparent process rather than being
      a config value only the operator can see.
- [ ] **Cloudflare Rules-expression / Monetization Gateway
      integration.** Push route matching to the edge (before a request
      even reaches a Worker) instead of doing it in `evaluate_request`.
- [ ] **Real Web Bot Auth verification.** V1 trusts a
      `bot_auth_verified` boolean the caller asserts; a real
      implementation verifies the HTTP Message Signatures directive
      itself.
- [ ] **Signed coupon tokens.** Move from DB-row coupons to signed
      JWT-style tokens so edge logic can validate a trial without a D1
      round-trip.
- [ ] **Multi-facilitator failover.** Retry against a secondary
      facilitator if the primary times out or degrades.

## Risks & open questions

Being direct about these because the stake-membership model in
particular touches money in ways that are easy to hand-wave past in a
roadmap and expensive to get wrong in production.

- **Regulatory/legal exposure is the biggest open question, not a
  footnote.** Taking custody of member funds, deploying them into
  yield-generating strategies, and paying out a share of the return is
  a fact pattern that can implicate money transmission licensing,
  securities law (an arrangement where people provide capital expecting
  a return generated by the efforts of others is the classic shape
  regulators look at), and/or banking regulation, depending on
  jurisdiction and exact structure. This needs review by an actual
  lawyer familiar with digital asset regulation *before* V2 touches a
  single real dollar — not after a prototype is already live. Nothing
  in this repo should be read as legal clearance to proceed.
- **Yield is not guaranteed.** 4–6% APY is a snapshot of current
  DeFi money-market conditions, not a fixed rate. Rates on Aave/Morpho
  move with utilization and can go meaningfully lower (or, in
  principle, negative in real terms after protocol risk) with no
  warning. Any member-facing promise needs to be about a variable rate,
  explicitly, or the platform is on the hook for a gap it can't
  control.
- **Yield-source risk is real risk, not just a number.** Smart contract
  risk (a bug or exploit in the lending protocol), depeg risk (the
  stablecoin itself losing its peg), and liquidity risk (not being able
  to withdraw principal instantly if a money market is highly utilized)
  all sit between "member deposited $100" and "member gets $100 back."
  "Refundable principal" is a promise this system has to be able to
  keep even in a bad week for DeFi, which likely means holding some
  buffer un-deployed rather than putting 100% of stakes into yield.
- **Custody model matters a lot and isn't decided.** Platform-controlled
  wallet (simpler, more trust required) vs. real escrow smart contract
  (harder to build, less trust required) is a fork in the road that
  should probably be resolved before `deposit_stake` ships, not after.
- **Withdrawal time-locks create a run risk.** If everyone tries to
  withdraw at once (bad press, a yield-source incident, whatever), can
  the platform actually honor it on the timeline it promised? This is
  the same structural question every fractional-reserve-shaped system
  has to answer.
- **Subsidy economics only work at scale or higher stake tiers.** The
  README's own math table shows a $100 stake subsidizing about $0.21/mo
  — not enough to matter on its own. The model needs either a large
  member base (yield pools, not per-member positions, to keep gas/ops
  overhead sane) or a push toward higher minimum stakes to be
  economically meaningful, and that's a go-to-market question as much
  as an engineering one.
- **Tax treatment is unresolved.** Is the yield income to the platform,
  to the member, or split-recognized to both? Different jurisdictions
  will answer this differently, and it affects reporting obligations on
  both sides.

None of this blocks V1.1/V1.2 — those are safe, incremental, and don't
touch custody. It should block the start of any real V2 implementation
work until at least the regulatory and custody-model questions have
real answers.
