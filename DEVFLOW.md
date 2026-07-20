# DevFlow Adoption

This repository adopts canonical AFO DevFlow rather than carrying a full
project-local copy of the shared specification.

```text
Canonical specification: https://github.com/nothinginfinity/afo-devflow/blob/1f3d80786408b45e1406dc2c69cb990324f3ea53/DEVFLOW.md
Version: 0.1.0
Canonical commit: 1f3d80786408b45e1406dc2c69cb990324f3ea53
Canonical file blob: ba38b3ce2f2a4674383dd68eb891f7a1389eb919
CairnStone chain: afo-devflow
Canonical HEAD: 309f8256fed6d187736b17f966e8b33ca305bfd0e2e328c1a681f6bf2ca36722
Canonical HEAD type: committed DEVFLOW.md specification stone
Adopted-by: nothinginfinity/x402-sub-agent-mcp
Implemented-by: ChatGPT
Status: active
Local overrides: DEVFLOW.local.md
```

## Adoption scope

This record governs development, review, verification, handoff, GitHub,
Cloudflare, and CairnStone work in `nothinginfinity/x402-sub-agent-mcp`.
When a work item also touches `nothinginfinity/x402-balance-ledger-mock`, its
own current Git source, chain manifest, runtime HEAD, migrations, and handoffs
must be read in addition to this repository's records.

## Orientation order

1. Read this adoption record.
2. Read canonical AFO DevFlow `0.1.0` at the pinned commit above.
3. Read [`DEVFLOW.local.md`](./DEVFLOW.local.md).
4. Read the affected CairnStone chain manifests and explicit HEADs.
5. Read the latest relevant START HERE handoff.
6. Read [`ROADMAP.md`](./ROADMAP.md) and applicable architecture or migration
   records.
7. Read exact current Git files and confirm their SHAs immediately before any
   write.

## Source responsibilities

- Canonical AFO DevFlow defines shared contribution and continuity rules.
- `DEVFLOW.local.md` specializes and strengthens those rules for x402's
  testnet, OAuth, runtime-HEAD, verification, attribution, and security
  boundaries.
- `ROADMAP.md` owns product direction, milestone order, approved capability
  scope, shipped status, and deferred work.
- Git owns exact source bytes and commit history.
- CairnStone owns explicit canonical HEAD selection and typed relationships.
- Live, provider, ledger, database, and on-chain evidence own claims about
  actual runtime behavior.

Only a verified `worker.js` stone may become the runtime HEAD for the
`x402-sub-agent-mcp` chain. This adoption record and its local override are
documentation artifacts and must not replace the runtime HEAD.

## Exceptions

No exception removes canonical requirements for exact-source orientation,
provenance, optimistic concurrency, honest evidence reporting, handoff
continuity, or explicit CairnStone HEAD selection.

Repository-specific direct-main development, authorization rollout order,
security boundaries, test matrices, and runtime artifact rules are recorded
in `DEVFLOW.local.md`.

## Adoption signature

```text
Work-ID: DEVFLOW-X402-ADOPT-01
Introduced-by: ChatGPT
Modified-by: ChatGPT
Approved-by: Jared
Continued-from: x402 DEVFLOW stone 7549026fdc2ca8c00d3da5a22e2601b08a18b2bd028ffc8d846d2db878b2b5ed
Based-on-commit: a3beb3c137e0eeb876090e3dab89f58f15f9e46b
Based-on-HEAD: 2a338a5507ba2097c505031866f454114e2f8df0f3d2de6d75bff1aa0990f5f8
Reason: adopt canonical AFO DevFlow 0.1.0 and move x402-specific rules into DEVFLOW.local.md
Status: committed; exact-content and CairnStone verification pending
```
