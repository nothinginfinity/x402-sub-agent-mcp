# R&D Evidence Roadmap

**Status:** Design roadmap only — no implementation started.

**Dependency rule:** This roadmap is adjacent to, not a replacement for, the canonical x402 unified product roadmap. It must not delay or silently reorder the current U5.4 → U6 x402 execution sequence unless explicitly approved later.

**Architecture:** `docs/RD_EVIDENCE_ARCHITECTURE.md`

**Research date:** 2026-09-05

## Mission

Build a source-grounded evidence system that continuously converts real engineering activity into a reviewable, immutable R&D evidence graph for professional evaluation of:

- IRC section 41 research-credit positions;
- Form 6765 business-component reporting, including current Section G structure;
- domestic R&E support under section 174A;
- audit/refund-claim substantiation packages.

The product must increase evidence quality and reduce reconstruction effort without representing itself as a tax advisor or automatic eligibility engine.

## Non-negotiable product boundaries

1. **Evidence, not entitlement.** The software never guarantees that a company, project, person, or expense qualifies for a credit or deduction.
2. **Professional approval required.** Candidate classifications become claim-ready only after identified reviewer approval.
3. **Source-grounded prose only.** Generated narratives must cite source evidence; unsupported LLM narrative is not evidence.
4. **No manufactured activity.** Never create fake tests, testnet transfers, work logs, or experimental records for the purpose of increasing a tax position.
5. **Accounting remains external authority.** Payroll/AP/general-ledger systems remain authoritative for monetary amounts.
6. **x402 remains execution/policy infrastructure.** The evidence layer reads receipts/events; it does not turn `x402-sub-agent-mcp` into a tax or accounting system.
7. **Section 174A and section 41 remain separate determinations.** Domestic software-development R&E treatment must not be conflated with research-credit qualification.
8. **Form versions are explicit.** IRS schema/mapping is versioned and cannot silently drift.
9. **History is append-only.** Reclassifications and corrections supersede prior review decisions/snapshots rather than deleting them.
10. **PII is not graph decoration.** EINs, payroll data, employee information, invoices, and secrets require protected storage and scoped access.

# Delivery sequence

## R0 — Research specification and evidence contract

**Status: current slice.**

Goal: freeze a safe evidence model before writing runtime code.

Deliverables:

- architecture document defining product boundary and domain objects;
- Form 6765 Section G mapping based on current IRS instructions;
- four-part-test evidence dimensions applied separately per business component;
- section 174A vs section 41 separation;
- candidate/reviewed classification states;
- immutable evidence/snapshot semantics;
- source connector inventory;
- security/privacy requirements;
- staged implementation roadmap.

Exit condition:

- design is explicit enough that implementation cannot accidentally become an automatic tax-eligibility engine;
- current IRS source/version references are recorded;
- no production code or database migration has been written.

## R0.1 — Canonical evidence schemas

Goal: define machine contracts without connecting live customer data.

Create versioned JSON schemas for:

- `rd-tax-entity-v1`
- `rd-business-component-v1`
- `rd-research-question-v1`
- `rd-experiment-episode-v1`
- `rd-evidence-source-v1`
- `rd-person-activity-v1`
- `rd-expense-record-v1`
- `rd-qre-candidate-allocation-v1`
- `rd-review-decision-v1`
- `rd-evidence-snapshot-v1`

Required design properties:

- stable IDs;
- explicit tax-year scope;
- immutable source identities;
- no raw secrets;
- reviewer identity/provenance;
- `candidate` vs `reviewed_approved` separation;
- authority/version metadata for any IRS mapping;
- idempotency keys for every imported source event.

Acceptance:

- deterministic schema validation tests;
- fixture corpus containing success, failure, ambiguity, foreign/domestic split, and reclassification cases;
- no network connectors yet.

## R0.2 — Read-only engineering evidence ingestion

Goal: prove continuous evidence capture from engineering systems without any cost/tax classification automation.

Initial connectors:

1. GitHub commits/PRs/reviews/issues/releases;
2. GitHub Actions / CI runs, jobs, and test/benchmark outcomes;
3. CairnStone stones/refs/edges/HEAD and source provenance;
4. x402 read-only usage/receipt projection;
5. optional cloud/model execution receipts where source identity is stable.

Build:

- connector cursor/checkpoint model;
- immutable `evidence_source` records;
- content/hash identity;
- deduplication;
- source deletion/drift handling without erasing prior captured evidence;
- provenance links back to exact source artifacts.

Acceptance:

- re-import is idempotent;
- source hashes match originals;
- failure/partial-import state is visible;
- no connector can mutate GitHub, CairnStone accepted state, x402 policy, or source systems through this ingestion path.

