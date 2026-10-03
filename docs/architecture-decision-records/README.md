# Architecture Decision Records (ADRs)

## What is an ADR?

An Architecture Decision Record (ADR) is a document that captures a significant architectural decision made in the project, along with its context, consequences, and rationale.

## When to Write an ADR

Write an ADR when you are making a decision that:

- Affects the overall architecture of the system
- Is difficult to reverse
- Has significant implications for future development
- Involves trade-offs between multiple alternatives
- Is a departure from previous practices or standards

Examples include:
- Choosing a new technology or framework
- Designing a major component or module
- Defining coding standards or conventions
- Making changes to data storage or API design

## How to Write an ADR

1. **Copy the template**  
   Copy `docs/architecture-decision-records/template.md` to a new file.

2. **Name the file**  
   Follow the format: `ADR-XXX-short-title.md` (e.g., `ADR-001-use-prisma-for-database-access.md`)

3. **Fill out the template**  
   - Fill in all sections with clear, concise information
   - Use numbered prefixes for easy ordering and reference
   - Link to related issues, PRs, and documentation

4. **Review and approve**  
   Share the ADR with the team for review and discussion

5. **Update status**  
   Once approved, set the status to "Accepted"

## ADR Lifecycle

- **Proposed:** Decision is being considered and reviewed
- **Accepted:** Decision has been approved and is being implemented
- **Deprecated:** Decision is no longer in use
- **Superseded by ADR-YYY:** Decision has been replaced by another ADR

## Index of ADRs

| Number | Title | Date | Status |
|--------|-------|------|--------|
| [ADR-001](ADR-001-use-prisma-for-database-access.md) | Use Prisma as the Database ORM | 2024-01-15 | Accepted |
| [ADR-002](ADR-002-write-ahead-audit-log.md) | Write-Ahead Audit Log for Admin Configuration Changes | 2024-03-10 | Accepted |
| [ADR-003](ADR-003-api-contract-schema-snapshots.md) | API Contract Schema Snapshots for Backward-Compatibility Enforcement | 2024-04-20 | Accepted |
| [ADR-004](ADR-004-soroban-vault-contracts.md) | Multi-Tenant Vault Isolation via Soroban Smart Contracts | 2024-05-05 | Accepted |
| [ADR-005](ADR-005-soc2-audit-log-traceability.md) | SOC2 Audit Log Traceability with IP and User-Agent Capture | 2026-09-29 | Accepted |
| [ADR-006](ADR-006-driftless-scheduler-for-critical-jobs.md) | Driftless Scheduler for Critical Hourly Jobs Using setTimeout with Recalculation | 2026-09-29 | Accepted |
