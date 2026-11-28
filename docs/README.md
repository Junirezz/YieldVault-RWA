# Documentation Index

Single entry point for every document in [`docs/`](.). The repo has accumulated a
large amount of Markdown across architecture, operations, security, and product
guides — this page groups **all 117 Markdown files by audience** so you can find
the right one without browsing the tree.

**Pick your audience:**

| Audience | Start with |
| --- | --- |
| New contributors | [Local Development Quickstart](./LOCAL_DEVELOPMENT_QUICKSTART.md) · [Contributor Onboarding Checklist](./CONTRIBUTOR_ONBOARDING_CHECKLIST.md) |
| Smart contract engineers | [Contracts Architecture](./CONTRACTS_ARCHITECTURE.md) · [Storage Layout Reference](./storage-layout-reference.md) |
| Frontend engineers | [Frontend State Management](./FRONTEND_STATE_MANAGEMENT.md) · [Vault UX Pattern Library](./VAULT_UX_PATTERN_LIBRARY.md) |
| Security reviewers | [Threat Model](./THREAT_MODEL.md) · [Security Checklist](./SECURITY_CHECKLIST.md) |
| Operators / on-call | [Runbooks Overview](./runbooks/README.md) · [Incident Runbook](./incident-runbook.md) |
| API integrators | [API Documentation](./api/README.md) · [Error Code Catalog](./api/ERROR_CODE_CATALOG.md) |
| Webhook consumers | [Webhook Integration Guide](./WEBHOOK_INTEGRATION.md) · [Event Schema Catalog](./WEBHOOK_EVENT_SCHEMA_CATALOG.md) |

---

## Start Here

High-level orientation for anyone opening the repository for the first time.

- [prd.md](./prd.md) — Product Requirements Document for the YieldVault Stellar RWA vault.
- [architecture.md](./architecture.md) — Architecture overview: frontend app and Soroban contracts on Stellar.
- [ARCHITECTURE_MAP.md](./ARCHITECTURE_MAP.md) — End-to-end map of components, data flows, and state machines from wallet to contract.
- [GLOSSARY.md](./GLOSSARY.md) — Domain glossary covering RWA vault, strategy, and infrastructure terminology.
- [user-guide.md](./user-guide.md) — Plain-language guide to using the vault and reading dashboard values.
- [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md) — ⚠️ *Historical* one-off summary of the security scanning integration (Jan 2024).
- [issues.md](./issues.md) — ⚠️ *Superseded* — a snapshot of issues to file manually when `gh` was unavailable; live issues now live on GitHub.

---

## Contributors

Standards, process, and day-to-day development workflow.

