# x402 DevFlow Local Overrides

This file specializes canonical AFO DevFlow for `x402-sub-agent-mcp`.
It strengthens repository-specific runtime, authorization, verification,
and CairnStone rules without replacing the canonical specification.

## Repository identity

```text
Repository: nothinginfinity/x402-sub-agent-mcp
Related repository: nothinginfinity/x402-balance-ledger-mock
Adopted DevFlow version: 0.1.0
Canonical DevFlow commit: 1f3d80786408b45e1406dc2c69cb990324f3ea53
Canonical DevFlow HEAD: 309f8256fed6d187736b17f966e8b33ca305bfd0e2e328c1a681f6bf2ca36722
CairnStone chain: x402-sub-agent-mcp
Canonical HEAD type: committed worker.js stone
Maintainer: Jared
Sensitive-capability approver: Jared
```

The sibling ledger has its own chain and runtime HEAD. Cross-repository work
must read both manifests, both exact Git trees, and the latest relevant
handoff before relying on shared behavior.

## Local workflow

```text
Branch policy: direct SHA-guarded patches to main are permitted for this personal testnet project
Pull-request policy: optional unless Jared requests review through a pull request
One-active-writer policy: one active writer per runtime file; parallel work is allowed on separate files or repositories
Work-ID format: short bounded identifiers such as OAUTH-S1-FOUNDATION or LEDGER-ATTRIBUTION-01
Commit-signature requirements: record Work-ID, contributor role, based-on runtime HEAD, reason, and honest status
Required orientation: adoption record -> local overrides -> affected manifests -> START HERE -> ROADMAP -> exact Git source and SHAs
```

Before every write, re-read the current branch commit and affected file SHA.
Use an expected-SHA or equivalent optimistic-concurrency guard. If a SHA
changed, stop, reread, and re-anchor rather than forcing a stale overwrite.

Documentation changes do not become runtime changes. Only a newly verified
`worker.js` revision may replace the `x402-sub-agent-mcp` chain HEAD. The
same rule applies to the sibling ledger chain. ROADMAP, DEVFLOW, local
overrides, migrations, reviews, verification reports, and handoffs must not
replace a runtime HEAD.

## Current runtime declarations

At adoption time:

```text
x402-sub-agent-mcp runtime HEAD: 2a338a5507ba2097c505031866f454114e2f8df0f3d2de6d75bff1aa0990f5f8
x402-balance-ledger-mock runtime HEAD: 5dff1811e05b309f2e187301aa1bf4f3ce0d419092ec8a61dcaa9855f150799f
```

These values are orientation anchors, not permanent constants. Always use the
current manifest rather than timestamps or this historical declaration when
they differ.

## OAuth and capability rollout

The existing static `MCP_AUTH_TOKEN` path is a compatibility boundary. OAuth
work is additive and must not remove, weaken, or silently change the static
bearer path used by Claude.

The rollout order is mandatory:

1. **Stage 1 — connectivity and read-only authorization.** Add metadata,
   authorization code flow, PKCE S256, required client registration,
   D1-backed one-time authorization and token state, expiration, revocation,
   and the `wallet:read` scope. Approved OAuth tools are limited to
   `subagent_status`, `circle_list_wallet_sets`, `circle_list_wallets`,
   `circle_get_wallet_balance`, and `circle_get_transaction`.
2. **Stage 2 — narrow testnet economic action.** Only after Stage 1 is
   live-verified, separately enable `circle_gasless_transfer` under
   `wallet:transfer:testnet`, apply the ROADMAP limits, and perform one
   approved small Base Sepolia transfer.
3. **Stage 3 — evidence and attribution.** Confirm Circle signing,
   facilitator submission, on-chain confirmation, gasless payer behavior,
   audit evidence, caller identity, and ledger spend attribution.
4. **Stage 4 — multi-agent economic loop.** Extend stable identities,
   wallets, budgets, spend attribution, and receipts to approved drivers.
5. **Stage 5 — credential rotation and hardening.** Rotate prototype
   credentials, review storage and logs, tighten limits, and establish the
   next security baseline after the multi-agent proof succeeds.

Stage 1 must not expose any transfer tool. `wallet:transfer:testnet` may exist
in the token model but maps to no callable tool until Stage 2 is separately
approved. OAuth must not expose `circle_transfer`, wallet creation, wallet
funding, payment-rule administration, coupon administration, pricing-tier
administration, internal-token administration, or settlement-asset
administration unless Jared later expands the scope in writing.

## OAuth subject and caller attribution

The privacy-preserving identifier design for Stage 1 is fixed before runtime
implementation:

