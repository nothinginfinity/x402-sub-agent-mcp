# Agent operating balances and branded denomination UX

This document defines the long-term conceptual model for consumable agent balances, human-readable micro-denominations, external settlement assets, and future marketplace payments.

It is architecture guidance, not legal, accounting, custody, tax, banking, stablecoin, or investment advice. Actual classification depends on contracts, marketing, redemption rights, custody, transferability, counterparties, jurisdictions, and operational control.

## Core product thesis

Autonomous agents need a funded operating account with machine-enforceable budgets. The product should make tiny software purchases understandable to humans while preserving exact integer accounting for machines.

The durable product is an **agent commerce operating system**:

- agent identity and authorization;
- organization and user budgets;
- route and tool pricing;
- pre-authorization and maximum-spend controls;
- measured usage and final settlement;
- receipts, analytics, and reconciliation;
- tool discovery and marketplace attribution; and
- adapters to approved external settlement providers.

Reserve income may improve platform margin in later regulated structures. It is not the core product and must not be required for the software economics to work.

## Four concepts that must stay separate

### 1. Agent operating balance

A consumable prepaid balance used for tool calls, data access, compute, workflows, and developer services.

Spending reduces the balance. An unused amount may be withdrawable or refundable only under the terms and capabilities of the external provider and applicable program.

### 2. Enterprise membership reserve

Refundable principal committed for a defined service term. It unlocks fixed entitlements, permissions, included usage, and preferred overage pricing.

Ordinary tool calls do not consume the reserve principal. The reserve and the customer's operating balance are separate liabilities with separate contract, liquidity, cancellation, and accounting treatment.

### 3. Settlement asset or payment rail

The external asset or account used to fund, settle, redeem, or withdraw value. Examples for later evaluation may include USDC, USDT, a tokenized deposit, a fiat account held by an approved provider, or another supported asset.

Each adapter has its own issuer, network, custody, redemption, availability, sanctions, freeze, depeg, settlement, and jurisdiction characteristics. Asset names are never interchangeable merely because they target the same unit of account.

### 4. Branded denomination

A human-readable display or marketing unit mapped to an exact atomic value. Examples include Penny, Nickel, Quarter, Dollar, or Mill.

A mill is $0.001, which is one-tenth of one cent.

A branded denomination is not automatically:

- a separate blockchain token;
- an independently redeemable asset;
- a customer liability separate from the underlying balance;
- a stablecoin;
- a bank deposit;
- government-backed or government-issued; or
- insured or deposit-protected.

The same balance can be rendered several ways without changing its economic substance:

```text
machine amount: 800000 microunits
standard display: $0.80
coin display: 3 quarters + 1 nickel
```

## Canonical unit model

Use one integer atomic ledger per supported settlement asset.

```text
1 USD-denominated unit = 1,000,000 microunits
$0.01 = 10,000 microunits
$0.001 = 1,000 microunits
```

Do not use floating-point values for canonical balances, holds, settlement amounts, fees, developer payables, or refunds.

Display metadata may include:

```text
name
symbol
atomic_value
settlement_asset_ref
locale
singular_label
plural_label
marketing_only
```

Changing a label must never change the atomic amount.

## Suggested customer account presentation

Keep consumable and refundable amounts visually separate:

```text
Agent operating balance
$482.74 available for tool execution

Enterprise membership reserve
$25,000 committed through July 31, 2027

Included usage
$1,240 of $2,000 remaining this month
```

Do not collapse these into one ambiguous `float` field.

## Request lifecycle

A safe metered call uses a hold-and-finalize lifecycle:

```text
1. Agent requests a tool with a maximum authorized amount.
2. Policy engine evaluates identity, scope, budget, and pricing.
3. External balance service signs an authorization or reservation.
4. Tool executes and reports actual measured usage.
5. External balance service commits the actual amount.
6. Unused authorization is released.
7. Policy engine records the signed settlement receipt.
8. Accounting and marketplace services reconcile fees and payables.
```

Every financial mutation needs:

- an idempotency key;
- request and authorization expiration;
- replay protection;
- immutable event history;
- maximum-spend enforcement;
- partial-usage handling;
- failure recovery;
- signed receipts; and
- reconciliation status.

