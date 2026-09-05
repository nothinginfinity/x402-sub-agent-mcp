# R&D Evidence Architecture

**Status:** Design-only adjacent product architecture. No runtime implementation is authorized by this document.

**Repository relationship:** This design is documented in `x402-sub-agent-mcp` because the existing x402 policy/receipt plane is an important evidence source. The evidence product itself must remain a separate logical layer and must not turn this Worker into a tax engine, tax preparer, wallet, custodian, payroll system, or accounting system.

**Research date:** 2026-09-05

## Product thesis

Modern software R&D increasingly happens as a machine-readable sequence of questions, experiments, commits, tests, agent/tool calls, benchmark runs, failures, approvals, and economic events. Traditional tax-credit substantiation often reconstructs that history after the fact.

The proposed product continuously captures and organizes that source evidence so a qualified tax professional can evaluate research-credit positions under IRC section 41, domestic R&E treatment under section 174A, and the business-component reporting structure in Form 6765.

The product is **evidence infrastructure**, not an automatic tax-credit eligibility engine.

A safe product statement is:

> Capture, organize, and preserve engineering evidence for professional evaluation of R&D tax positions.

Unsafe product statements include claims that the software itself proves qualification, guarantees a credit, eliminates regulatory obligations, or determines that a specific expense is a QRE without professional review.

## Current IRS reporting landscape this design targets

The December 2025 IRS Instructions for Form 6765 state that, for tax years beginning after 2025, Section G business-component reporting is required subject to stated exceptions. Where Section G is required, taxpayers generally report at least 80% of total QREs by business component, with no more than 50 business components, and aggregate the remainder.

The same instructions define qualified research around four core requirements:

1. expenditures treated as domestic research or experimental expenditures under section 174A;
2. research undertaken to discover information technological in nature;
3. application intended to be useful in development of a new or improved business component; and
4. substantially all research activities constituting elements of a process of experimentation relating to function, performance, reliability, or quality.

The instructions also state that the four-part test is applied separately to each business component.

Section 174A now permits current deduction of domestic research or experimental expenditures for tax years beginning after December 31, 2024, subject to the Code and available elections. IRS guidance also states that domestic software-development expenditures are treated as research or experimental expenditures for section 174A purposes. That does **not** by itself make every software-development cost a section 41 QRE.

### Primary official sources

- IRS Instructions for Form 6765 (Rev. December 2025): https://www.irs.gov/instructions/i6765
- IRS PDF Instructions for Form 6765: https://www.irs.gov/pub/irs-pdf/i6765.pdf
- IRS Rev. Proc. 2025-28 / section 174A transition guidance: https://www.irs.gov/irb/2025-38_IRB
- IRS research-credit amended-return FAQ: https://www.irs.gov/businesses/corporations/research-credit-claims-section-41-on-amended-returns-frequently-asked-questions
- IRS qualified-small-business payroll-tax research-credit page: https://www.irs.gov/credits-deductions/research-credit-against-payroll-tax-for-small-businesses

These sources are versioned external authority. Product logic must record the source/version used for any generated mapping and must not silently assume that future forms or instructions are unchanged.

## Hard boundary: evidence is not qualification

The platform may classify evidence into workflow states, but only an authorized human reviewer may approve a tax position.

Recommended states:

- `unclassified` — source evidence captured but not mapped;
- `candidate` — potentially relevant to a research component or expense;
- `supported` — evidence currently supports a proposed treatment;
- `questioned` — incomplete, conflicting, or requires professional judgment;
- `excluded_candidate` — appears to fall outside the intended claim set;
- `reviewed_approved` — approved by an identified professional reviewer for the specified tax period and methodology;
- `reviewed_rejected` — reviewed and rejected for the specified treatment.

The system must preserve the original evidence even when classifications change.

## Architectural position