## R0.3 — Business Component + Experiment Graph

Goal: turn raw evidence into a human-reviewable research timeline.

Build:

- business-component register;
- project/repo/workspace → component mapping;
- research-question records;
- experiment-episode grouping;
- alternatives/hypothesis/result fields;
- links to commits, tests, benchmarks, agent/tool calls, failures, and decisions;
- reconstruction marker for narratives entered after the fact;
- reviewer editing without rewriting source evidence.

AI use in this phase:

- may propose component/experiment grouping;
- may summarize cited evidence;
- must label proposals as unreviewed;
- must not determine tax qualification.

Acceptance:

- one real internal software project can be reconstructed into a component/experiment graph;
- every summary sentence can trace to evidence;
- failed experiments are preserved rather than filtered out;
- a reviewer can split/merge proposed episodes without losing source lineage.

## R0.4 — Activity and Cost Attribution

Goal: connect engineering evidence to source-of-truth accounting records while keeping monetary authority external.

Candidate connectors:

- payroll/HR export or API;
- contractor/AP invoices;
- general-ledger R&E accounts;
- approved cloud/compute invoices;
- x402/model/tool costs as supporting operational cost evidence where economically real and accounting-reconciled.

Build:

- person/activity mapping;
- actual conduct / direct supervision / direct support categories;
- expense source import;
- allocation methodology records;
- `qre_candidate_allocation` proposals;
- domestic/foreign activity split evidence;
- reconciliation back to source ledger totals.

Important boundary:

- testnet token amounts are not economic expense records;
- model/tool/x402 spend is not automatically a Form 6765 QRE merely because it supported an experiment;
- only approved accounting values can enter tax-form previews.

Acceptance:

- every candidate dollar reconciles to an imported source amount;
- allocations cannot exceed source expense totals;
- rejected/reclassified allocations remain auditable;
- reviewer can identify the evidence basis for each allocation.

## R0.5 — Four-Part-Test Review Workspace

Goal: make professional review faster without automating the legal conclusion.

For each business component present four independent evidence panes:

1. domestic R&E / section 174A nexus;
2. technological-in-nature evidence;
3. new/improved business-component / permitted-purpose evidence;
4. process-of-experimentation evidence.

Build:

- evidence completeness checklist;
- contradiction/gap detection;
- source citation viewer;
- reviewer notes;
- explicit approve/reject/questioned decision;
- review version and supersession;
- optional exclusion flags requiring reviewer disposition.

Acceptance:

- system refuses to mark a component claim-ready without reviewer identity;
- a model cannot elevate its own recommendation into an approved decision;
- every decision is tied to tax year, methodology version, and evidence snapshot.

## R0.6 — Form 6765 Section G Preview

Goal: project reviewed source data into the current IRS business-component reporting structure.

Implement a versioned adapter for the December 2025 Form 6765 instructions covering:

- 49(a) entity EIN reference;
- 49(b) PBA code;
- 49(c) stable business-component ID/name;
- 49(d) type;
- 49(e) software type where applicable;
- 49(f) amended-return support path when applicable;
- 50 actual-conduct wages;
- 51 direct-supervision wages;
- 52 direct-support wages;
- 53 total wages;
- 54 supplies;
- 55 qualifying computer rental/lease;
- 56 applicable contract research;
- 80%/Top-50 ordering and aggregate remainder.

The output is always labeled `PREVIEW / PROFESSIONAL REVIEW REQUIRED` until exported through an approved review flow.

Acceptance:

- deterministic totals;
- 80%/Top-50 logic tested at boundaries;
- aggregate row tested;
- form projection exactly reconciles to approved allocations;
- schema mapping identifies the IRS instruction revision used.

## R0.7 — Section 174A Evidence Schedule

Goal: support domestic R&E documentation separately from research-credit qualification.

Build:

- domestic vs foreign R&E evidence;
- software-development source evidence;
- current-year source costs;
- method/election metadata supplied by tax professional/accounting system;
- transition-data import where applicable;
- reconciliation to books.

Do not calculate or choose a tax accounting method automatically.

Acceptance:

- section 174A schedule can include costs that are not approved section 41 QREs;
- the UI makes that distinction obvious;
- no foreign research cost is silently included as domestic.

## R0.8 — CPA / Audit Evidence Package

Goal: export a defensible, reproducible review package.

Package contents:

- immutable snapshot manifest;
- business-component register;
- experiment ledger;
- cited factual narratives;
- reviewer decisions;
- approved cost allocations;
- Form 6765 Section G preview;
- section 174A evidence schedule;
- source-artifact index;
- hash manifest;
- external-authority/version references.