- [CONTRIBUTOR_ONBOARDING_CHECKLIST.md](./CONTRIBUTOR_ONBOARDING_CHECKLIST.md) — Tooling to install before cloning the repository.
- [LOCAL_DEVELOPMENT_QUICKSTART.md](./LOCAL_DEVELOPMENT_QUICKSTART.md) — Fastest supported way to boot backend, contracts, and frontend locally.
- [LOCAL_DEV_BOOTSTRAP.md](./LOCAL_DEV_BOOTSTRAP.md) — Step-by-step local bootstrap for all three layers (development/test environments only).
- [CODE_REVIEW_STANDARDS.md](./CODE_REVIEW_STANDARDS.md) — Review principles, approval thresholds, and merge policies.
- [DEFINITION_OF_DONE.md](./DEFINITION_OF_DONE.md) — Definition of Done for features spanning backend, frontend, contracts, and infra.
- [QUALITY_GATES_MATRIX.md](./QUALITY_GATES_MATRIX.md) — Required quality gates and testing standards by component criticality.
- [TESTING_STRATEGY.md](./TESTING_STRATEGY.md) — How unit, integration, and end-to-end testing is split across surfaces.
- [ROOT_SCRIPTS_REFERENCE.md](./ROOT_SCRIPTS_REFERENCE.md) — What each root `package.json` script checks or runs, and when to use it.
- [SPRINT_AND_TRIAGE_CONVENTIONS.md](./SPRINT_AND_TRIAGE_CONVENTIONS.md) — Sprint labeling, issue taxonomies, and triage workflow standards.
- [ISSUE_TAXONOMY_AND_LABELS.md](./ISSUE_TAXONOMY_AND_LABELS.md) — Repository-wide issue and PR label taxonomy.
- [TRIAGE_ROTATION_CALENDAR.md](./TRIAGE_ROTATION_CALENDAR.md) — Rotating triage ownership and escalation timeline. *(Links to `../TRIAGE_AND_REVIEW.md`, which does not currently exist.)*
- [CROSS_REPO_INTEGRATION_TESTS.md](./CROSS_REPO_INTEGRATION_TESTS.md) — Ownership and coordination model for tests spanning multiple repositories.
- [DEPENDENCY_REVIEW_PROCESS.md](./DEPENDENCY_REVIEW_PROCESS.md) — Recurring dependency review process, owners, and outcomes.
- [DEPENDENCY_UPDATE_POLICY.md](./DEPENDENCY_UPDATE_POLICY.md) — Rules for upgrading dependencies across contracts, backend, and frontend.
- [CANARY_MIGRATION_STRATEGY.md](./CANARY_MIGRATION_STRATEGY.md) — Patterns that keep the database schema backward-compatible during canary deploys.
- [RELEASE_TRAIN_CADENCE_AND_FREEZE_POLICY.md](./RELEASE_TRAIN_CADENCE_AND_FREEZE_POLICY.md) — Release cadence, freeze windows, and exception handling.
- [release-notes-playbook.md](./release-notes-playbook.md) — How release notes are structured and published.
- [BACKEND_MODULE_OWNERSHIP.md](./BACKEND_MODULE_OWNERSHIP.md) — Maps every backend module to its domain, owner, and reviewer.
- [SERVICE_DEPENDENCY_MATRIX.md](./SERVICE_DEPENDENCY_MATRIX.md) — Service dependencies, startup order, and health checks.
- [ENV_VARIABLE_MATRIX.md](./ENV_VARIABLE_MATRIX.md) — Complete environment variable reference across the stack.
- [focus-management-pattern.md](./focus-management-pattern.md) — Shared focus-management pattern for keyboard and screen-reader users.
- [FRONTEND_STATE_MANAGEMENT.md](./FRONTEND_STATE_MANAGEMENT.md) — State ownership, data-fetching boundaries, and UI sync patterns.
- [FRONTEND_FORM_VALIDATION.md](./FRONTEND_FORM_VALIDATION.md) — Shared form validation system used by the deposit/withdraw wizard.
- [storage-ttl-policy.md](./storage-ttl-policy.md) — Soroban storage durability tiers and per-user state architecture.

---

## Contracts & Architecture

Smart contract internals, invariants, and architectural decisions.

- [CONTRACTS_ARCHITECTURE.md](./CONTRACTS_ARCHITECTURE.md) — Overview of the Soroban vault protocol and strategy contracts.
- [SYSTEM_OWNERSHIP_AND_DATA_FLOW.md](./SYSTEM_OWNERSHIP_AND_DATA_FLOW.md) — Source of truth for layer ownership boundaries and cross-layer interfaces.
- [storage-layout-reference.md](./storage-layout-reference.md) — Nine namespace-partitioned storage domains with collision prevention.
- [VAULT_INVARIANTS.md](./VAULT_INVARIANTS.md) — Operator-facing specification of contract-level vault accounting invariants.
- [FORMAL_VERIFICATION_ACCOUNTING.md](./FORMAL_VERIFICATION_ACCOUNTING.md) — Formal spec and verification properties for critical accounting logic.
- [PROTOCOL_RISK_LIMITS.md](./PROTOCOL_RISK_LIMITS.md) — Hard caps on vault exposure layered above per-strategy limits.
- [strategy-allocation-wiki.md](./strategy-allocation-wiki.md) — Strategy allocation and RWA risk management deep dive.
- [VAULT_LIFECYCLE_AUDIT_LOG.md](./VAULT_LIFECYCLE_AUDIT_LOG.md) — What the vault lifecycle audit log records and how to read it.
- [BRIDGE_COMPATIBILITY.md](./BRIDGE_COMPATIBILITY.md) — Generic cross-chain USDC bridge interface (Wormhole, LayerZero, etc.).
- [ERC404_FEASIBILITY_STUDY.md](./ERC404_FEASIBILITY_STUDY.md) — Feasibility of ERC-404-style hybrid tokens on Stellar/Soroban.
- [DEPOSIT_WITHDRAWAL_LIFECYCLE.md](./DEPOSIT_WITHDRAWAL_LIFECYCLE.md) — Sequence diagrams for the full deposit and withdrawal lifecycle.
- [DEPOSIT_WITHDRAWAL_TROUBLESHOOTING.md](./DEPOSIT_WITHDRAWAL_TROUBLESHOOTING.md) — Diagnosing failed, pending, or missing deposits and withdrawals.

### Architecture Decision Records

