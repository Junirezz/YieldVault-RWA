# Implementation Plan: Structured Logging + Correlation IDs

## Overview

Implement structured JSON logging and correlation ID propagation for the YieldVault-RWA off-chain layer. Work proceeds in layers: extend existing types first, then build the new modules, wire them together, and validate with property-based and unit tests throughout.

## Tasks

- [x] 1. Extend existing types with `correlationId`
  - [x] 1.1 Add `correlationId?: string` to `ApiTelemetryEvent` variants in `frontend/src/lib/api/telemetry.ts`
    - Add the optional field to every event variant that represents a request lifecycle event
    - _Requirements: 2.1_
  - [x] 1.2 Add `correlationId?: string` to `ApiErrorMetadata` and `ApiError` in `frontend/src/lib/api/error.ts`
    - Ensure the field is propagated when constructing `ApiError` from metadata
    - _Requirements: 2.2_

- [x] 2. Implement the `logger` module
  - [x] 2.1 Create `frontend/src/lib/logger.ts` with `LogLevel`, `LogEntry`, `LoggerConfig` types and `configureLogger` / `log` functions
    - Implement level ordering (`debug < info < warn < error`) and filtering logic
    - Default output writes `JSON.stringify(entry)` to `console.log`
    - Catch and swallow errors thrown by the `output` function, writing a single `console.error` as last resort
    - _Requirements: 3.1, 3.2, 3.3_
  - [ ]* 2.2 Write property test for log entry JSON serialization (Property 5)
    - `// Feature: structured-logging-correlation-ids, Property 5: Log entries serialize to valid JSON with required fields`
    - Use `fc.record({ level: fc.constantFrom(...), message: fc.string() })` to generate inputs
    - Assert parsed object has `timestamp` (string), `level` (string), `message` (string)
    - **Validates: Requirements 2.3, 3.1**
  - [ ]* 2.3 Write property test for log level filtering (Property 6)
    - `// Feature: structured-logging-correlation-ids, Property 6: Log level filtering excludes entries below threshold`
    - Generate all combinations of `minLevel` × `entryLevel`; assert output called iff `levelOrder[entryLevel] >= levelOrder[minLevel]`
    - **Validates: Requirements 3.2**
  - [ ]* 2.4 Write unit tests for `logger`
    - Test that output-function errors are swallowed (no throw propagates)
    - Test `configureLogger` replaces the active config
    - _Requirements: 3.1, 3.2, 3.3_

- [x] 3. Implement `CorrelationIdContext`
  - [x] 3.1 Create `frontend/src/context/CorrelationIdContext.tsx` with `CorrelationIdProvider`, `useCorrelationId`, and the context value type
    - Generate UUID v4 via `crypto.randomUUID()` on mount
    - Expose `refreshCorrelationId` to rotate the ID
    - Throw descriptive error when `useCorrelationId` is called outside the provider
    - _Requirements: 1.4, 4.1, 4.2_
  - [ ]* 3.2 Write property test for context accessibility at arbitrary nesting depth (Property 7)
    - `// Feature: structured-logging-correlation-ids, Property 7: Correlation ID accessible throughout React tree`
    - Use `fc.integer({ min: 1, max: 10 })` for nesting depth; render provider + nested component; assert `useCorrelationId()` returns provider's ID
    - **Validates: Requirements 4.2**
  - [ ]* 3.3 Write unit tests for `CorrelationIdContext`
    - Test `refreshCorrelationId` produces a new, valid UUID v4
    - Test calling hook outside provider throws the expected error message
    - _Requirements: 1.4, 4.1, 4.2_