```text
GitHub / PRs / commits ───────┐
CI / tests / benchmarks ──────┤
CairnStone provenance ─────────┤
Agent / tool execution ────────┤
x402 usage + receipts ─────────┼──> Research Evidence Ingestion
Cloud/model telemetry ─────────┤             │
Payroll / HR ──────────────────┤             v
AP / contractor invoices ──────┘     Evidence + Provenance Graph
                                           │
                                           v
                                  Business Components
                                           │
                              ┌────────────┼────────────┐
                              v            v            v
                         Research      Experiment     Candidate
                         Questions      Episodes       Costs/QREs
                              └────────────┼────────────┘
                                           v
                                   Human Review Layer
                                           │
                          ┌────────────────┼────────────────┐
                          v                v                v
                     Form 6765        §174A support      Audit / CPA
                     preview          schedules          evidence pack
```

## Existing x402 assets that are useful evidence inputs

The current x402 architecture already produces evidence classes that can be consumed read-only:

- append-only or durable `usage_events` and payment/settlement outcomes;
- facilitator URL/status/latency and execution timing telemetry;
- authoritative agent identity and wallet-assignment context;
- budgets and permissions associated with agent execution;
- deterministic action drafts and executed-draft idempotency records;
- payment receipts and on-chain transaction identifiers where applicable;
- GitHub-backed source commits, migrations, tests, and repo receipts;
- CairnStone stones, typed graph edges, accepted HEADs, provenance, and immutable source identities.

None of these records alone establishes tax qualification. Their value is that they can prove **what occurred, when it occurred, which artifact or actor was involved, what result occurred, and how records relate**.

## Core domain model

### 1. `tax_entity`

Represents the legal/tax reporting entity, separate from a software workspace.

Minimum fields:

- `tax_entity_id`
- `legal_name`
- `ein_ref` or protected EIN reference
- `pba_code`
- `tax_year_start`
- `tax_year_end`
- `controlled_group_id` when applicable
- `review_status`

Sensitive identifiers should be encrypted or referenced through a secrets/PII boundary and should never be placed in public graph payloads.

### 2. `business_component`

A first-class record aligned to the Form 6765 business-component concept.

Minimum fields:

- `business_component_id`
- stable books-and-records identifier
- human name
- reporting entity
- type: `product | process | all_others`
- software type when applicable: `IUS | DFS | Non-IUS | Excepted`
- tax-year scope
- lifecycle dates
- source project/repo/workspace links
- four-part-test review state
- professional-review notes and decision provenance

The identifier should be stable enough to reconcile engineering source systems, books/records, and Form 6765 reporting.

### 3. `research_question`

Captures contemporaneous technical uncertainty or objective.

Fields should distinguish:

- technical uncertainty/question;
- intended new or improved function/performance/reliability/quality;
- alternatives or approaches under consideration;
- technological discipline involved;
- business component;
- beginning/ending evidence timestamps;
- linked source evidence.

The product should never generate a research question retroactively without clearly marking it as a later reconstruction.

### 4. `experiment_episode`

The atomic unit of the evidence graph.

Suggested fields:

- `experiment_id`
- `business_component_id`
- `research_question_id`
- hypothesis/objective
- alternatives evaluated
- actor/person/agent identities
- start/end timestamps
- source commits/branches/PRs
- test and benchmark runs
- tool/model execution receipts
- inputs/configuration identities
- failure/result observations
- resulting decision
- follow-up experiment links
- provenance hash set

An episode may fail and still be highly valuable evidence. The system must not bias toward successful outcomes.

### 5. `evidence_source`

Immutable or content-addressed pointer to source material.

Examples:

- Git commit/tree/blob
- PR and review
- CI run/job/test output
- benchmark artifact
- CairnStone stone/ref/edge
- x402 receipt / usage event
- cloud execution receipt
- model/tool-call record
- design document
- issue/ticket
- human approval
- payroll record
- invoice / contractor statement

Recommended fields:

- source system
- immutable source identifier
- observed timestamp
- content/hash identity
- retrieval metadata
- retention class
- confidentiality class
- source freshness/currentness where relevant

### 6. `person_activity`

Maps human work to business components and experiment episodes without relying solely on annual retrospective percentages.

Possible evidence inputs:

- commits and reviews;
- tickets/tasks;
- calendar/project records when authorized;
- experiment ownership;
- test/benchmark activity;
- contemporaneous time allocation;
- supervisor review.