- [architecture-decision-records/README.md](./architecture-decision-records/README.md) — What an ADR is and how this project writes them.
- [architecture-decision-records/template.md](./architecture-decision-records/template.md) — Blank ADR template.
- [ADR-001: Use Prisma as the Database ORM](./architecture-decision-records/ADR-001-use-prisma-for-database-access.md) — Rationale for Prisma as the type-safe data layer.
- [ADR-002: Write-Ahead Audit Log](./architecture-decision-records/ADR-002-write-ahead-audit-log.md) — Audit admin configuration changes before applying them.
- [ADR-003: API Contract Schema Snapshots](./architecture-decision-records/ADR-003-api-contract-schema-snapshots.md) — Enforce REST API backward compatibility in CI.
- [ADR-004: Multi-Tenant Vault Isolation via Soroban](./architecture-decision-records/ADR-004-soroban-vault-contracts.md) — How multiple depositors share a vault safely.
- [ADR-005: SOC2 Audit Log Traceability](./architecture-decision-records/ADR-005-soc2-audit-log-traceability.md) — Capture IP and user agent for SOC2 evidence.
- [ADR-006: Driftless Scheduler for Critical Jobs](./architecture-decision-records/ADR-006-driftless-scheduler-for-critical-jobs.md) — Hourly yield accrual without timer drift.

---

## Frontend

UI patterns, screens, and feature-specific guides.

- [VAULT_UX_PATTERN_LIBRARY.md](./VAULT_UX_PATTERN_LIBRARY.md) — Approved UX patterns for deposit, withdrawal, approval, and confirmation.
- [frontend/vault-comparison.md](./frontend/vault-comparison.md) — Vault comparison screen (`/compare`) for side-by-side strategy evaluation.
- [frontend/transaction-filters.md](./frontend/transaction-filters.md) — Advanced filter and sort behaviour on the Transaction History page.
- [frontend/account-risk-summary.md](./frontend/account-risk-summary.md) — Account risk summary card component and its data source.
- [features/WALLET_CONNECTION_STATE.md](./features/WALLET_CONNECTION_STATE.md) — Freighter wallet connection state machine.
- [features/I18N_SCAFFOLDING.md](./features/I18N_SCAFFOLDING.md) — In-repo i18n layer and message catalog conventions (no `i18next` dependency).
- [features/PERFORMANCE_FEE_SWITCH.md](./features/PERFORMANCE_FEE_SWITCH.md) — Governance process for activating the performance fee switch.
- [FRONTEND_STATE_MANAGEMENT.md](./FRONTEND_STATE_MANAGEMENT.md) — *(Also listed under Contributors)* state management architecture reference.
- [FRONTEND_FORM_VALIDATION.md](./FRONTEND_FORM_VALIDATION.md) — *(Also listed under Contributors)* shared form validation system.
- [focus-management-pattern.md](./focus-management-pattern.md) — *(Also listed under Contributors)* focus management for accessible navigation.

---

## Security

Threat modelling, scanning, compliance, and data protection.

- [THREAT_MODEL.md](./THREAT_MODEL.md) — Contract threat model, trust assumptions, and trust boundaries.
- [SECURITY_CHECKLIST.md](./SECURITY_CHECKLIST.md) — Pre-PR smart contract security review checklist.
- [PRODUCTION_SECURITY_CHECKLIST.md](./PRODUCTION_SECURITY_CHECKLIST.md) — Production controls: keys, CORS, logging, and operational safeguards.
- [SECURITY_SCANNING_GUIDE.md](./SECURITY_SCANNING_GUIDE.md) — Setup and usage of the automated security scanning suite.
- [SLITHER_INTEGRATION_GUIDE.md](./SLITHER_INTEGRATION_GUIDE.md) — Configuring Slither in CI with severity policies.
- [SLITHER_SUPPRESSION_GUIDE.md](./SLITHER_SUPPRESSION_GUIDE.md) — Developer quick guide for suppressing Slither false positives.
- [FALSE_POSITIVE_HANDLING.md](./FALSE_POSITIVE_HANDLING.md) — Triaging scanner findings and maintaining a false-positive audit trail.
- [security/encryption-review.md](./security/encryption-review.md) — Encryption review covering data at rest and in transit.
- [DATA_RETENTION_DELETION_POLICY.md](./DATA_RETENTION_DELETION_POLICY.md) — Retention periods, deletion workflows, and compliance considerations.
- [risk-register.md](./risk-register.md) — Production risks, current controls, mitigations, and review workflow.
- [ROLLOUT_TRAINING_PLAN.md](./ROLLOUT_TRAINING_PLAN.md) — ⚠️ *Historical* training plan for the original security scanning rollout.

---

## Operators & Runbooks

On-call procedures, incidents, disaster recovery, and release operations.

