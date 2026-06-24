import type { NextFunction, Request, Response } from 'express';
import { logger } from './middleware/structuredLogging';

export interface MaintenanceModeState {
  enabled: boolean;
  reason?: string;
  updatedAt: string;
  updatedBy?: string;
  retryAfterSeconds: number;
}

export interface MaintenanceModeUpdateInput {
  enabled?: boolean;
  reason?: string | null;
  retryAfterSeconds?: number;
  actor?: string;
}

const DEFAULT_RETRY_AFTER_SECONDS = parseInt(
  process.env.MAINTENANCE_MODE_RETRY_AFTER_SECONDS || '300',
  10,
);

function parseBooleanEnv(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

function parseRetryAfterSeconds(value: string | undefined): number {
  const parsed = parseInt(value || '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_RETRY_AFTER_SECONDS;
  }

  return parsed;
}

function readEnvState(): MaintenanceModeState {
  const enabled = parseBooleanEnv(process.env.MAINTENANCE_MODE_ENABLED);
  const reason = process.env.MAINTENANCE_MODE_REASON?.trim();

  return {
    enabled,
    reason: reason || undefined,
    updatedAt: new Date().toISOString(),
    retryAfterSeconds: parseRetryAfterSeconds(process.env.MAINTENANCE_MODE_RETRY_AFTER_SECONDS),
  };
}

const envState = readEnvState();
let runtimeState: MaintenanceModeState | null = null;

export function getMaintenanceModeState(): MaintenanceModeState {
  return runtimeState ?? envState;
}

export function updateMaintenanceModeState(update: MaintenanceModeUpdateInput): MaintenanceModeState {
  const previous = getMaintenanceModeState();
  const next: MaintenanceModeState = {
    enabled: update.enabled ?? previous.enabled,
    reason: update.reason === undefined ? previous.reason : update.reason?.trim() || undefined,
    updatedAt: new Date().toISOString(),
    updatedBy: update.actor ?? previous.updatedBy,
    retryAfterSeconds: update.retryAfterSeconds ?? previous.retryAfterSeconds,
  };

  runtimeState = next;
  return next;
}

export function resetMaintenanceModeState(): void {
  runtimeState = null;
}

function isMaintenanceBypassPath(pathname: string): boolean {
  return (
    pathname === '/health' ||
    pathname === '/ready' ||
    pathname === '/metrics' ||
    pathname === '/maintenance/status' ||
    pathname.startsWith('/admin/maintenance')
  );
}

function isMutatingMethod(method: string): boolean {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
}

export function maintenanceModeMiddleware(req: Request, res: Response, next: NextFunction): void {
  const state = getMaintenanceModeState();

  if (!state.enabled || !isMutatingMethod(req.method) || isMaintenanceBypassPath(req.path)) {
    next();
    return;
  }

  res.setHeader('Retry-After', String(state.retryAfterSeconds));
  res.status(503).json({
    error: 'Service Unavailable',
    status: 503,
    message: state.reason
      ? `Maintenance mode is enabled. ${state.reason}`
      : 'Maintenance mode is enabled. Please retry later.',
    retryAfterSeconds: state.retryAfterSeconds,
    maintenanceMode: {
      enabled: true,
      reason: state.reason,
      updatedAt: state.updatedAt,
    },
  });
}

export function logMaintenanceTransition(details: {
  enabled: boolean;
  actor: string;
  reason?: string;
  retryAfterSeconds: number;
  previousEnabled: boolean;
}): void {
  logger.log('info', details.enabled ? 'Maintenance mode enabled' : 'Maintenance mode disabled', {
    actor: details.actor,
    reason: details.reason,
    enabled: details.enabled,
    previousEnabled: details.previousEnabled,
    retryAfterSeconds: details.retryAfterSeconds,
  });
}