## Accounting model

Funding an operating balance is not service revenue at the time of funding.

Representative entries, subject to professional confirmation:

```text
Customer funds $500
Asset or processor receivable +$500
Customer balance liability +$500
Revenue $0
```

A customer spends $0.80 on a third-party tool with a 10% platform fee:

```text
Customer balance liability -$0.80
Developer payable +$0.72
Platform fee revenue +$0.08
```

First-party compute may instead allocate the consumed amount among service revenue, compute expense, taxes, refunds, and other required accounts.

Enterprise membership reserves require a separate refundable-liability ledger and must not be netted against operating balances.

## System boundaries

### Trust plane

Owns agent identity, organization membership, signatures, roles, device or workload identity, budgets, and administrative approvals.

### Policy plane

This repo. Owns route pricing, entitlement checks, x402 challenges, metering decisions, usage attribution, and receipt references.

### Money plane

An external balance, custody, settlement, and accounting system. Owns canonical balances, customer liabilities, holds, commits, releases, withdrawals, refunds, reserve assets, and reconciliation.

### Supply plane

Owns tool registry, developer onboarding, reputation, marketplace terms, developer payable calculation, disputes, and payout workflows.

Only signed, minimal authorization and receipt data should cross from the money plane into this Worker.

## Staged implementation

### Stage 0 — current V1

Use x402 exact payments, mock settlement, route pricing, coupons, enterprise tiers, and usage logging. No customer wallet or balance is held by this Worker.

### Stage 1 — display and settlement abstraction

Add settlement-asset metadata and display-denomination metadata. Continue settling through existing supported assets. Treat Penny, Nickel, Quarter, and Mill as interface labels only.

### Stage 2 — synthetic or testnet balance service

Build a separate mock service for `authorize`, `reserve`, `commit`, `release`, and `get_receipt`. Exercise full metered flows with synthetic or testnet value and no real custody.

### Stage 3 — approved provider pilot

Integrate one approved provider and one settlement asset after security, legal, custody, accounting, fraud, sanctions, refund, and unclaimed-property questions have written answers.

Use provider-signed attestations. Keep private keys, custody credentials, canonical balances, and customer-money movement outside this Worker.

### Stage 4 — controlled marketplace

Start with first-party tools and a small approved partner set. Add independent developer payables, tax, disputes, refunds, fraud, sanctions, and payout operations before open marketplace onboarding.

### Stage 5 — optional branded on-chain unit research

A branded on-chain unit may be evaluated later for distribution or marketing. It is unnecessary for sub-cent pricing and must be a separate issuer/custody/legal project or use an approved issuing partner.

The research must answer:

- who legally issues and redeems the unit;
- which asset or account supports it;
- whether it is transferable;
- where it may be used;
- who holds customer funds;
- what claims customers have in insolvency;
- which disclosures, licenses, reserves, attestations, and controls apply; and
- whether the unit adds value beyond UI branding over an existing settlement asset.

## Marketing guardrails

Prefer precise language:

- `priced in cents and settled through [asset/provider]`;
- `a branded display denomination mapped to the supported settlement asset`;
- `agent operating balance`;
- `metered tool spending`;
- `provider-held balance`; and
- `subject to provider terms, availability, and eligibility`.

Do not use these claims without exact, documented support:

- `government-backed`;
- `government-issued`;
- `official stablecoin`;
- `risk-free`;
- `FDIC insured`;
- `SIPC protected`;
- `bank account`;
- `checking account`;
- `withdraw anytime`;
- `guaranteed redemption`; or
- `your money is invested in Treasuries`.

A private stablecoin does not become government-backed merely because its reserve portfolio includes government securities. Regulation of an issuer is also not the same as a government guarantee of the token or customer claim.

## Permanent boundary for this repo

`x402-sub-agent-mcp` may become the programmable authorization and policy engine behind an agent operating account.

It must not become, inside this Worker:

- the stablecoin issuer;
- the canonical customer wallet;
- the custodian of customer assets;
- the treasury manager;
- the refund executor;
- the developer payout processor; or
- the legal or accounting system of record.

The Worker should know whether a signed authorization, entitlement, or settlement receipt is valid. It should not control the underlying money.