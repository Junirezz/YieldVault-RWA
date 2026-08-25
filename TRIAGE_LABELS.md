# Issue Triage & Labels Guide

This document defines the label taxonomy, triage workflow, and SLA guidance for issue management in YieldVault-RWA.

## Table of Contents

- [Label Taxonomy](#label-taxonomy)
- [Triage Workflow](#triage-workflow)
- [SLA Guidance](#sla-guidance)
- [Ownership & Assignment](#ownership--assignment)
- [Label Usage Examples](#label-usage-examples)
- [Automation & Tools](#automation--tools)

---

## Label Taxonomy

All issues use labels across three dimensions: **severity**, **area**, and **status**.

### Severity Labels

Severity indicates impact and urgency. Every issue must have exactly one severity label.

| Label | Color | Criteria | Response SLA | Resolution SLA |
|---|---|---|---|---|
| `critical` | 🔴 Red | Production outage, data loss, security breach | 15 min | 4 hours |
| `high` | 🟠 Orange | Feature broken, significant performance degradation, security vulnerability (no active exploit) | 1 hour | 1 day |
| `medium` | 🟡 Yellow | Feature partially broken, user workflow impacted, performance issue (non-critical path) | 4 hours | 3 days |
| `low` | 🟢 Green | Minor bug, cosmetic issue, documentation, question | 1 day | 2 weeks |

**Severity Definitions**:

- **Critical**: Immediate business impact. Revenue at risk. Users blocked. Security breach. Examples:
  - Production API down
  - Data corruption
  - Authentication bypass
  - Active security incident

- **High**: Significant business impact. Multiple users affected or core feature broken. Examples:
  - Withdrawal feature returns 500 errors
  - 30%+ performance regression
  - Auth token expiration broken
  - Smart contract interaction fails

- **Medium**: User experience degraded but workaround exists. Examples:
  - Dashboard loads slowly (but loads)
  - Pagination broken in admin panel
  - Email notifications delayed
  - Rate limiting threshold too low

- **Low**: Cosmetic or minor functional issues. Examples:
  - Typo in UI
  - Button color misaligned
  - Outdated documentation
  - Minor performance edge case

---

### Area Labels

Area indicates the component or subsystem affected. Use one or more area labels.

| Label | Subsystem | Owned By | Example Issues |
|---|---|---|---|
| `area:auth` | Authentication & authorization | Security team | Login broken, OAuth provider integration |
| `area:api` | REST/GraphQL API | Backend lead | Endpoint returns 500, rate limiting |
| `area:contracts` | Smart contracts & blockchain | Contract lead | Contract logic, gas optimization |
| `area:database` | Data layer, queries, migrations | Backend lead | Query timeout, migration failure |
| `area:frontend` | UI, React components | Frontend lead | Component bug, styling issue |
| `area:performance` | Latency, throughput, optimization | Backend lead | Query slow, endpoint timeout |
| `area:security` | Security, secrets, encryption | Security lead | Vulnerability, secret exposure |
| `area:devops` | Infrastructure, CI/CD, deployment | DevOps lead | Deploy failed, monitoring alert |
| `area:documentation` | Docs, comments, API docs | DevRel | README outdated, comment unclear |
| `area:testing` | Tests, test infrastructure, CI | QA lead | Test flaky, coverage gap |
| `area:dependencies` | Dependencies, package updates | Backend/DevOps lead | Vulnerability in dependency |

---

### Status Labels

Status indicates where the issue is in its lifecycle. Use exactly one status label (except in rare cases).

| Label | Color | Meaning | Usage |
|---|---|---|---|
| `triage-needed` | 🔵 Blue | Issue requires initial assessment | New issues, unclear scope |
| `accepted` | 🟣 Purple | Scope understood, accepted for work | Ready for development |
| `in-progress` | 🟨 Yellow | Actively being worked on | Issue assigned, PR open |
| `blocked` | 🔴 Red | Cannot proceed; waiting on external dependency | Awaiting decision, dependency unresolved |
| `needs-review` | 🟠 Orange | PR or fix ready for review | PR open, awaiting approval |
| `resolved` | 🟢 Green | Fixed, merged, or closed | PR merged or issue closed |
| `wontfix` | ⚫ Black | Intentionally not fixing | Design decision, low priority |
| `duplicate` | ⚫ Black | Duplicate of another issue | Link to original issue |
| `question` | 💭 Gray | User question, not a bug | Use for Q&A discussions |

---

### Special Labels

| Label | Purpose | Example |
|---|---|---|
| `roadmap-qX-YYYY` | Links issue to roadmap phase | `roadmap-q3-2026`, `roadmap-q4-2026` |
| `breaking-change` | Requires major version bump | API signature change |
| `security` | Security-related (in addition to `area:security`) | Use for visibility |
| `good-first-issue` | Suitable for new contributors | Small scope, clear requirements |
| `help-wanted` | Explicitly asking for community help | Complex issue, need bandwidth |
| `performance` | Performance-related (in addition to area) | Use for tracking perf work |

---

## Triage Workflow

### Step 1: Issue Creation (Submitter)

When creating an issue:
1. Use the appropriate template (bug, feature, security, task)
2. Provide clear reproduction steps (for bugs)
3. Include expected vs. actual behavior
4. Add relevant details (environment, version, logs)

**Template links**:
- [Bug Report](/.github/ISSUE_TEMPLATE/bug_report.md)
- [Feature Request](/.github/ISSUE_TEMPLATE/feature_request.md)
- [Security Report](/.github/ISSUE_TEMPLATE/security_report.md)
- [Task/Chore](/.github/ISSUE_TEMPLATE/task_or_chore.md)

---

### Step 2: Initial Triage (Triage Team - within 4 hours)

Assigned triage team members review new issues and apply:

1. **Severity**: Based on impact and urgency
2. **Area**: Component affected
3. **Status**: `triage-needed` or `accepted` (if clear scope)

**Triage Team Membership**:
- Backend lead
- Frontend lead
- DevOps lead
- Security lead
- DevRel (for docs/community)

**Triage Questions**:
- Is the issue reproducible? (ask for more details if not)
- What's the scope? (feature, bug, task)
- Is it a duplicate? (search related issues)
- Does it need security review?
- Should it be on roadmap?

---

### Step 3: Refinement (Issue Owner - within 1 day)

If `triage-needed`, the assigned owner refines:

1. **Reproduce**: Confirm the issue is real
2. **Scope**: Break down into smaller tasks if needed
3. **Acceptance Criteria**: Define what "done" looks like
4. **Effort Estimate**: T-shirt size (S/M/L/XL) or story points
5. **Links**: Add related issues, PRs, or docs

**Example refined issue**:

```
**Title**: Referral accrual calculation off by 1% edge case

**Severity**: medium

**Acceptance Criteria**:
- [ ] Identify root cause of 1% discrepancy
- [ ] Add unit test for edge case
- [ ] Fix calculation in referral service
- [ ] Update referrals for affected users
- [ ] Add regression test

**Effort**: M (3-5 days)

**Related**: #812 (referral system)
```

After refinement, change status to `accepted`.

---

### Step 4: Assignment & Development

When ready to work:
1. Assign to developer
2. Change status to `in-progress`
3. Open a PR (even as draft)
4. Update PR to reference issue: "Closes #123"

---

### Step 5: Review & Closure

1. Issue creator or domain expert reviews
2. Change status to `needs-review`
3. After PR merges, status becomes `resolved`
4. Close issue (GitHub auto-closes if PR merged)

---

## SLA Guidance

### Response SLA (Time to first response)

| Severity | SLA | Owner |
|---|---|---|
| Critical | 15 minutes | On-call engineer |
| High | 1 hour | Area owner |
| Medium | 4 hours | Team lead |
| Low | 1 business day | Team lead |

**Response** = Comment from maintainer acknowledging the issue, asking clarifying questions, or providing status.

**Example response**:
> Thanks for the report. We can reproduce this on staging. Initial investigation points to a race condition in the withdrawal logic. We're prioritizing this as high and will have an update by EOD.

### Resolution SLA (Time to fix & merge)

| Severity | SLA | Notes |
|---|---|---|
| Critical | 4 hours | May require hotfix branch |
| High | 1 day | Prioritized in sprint |
| Medium | 3 days | Added to sprint |
| Low | 2 weeks | Backlog priority |

**Resolution** = Fix merged to `main` and deployed (or scheduled for next release).

If SLA will be missed, update the issue with a new ETA.

---

### Escalation

If SLA will be missed:

1. **Comment on issue**: Explain delay and new ETA
2. **Notify stakeholders**: Via Slack or team channel
3. **Escalate if critical**: Involve tech lead or on-call

---

## Ownership & Assignment

### Assignment Best Practices

1. **Assign to one person** (the primary owner, though help is OK)
2. **Assign from the area team**: `area:auth` → security team, etc.
3. **Good-first-issue**: Assign to interested contributor (onboard if needed)
4. **Blocked**: Don't assign until unblocked; keep status as `blocked`

### Ownership by Area

| Area | Primary Owner | Backup |
|---|---|---|
| `area:auth` | Security lead | Backend lead |
| `area:api` | Backend lead | API owner |
| `area:contracts` | Contract lead | Backend lead |
| `area:database` | Backend lead | DevOps (for migration issues) |
| `area:frontend` | Frontend lead | Frontend team |
| `area:performance` | Backend lead | DevOps (infrastructure) |
| `area:security` | Security lead | Tech lead |
| `area:devops` | DevOps lead | Tech lead |
| `area:documentation` | DevRel | Relevant area owner |
| `area:testing` | QA lead | Backend/Frontend lead |
| `area:dependencies` | Tech lead | DevOps |

---

## Label Usage Examples

### Example 1: Critical Production Bug

```
Title: Withdrawals fail with 500 error (production)

Labels:
- critical
- area:api
- area:database
- security (maybe—if data loss involved)
- in-progress

Assignee: Backend lead

SLA: 4 hours to resolve
```

### Example 2: Feature Request (New)

```
Title: Add export to CSV for transaction history

Labels:
- low (no current impact)
- area:frontend
- triage-needed

Assignee: Awaiting triage

SLA: Triage within 4 hours
```

### Example 3: Performance Regression

```
Title: Dashboard loads 3x slower than last week

Labels:
- high
- area:performance
- area:frontend
- performance
- in-progress

Assignee: Performance lead

SLA: 1 day investigation & mitigation
```

### Example 4: Good First Issue

```
Title: Fix typo in withdraw button label

Labels:
- low
- area:frontend
- good-first-issue
- accepted

Assignee: New contributor

SLA: 2 weeks (low priority, educational)
```

### Example 5: Security Vulnerability

```
Title: JWT token accepted after expiration

Labels:
- critical
- area:auth
- area:security
- security
- blocked (awaiting security audit)

Assignee: Security lead

SLA: 15 min response, 4 hours remediation
```

---

## Automation & Tools

### GitHub Actions for Labels

We automate common labeling tasks:

1. **Auto-triage**: New issues get `triage-needed` label
2. **Auto-close**: Stale `low` issues closed after 4 weeks
3. **Auto-link**: Related issues linked automatically (via keywords)
4. **Status updates**: Bot updates status based on PR activity

### Filtering & Searching

**Find issues by SLA urgency**:

```
# All critical issues needing response
is:open label:critical -label:resolved

# High issues unassigned
is:open label:high -assignee:*

# Issues blocked on dependencies
is:open label:blocked
```

**GitHub Projects**:
- [Triage Board](https://github.com/YieldVault-RWA/repo/projects/2): Shows `triage-needed` issues
- [Backlog](https://github.com/YieldVault-RWA/repo/projects/3): Shows `accepted` issues by priority
- [In Progress](https://github.com/YieldVault-RWA/repo/projects/4): Shows `in-progress` issues

### Slack Notifications

Critical and high issues are posted to `#alerts` channel:

```
🚨 [critical] Withdrawals fail with 500 error
   → Assigned to @john
   → Response SLA: 15 minutes
   → Link: github.com/...
```

---

## Common Triage Decisions

### "Is this a duplicate?"

Search existing issues:
- Use similar keywords
- Check closed issues too
- If duplicate, add label `duplicate` and link original

**Close with**:
> Duplicate of #456. Continuing discussion there.

---

### "Is this a bug or feature?"

**Bug**: Current behavior is broken/unintended  
**Feature**: New behavior or enhancement

If unclear, ask in issue comment.

---

### "Should this be on the roadmap?"

Add `roadmap-qX-YYYY` if:
- Aligns with strategic initiative
- Requires cross-team coordination
- Will span multiple quarters
- Is a major release feature

Otherwise, it stays in backlog.

---

### "Should this be security-reviewed?"

Add `area:security` if it affects:
- Authentication or authorization
- Secrets or credentials
- Encryption or data protection
- Blockchain interactions (contract logic)
- Dependency vulnerabilities

---

## Resources

- [Contributing Guide](./CONTRIBUTING.md)
- [Security Review Guide](./SECURITY_REVIEW.md)
- [Roadmap](./ROADMAP.md)
- [GitHub Issues](https://github.com/YieldVault-RWA/repo/issues)
- [GitHub Projects](https://github.com/YieldVault-RWA/repo/projects)
- [Issue Templates](/.github/ISSUE_TEMPLATE/)

---

**Last Updated**: August 2026  
**Maintained By**: DevRel & Triage Team  
**Review Schedule**: Quarterly  
**Next Review**: November 2026
