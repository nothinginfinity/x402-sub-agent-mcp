# Development Flow

This file defines how Jared and any human or software agent contribute to `x402-sub-agent-mcp` and its sibling repositories without losing continuity. It is optimized for iPhone-first development: small remote patches, fast live verification, and CairnStone-backed handoffs instead of desktop-only ceremony.

`ROADMAP.md` owns product direction, milestone order, shipped status, and deferred work. `DEVFLOW.md` owns the process used to move those milestones forward.

## Core principle

CairnStone is the persistent navigation layer. Git preserves exact source; CairnStone preserves compressed project memory, canonical runtime HEADs, handoffs, reviews, verification evidence, and graph relationships.

Files are not permanently owned by one contributor. Any agent may continue, revise, or correct work introduced by another agent. The requirement is a visible chain of custody:

```text
who introduced it
-> who modified or continued it
-> what canonical source state it began from
-> who reviewed or verified it
-> what became canonical
```

The process must remain adaptable. It should create enough order for safe continuation without slowing personal, testnet-only development.

## Roles

### Jared

Jared is the product owner and final decision-maker. He sets priorities, resolves architecture forks, approves sensitive capability expansion, and may reassign work between agents at any time.

### Contributors

A contributor may be Claude, ChatGPT, an AFO or Cloudflare subagent, a GitHub agent, another LLM, or a human collaborator.

Roles are assigned per bounded work item, not permanently:

- **Change owner:** currently preparing the design, patch, migration, or implementation.
- **Reviewer:** independently checks the proposed or completed work.
- **Continuation agent:** resumes interrupted work from recorded state.
- **Verifier:** checks source, deployment, live behavior, provider evidence, ledger evidence, or on-chain evidence.
- **Approver:** authorizes a stage, capability expansion, or sensitive deployment.

One contributor may perform more than one role when speed requires it. The record must state what actually occurred rather than implying an independent review that did not happen.

## Mobile-first loop

The normal development loop is:

```text
orient
-> define a bounded change
-> patch
-> validate
-> push or deploy when applicable
-> verify live
-> stone and link
-> hand off the exact next step
```

Prefer:

- small anchored patches over broad rewrites;
- exact GitHub file SHAs before patching;
- optimistic-concurrency guards when supported;
- automated syntax, bundle, and migration checks;
- immediate live endpoint checks after deployment;
- compact handoffs readable on an iPhone;
- manifests and runtime HEADs instead of reconstructing state from chat;
- explicit partial completion over pretending a long session finished.

Traditional local branches and pull requests may be used when helpful, but they are not prerequisites for personal testnet progress.

## Sources of truth

Different artifacts answer different questions:

- **GitHub file and commit:** exact source and exact diff.
- **CairnStone runtime HEAD:** canonical runtime file for a chain.
- **CairnStone graph:** relationships among implementations, migrations, reviews, documentation, patches, handoffs, and verification reports.
- **ROADMAP.md:** what is planned, shipped, deferred, or gated.
- **DEVFLOW.md:** how contributors coordinate and hand off work.
- **Migration files:** durable database schema history.
- **Live evidence:** actual deployed behavior; a green push alone is not proof.

Only the canonical runtime file, normally `worker.js`, becomes chain HEAD. ROADMAP, DEVFLOW, README, migration, review, verification, and handoff stones must not replace the runtime HEAD.

## Orientation before changing a repository

Before chain-scoped work, the active contributor should:

1. Read the CairnStone chain manifest for every affected repository.
2. Record each current runtime HEAD.
3. Read the latest relevant START HERE handoff.
4. Read the applicable ROADMAP and DEVFLOW sections.
5. Read the exact current GitHub files to be changed.
6. Confirm each current file SHA immediately before patching.
7. Check whether an active work item already covers the same file or scope.

Do not begin from a copied prompt or remembered snapshot when current source and graph state are available.

## Work items and state

Each meaningful change should have a short identifier, such as `OAUTH-S1-METADATA` or `LEDGER-TOOL-VALUE-01`.

Use one of these states:

- `AVAILABLE` — defined but not currently being edited.
- `ACTIVE` — a named contributor is the current change owner.
- `WAITING_FOR_REVIEW` — implementation exists and review is requested.
- `READY_FOR_JARED` — requested review is complete and Jared's decision or approval is next.
- `VERIFIED` — required evidence passed and project records were updated.
- `BLOCKED` — progress stopped on a named dependency or failure.
- `TRANSFERRED` — the previous owner intentionally handed the work to another contributor.

These labels coordinate work; they are not permanent locks. Jared may override them, and interrupted work may be taken over through the continuation procedure.

## Minimal work record

A work item should be short enough to read and update from a phone:

```text
Work-ID: OAUTH-S1-METADATA
State: ACTIVE
Owner: Claude
Reviewer: ChatGPT
Repos: x402-sub-agent-mcp
Files: worker.js, migrations/0004_oauth.sql
Based-on-HEAD: 2a338a5507ba...
Objective: OAuth discovery and read-only authorization foundation
Non-goals: transfer scope, mainnet, removal of MCP_AUTH_TOKEN
Next-check: metadata curl matrix
```

This may live in a handoff stone, task stone, commit message, or compact project note. A permanent new file is not required for every small patch.

## Change signatures

Every meaningful commit, implementation stone, review stone, or handoff should carry a compact semantic signature. Git already records who committed bytes; this records project roles and continuity.

Recommended fields:

```text
Work-ID: OAUTH-S1-METADATA
Introduced-by: Claude
Modified-by: ChatGPT
Reviewed-by: Claude
Approved-by: Jared
Continued-from: Claude / prior commit or stone hash
Based-on-HEAD: 2a338a5507ba...
Reason: complete OAuth metadata and scope mapping
Status: live-verified
```

