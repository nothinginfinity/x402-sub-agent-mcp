# CairnStone Accord — Voluntary AI Negotiation & Settlement

**Work-ID:** X402-ACCORD-DESIGN-20261009
**Status:** Proposed product / roadmap design; not implemented, deployed, audited, or legally approved
**Parent track:** CairnStone Escrow (E0–E5)
**Product principle:** AI can argue, explain, negotiate, and propose. Humans authorize the settlement. Deterministic payment infrastructure executes it.
**Initial test:** 10-session coaching escrow package; one contested $150 session on Base Sepolia testnet.

## Product thesis

Low-value disagreements rarely justify conventional adjudication costs. Two parties can each delegate *argument and drafting* to a selected LLM (ChatGPT, Claude, Grok, BYOK, etc.), exchange bounded, evidence-grounded proposals, and voluntarily agree on an exact micro-refund, payout reduction, service credit, extra payment, or contract amendment. Both parties retain freedom to reject without AI-imposed payment consequences. A proposed settlement is neither an adjudication nor automatic authority to transfer USDC.

This engine is potentially valuable **beyond escrow**: freelance deliverables, microcontracts, B2B service adjustments, paid-agent work, and consensual price renegotiation. Escrow is one adapter, not the total product definition. Avoid claiming all disputes are resolvable for pennies until inference, relaying, fraud, support, and operational costs are measured.

## Example (illustrative, not a rule)

- Original: 60-minute coaching session, $150.00, funded through escrow.
- Client alleges late arrival, requests a $15 credit.
- Trainer asserts an additional 10 minutes of service, requests $10 extra.
- AI agents analyze the same immutable terms and the evidence each is permitted to share; they exchange a maximum of three rounds of bounded counteroffers.
- Hypothetical mutually accepted compromise: $12 lateness credit and $10 additional-time adjustment; effective earned payment **$148.00**. Depending on funding and contract rules, $148 pays the trainer and $2 remains for the client.
- Both humans review the exact settlement and independently approve it. The agreement is encoded as a typed, replay-protected authorization; a separate deterministic money path performs and reconciles settlement.
- If added service would take payment above deposited funds, a fresh, narrowly scoped top-up/authorization is needed. The client's unrelated wallet balance must never be implicitly pulled.

## Roles and trust boundaries

1. **Client agent:** pursues the client's chosen goals, price boundaries, and privacy preferences. It cannot settle or spend merely by advocating.
2. **Provider agent:** pursues the provider's chosen goals and bounded counteroffer instructions. It cannot withdraw escrow unilaterally.
3. **Optional neutral evaluator:** summarizes evidence, flags inconsistent claims and possible fairness considerations. It is advisory, not a judge, legal authority, or payment signer.
4. **Accord protocol coordinator:** validates participants, agreement version, evidence references, round/fee ceilings, proposal structure, expiry, anti-replay and bounded negotiation lifecycle. LLM outputs are untrusted proposals.
5. **Acceptance authority:** initially EACH human expressly approves the same exact final settlement terms. Later delegated *bounded* consent (e.g., at most a $5 credit per specific agreement) requires separate policy, user approval, risk analysis, a revocation model, and proof that budgets cannot compound beyond the agreed limit.
6. **Settlement adapter:** escrow vault for locked funds, x402 for suitable direct/additional payments, or another explicitly authorized payment provider. x402 HTTP pay-per-request/signatures do not automatically authorize vault withdrawals.
7. **CairnStone provenance:** links immutable original agreement/version, submissions, permitted evidence, negotiation transcript summary, candidates, acceptance fingerprints, economic effects, transaction receipts, and any subsequent corrections. Keep private testimony scoped; never make confidential facts public by merely creating a stone.

## Proposed deterministic state machine (subject to design review)

`agreement_active → dispute_opened → negotiation_invited → negotiating → proposed → awaiting_both_acceptances → accepted → settlement_pending → settled_reconciled`.

Other terminal or holding paths: `declined`, `expired`, `withdrawn`, `negotiation_failed`, `disputed_hold`, `manual_resolution`. A one-party signature never enters `accepted`. Proposal edits invalidate prior acceptances. Concurrent proposal revisions require exact-version compare-and-swap; replay cannot move funds twice. Settlement success requires independent chain/provider evidence.

**No deal is not a deal:** reject/expiry/silence must not create AI-determined default liability, automatic award, or unilateral refund. The original contract's independently agreed default/dispute fallback remains authoritative, and a fair finite off-ramp for indefinite escrow deadlock still needs design.

## Negotiation protocol MVP