- [runbooks/README.md](./runbooks/README.md) — Overview of the disaster recovery and incident response runbooks.
- [runbooks/QUICK_REFERENCE.md](./runbooks/QUICK_REFERENCE.md) — Printable DR quick reference with emergency contacts and first actions.
- [runbooks/INCIDENT_TRIAGE_AND_SEVERITY.md](./runbooks/INCIDENT_TRIAGE_AND_SEVERITY.md) — Classify severity and escalate before engaging a domain playbook.
- [runbooks/FAILED_WITHDRAWAL_INCIDENT_PLAYBOOK.md](./runbooks/FAILED_WITHDRAWAL_INCIDENT_PLAYBOOK.md) — Response playbook for failed vault withdrawals.
- [runbooks/rollback-and-hotfix.md](./runbooks/rollback-and-hotfix.md) — Rollback and hotfix operations during an incident.
- [runbooks/BACKEND_REDEPLOY.md](./runbooks/BACKEND_REDEPLOY.md) — Safe backend redeployment procedure.
- [runbooks/CONTRACT_UPGRADE_PLAYBOOK.md](./runbooks/CONTRACT_UPGRADE_PLAYBOOK.md) — Upgrading and migrating deployed Soroban contracts.
- [runbooks/DATABASE_RESTORE.md](./runbooks/DATABASE_RESTORE.md) — Restoring the database to a known-good state.
- [runbooks/RPC_FAILOVER.md](./runbooks/RPC_FAILOVER.md) — Failing over to a healthy Stellar RPC node.
- [runbooks/REPLAY_PROCEDURES.md](./runbooks/REPLAY_PROCEDURES.md) — Manually replaying ledger events and email queue items after recovery.
- [runbooks/FULL_DR_PROCEDURE.md](./runbooks/FULL_DR_PROCEDURE.md) — Complete disaster recovery for total infrastructure failure.
- [runbooks/RTO_RPO_TARGETS.md](./runbooks/RTO_RPO_TARGETS.md) — Recovery Time and Recovery Point Objective targets.
- [runbooks/ERROR_CODE_TROUBLESHOOTING.md](./runbooks/ERROR_CODE_TROUBLESHOOTING.md) — Maps backend error codes to causes and fixes.
- [runbooks/ISSUE_392_IMPLEMENTATION_SUMMARY.md](./runbooks/ISSUE_392_IMPLEMENTATION_SUMMARY.md) — ⚠️ *Historical* summary of the DR runbooks work (Issue #392).
- [runbooks/ISSUE_754_IMPLEMENTATION_SUMMARY.md](./runbooks/ISSUE_754_IMPLEMENTATION_SUMMARY.md) — ⚠️ *Historical* summary of the canonical contract error namespace (Issue #754).
- [runbooks/ISSUE_769_IMPLEMENTATION_SUMMARY.md](./runbooks/ISSUE_769_IMPLEMENTATION_SUMMARY.md) — ⚠️ *Historical* summary of the postmortem template workflow (Issue #769).
- [runbooks/templates/post-mortem.md](./runbooks/templates/post-mortem.md) — Blank postmortem template.
- [runbooks/templates/incident-report.md](./runbooks/templates/incident-report.md) — Blank incident report template.
- [runbooks/templates/dr-test-report.md](./runbooks/templates/dr-test-report.md) — Blank disaster recovery test report template.
- [incident-runbook.md](./incident-runbook.md) — Production incident triage runbook for on-call first responders.
- [incident_response_runbook.md](./incident_response_runbook.md) — Focused runbook for RPC degradation and transaction delivery failures.
- [postmortem-playbook.md](./postmortem-playbook.md) — When postmortems are written and how action items are tracked.
- [incidents/README.md](./incidents/README.md) — Index of published incident postmortems and DR exercises.
- [escalation-matrix.md](./escalation-matrix.md) — Severity classifications, team handoffs, and response expectations.
- [recovery.md](./recovery.md) — Operational sequences for recovering stranded funds.
- [MONITORING_OBSERVABILITY.md](./MONITORING_OBSERVABILITY.md) — Every metric, alert, and dashboard panel used to monitor backend health.
- [NFR_BASELINES.md](./NFR_BASELINES.md) — Binding SLOs, SLIs, and recovery objectives.
- [ORACLE_FAILURE_HANDLING.md](./ORACLE_FAILURE_HANDLING.md) — Procedures for heartbeat failures, deviation spikes, and partitions.
- [PERFORMANCE_REGRESSION.md](./PERFORMANCE_REGRESSION.md) — Nightly benchmark thresholds for Soroban host CPU and memory.
- [RPC_PROVIDER_FAILOVER_STRATEGY.md](./RPC_PROVIDER_FAILOVER_STRATEGY.md) — Configuring multi-provider RPC failover.
- [MAINTAINER_ONBOARDING_RUNBOOK.md](./MAINTAINER_ONBOARDING_RUNBOOK.md) — What a new maintainer needs to operate governance safely.
- [DEPLOYMENT.md](./DEPLOYMENT.md) — Building and deploying smart contracts to the Stellar network.
- [DEPLOYMENT_CHECKLIST.md](./DEPLOYMENT_CHECKLIST.md) — Pre/during/post deployment checklist for testnet and mainnet.
- [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md) — Release checklist for testnet and mainnet.
- [RELEASE_READINESS_CHECKLIST.md](./RELEASE_READINESS_CHECKLIST.md) — Maps each release-readiness section to an automated or manual check.
- [RELEASE_VERIFICATION_CHECKLIST.md](./RELEASE_VERIFICATION_CHECKLIST.md) — Verification pass across backend, frontend, and contracts before a release.
- [QUALITY_GATES_MATRIX.md](./QUALITY_GATES_MATRIX.md) — *(Also listed under Contributors)* quality gates by component criticality.

---

## API Reference

Integrator-facing REST API documentation — see also the generated site under [`api/frontend/`](./api/frontend/).

- [api/README.md](./api/README.md) — Entry point describing the two API layers this project exposes.
- [api/AUTH_AND_TOKEN_GUIDE.md](./api/AUTH_AND_TOKEN_GUIDE.md) — Authentication mechanisms, token lifecycles, and rotation procedures.
- [api/ERROR_FORMAT.md](./api/ERROR_FORMAT.md) — Canonical error response shapes returned by the API.
- [api/ERROR_CODE_CATALOG.md](./api/ERROR_CODE_CATALOG.md) — Integrator-facing reference of stable error codes.
- [api/PAGINATION.md](./api/PAGINATION.md) — Pagination conventions used across list endpoints.
- [api/RATE_LIMITING.md](./api/RATE_LIMITING.md) — Independent rate limits for sensitive and public traffic.
- [api/VERSIONING.md](./api/VERSIONING.md) — Versioning and deprecation policy for the REST API.
- [api/SLA_SLO.md](./api/SLA_SLO.md) — Uptime, latency, and availability targets for the backend API.

---

## Webhooks & Events

- [WEBHOOK_INTEGRATION.md](./WEBHOOK_INTEGRATION.md) — Consumer integration guide for receiving YieldVault webhooks.
- [WEBHOOK_EVENT_SCHEMA_CATALOG.md](./WEBHOOK_EVENT_SCHEMA_CATALOG.md) — **Authoritative**, generated catalog of every webhook event schema.
- [WEBHOOK_PAYLOAD_EVOLUTION.md](./WEBHOOK_PAYLOAD_EVOLUTION.md) — How webhook payloads evolve without breaking consumers.
- [schemas/webhooks/EVENT_SCHEMA_CATALOG.md](./schemas/webhooks/EVENT_SCHEMA_CATALOG.md) — ⚠️ *Superseded* by [`WEBHOOK_EVENT_SCHEMA_CATALOG.md`](./WEBHOOK_EVENT_SCHEMA_CATALOG.md), which is generated from the Zod schemas.
- Machine-readable JSON Schema files live beside it in [`schemas/webhooks/`](./schemas/webhooks/).

---

## Non-Markdown Assets

Not indexed file-by-file (generated or machine-consumed), listed for completeness:

- [`api/frontend/`](./api/frontend/) — Generated TypeDoc HTML API site (regenerate with `npm run docs:api`).
- [`schemas/webhooks/*.json`](./schemas/webhooks/) — JSON Schema definitions for webhook envelopes and payloads.
- [`examples/`](./examples/) — Runnable webhook and pagination consumer examples (TypeScript and Python).
- [`ci/postmortem-docs.workflow.yml`](./ci/postmortem-docs.workflow.yml) — CI workflow that publishes postmortem docs.
- [`images/architecture.png.b64`](./images/architecture.png.b64) — Base64-encoded architecture diagram.
- [`nfr-baselines.json`](./nfr-baselines.json) · [`observability-dashboard-minimums.json`](./observability-dashboard-minimums.json) — Machine-readable SLO and dashboard thresholds.
- [`incidents/drafts/`](./incidents/drafts/) — Staging area for unpublished postmortems.

---

## Conventions

- Documents marked ⚠️ *Historical* or ⚠️ *Superseded* are kept for audit trail; prefer the linked replacement.
- New documents should be added to the matching audience section above so this index stays complete.
- The repository root [`README.md`](../README.md) links here for full documentation.
