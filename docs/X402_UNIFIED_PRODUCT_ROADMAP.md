# x402 Unified Product Roadmap

**Status:** Canonical cross-repository product roadmap

**Canonical source:** `nothinginfinity/agent-wallets-console/docs/X402_UNIFIED_PRODUCT_ROADMAP.md`

This roadmap coordinates the product work spanning:

- `nothinginfinity/agent-wallets-console` — precision Wallet Cockpit and Wallet Brain host
- `nothinginfinity/agent-universe` — 3D/fleet-scale Command Map for hundreds to thousands of agents and wallets
- `nothinginfinity/x402-cairnstone` — paid tool/data surface, x402 settlement, metering, pricing, receipts, and provenance
- `nothinginfinity/x402-sub-agent-mcp` — authoritative Agent Context, wallet assignment, budgets, permissions, and wallet execution substrate

Repository-specific roadmaps remain valid for local implementation detail. When product ordering or cross-repository responsibilities conflict, this unified roadmap is the coordinating plan. Mirrors in the other repositories should be kept byte-equivalent to this file except for an optional short local-repo note above the canonical-source line.

## Product thesis

Build an agent-native wallet operating system that a human can use to supervise one wallet or more than 1,000 wallets, while allowing tool-capable LLMs to safely send, receive, request, purchase, meter, and explain x402 economic activity.

The product has three human-facing surfaces over one authoritative backend truth:

1. **Wallet Cockpit** — exact operational control, balances, identities, budgets, transactions, failures, approvals, and detailed wallet administration.
2. **Agent Universe** — spatial fleet intelligence, clustering, relationships, payment flows, economic activity, anomalies, and navigation at 100-1,000+ agent/wallet scale.
3. **Wallet Brain** — BYOK, provider-agnostic LLM chat that reasons over wallet/tool state, formulates prompts, proposes transactions, explains activity, and coordinates external LLMs without becoming wallet authority itself.

The Wallet Brain may understand and propose. Deterministic server-side tools resolve identities, enforce policy, and execute.

## Non-negotiable architecture

- `x402-sub-agent-mcp` remains authoritative for Agent Context, current wallet assignment, budgets, permissions, and wallet execution policy.
- A UI alias or LLM conversation must never become wallet authority.
- Wallet reassignment must propagate automatically through authoritative resolution; UI databases must not require manual wallet-ID synchronization.
- `x402-cairnstone` and other paid services resolve payer wallets through the authoritative agent-wallet resolver and fail closed.
- Browser/3D gestures create drafts and previews only. Signing, policy checks, idempotency, submission, settlement, and receipts remain server-side.
- LLMs may call tools but must not invent wallet IDs, addresses, balances, settlement state, or transaction results from conversation context.
- Every consequential action receives a structured preview before execution when confirmation policy requires it.
- Provider/on-chain evidence, not animation or model prose, determines final transaction state.
- Testnet and mainnet must be visually and technically distinct.
- Secrets, provider API keys, signing material, and unrestricted service credentials never enter graph payloads or ordinary client-visible state.

## Current proven foundation

The backend foundation is sufficiently proven to begin product UI development:

- Agent Context and wallet reassignment are live.
- OAuth tool-scope regression suite is repaired and CI-green.
- x402 metered settlement is proven end-to-end on Base Sepolia.
- Authoritative wallet resolution is live and has passed the wallet-reassignment regression without a CairnStone D1 wallet update.
- Missing binding, disabled agent, no active wallet, and ambiguous wallet paths fail closed.
- Fresh-chat LLM transaction execution has independently resolved its own Agent Context and completed a verified on-chain transfer.

These facts justify moving the primary development focus from backend rescue to operator UX while preserving backend regression coverage.

# Execution order

## Phase U0 — Unified contracts and read models

**Goal:** make both UIs consume the same normalized authoritative data before adding new mutation paths.

### x402-sub-agent-mcp

- Expose or formalize scoped read contracts for agent identity, current wallet, wallet lifecycle, budgets, permissions, caller bindings, and transaction-relevant policy.
- Preserve one shared active-wallet resolver for OAuth, internal service resolution, and UI projections.
- Add supported audited caller-binding administration rather than relying only on seed SQL.
- Keep stale/dead identity tables out of authority paths; destructive cleanup is separate.

### x402-cairnstone

- Expose read-safe settlement, metered-call, pricing-rule, payment/receipt, and failure-state projections needed by the UIs.
- Keep pricing precedence explicit: lower numeric priority wins.
- Preserve durable settlement error evidence and authoritative payer resolution.

### agent-wallets-console

- Replace ad-hoc wallet presentation assumptions with a normalized read model sourced from authoritative services.
- Introduce stable human aliases/display metadata that never replace agent IDs, wallet IDs, or addresses as authority.
- Separate Agent identity from Current Wallet everywhere in the UI.

### agent-universe

- Build/read the same normalized projection as Agent Cells and typed economic graph events.
- Do not create a second wallet database or competing wallet authority.

**Exit condition:** the Cockpit and Universe can render the same small real testnet fixture and agree on agent, current wallet, balance, budget, and recent transaction state.