- [x] 4. Implement correlation ID interceptors
  - [x] 4.1 Create `frontend/src/lib/api/correlationInterceptors.ts` with `createCorrelationRequestInterceptor` and `createCorrelationResponseInterceptor`
    - Request interceptor: read ID from `getCorrelationId()` getter and set `X-Correlation-ID` header
    - Response interceptor: read echoed `X-Correlation-ID` from response headers and attach to telemetry context
    - Fallback: if `crypto.randomUUID` is unavailable, generate a `fallback-<timestamp>` ID and emit a `warn` log entry
    - _Requirements: 1.1, 1.2, 1.3, 1.5_
  - [ ]* 4.2 Write property test for request header presence (Property 1)
    - `// Feature: structured-logging-correlation-ids, Property 1: Every outgoing request carries a correlation ID header`
    - Use `fc.record({ method: fc.constantFrom('GET','POST','PUT','DELETE'), path: fc.string() })` to generate requests
    - Assert `headers.get('X-Correlation-ID')` is a non-empty string after interceptor runs
    - **Validates: Requirements 1.1**
  - [ ]* 4.3 Write property test for client-supplied ID precedence (Property 2)
    - `// Feature: structured-logging-correlation-ids, Property 2: Client-supplied correlation ID takes precedence`
    - Use `fc.uuid()` to generate supplied IDs; assert outgoing header equals the supplied ID exactly
    - **Validates: Requirements 1.3**
  - [ ]* 4.4 Write unit tests for `correlationInterceptors`
    - Test missing `X-Correlation-ID` in response does not throw and retains the request ID
    - Test non-secure context fallback produces a string prefixed with `fallback-`
    - _Requirements: 1.1, 1.2, 1.5_

- [x] 5. Implement correlation ID generation utility and property test
  - [x] 5.1 Extract or confirm a `generateCorrelationId()` helper (can live in `correlationInterceptors.ts` or a shared util)
    - Wraps `crypto.randomUUID()` with the fallback logic
    - Export `UUID_V4_PATTERN` regex constant for use in tests
    - _Requirements: 1.4_
  - [ ]* 5.2 Write property test for UUID v4 format (Property 3)
    - `// Feature: structured-logging-correlation-ids, Property 3: Generated correlation IDs are valid UUID v4`
    - Use `fc.integer({ min: 1, max: 1000 })` to drive repeated calls; assert each result matches `UUID_V4_PATTERN`
    - **Validates: Requirements 1.4**

- [x] 6. Subscribe logger to telemetry bus and wire correlation ID through events
  - [x] 6.1 Add a telemetry subscriber in `logger.ts` (or a `setupLogging` init function) that maps `ApiTelemetryEvent` variants to `LogEntry` fields and calls `log()`
    - Map `correlationId`, `method`, `url`, `durationMs`, `attempt`, `status`, `errorCode` from event to log entry
    - _Requirements: 2.1, 2.3_
  - [x] 6.2 Update `ApiClient` in `frontend/src/lib/api/client.ts` to register the two correlation interceptors on construction
    - Pass `useCorrelationId` getter (or an equivalent context accessor) to `createCorrelationRequestInterceptor`
    - _Requirements: 1.1, 1.2_
  - [ ]* 6.3 Write property test for end-to-end correlation ID propagation (Property 4)
    - `// Feature: structured-logging-correlation-ids, Property 4: All observable outputs carry the correlation ID`
    - Use `fc.uuid()` and `fc.constantFrom('success','error')` to simulate telemetry events; assert logger output and `ApiError` carry the same `correlationId`
    - **Validates: Requirements 2.1, 2.2**

- [x] 7. Checkpoint — ensure all tests pass
  - Run `vitest --run` in `frontend/`; ensure all new and existing tests pass. Ask the user if any questions arise.

- [x] 8. Integrate `CorrelationIdProvider` into the React app
  - [x] 8.1 Wrap the app root (or the relevant subtree) with `CorrelationIdProvider` in `frontend/src/main.tsx` or `App.tsx`
    - Follow the same pattern used by `ThemeContext` and `ToastContext` providers
    - _Requirements: 4.1, 4.2_
  - [x] 8.2 Update `ApiClient` instantiation to consume `useCorrelationId` from context where the client is created
    - Ensure the getter passed to the request interceptor always reflects the current context value
    - _Requirements: 1.1, 4.1_

- [x] 9. Extend existing `ApiClient` tests
  - [x] 9.1 Update `frontend/src/lib/api/client.test.ts` to assert interceptors are invoked in order and that `ApiError` carries `correlationId`
    - _Requirements: 1.1, 2.2_

- [x] 10. Final checkpoint — ensure all tests pass
  - Run `vitest --run` in `frontend/`; verify full suite is green. Ask the user if any questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Property tests use fast-check (`npm install --save-dev fast-check` in `frontend/`)
- `UUID_V4_PATTERN`: `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i`