Rules:

- Omit fields that do not apply rather than inventing participation.
- `Introduced-by` names the contributor that first created the relevant design or implementation.
- `Modified-by` may be repeated when later contributors materially change it.
- `Continued-from` records a takeover or context-limit handoff.
- `Reviewed-by` means an actual review occurred; it is not automatic.
- `Approved-by` is used only when Jared explicitly approved the relevant decision or stage.
- `Status` must distinguish planned, patched, deployed, and live-verified.
- Use stable contributor labels. Do not rely on vague labels such as `AI`.

Do not add large authorship headers throughout runtime source. Prefer commit messages, stones, edge notes, work records, and document footers. A nearby code comment is appropriate only when it explains a non-obvious architectural decision, not merely authorship.

## Editing another contributor's work

Editing another contributor's work is normal and permitted.

Before doing so:

1. Read the current chain manifest and exact latest GitHub file.
2. Identify the commit or stone being continued or modified.
3. Patch against the latest file SHA, not a cached copy.
4. Record `Modified-by` or `Continued-from` in the resulting commit or stone.
5. State whether earlier behavior was preserved, replaced, or corrected.
6. Link a new version of the same runtime file with `supersedes`.
7. Use `patches` when a fix specifically addresses a documented problem.

The original contributor remains visible through Git and prior stones. The later contributor becomes visible through the new commit, stone author, and edge note.

## Context-limit and interruption recovery

When a contributor is nearing a context or token limit, leave a compact handoff containing:

- Work-ID and state.
- Current chain HEADs.
- Exact Git commit and file SHAs.
- Files changed and files not yet changed.
- Validation already completed.
- Known failures or uncertain behavior.
- Exact next operation.
- Explicit non-goals that remain in force.

When no handoff was possible, the continuation agent may reconstruct state from GitHub, CairnStone manifests, latest stones, deployment logs, and live behavior. Mark that record:

```text
Continuation-mode: reconstructed-after-interruption
```

Never assume an uncommitted or undescribed change exists. Continue from the latest verifiable source state.

## Parallel work and conflicts

Parallel work is encouraged across different files, repositories, or clearly separated modules.

For the same file:

- Prefer one active writer at a time.
- A second contributor may take over when the first is blocked, interrupted, or explicitly hands off.
- Read the newest SHA immediately before applying a patch.
- Use expected-SHA checks when supported.
- If the SHA changed, reread and re-anchor; do not force a stale overwrite.
- Record every material contributor in the semantic change signature.

If two valid versions were produced, preserve both long enough to compare. Choose the canonical version through review and live evidence, then connect the accepted runtime stone to the prior canonical runtime with `supersedes`. Do not use timestamps alone to decide which is current.

## Review and verification

A review reports real findings, not raw heuristic flag counts.

For runtime changes, state which layers were checked:

- exact source pushed;
- syntax or parser validation;
- bundle validation;
- migration application;
- deployment logs;
- live endpoint behavior;
- static bearer regression;
- OAuth scope behavior;
- Circle or facilitator response;
- ledger attribution;
- independent blockchain confirmation;
- CairnStone links and HEAD correctness.

A successful tool call, commit, workflow, or deploy is not enough by itself. Unverified layers must be stated explicitly.

For documentation-only changes, verify exact committed content and graph relationships. Do not imply runtime behavior changed.

## CairnStone recording rules

After meaningful work:

1. Create a stone for each materially changed file or report.
2. Use the correct chain.
3. Link a new version of a file to its prior same-file version with `supersedes`.
4. Link migrations or documentation to the runtime they describe with `documents`.
5. Link reviews with `reviews`.
6. Link targeted fixes with `patches`.
7. Use `references` only when no more specific edge applies.
8. Set HEAD only when a new canonical runtime file was created.
9. Create or update the START HERE handoff after a substantial session or whenever continuation risk is high.

Before linking, confirm both hashes represent the intended files and chains. Cross-chain references are valid; cross-chain `supersedes` edges between unrelated runtime files are not.

## Prototype security posture

The present phase is personal, single-operator, testnet-only development. Speed and proving the multi-agent economic loop take priority over production credential ceremony. Credential rotation and tighter controls are a planned graduation stage after ChatGPT, Claude, and other agents can perform and attribute testnet transactions.

This does not authorize mainnet activity, external counterparties, or silent scope expansion. Existing ROADMAP gates still apply. Secrets must not be committed to GitHub source.

## Current collaboration sequence

For V1.4.5 and the first ChatGPT economic-action proof:

1. **ChatGPT OAuth connectivity** — metadata, PKCE authorization-code flow, single-user authorization, D1 token state, and preservation of the existing static bearer path.
2. **ChatGPT read-only proof** — authenticate and call the five approved `wallet:read` tools.
3. **ChatGPT testnet economic-action proof** — separately enable only `circle_gasless_transfer` under `wallet:transfer:testnet`, perform the approved small test transfer, and verify attribution.
4. **Multi-agent economic loop** — add stable caller identities, budgets, tool-spend attribution, and receipts for each participating driver or agent.
5. **Credential rotation and hardening** — rotate prototype credentials, review token storage and logs, tighten limits, and establish the next security baseline after the loop works.

The active owner and reviewer for each stage are recorded in its work item; they are not permanently assigned here.

## Document signature

```text
Work-ID: DEVFLOW-01
Introduced-by: ChatGPT
Approved-by: Jared
Based-on-HEAD: 2a338a5507ba...
Reason: establish agent-neutral, mobile-first continuity and provenance rules
Status: documentation committed; runtime unchanged
```