## Phase U1 — Wallet Cockpit v1

**Goal:** make day-to-day wallet operation understandable before scaling mutation.

Primary repo: `agent-wallets-console`.

Ship:

- mobile-first overview
- wallet cards with alias, agent identity, current wallet, address, network, asset, balance, status, and freshness
- clear archived/reassigned-wallet history
- agent view with caller bindings and authoritative current wallet
- activity/transaction ledger with human-readable source and destination labels
- search and filters
- exact IDs available but visually secondary
- wallet summary copy action
- deterministic prompt composer upgraded from fixed transfer text to structured action drafts
- explicit testnet labeling

**Exit condition:** an operator can identify any currently active test wallet, who/what controls it, its balance, recent activity, and its authoritative agent relationship without memorizing UUIDs.

## Phase U2 — Wallet Brain read-only + BYOK

**Goal:** place a provider-agnostic LLM inside the wallet product without giving it mutation authority yet.

Primary repo: `agent-wallets-console`; shared contracts from backend repos.

Ship:

- persistent Wallet Brain chat surface
- BYOK provider abstraction for tool-capable models
- initial provider adapters chosen behind one model/tool interface
- secure key handling; provider keys never appear in ordinary logs, graph payloads, or model-visible tool results
- read-only tools for wallet inventory, agent context, balances, budgets, caller bindings, transaction history, x402 metered activity, pricing, and failures
- natural-language fleet queries
- prompt generation for Claude, ChatGPT, Gemini, Perplexity, or other external LLMs
- x402 purchase/payment instruction generation
- explanations grounded in tool results with visible provenance/freshness

Example requests:

- Which wallet does Claude control right now?
- Which wallets are below 0.10 USDC?
- What paid CairnStone yesterday?
- Generate a prompt for another LLM to pay Jared 3 and then access this x402 tool.
- Explain why this settlement failed.

**Exit condition:** the Brain correctly answers wallet/fleet/economic questions from tools and generates portable external-agent prompts without executing transfers itself.

## Phase U3 — Transaction drafts, requests, and explicit previews

**Goal:** turn natural language into safe structured economic actions.

Ship a common action-draft contract supporting at minimum:

- send
- request payment
- x402 purchase/pay-to-access
- external-agent prompt generation

A draft resolves:

- actor/agent
- authoritative source wallet
- destination identity/address
- asset
- network
- exact atomic amount
- human display amount
- purpose/resource
- applicable budget/policy
- confirmation requirement
- idempotency identity

Cockpit renders the precision preview. Universe may originate drafts from graph interactions but must use the same contract.

**Exit condition:** users can create, inspect, edit, cancel, and copy/promote transaction drafts without moving funds.

## Phase U4 — Controlled execution from Wallet Brain/Cockpit

**Goal:** allow the in-wallet LLM and UI to execute only through deterministic wallet tools and existing policy.

Ship:

- explicit confirmation flow for configured action classes
- server-side authoritative wallet re-resolution immediately before execution
- budget and permission enforcement
- idempotency protection
- exactly-once UX semantics where supported
- transaction submission state
- provider/on-chain reconciliation
- receipt and audit records
- failure/retry policy that never silently changes wallet, amount, destination, network, or asset
- post-execution Agent Context re-resolution and final report

**Exit condition:** a user can say “send 0.01 USDC from Claude to Jared 3,” approve a resolved preview, execute exactly one testnet transfer, and independently verify the resulting receipt/on-chain event.

## Phase U5 — Agent Universe live read-only fleet view

**Goal:** turn Agent Universe into the fleet-scale Command Map over real x402 state.

Primary repo: `agent-universe`.

Ship:

- live Agent Cells from the normalized read model
- current wallet and budget state
- typed transaction/payment/request/receipt edges
- provenance and freshness indicators
- inspectors with exact underlying records
- search/filter/focus
- semantic clustering by owner, project/workspace, runtime/model family, role, capability, and transaction community
- semantic zoom / level of detail
- 2D/list fallback over the same graph state
- deep links: `View in Cockpit`

**Exit condition:** an operator can navigate hundreds or thousands of entities without rendering an unreadable cloud of individual wallet icons.

## Phase U6 — Shared Wallet Brain across Cockpit and Universe

**Goal:** make the Brain the common semantic navigation/control layer rather than a chat widget tied to one page.

Ship:

- shared conversation/session state across views
- Brain-driven graph filtering/highlighting
- Brain answers with entity references that open Cockpit details or Universe locations
- “show me” commands for fleet navigation
- “open this in Cockpit” for precision review
- one action-draft contract across both interfaces

Examples:

- Show every wallet that received money from Claude this week.
- Highlight active agents with balances below their configured threshold.
- Show economic activity between ChatGPT and Claude agents.
- Why is this Agent Cell degraded?

**Exit condition:** a conversation can move between semantic fleet exploration and exact transactional inspection without losing identity or action context.

## Phase U7 — x402 commerce cockpit