- The authorization server creates one opaque 128-bit random subject for the
  local Jared user and stores its lowercase 32-character hexadecimal form in
  D1.
- The subject is not derived from a name, email address, wallet address,
  client ID, IP address, or device identifier.
- Access and refresh state refer to this opaque subject.
- Calls driven through ChatGPT use the ledger-compatible caller identifier
  `chatgpt:<oauth-subject>`.
- The subject portion contains no colon, keeping the stable
  `<driver>:<session-or-subject>` convention unambiguous.
- Dynamic OAuth clients do not receive a new human subject merely because
  their client IDs differ.
- Do not use the vague shared identifier `chatgpt-agent`.

## Validation and verification

Runtime changes require the layers relevant to the changed surface. Report
performed and unperformed layers separately.

```text
Required syntax check: node --check worker.js
Required bundle check: esbuild or the repository's current equivalent must bundle worker.js successfully
Required migration check: review exact SQL, apply to the intended D1 database, verify the resulting schema/state, and commit the matching migration file
Required deployment check: inspect the actual workflow run, jobs, and failed-step evidence rather than relying on a green commit indicator
Required source check: read back committed paths and blob SHAs and confirm no truncation or unintended file changes
Required live check: exercise the deployed route and authorization matrix affected by the change
Required graph check: create stones, use typed edges, preserve runtime HEAD rules, and verify the final manifest
```

Stage 1 verification must include:

- protected-resource and authorization-server metadata correctness;
- unauthenticated MCP calls rejected with correct authorization metadata;
- PKCE S256 required and plain/no challenge rejected;
- redirect URI and state validation;
- one-time authorization-code replay rejection;
- access-token storage, audience/resource binding, and expiration behavior;
- rotating refresh tokens and replay-family rejection;
- read-only scope enforcement across all five approved tools;
- denial of `circle_gasless_transfer` and every other non-read OAuth tool;
- static bearer regression across the existing Claude-compatible path;
- caller attribution passed to the ledger wherever Stage 1 invokes a
  ledger-aware path;
- workflow/deployment log inspection and direct live endpoint checks.

An economic-action stage additionally requires Circle evidence, facilitator
evidence, ledger attribution, and independent Base Sepolia confirmation.
Deployment success alone is never functional proof.

## Security and data boundaries

```text
Permitted environment: personal, single-operator, testnet-only
Restricted capabilities: mainnet, external multi-user authorization, public account creation, silent scope expansion, and real-customer custody
Required approvals: Jared must approve transfer enablement, mainnet work, external users, credential rotation timing, and any wider OAuth scope
Secret handling: never commit or return MCP_AUTH_TOKEN, Circle credentials, signing material, OAuth passwords, access tokens, or refresh tokens
One-time state: authorization codes, refresh-token families, revocations, and replay state belong in D1 rather than KV
Logging: log identifiers and outcomes needed for audit, but never raw secrets or bearer material
```

Credential rotation follows the successful multi-agent testnet proof. It does
not block the current architecture experiment, and it must not occur early in
a way that breaks the existing Claude connector before the cross-agent test is
complete.

## CairnStone relationships

- A new `worker.js` revision links to the prior same-file runtime HEAD with
  `supersedes` only after required verification passes.
- A migration or explanatory document links to the runtime it describes with
  `documents`.
- A review links with `reviews`; a targeted fix links with `patches`.
- Cross-repository relationships normally use `references` or `documents`.
- Never use cross-chain `supersedes` between unrelated runtime files.
- Re-read the manifest after linking and confirm the intended runtime HEAD.

## Local exceptions

No local rule removes canonical requirements for exact-source orientation,
provenance, concurrency protection, honest evidence reporting, handoff
continuity, or explicit HEAD selection.

Direct main-branch patches and same-contributor verification are permitted for
speed in this personal testnet phase. When the same contributor implements,
reviews, or verifies, the record must say so and must not imply independent
review.

## Local signature

```text
Work-ID: DEVFLOW-X402-ADOPT-01
Introduced-by: ChatGPT
Approved-by: Jared
Continued-from: x402 DEVFLOW stone 7549026fdc2ca8c00d3da5a22e2601b08a18b2bd028ffc8d846d2db878b2b5ed
Based-on-commit: bebcd4332173a82d4729804d3c8ea9d0addfa449
Based-on-HEAD: 2a338a5507ba2097c505031866f454114e2f8df0f3d2de6d75bff1aa0990f5f8
Reason: preserve x402-specific rules while adopting canonical AFO DevFlow 0.1.0
Status: committed; verification and CairnStone integration pending
```