The system should distinguish actual conduct, direct supervision, direct support, and non-qualifying/general administrative activity because Form 6765 Section G separates wage categories.

### 7. `expense_record`

Imported accounting/payroll cost record with immutable source provenance.

Suggested classes:

- wages;
- supplies;
- rental/lease of qualifying computers;
- contract research;
- other R&E book expenses used for section 174A support but not necessarily Form 6765 QREs.

The source ledger remains authoritative for the amount. The evidence system stores allocation and review decisions, not a competing accounting balance.

### 8. `qre_candidate_allocation`

A proposed allocation from an expense record to one or more business components.

Fields:

- source expense ID;
- tax year;
- business component;
- expense category;
- proposed amount/percentage;
- allocation methodology;
- linked activity evidence;
- confidence/completeness indicators;
- reviewer;
- review decision;
- adjustment history.

No candidate amount becomes `reviewed_approved` without explicit professional review.

### 9. `review_decision`

Append-only professional review record.

Must include:

- reviewer identity/role;
- object reviewed;
- decision;
- tax year;
- methodology/version;
- timestamp;
- comments;
- superseded decision link if changed.

### 10. `evidence_snapshot`

Immutable close package for a tax period or review milestone.

Contains hashes/identifiers for:

- included business components;
- experiment episodes;
- source evidence;
- cost allocations;
- reviewer decisions;
- external authority/version references;
- export outputs.

A later correction creates a new snapshot and links it as superseding the older snapshot; it does not mutate history.

## Four-part-test evidence mapping

The system should gather evidence under four separate review dimensions for **each business component**.

### A. Section 174A / domestic R&E nexus

Evidence candidates:

- location of research activity;
- project/software-development records;
- engineering payroll/contract records;
- domestic/foreign work allocation;
- books-and-records R&E classification;
- section 174A method/election metadata supplied by tax professionals.

Important: section 174A treatment and section 41 qualification are related but not identical determinations.

### B. Technological in nature

Evidence candidates:

- engineering/computer-science design documents;
- architecture alternatives;
- algorithms, protocols, distributed-systems design;
- performance/reliability/security experiments;
- technical test plans and measurements.

Do not classify a project merely because software was used.

### C. New or improved business component / permitted purpose

Evidence candidates:

- component identity;
- baseline/version before research;
- intended improvement in function, performance, reliability, or quality;
- requirements and acceptance criteria;
- release/feature lineage.

### D. Process of experimentation

Evidence candidates:

- uncertainty;
- alternatives considered;
- hypotheses;
- simulations/prototypes;
- test runs and benchmark comparisons;
- failed attempts;
- code/design iterations;
- resulting technical decisions.

The strongest value proposition of this system is contemporaneous experiment lineage rather than a later narrative generated from the final code state.

## Form 6765 Section G projection

The evidence model should be able to project reviewed data into the current Section G structure without making the form itself the canonical database schema.

Current IRS mapping from the December 2025 instructions:

| Form 6765 field | Evidence-system projection |
|---|---|
| 49(a) | Entity EIN reference |
| 49(b) | Principal business activity code |
| 49(c) | Stable business-component name/identifier |
| 49(d) | Product / Process / All Others |
| 49(e) | Software type: IUS / DFS / Non-IUS / Excepted, when applicable |
| 49(f) | Amended-return claim-support information when applicable; keep versioned and reviewer-controlled |
| 50 | Wages — actual conduct of qualified research |
| 51 | Wages — direct supervision |
| 52 | Wages — direct support |
| 53 | Total qualified wages from 50–52 |
| 54 | Supplies |
| 55 | Rental/lease of computers meeting the form requirements |
| 56 | Applicable contract research expense |

The system should compute a **preview** of the IRS 80%/Top-50 ordering after professional-approved QRE allocations. It must also support aggregate remaining business components.

Current instructions contain exceptions to mandatory Section G reporting, including certain qualified-small-business payroll-tax-credit filers and certain original-return filers within stated QRE/gross-receipts thresholds. The evidence product should still retain business-component detail even when a taxpayer is not required to file Section G because the underlying evidence may remain useful for substantiation and future periods.

