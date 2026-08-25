# Observability & Auth Enhancement Spec

## Overview
Improve system reliability and user security through enhanced distributed tracing, slow query monitoring, and secure session management.

## Features

### 1. Distributed Request Tracing
**Goal:** Make multi-step request debugging easier with clear correlation identifiers.

**Problem:** Without correlation IDs across all layers, debugging multi-step requests requires manually correlating logs across services.

**Acceptance Criteria:**
- Request IDs added to all API requests and propagated through middleware
- Trace IDs included in logs and error responses
- Correlation IDs propagated to downstream calls (webhooks, external services)
- Tracing metrics available in operational dashboards
- Integration tests validate trace propagation

**Scope:**
- Enhance existing correlationId middleware with trace context propagation
- Add span attributes for request paths, user context, tenant boundaries
- Document trace format for operational teams
- Add tests for trace context propagation across async operations

### 2. Slow Query Monitoring & Alerting
**Goal:** Identify expensive requests before they affect production reliability.

**Problem:** Slow database queries can quietly degrade user experience without visibility into the root cause.

**Acceptance Criteria:**
- Query execution time measured for all database operations
- Alerts triggered when queries exceed configured thresholds
- Slow query logs surfaced in operational tooling (structured logs, metrics)
- Common bottlenecks identifiable through dashboard queries
- Performance budget breach severity (warning vs critical) configurable per query

**Scope:**
- Extend existing queryBudgets module with structured alert delivery
- Add metrics for query duration distribution and breach frequency
- Implement alert rate limiting to prevent storms
- Create operational dashboard queries for slow query analysis
- Add monitoring documentation for ops teams

### 3. Secure Session & Token Management
**Goal:** Make auth sessions safer and easier to recover from.

**Problem:** Session expiration and token refresh flows can become confusing or insecure without solid handling.

**Acceptance Criteria:**
- Refresh token lifecycle follows secure rotation rules
- Tokens revoked immediately on logout or suspicious activity
- Expiration and reuse errors tracked and logged clearly
- Tests cover expired, rotated, and invalid token flows
- Session recovery procedures documented

**Scope:**
- Enhanced refresh token rotation with audit trail
- Token revocation list with efficient lookups
- Replay attack detection and response
- Redis-backed session store for multi-instance deployments
- Comprehensive test suite for token flows
- Session recovery documentation

### 4. Contract Work: Max Exposure Guardrails
**Goal:** Ensure strategy allocation respects maximum exposure limits in production-hardened way.

**Problem:** Current implementation doesn't fully cover this capability with proper testing and documentation.

**Acceptance Criteria:**
- Implementation completed with comprehensive validation logic
- Unit tests added for guardrail calculations
- Integration tests validate multi-vault exposure limits
- E2E tests confirm UI reflects exposure constraints
- Documentation updated with exposure model and limits
- CI checks pass with no regressions

**Scope:**
- Add or enhance exposure validation in strategy allocation
- Implement guardrails for per-vault and cross-vault exposure
- Add metrics and alerts for exposure threshold breaches
- Document exposure constraints for product and ops teams

## Implementation Sequence
1. **Phase 1:** Distributed tracing enhancements (req #1)
2. **Phase 2:** Slow query monitoring (req #2)
3. **Phase 3:** Session & token management (req #3)
4. **Phase 4:** Contract work on exposure guardrails (req #4)

## Success Metrics
- All acceptance criteria met for each feature
- No regressions in existing tests
- Comprehensive test coverage (unit, integration, e2e)
- Documentation complete and reviewed
- Operational runbooks created for monitoring and incident response
