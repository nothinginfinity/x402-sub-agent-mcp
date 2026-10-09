# CairnStone Escrow — Programmable Agreements & Milestone Settlement

**Work-ID:** X402-ESCROW-20261009
**Status:** Proposed product track; specification only; no contract deployment or real-money authorization
**Canonical execution dependency:** existing unified x402 U-sequence remains unchanged; this is an adjacent E0–E5 track
**Initial use case:** 10-session coaching package, $1,500 USDC prepaid, $150 per approved session

## Product concept
Combine x402 HTTP payment experiences, gas-sponsored USDC funding authorizations, a dedicated smart-contract escrow / approved custody adapter, offchain signed milestone approvals, onchain release/refund receipts, and CairnStone agreement/evidence provenance.

The reference product is a prepaid coaching package. Future variants may support freelance deliverables, service agreements, and agent-to-agent work. The distinguishing property is **locked, verifiable, rule-bound funds**, not x402's ordinary instantaneous wallet-to-merchant payment.

## Design boundaries (proposed, not yet implementation-approved)
- **Protocol:** x402 is the payment interaction and/or facilitator layer, not a substitute for contract-based escrow. Evaluate the x402 batch-settlement/escrow-channel scheme against a purpose-built bilateral agreement vault before selecting code.
- **Funding:** initial deposit on Base Sepolia testnet USDC; for a custom vault atomically account for deposited funds under an exact agreement ID. Prefer in-contract `receiveWithAuthorization` where supported for EIP-3009 receive authorization rather than treating a standalone `transferWithAuthorization` to a vault address as sufficient accounting.
- **Release authorization:** distinguish a standard x402 direct token-transfer signature from a vault-specific milestone authorization. Compare typed-data EIP-712 approvals (agreement, milestone, amount, recipient, network/chain, contract, nonce, expiry) with properly scoped monotonic cumulative x402 vouchers.
- **Payment authority:** coach recording completion is evidence only, NEVER unilateral authority to withdraw. Exact agreed approval conditions, contested milestones, and timeouts are unresolved.
- **Vault invariants:** released + refunded + remaining = accounted funded principal (ignoring separately and explicitly tracked fees); no double release, refund replay, overpayment, destination redirection, or other cross-agreement spend.
- **Relaying and gas:** client may avoid holding native gas only if sponsor/relayer pays; sponsorship still costs someone gas. Minimize repeated dialogs only using expressly scoped authorization; no blanket spend authority.
- **Backend:** Cloudflare Workers coordinate agreements, signatures, status and indexed transactions. Contract/provider and onchain evidence—not D1, LLM prose, a UI click, or facilitator HTTP status—determine actual fund state.
- **Existing roles:** x402-sub-agent-mcp retains wallet identity, budget, permissions, policy, and signing orchestration; CairnStone retains immutable agreement/version/event evidence; Console or Hop Bar is human-facing UX; custody/escrow stays a separate reviewed contract/provider.
- **Production gates:** written security audit, jurisdiction-specific custody/escrow and money-transmission analysis, consumer protection and cancellation terms, AML/KYC/sanctions applicability, refunds, accounting, key management, and incident operations BEFORE any real third-party principal. A testnet-only self-operated pilot does not satisfy those gates.

## Reference accounting
Ten sessions at $150 each, funded with $1,500. If seven validly approved milestones release $1,050 to the coach, $450 remains locked or refundable subject to the agreed cancellation and dispute policy. No automatic payout from a coach's completion checkbox.

## Adjacent product roadmap
- **E0 — Architecture/specification.** Compare x402 batch-settlement channel vs custom bilateral vault, define agreement identity, deposit/voucher/claim interfaces, permissions, signature domain binding, and invariant/test matrix.
- **E1 — Funding.** Single-agreement Base Sepolia deposit with verified onchain accounting, duplicate/insufficient deposit tests, correct refund rights.
- **E2 — Milestones/refunds.** Per-session approvals, no replay or duplicate withdrawal, partial claims, failures, cancellation, and explicitly defined dispute fallback.
- **E3 — Evidence integration.** Workers, D1 indexed metadata, CairnStone agreement and tx receipts, reorg/failed transaction reconciliation, independent onchain verification.
- **E4 — Mobile UX.** Coach/client agreement view, funding, completed sessions, approval, refund, dispute state; iPhone acceptance gate.
- **E5 — Production readiness.** Independent smart-contract/security review, legal/custody/regulatory approvals, operational policies and limited pilot decision.

This is a roadmap addition only. No E-phase is authorized for production, and it must not reorder or block the existing U5.4 → U6 execution sequence.

## OPEN DECISION — disputes (next discussion)
**Unresolved; do not preselect a 7-day auto-release, platform arbiter, silence-as-consent, or unilateral cancel/refund policy.**

Questions to decide next:
1. Who supplies evidence that a coaching session happened, and what can a contract verify objectively?
2. Does every payout require client confirmation? If silent, what precisely happens and after what period?
3. What is the challenge/dispute window, who holds funds during challenge, and how is notice proved?
4. Who arbitrates: independent third party, multisig, preselected arbitrator, deterministic rule, or hybrid? How are conflicts of interest and unilateral platform drains prevented?
5. What prevents a dishonest coach claiming undelivered sessions, and a dishonest client withholding approved earned compensation?
6. How do cancellations, no-shows, illness, partially delivered work, compromised keys, and lost access affect payouts/refunds?
7. Which dispute semantics are native to any adopted x402 batch-settlement scheme, and which require separate escrow primitives?

**Next product discussion:** design dispute and cancellation policy before committing to E1/E2 contract choices.

## Related roadmap and provenance
- `nothinginfinity/x402-sub-agent-mcp/ROADMAP.md` — local product roadmap.
- `nothinginfinity/x402-sub-agent-mcp/docs/X402_UNIFIED_PRODUCT_ROADMAP.md` — unified roadmap mirror (claims canonical source is `nothinginfinity/agent-wallets-console/docs/X402_UNIFIED_PRODUCT_ROADMAP.md`).
- Accessible repository sources demonstrate live Base Sepolia x402 transfers and synthetic ledger reserve/commit/release; neither proves a real escrow vault.
- Canonical cross-repo roadmap currently not accessible through the connected GitHub integration. Synchronization with it and other mirrors remains outstanding.