Formats:

- human-readable PDF/HTML binder later;
- JSON canonical export;
- CSV worksheets for tax professionals;
- source manifest suitable for long-term archival.

Acceptance:

- another authorized reviewer can reproduce every reported amount and factual claim from the snapshot;
- package generation does not depend on mutable `main` branches or latest-state assumptions.

## R0.9 — Internal Historical Pilot

Goal: validate the product against a real historical engineering project before onboarding external companies.

Candidate internal pilot:

- one bounded x402/CairnStone engineering slice with rich Git, CI, CairnStone, tool-call, failure, and acceptance evidence.

Process:

1. choose one tax year/project slice;
2. ingest only already-existing real activity;
3. form proposed business components and experiment episodes;
4. import/reconcile real accounting data only if authorized;
5. have an independent CPA/tax professional review the evidence model and outputs;
6. record gaps, false positives, and missing source classes;
7. revise schemas before external beta.

No claim should be filed solely because the pilot system says a component is supported.

## R1.0 — Advisor Beta

Goal: allow tax professionals to use the system as evidence-review infrastructure for a small number of consenting businesses.

Required before beta:

- tenant isolation;
- reviewer RBAC;
- protected PII/tax-ID storage;
- audit log;
- retention/deletion/legal-hold model;
- connector authorization lifecycle;
- export access controls;
- incident response process;
- documented limitation language;
- professional-advisor feedback incorporated from R0.9.

Product UX:

- company dashboard;
- business-component register;
- evidence inbox;
- experiment timeline;
- cost reconciliation;
- four-part-test review workspace;
- form preview;
- immutable close snapshot.

## R1.1 — Continuous Evidence Mode

Goal: move from year-end reconstruction to continuous capture.

Build:

- background connector sync;
- weekly/monthly evidence review queue;
- prompts for missing contemporaneous uncertainty/experiment context;
- drift detection when project/component structure changes;
- period-close workflow;
- source-retention monitoring.

Important UX principle:

Prompts should ask users to document what actually occurred, not coach them to manufacture tax-credit language.

## R1.2 — AI-Native R&D Provenance

Goal: make agentic software development legible to finance/tax reviewers.

Add first-class support for:

- model/provider identity;
- tool/subagent invocation lineage;
- prompt/request hash or approved redacted representation;
- execution environment/config identity;
- benchmark/test results;
- agent-generated alternatives;
- human approval/override;
- model/compute cost receipts;
- resulting commits/PRs;
- failed/retried execution lineage.

This is the long-term differentiation: preserve the experimental lineage of human + AI engineering instead of treating the final commit as the only artifact.

## R1.3 — Multi-Entity / Controlled-Group Support

Goal: support companies with multiple entities and the reporting complexity reflected in current Form 6765 instructions.

Build only after advisor validation:

- controlled-group entity model;
- component ownership by reporting entity;
- group-level QRE ranking support;
- member-level separate-return projections;
- transfer/reorganization/acquisition metadata where required;
- strict prevention of cross-entity double counting.

## R2 — Evidence Network / Interoperability

Longer-term possibilities after production trust is established:

- accountant/tax-provider APIs;
- signed evidence attestations;
- auditor-verifiable snapshot manifests;
- interoperable research-evidence schemas;
- read-only connectors into project-management and observability systems;
- x402-payable specialist review tools or subagents, while retaining human tax-position authority.

This phase should not be planned in detail until R1 advisor usage proves the evidence model.

# Immediate next bounded engineering slice

**Do not start runtime implementation yet.**

The next approved work after this design is reviewed should be **R0.1 — Canonical evidence schemas** only.

R0.1 should:

1. add versioned JSON schemas and synthetic fixtures;
2. contain zero customer data;
3. contain zero tax-eligibility model logic;
4. contain zero live connectors;
5. include deterministic validation tests;
6. explicitly encode candidate vs professional-approved status;
7. encode authority/version metadata for Form 6765 mappings;
8. be stoned and reviewed before R0.2 ingestion work begins.

# Current IRS assumptions to re-check before any Form adapter ships

Before implementing R0.6, re-fetch current IRS authority and confirm at minimum:

- whether the December 2025 Form 6765 instructions remain current;
- Section G filing requirements/exceptions for the target tax year;
- 80%/Top-50 rule;
- columns 49(a)–(f), 50–56;
- software categories and internal-use-software rules;
- amended-return claim-information requirements;
- any section 174A guidance or transition changes;
- qualified-small-business payroll-tax-credit limits and eligibility rules if surfaced in product UI.

No hard-coded legal/tax rule should be treated as timeless.
