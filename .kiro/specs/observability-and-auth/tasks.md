# Implementation Tasks

## Phase 1: Distributed Request Tracing

### Task 1.1: Enhance Correlation ID Middleware
- **Description:** Extend correlation ID middleware to propagate trace context across async boundaries
- **Acceptance Criteria:**
  - Correlation IDs propagated to all child spans
  - Trace context available in async operations via AsyncLocalStorage
  - Span attributes include request path, method, and user context
  - Error responses include correlation ID for customer support reference
- **Files to Create/Modify:**
  - `src/middleware/correlationId.ts` - enhance with trace context
  - `src/tracing.ts` - update to export trace context helpers
- **Estimated Effort:** 3-4 hours

### Task 1.2: Trace Context Propagation to Downstream Services
- **Description:** Ensure trace IDs are included when calling webhooks, external APIs, and async jobs
- **Acceptance Criteria:**
  - Webhook delivery includes X-Correlation-ID header
  - External API calls include trace headers
  - Async job queue includes trace context in metadata
  - Outbound request headers documented
- **Files to Create/Modify:**
  - `src/webhookDelivery.ts` - add trace headers
  - `src/sorobanClient.ts` - add trace headers
  - `src/eventOutbox.ts` - add trace context
- **Estimated Effort:** 2-3 hours

### Task 1.3: Tracing Documentation & Operational Guide
- **Description:** Document trace format and how to use traces for debugging
- **Acceptance Criteria:**
  - Trace flow diagram in documentation
  - Log parsing examples for ops teams
  - Tracing section in ARCHITECTURE_SUMMARY.md
  - Sample queries for observability tools
- **Files to Create/Modify:**
  - `docs/DISTRIBUTED_TRACING.md` (new)
  - `ARCHITECTURE_SUMMARY.md` - add tracing section
- **Estimated Effort:** 2 hours

### Task 1.4: Integration Tests for Trace Propagation
- **Description:** Write tests validating trace context flows through request lifecycle
- **Acceptance Criteria:**
  - Tests for sync request flow
  - Tests for async operation spawning
  - Tests for error cases
  - Tests for downstream service calls
- **Files to Create/Modify:**
  - `src/__tests__/distributedTracing.test.ts` (new)
- **Estimated Effort:** 4-5 hours

---

## Phase 2: Slow Query Monitoring & Alerting

### Task 2.1: Enhanced Query Performance Monitoring
- **Description:** Extend queryBudgets module with comprehensive metrics and structured logging
- **Acceptance Criteria:**
  - All query durations recorded in metrics (Prometheus)
  - Slow query logs include duration, query pattern, and context
  - Budget thresholds configurable per query type
  - Alert severity (warning vs critical) determined by breach ratio
- **Files to Create/Modify:**
  - `src/queryBudgets.ts` - enhance metrics collection
  - `src/metrics.ts` - add query performance histogram
- **Estimated Effort:** 3-4 hours

### Task 2.2: Slow Query Alert Delivery
- **Description:** Implement alert delivery mechanism with rate limiting
- **Acceptance Criteria:**
  - Alerts sent to Slack/PagerDuty for critical breaches
  - Alert cooldown prevents alert storms
  - Cooldown store supports both Redis and in-memory
  - Alert payload includes query context and recommendations
- **Files to Create/Modify:**
  - `src/queryBudgets.ts` - enhance alert delivery
  - `src/alerting.ts` (new) - alert delivery abstraction
- **Estimated Effort:** 3-4 hours

### Task 2.3: Slow Query Dashboard Queries
- **Description:** Create Prometheus/Grafana queries for operational dashboards
- **Acceptance Criteria:**
  - Query duration percentile queries (p50, p95, p99)
  - Breach frequency per query type
  - Top slow queries dashboard
  - Budget vs actual heatmap
- **Files to Create/Modify:**
  - `docs/SLOW_QUERY_MONITORING.md` (new)
  - Sample dashboard JSON
- **Estimated Effort:** 2-3 hours

### Task 2.4: Slow Query Monitoring Tests
- **Description:** Unit and integration tests for query monitoring
- **Acceptance Criteria:**
  - Tests for budget breach detection
  - Tests for alert delivery
  - Tests for cooldown mechanism
  - Tests for metrics collection
- **Files to Create/Modify:**
  - `src/__tests__/slowQueryMonitoring.test.ts` (new)
- **Estimated Effort:** 3-4 hours

---

## Phase 3: Secure Session & Token Management

### Task 3.1: Refresh Token Rotation & Revocation
- **Description:** Enhance auth module with secure token lifecycle and revocation tracking
- **Acceptance Criteria:**
  - New refresh tokens issued on every /auth/refresh call
  - Previous tokens immediately revoked
  - Revocation list available via Redis or in-memory store
  - Replay attack detection and response
