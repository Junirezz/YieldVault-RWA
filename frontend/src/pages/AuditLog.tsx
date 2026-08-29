import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../lib/apiClient";

interface AuditLogEntry {
  id: string;
  timestamp: string;
  operation: "deposit" | "withdraw" | "strategy_switch" | "parameter_change";
  actor: string;
  details: Record<string, unknown>;
}

interface AuditLogResponse {
  data: AuditLogEntry[];
  pagination: {
    count: number;
    limit: number;
    total: number;
    hasNextPage: boolean;
  };
  timestamp: string;
}

type OperationFilter = "all" | "deposit" | "withdraw" | "strategy_switch" | "parameter_change";

const OPERATION_LABELS: Record<string, string> = {
  deposit: "Deposit",
  withdraw: "Withdraw",
  strategy_switch: "Strategy Switch",
  parameter_change: "Parameter Change",
};

const OPERATION_COLORS: Record<string, string> = {
  deposit: "#22c55e",
  withdraw: "#ef4444",
  strategy_switch: "#3b82f6",
  parameter_change: "#f59e0b",
};

function formatDetails(details: Record<string, unknown>): string {
  return Object.entries(details)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(", ");
}

const AuditLog: React.FC = () => {
  const [operationFilter, setOperationFilter] = useState<OperationFilter>("all");
  const [actorFilter, setActorFilter] = useState("");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["audit-logs", operationFilter, actorFilter],
    queryFn: async (): Promise<AuditLogResponse> => {
      const params = new URLSearchParams();
      if (operationFilter !== "all") {
        params.set("operation", operationFilter);
      }
      if (actorFilter) {
        params.set("actor", actorFilter);
      }
      params.set("limit", "20");

      const response = await apiClient.get<AuditLogResponse>(
        `/api/v1/audit-logs?${params.toString()}`,
      );
      return response;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  return (
    <div className="glass-panel audit-log-page">
      <header className="page-header" style={{ textAlign: "center", marginBottom: 32 }}>
        <h1>Audit Log</h1>
        <p style={{ color: "var(--color-text-secondary)", marginTop: 8 }}>
          Vault state change history for compliance and monitoring.
        </p>
      </header>

      <div className="audit-log-page__controls">
        <div className="audit-log-page__filters" role="group" aria-label="Filter by operation">
          <label htmlFor="operation-filter">Operation:</label>
          <select
            id="operation-filter"
            value={operationFilter}
            onChange={(e) => setOperationFilter(e.target.value as OperationFilter)}
          >
            <option value="all">All</option>
            <option value="deposit">Deposit</option>
            <option value="withdraw">Withdraw</option>
            <option value="strategy_switch">Strategy Switch</option>
            <option value="parameter_change">Parameter Change</option>
          </select>
        </div>

        <div className="audit-log-page__filters">
          <label htmlFor="actor-filter">Actor:</label>
          <input
            id="actor-filter"
            type="text"
            placeholder="Search by actor address..."
            value={actorFilter}
            onChange={(e) => setActorFilter(e.target.value)}
          />
        </div>

        <button
          type="button"
          className="audit-log-page__refresh"
          onClick={() => refetch()}
          disabled={isLoading}
        >
          {isLoading ? "Refreshing\u2026" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="audit-log-page__error" role="alert">
          <p>Unable to load audit log</p>
          <button type="button" onClick={() => refetch()}>
            Retry
          </button>
        </div>
      )}

      {isLoading && !data && (
        <div className="audit-log-page__loading" aria-busy="true">
          <p>Loading audit log\u2026</p>
        </div>
      )}

      {data && data.data.length === 0 && !isLoading && (
        <div className="audit-log-page__empty">
          <p>No audit log entries found</p>
        </div>
      )}

      {data && data.data.length > 0 && (
        <div className="audit-log-page__table" role="table" aria-label="Audit log entries">
          <div className="audit-log-row audit-log-row--header" role="row">
            <div role="columnheader">Timestamp</div>
            <div role="columnheader">Operation</div>
            <div role="columnheader">Actor</div>
            <div role="columnheader">Details</div>
          </div>
          {data.data.map((entry) => (
            <div key={entry.id} className="audit-log-row" role="row">
              <div role="cell">
                {new Date(entry.timestamp).toLocaleString()}
              </div>
              <div role="cell">
                <span
                  className="audit-log-badge"
                  style={{
                    backgroundColor: OPERATION_COLORS[entry.operation] ?? "#6b7280",
                  }}
                >
                  {OPERATION_LABELS[entry.operation] ?? entry.operation}
                </span>
              </div>
              <div role="cell" className="audit-log-actor">
                {entry.actor}
              </div>
              <div role="cell" className="audit-log-details">
                {formatDetails(entry.details)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AuditLog;
