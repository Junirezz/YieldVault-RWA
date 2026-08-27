# Changelog

All notable changes to YieldVault-RWA are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- next-release -->

## [Unreleased]

### Features
- Implement network mismatch detector and guided fix flow with instant Freighter recheck and accessible step-by-step guidance (#979)
- Add downloadable account statement export flow with custom date range filtering, holdings summary, and CSV/JSON serialization (#983)
- Add advanced filter and sort to the transaction history table: multi-column sort (up to three keys) with shift-click tiebreakers, a keyboard-reachable sort panel, URL-shareable ordering with legacy single-column links still honoured, relative date presets, removable active-filter chips, and inline reporting of contradictory ranges (#1035)
- Harden the transfer orchestration service to be idempotent and retry-safe: wallet-scoped idempotency keys, request validation and canonicalisation, submission-boundary failure classification that never blindly resubmits a transfer whose outcome is unknown, stored terminal rejections, circuit-breaker fail-fast, a submission timeout, and an operator reconciliation queue with metrics (#1043)
- Harden the vault comparison screen for multi-strategy selection: numeric strategy catalog with locale-aware formatting, URL-synced shareable selection and column ordering, best-in-class marking with non-colour cues, and screen-reader announcements for selection and sort changes (#1036)
- Add journalled partial-failure recovery for multi-step withdrawals: resume-forward retries, reverse-order compensation, an operator escalation queue with admin endpoints, and a background sweeper for crashed or backed-off sagas (#954)
- Add deterministic admin proposal nonces with replay rejection for admin rotation (#736)
- Add empty-state deposit and withdraw intent actions across dashboard pages (#734)
- CORS configuration for cross-origin API access
- Add canonical `VaultError` namespace module and replace contract panics with stable error codes (#754)
- Structured logging, graceful shutdown, caching, and API key authentication
- Network badge showing testnet vs mainnet status in the frontend
- Add wallet activity heatmap aggregation endpoint for admin analytics without exposing raw wallet records (#712)
- Add replay-safe deduplication store for webhook event processing to prevent duplicate downstream delivery during retries and restarts (#710)
- Add deterministic request ID propagation across HTTP handlers, queued jobs, and worker logs using AsyncLocalStorage (#700)

### Bug Fixes
- Vault performance dynamic date filter

### Documentation
- Create release checklist for testnet and mainnet deployment covering preflight, deployment, validation, and multi-tier sign-off (#1146)
- Add runbook for incident response and rollback operations with failure scenarios, activation triggers, and operational owner matrix (#1149)
- Add incident postmortem templates, publication playbook, and CI validation workflow (#769)
- Add release notes playbook and changelog curation guidelines (#618)
- Add API versioning and deprecation policy with sunset windows, migration guide, and breaking-change classification (#610)

### Chores
- Resolve merge conflict in Skeleton and dateUtils imports