- **Files to Create/Modify:**
  - `src/auth.ts` - enhance token rotation logic
  - `src/tokenRevocation.ts` (new) - revocation store abstraction
- **Estimated Effort:** 4-5 hours

### Task 3.2: Session Audit Trail & Recovery
- **Description:** Track session events and provide recovery procedures
- **Acceptance Criteria:**
  - Session creation, refresh, and revocation events logged
  - Audit logs queryable by wallet address
  - Recovery procedure documented
  - Session history available to users
- **Files to Create/Modify:**
  - `src/sessionAudit.ts` (new)
  - `src/auth.ts` - integrate audit logging
- **Estimated Effort:** 3-4 hours

### Task 3.3: Token Flow Error Handling & Tests
- **Description:** Comprehensive test coverage for token lifecycle scenarios
- **Acceptance Criteria:**
  - Tests for token expiration scenarios
  - Tests for token rotation on refresh
  - Tests for invalid/tampered token detection
  - Tests for replay attack prevention
  - Tests for concurrent refresh requests
  - Tests for session recovery
- **Files to Create/Modify:**
  - `src/__tests__/tokenLifecycle.test.ts` (new)
- **Estimated Effort:** 5-6 hours

### Task 3.4: Session Management Documentation
- **Description:** Document secure session handling and recovery procedures
- **Acceptance Criteria:**
  - Token lifecycle diagram
  - Security model documentation
  - Session recovery runbook
  - Customer support guide for common issues
- **Files to Create/Modify:**
  - `docs/SESSION_MANAGEMENT.md` (new)
  - `backend/docs/TOKEN_SECURITY.md` (new)
- **Estimated Effort:** 2 hours

---

## Phase 4: Contract Work - Max Exposure Guardrails

### Task 4.1: Exposure Limit Validation Logic
- **Description:** Implement or enhance exposure limit validation
- **Acceptance Criteria:**
  - Per-vault exposure limits enforced
  - Cross-vault exposure limits enforced
  - Validation happens before strategy allocation
  - Exposure calculation includes all open positions
- **Files to Create/Modify:**
  - `src/exposureGuardrails.ts` (new or enhanced)
- **Estimated Effort:** 4-5 hours

### Task 4.2: Unit Tests for Exposure Guardrails
- **Description:** Unit tests for exposure limit calculations
- **Acceptance Criteria:**
  - Tests for per-vault limits
  - Tests for cross-vault aggregation
  - Tests for edge cases (zero exposure, maximum positions)
  - Tests for concurrent operations
- **Files to Create/Modify:**
  - `src/__tests__/exposureGuardrails.test.ts` (new)
- **Estimated Effort:** 3-4 hours

### Task 4.3: Integration Tests for Exposure Guardrails
- **Description:** Integration tests with real vault operations
- **Acceptance Criteria:**
  - Tests for multi-vault exposure scenarios
  - Tests for rebalancing within limits
  - Tests for rejection when limits exceeded
  - Tests for partial fills respecting limits
- **Files to Create/Modify:**
  - `src/__tests__/exposureGuardrails.integration.test.ts` (new)
- **Estimated Effort:** 4-5 hours

### Task 4.4: UI & E2E Tests for Exposure Constraints
- **Description:** Frontend validation and E2E tests for exposure constraints
- **Acceptance Criteria:**
  - UI shows remaining exposure capacity
  - Strategy allocation blocked when limit exceeded
  - Error messages guide users to safe allocation
  - E2E tests validate full flow
- **Files to Create/Modify:**
  - `frontend/src/components/StrategyAllocation.test.tsx` - enhance
  - `frontend/cypress/e2e/exposure-guardrails.cy.ts` (new)
- **Estimated Effort:** 4-5 hours

### Task 4.5: Exposure Guardrails Documentation
- **Description:** Document exposure model and limits
- **Acceptance Criteria:**
  - Exposure calculation model documented
  - Limit configuration guide
  - Operational runbook for monitoring exposure
  - Product guide for users
- **Files to Create/Modify:**
  - `docs/EXPOSURE_GUARDRAILS.md` (new)
  - `ARCHITECTURE_SUMMARY.md` - add exposure section
- **Estimated Effort:** 2-3 hours

---

## Summary

**Total Estimated Effort:** 53-67 hours
- Phase 1 (Tracing): 11-14 hours
- Phase 2 (Slow Queries): 11-15 hours  
- Phase 3 (Sessions): 14-17 hours
- Phase 4 (Exposure): 17-21 hours

**Recommended Timeline:** 2-3 weeks (distributed across team)