## Amended-return evidence support

IRS amended-return guidance requires business-component and research-activity information and total expense categories, and notes that more detailed information may be requested on examination.

Therefore the evidence graph should support an export that includes:

- business components in scope;
- research activities/experiment episodes by component;
- factual basis narrative generated only from cited evidence;
- wage, supply, computer-rental/lease, and contract-research totals;
- source citations for every material factual assertion;
- reviewer sign-off and snapshot identity.

Generated prose must be traceable to source evidence. Unsupported model prose is not substantiation.

## x402 integration boundary

`x402-sub-agent-mcp` remains the policy and execution plane.

The R&D Evidence layer may consume a read-only projection of:

- usage events;
- action/receipt IDs;
- actor/agent identity;
- tool/service identity;
- timestamps;
- price/cost metadata;
- execution outcome;
- payment/settlement provenance.

It must not:

- alter payment policy to create tax evidence;
- execute fake economic activity for the purpose of manufacturing deductions/credits;
- classify testnet token value as a QRE merely because a transaction occurred;
- mutate authoritative wallet/accounting records;
- characterize a tax position as approved without reviewer authority.

Testnet and synthetic execution are useful as engineering-experiment evidence when they genuinely document technical experimentation. They are not themselves economic QREs merely because they are logged.

## CairnStone role

CairnStone should serve as the provenance and evidence-relationship layer, not the tax calculation authority.

Useful edge types at the evidence layer include semantic relationships such as:

```text
business_component -> documents -> design evidence
experiment -> references -> source commit
experiment -> references -> CI run
experiment -> references -> x402 receipt
review -> reviews -> candidate allocation
new snapshot -> supersedes -> prior snapshot
```

Where CairnStone's native edge vocabulary is narrower, application-level relation metadata can remain in the evidence domain while the CairnStone stone graph preserves canonical document/source lineage.

## Security and privacy

This product may handle payroll, tax IDs, invoices, employee data, and proprietary engineering evidence. Required controls before production use include:

- strict tenant/workspace isolation;
- role-based access for engineering, finance, and tax reviewers;
- encryption for PII and tax identifiers;
- source-specific least-privilege connectors;
- auditable access to evidence exports;
- immutable review/snapshot history;
- configurable retention/legal-hold support;
- secrets excluded from evidence payloads;
- redaction paths for model-visible contexts;
- no customer evidence used for model training without explicit authorization.

## Initial export contracts

The first useful read-only exports should be:

1. **Business Component Register** — stable component IDs, type/software classification, linked projects, review state.
2. **Experiment Evidence Ledger** — question → alternatives → runs → results → decisions → cited sources.
3. **Candidate QRE Allocation Report** — costs by component/category with methodology and review state.
4. **Form 6765 Section G Preview** — current-field projection and 80%/Top-50 calculation, clearly marked `PREVIEW / NOT FILED`.
5. **Section 174A Evidence Schedule** — domestic R&E source-cost inventory and software-development evidence, separate from section 41 qualification.
6. **CPA/Audit Evidence Package** — immutable snapshot manifest plus cited supporting artifacts.

## Acceptance principles for any future implementation

A future implementation is not accepted until it proves:

- source records are preserved with immutable provenance;
- the same source event is idempotently deduplicated;
- business-component identity is stable across imports;
- every generated factual statement can cite underlying evidence;
- section 41 candidate classification is distinct from reviewed approval;
- section 174A R&E treatment is distinct from section 41 QRE qualification;
- Form 6765 previews reconcile exactly to approved source allocations;
- no x402 payment/testnet event is treated as a QRE merely due to transaction value;
- a reviewer can reject/reclassify evidence without deleting history;
- tax-authority versions used for mappings are recorded;
- tenant and sensitive-data boundaries are tested before real customer data is accepted.

## Product name placeholder

Working category: **Research Evidence OS** / **Continuous R&D Evidence Infrastructure**.

This is intentionally a category description, not final branding.