- Mutual opt-in to use AI negotiation for this agreement or dispute, with agent role and model choice disclosed.
- Verify agreement ID, parties, session ID, source of funds, and original monetary terms against authoritative records.
- Permit each side to submit a claim, redacted evidence, requested adjustment, and constraints.
- Provide evidence classifications: agreed fact, party allegation, independently verifiable claim, unverified context. LLM cannot silently transform allegations into facts.
- Maximum three alternating offer rounds initially, bounded tokens/inference budget and an observable fee cap. Agents may opt out at any time.
- Standard offer schema: `agreement_id, proposal_id, version, milestone_id, adjustment_components[], net_atomic_amount, currency, network, payee, payer/refund_destination, funding_sources, expiry, evidence_refs[], rationale_hash`.
- Render one side-by-side human-readable statement of before/after economics; disallow misleading copy, hidden side transfers, unilateral fee deductions, opaque netting, or acceptance of different versions.
- Require each party's own authenticated approval of exact proposal hash with explicit authorization scope, independent of the LLM provider. If signing EIP-712, bind chain ID, verifying contract, parties, agreement ID, nonce, expiry, atomic amounts, and destinations; keep consent receipts.
- If both agree, request a deterministic preview + guarded execution; remain `settlement_pending` until network/provider state reconciles. Never claim payment complete because a model says so.
- Build simulation first without any real settlement. Then execute on Base Sepolia with two self-controlled test identities, zero real customer deposits.

## Monetization research

Possible flat per-dispute facilitation fee, sponsored/free trials, or bounded x402 metered agent reasoning. Avoid charging incentives that encourage long arguments or higher awards. Measure model token cost, dispute complexity, facilitator gas costs, abuse patterns, conversion to mutual acceptance, and a minimum dispute value where AI mediation makes economic sense. A self-settlement agreement can have no platform fee in the prototype.

## Threat model and constraints

- Model hallucinations, fabricated evidence, biased phrasing, deliberately manipulative negotiation, adversarial prompt injection in submitted evidence, collusion, undisclosed model routing, model impersonation, private information leakage, and consent fatigue.
- Counterparty identity spoofing, wallet/address substitution, double-spend/double-refund, expired credentials, stale agreement terms, unauthorized deductions, negative escrow balances, one-party abandonment, timeouts, chain reorganizations, relayer/facilitator outages, compromised signing authority.
- Never label the AI 'binding arbitration', 'court', or an independent adjudicator merely because models debated. Voluntary settlement enforceability is jurisdiction- and context-dependent; legal/consumer rights and required dispute processes cannot be waived simply by UI text.
- A neutral-model opinion is evidence of advice only. A signed human-authorized contract amendment remains distinct from whether a court would enforce it.
- Encryption/retention/privacy policy required before accepting identifiable service-client records; CairnStone stones should not publish unredacted allegations by default.
- Real money, third-party custody, or external launch remain behind existing security, audit, escrow/custody, and legal/compliance gates.

## Adjacent phased roadmap: A0–A5

- **A0 — Negotiation contract & bounded authority:** exact parties, agent roles, offer schema, evidence classes, consent and rejection, security/fee limits, legal framing, cancellation/no-deal fallback. Determine relationship with E0 vault/channel architecture.
- **A1 — Offchain two-agent simulator:** redacted coaching disagreement fixture, three-round proposal engine, no funds moved, immutable offer/revision records; replay and prompt-injection tests.
- **A2 — Dual-acceptance engine:** deterministic proposal hash/version, explicit human consent on both sides, rejection/expiry and preview-only economic effect; independent tests for mismatched hashes and edits.
- **A3 — Testnet settlement adapter:** settlement of mutually signed refund/adjustment on Base Sepolia, refund/payout conservation, optional separately approved extra top-up, onchain proof and retry/reorg reconciliation.
- **A4 — Mobile Hop Card/Console UX:** agent debate viewer, selectable model/BYOK, evidence and fee controls, compare offers, accept/decline, receipt inspect, owner iPhone tests.
- **A5 — Operational pilot criteria:** measure economics and fairness, third-party security review, contract and consumer protections, consent evidence, fallback provider and privacy/retention, controlled external launch decision.

This proposed Accord track is **adjacent to** CairnStone Escrow and does not reorder the unified U5.4 → U6 wallet execution sequence. A0–A2 can be prototyped without money movement once separately scoped; A3 and later need explicit gates.

## Unresolved design choices (do not encode defaults yet)

1. How are model preferences disclosed and one-sided manipulation prevented? Is there a neutral evaluator at all?
2. What are the maximum rounds, fees, settlement amount, per-dispute rate limiting, and fallback when models or parties disagree?
3. Does the original contract permit a dispute hold or must session approval remain outstanding; what are contractual deadlines and the external resolution mechanism?
4. Is a future tightly bounded delegated agent acceptance viable? V0 defaults to **two explicit human approvals**, not autonomous binding consent.
5. What liability and legal characterization apply to an accepted settlement vs recommendations?
6. What is the minimum testnet and security evidence before autonomous-agent counterparties are introduced?
7. How do privacy, evidence access, redaction and storage lifetimes work across different model providers?

## Relationship and provenance

Parent: `docs/X402_ESCROW_MILESTONE_SETTLEMENT_PROPOSAL.md` (E0–E5)
Roadmap registration: `ROADMAP.md` in `nothinginfinity/x402-sub-agent-mcp`.
CairnStone chain: `x402-escrow`; HEAD previously `8957fdab4198fb7c19cb581821e48286bf71ffa23d619898f54d585a968d1efa`.
Unified coordination file's declared canonical source is in `nothinginfinity/agent-wallets-console`; sync only when source is accessible and authoritative, do not silently alter execution order.