**Goal:** make paid tools/data/resources a first-class wallet workflow, not merely raw transfers.

Ship:

- payment requests tied to tools/resources
- pricing-rule inspection and human explanations
- payee/revenue views
- purchase/access receipts
- Brain-generated external-agent instructions that include payment, verification, tool invocation, and returned result requirements
- paid tool/data revenue and spend summaries
- linkage from transaction -> resource/tool -> receipt -> access/result where available

**Exit condition:** an operator can understand not just that money moved, but what an agent paid for or earned from and whether access/work followed correctly.

## Phase U8 — 1,000+ wallet/operator scale

**Goal:** make a large autonomous wallet fleet operable by exception rather than manual inspection.

Ship:

- workspaces/groups/tags
- saved views
- bulk read operations
- semantic clusters
- balance/budget/activity threshold views
- anomaly and policy-risk signals clearly labeled as heuristic unless verified
- archival and lifecycle management
- fleet summaries and trend views
- role-based/scoped views if multiple human operators are introduced
- performance budgets for 1,000+ wallets and high event counts

The Brain becomes the primary fleet query interface; the Universe becomes the primary relationship/navigation interface; the Cockpit remains the primary precision/execution interface.

**Exit condition:** an operator can answer “what needs my attention?” and drill from fleet summary to exact source records and receipts without manually scanning 1,000 wallet cards.

# Repository responsibilities

## agent-wallets-console

Owns:

- Wallet Cockpit UI/UX
- Wallet Brain host UI
- BYOK/model-provider UX
- precision transaction/action previews
- wallet/agent aliases and display metadata
- activity/ledger presentation
- deep links into Agent Universe

Does not own authoritative wallet assignment, signing policy, or settlement truth.

## agent-universe

Owns:

- fleet-scale spatial/graph interface
- Agent Cell projections
- typed relationship/economic graph visualization
- clustering, semantic zoom, graph filtering, inspectors, replay, and saved views
- deep links into Wallet Cockpit

Does not own wallet authority or infer settlement from animation.

## x402-sub-agent-mcp

Owns:

- authoritative Agent Context
- current wallet assignment and reassignment
- caller bindings
- budgets and permissions
- transfer policy and wallet execution tools
- wallet-provider integration
- authoritative wallet-resolution contracts

## x402-cairnstone

Owns within this product family:

- metered x402 paid-tool behavior
- pricing-rule application
- settlement evidence and failures
- payment/receipt/provenance surfaces for CairnStone resources
- proving the pay-to-access pattern that other paid services can follow

It must not maintain a competing payer-wallet authority.

# Shared data and UX rules

1. **Identity is not wallet.** Always display agent identity and current wallet separately.
2. **Aliases are presentation.** Human labels never replace stable authoritative IDs.
3. **Atomic amounts at API boundaries.** Decimal formatting belongs in presentation.
4. **Network and asset are explicit.** Never infer them silently for mutation.
5. **Freshness is visible.** Distinguish verified, stale, conflicting, unavailable, unauthorized, redacted, and unknown.
6. **Draft is not execution.** Brain prose, graph gestures, and generated prompts are proposals until deterministic tools act.
7. **Submitted is not confirmed.** Final state follows provider/on-chain evidence.
8. **No silent fallback.** Missing identity/wallet/policy state fails closed.
9. **Every mutation is auditable and idempotent where possible.**
10. **Both UIs use the same truth.** Never fork authoritative state merely to make a visualization easier.

# Roadmap synchronization rule

The canonical file is:

`nothinginfinity/agent-wallets-console/docs/X402_UNIFIED_PRODUCT_ROADMAP.md`

Mirrors should live at the same path in:

- `nothinginfinity/agent-universe`
- `nothinginfinity/x402-cairnstone`
- `nothinginfinity/x402-sub-agent-mcp`

When the cross-product roadmap changes:

1. edit the canonical file first;
2. review ordering and repository responsibilities;
3. copy the approved content to all three mirrors in the same bounded change;
4. create/re-stone each changed file under its repository chain;
5. link roadmap stones to the current canonical implementation/orientation HEAD with `documents` or `references` edges as appropriate;
6. do not set roadmap stones as repository-chain HEAD unless the roadmap itself becomes the repository's canonical orientation.

Local repo roadmaps may contain deeper implementation detail but should reference this unified roadmap and must not silently contradict its cross-repository responsibility boundaries.

# Immediate next bounded slice

Begin **Phase U0 + U1**, not direct Brain transaction execution.

1. Define the normalized shared read model against the now-authoritative Agent Context/wallet substrate.
2. Upgrade `agent-wallets-console` into the precision Cockpit using that model.
3. Add aliases, clear Agent vs Current Wallet presentation, activity ledger, search/filter, and live freshness/status.
4. In parallel, prepare `agent-universe` to consume the same read model and render a small live read-only Agent Cell fixture.
5. Design the BYOK Wallet Brain interface and tool boundary during U1, then implement read-only Brain capability in U2.

This ordering gets immediate operator relief while keeping the 1,000-wallet Universe and Wallet Brain on the same foundation from the beginning.
