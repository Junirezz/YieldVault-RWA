# Requirements Document

## Introduction

This feature adds structured logging with request correlation IDs to the YieldVault-RWA system. The goal is to improve debuggability across the frontend client and off-chain scripting layer by emitting machine-readable JSON logs that carry a traceable correlation ID through the full lifecycle of each request. Because the Soroban smart contracts execute on-chain as WASM, structured logging applies to the off-chain components: the React frontend (API call layer) and any deployment/automation scripts.

## Glossary

- **Logger**: The off-chain logging utility responsible for emitting structured JSON log entries.
- **Correlation_ID**: A unique identifier (UUID v4) attached to a request at its origin and propagated through all log entries related to that request.
- **Log_Entry**: A single structured JSON object emitted by the Logger.
- **Request**: Any outbound call from the frontend or scripts to an external service (Soroban RPC, Horizon API, or deployment endpoints).
- **Frontend**: The React/Vite web application in the `frontend/` directory.
- **Script**: Any off-chain automation or deployment script in the `scripts/` directory.
- **Log_Level**: A severity classification for a Log_Entry — one of `debug`, `info`, `warn`, or `error`.
- **Log_Field**: A named key-value pair included in a Log_Entry.
- **Context**: The set of Log_Fields associated with a specific Request scope.

## Requirements

### Requirement 1: Structured JSON Log Format

**User Story:** As a developer, I want all log output to be emitted as structured JSON, so that logs can be parsed and queried by log aggregation tools.

#### Acceptance Criteria

1. THE Logger SHALL emit every Log_Entry as a single-line JSON object.
2. THE Logger SHALL include the following Log_Fields in every Log_Entry: `timestamp` (ISO 8601), `level`, `correlation_id`, `message`, and `module`.
3. WHEN a Log_Entry is at `error` level, THE Logger SHALL include a `error_type` Log_Field and a `context` Log_Field containing relevant request metadata.
4. THE Logger SHALL write Log_Entries to `stdout` so that container and process supervisors can capture output.
5. IF a required Log_Field value is unavailable at emit time, THEN THE Logger SHALL substitute the string `"unknown"` for that field's value.

---

### Requirement 2: Correlation ID Generation

**User Story:** As a developer, I want every request to carry a unique traceable ID, so that I can follow a single request across all related log entries.

#### Acceptance Criteria

1. WHEN a new Request is initiated by the Frontend, THE Logger SHALL generate a UUID v4 Correlation_ID and attach it to the request Context.
2. WHEN a new Request is initiated by a Script, THE Logger SHALL generate a UUID v4 Correlation_ID and attach it to the request Context.
3. THE Logger SHALL include the Correlation_ID in every Log_Entry emitted within the scope of that Request.
4. WHEN a Request completes or errors, THE Logger SHALL emit a final Log_Entry at `info` or `error` level that includes the Correlation_ID and the request outcome.

---

### Requirement 3: Correlation ID Propagation from Client

**User Story:** As a developer, I want the frontend to propagate an existing correlation ID when one is provided, so that end-to-end traces can span multiple hops.

#### Acceptance Criteria

1. WHEN an inbound request to the Frontend includes an `X-Correlation-ID` HTTP header, THE Frontend SHALL use that header's value as the Correlation_ID for the request Context instead of generating a new one.
2. WHEN the Frontend makes an outbound Request to the Soroban RPC or Horizon API, THE Frontend SHALL include the active Correlation_ID as the `X-Correlation-ID` HTTP header on that outbound call.
3. IF the `X-Correlation-ID` header value is not a valid UUID v4, THEN THE Frontend SHALL discard it and generate a new Correlation_ID.
4. THE Logger SHALL record whether the Correlation_ID was client-supplied or generated, using a `correlation_id_source` Log_Field with value `"client"` or `"generated"`.

---

### Requirement 4: Error Log Context

**User Story:** As a developer, I want error log entries to include enough context to debug the failure without needing to reproduce it, so that I can resolve issues from logs alone.

#### Acceptance Criteria

1. WHEN a Request results in an HTTP error response, THE Logger SHALL emit an `error` level Log_Entry that includes: `correlation_id`, `http_status`, `request_url`, `request_method`, and `error_message`.
2. WHEN a Soroban transaction simulation or submission fails, THE Logger SHALL emit an `error` level Log_Entry that includes: `correlation_id`, `contract_id`, `function_name`, `error_code`, and `error_message`.
3. WHEN an unhandled exception occurs in the Frontend, THE Logger SHALL emit an `error` level Log_Entry that includes: `correlation_id`, `error_type`, `error_message`, and `stack_trace`.
4. IF a Log_Entry at `error` level is emitted without a Correlation_ID in scope, THEN THE Logger SHALL generate a fallback Correlation_ID and include a `correlation_id_source` value of `"fallback"`.

---

### Requirement 5: Log Level Control

**User Story:** As a developer, I want to control the minimum log level at runtime, so that I can reduce noise in production while retaining full detail in development.

#### Acceptance Criteria

1. THE Logger SHALL support configuration of a minimum Log_Level via an environment variable named `LOG_LEVEL`.
2. WHEN `LOG_LEVEL` is set, THE Logger SHALL suppress all Log_Entries with a severity below the configured minimum.
3. IF `LOG_LEVEL` is not set or contains an unrecognised value, THEN THE Logger SHALL default to `info` level.
4. WHERE the environment is `development`, THE Logger SHALL default to `debug` level when `LOG_LEVEL` is not explicitly set.

---

### Requirement 6: Consistent Field Conventions Across Modules

**User Story:** As a developer, I want logging field names and formats to be consistent across all modules, so that log queries work uniformly regardless of which module emitted the entry.

#### Acceptance Criteria

1. THE Logger SHALL enforce a shared Log_Entry schema such that field names, types, and formats are identical across the Frontend and Script modules.
2. THE Logger SHALL use `snake_case` for all Log_Field names.
3. THE Logger SHALL format all `timestamp` values as UTC ISO 8601 strings with millisecond precision (e.g. `2024-01-15T10:30:00.123Z`).
4. THE Logger SHALL use the string values `"debug"`, `"info"`, `"warn"`, and `"error"` for the `level` Log_Field.
5. THE Logger SHALL populate the `module` Log_Field with the name of the source module (e.g. `"vaultApi"`, `"transactionApi"`, `"deploy_contracts"`).

---

### Requirement 7: Logging Field Documentation

**User Story:** As a developer, I want a reference document describing all standard logging fields and conventions, so that new modules can be instrumented consistently.

#### Acceptance Criteria

1. THE Logger SHALL be accompanied by a `docs/logging.md` document that lists every standard Log_Field, its type, whether it is required or optional, and an example value.
2. THE Logger documentation SHALL include at least one complete example Log_Entry for each Log_Level.
3. THE Logger documentation SHALL describe the Correlation_ID propagation mechanism and the `X-Correlation-ID` header convention.
4. WHEN a new Log_Field is added to the schema, THE Logger documentation SHALL be updated to reflect the addition before the change is merged.
