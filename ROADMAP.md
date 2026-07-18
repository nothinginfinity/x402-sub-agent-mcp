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

**Model update (reflected below):** the working design is no longer a
yield-*share* with members — it's closer to a refundable membership
deposit. A member pays (e.g.) $5,000/year for tool access; the company
holds that $5,000, invests it (Treasuries, money-market funds, or a
DeFi yield source depending on how V2 lands), keeps 100% of whatever it
earns as ordinary business revenue, and refunds the full $5,000
principal if the member cancels. The member is not promised any return,
any share of yield, or any profit participation — they're buying
service access with a refundable deposit, full stop. That's a
meaningfully different (and better) legal shape than the original
50/50 yield-split framing, closer in spirit to how a private club deposit
works than to an investment product. It changes *which* regulatory
buckets apply, not *whether* any apply.

- **This is very likely a money transmission / money-services-business
  question first, not a securities question.** Taking custody of a
  customer's funds and holding a refund obligation against them is the
  core fact pattern state money transmitter statutes and (for
  cross-border customers) FinCEN's MSB rules are built to cover. This
  is arguably the single most important item to resolve before
  `deposit_stake` accepts a real dollar — more directly on-point than
  the securities analysis below, and unlike securities exposure it
  doesn't go away just because there's no yield-share.
- **Securities-law exposure is real but weaker without a yield-share.**
  The classic U.S. test (Howey) turns on whether the buyer has an
  expectation of profit from the arrangement. A no-yield, full-refund,
  pay-for-access deposit doesn't obviously create that expectation the
  way a profit-split did — this is a genuine improvement over the
  earlier framing. It's not a guarantee of "not a security," just a
  meaningfully better starting position; a lawyer still needs to
  confirm the actual terms (refund policy wording, marketing language,
  whether any return is implied) don't accidentally recreate an
  expectation of profit.
- **State prepaid-membership / club-deposit statutes are the closest
  existing legal category.** Refundable-deposit-for-service-access is
  an old business model (private clubs, gyms, some subscription
  services) with real regulatory history — several states specifically
  require bonding, trust accounts, or escrow arrangements for prepaid
  membership deposits, precisely because members have historically lost
  deposits when such companies went insolvent. This is likely the most
  directly applicable body of law to research first, state by state for
  wherever members are based.
- **The GENIUS Act (signed July 2025) is relevant context, not a
  direct constraint here.** It prohibits *payment stablecoin issuers*
  from paying interest/yield to holders, with proposed OCC rules
  extending that to affiliate/third-party arrangements. This worker
  isn't issuing a stablecoin and isn't paying yield to depositors under
  the current no-share design, so the Act's core prohibition likely
  doesn't reach it directly — but it signals that "yield connected to
  stablecoin holding, paid by anyone in the chain" is exactly the
  pattern federal regulators are watching, and it's worth re-checking
  this analysis if the model ever reintroduces any member-facing yield
  component.
- **AML / KYC obligations follow from the money-transmission
  question.** If this is (or resembles) a money-services business,
  standard Bank Secrecy Act expectations apply: identity verification,
  transaction monitoring, suspicious activity reporting — especially
  relevant given international customers were explicitly part of the
  original pitch.
- **Unclaimed property / escheatment.** Deposits that go unclaimed for
  an extended period (member disappears, doesn't formally cancel)
  can trigger state requirements to eventually remit the balance to the
  state. Needs a defined dormancy/escheatment policy, not just "we hold
  it forever."
- **Custody model still matters, independent of the legal
  question.** Platform-controlled account/wallet (simpler, more trust
  required from members) vs. a real segregated trust/escrow account
  (harder to set up, less trust required, and likely what several
  states' prepaid-membership statutes actually require) is a decision
  that should land before `deposit_stake` ships, not after.
- **Where the deposit is invested still carries real risk, even in
  "safe" instruments.** Direct T-bill holdings carry minimal credit
  risk but real interest-rate and liquidity risk if a bill needs to be
  sold before maturity to fund a refund; a DeFi yield source adds smart
  contract and depeg risk on top; a tokenized-treasury product (Ondo's
  OUSG/USDY, Franklin Templeton's BENJI, Superstate, etc.) shifts the
  risk profile again since those are themselves securities/fund
  interests with their own redemption mechanics and eligibility
  restrictions (some are accredited-investor-only). Whichever venue V2
  picks, "refundable principal" is a promise the company has to be able
  to keep on the *member's* cancellation timeline, which may not match
  the yield source's liquidity timeline — this argues for holding some
  buffer un-invested rather than deploying 100% of deposits.
- **Withdrawal timing creates a run risk regardless of legal
  structure.** If many members cancel at once (bad press, a rate
  environment shift, whatever), can the company actually honor
  refunds on the promised timeline? Same structural question every
  system that promises instant liquidity on an less-liquid underlying
  asset has to answer, independent of whether it's legally a security.
- **Revenue economics need a real model, not just the yield-share math
  from the original framing.** Without a subsidy split, 100% of the
  yield is company revenue — the earlier "$100 stake → $0.21/mo
  subsidy" table no longer applies as a member-facing number, but the
  underlying point stands: at low deposit sizes and near-term rates,
  yield income per member is modest, and the business case likely
  depends on deposit volume/scale, higher minimum deposit tiers, or
  treating the yield as a margin-improver on top of otherwise-priced
  service rather than the primary revenue source.
- **Tax treatment.** Yield earned on customer deposits is very likely
  ordinary income to the company under this no-share structure (cleaner
  than the split-recognition question the original framing raised) —
  but refundable customer deposits sitting on the balance sheet also
  have their own accounting treatment (liability, not revenue) that
  should be set up correctly from day one rather than reconstructed
  later.

None of this blocks V1.1/V1.2 — those are safe, incremental, and don't
touch custody. It should block the start of any real V2 implementation
work until at least the money-transmission and prepaid-membership
regulatory questions have real answers — that's now the higher-priority
legal question to resolve first, ahead of the securities analysis,
given the no-yield-share structure.
