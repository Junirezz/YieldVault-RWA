/**
 * Structured maintenance window scheduler (Issue #714).
 *
 * Schedules future maintenance windows and exposes active/next visibility via a
 * read-only status endpoint. When a window is active, maintenance mode is
 * enabled automatically.
 */

import {
  getMaintenanceModeState,
  updateMaintenanceModeState,
  logMaintenanceTransition,
} from './maintenanceMode';
import { logger } from './middleware/structuredLogging';

export interface MaintenanceWindow {
  id: string;
  title: string;
  reason?: string;
  startsAt: string;
  endsAt: string;
  createdAt: string;
  createdBy?: string;
}

export interface MaintenanceWindowInput {
  title: string;
  reason?: string;
  startsAt: string;
  endsAt: string;
  actor?: string;
}

export interface MaintenanceStatusPayload {
  maintenanceMode: {
    enabled: boolean;
    reason?: string;
    updatedAt: string;
    retryAfterSeconds: number;
  };
  activeWindow: MaintenanceWindow | null;
  nextWindow: MaintenanceWindow | null;
  serverTime: string;
}

const windows: MaintenanceWindow[] = [];
let schedulerHandle: ReturnType<typeof setInterval> | null = null;
let lastAppliedWindowId: string | null = null;

const DEFAULT_POLL_INTERVAL_MS = parseInt(
  process.env.MAINTENANCE_WINDOW_POLL_MS || '30000',
  10,
);

function parseIso(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ISO timestamp: ${value}`);
  }
  return parsed;
}

function generateWindowId(): string {
  return `mw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function resetMaintenanceWindowsForTests(): void {
  windows.length = 0;
  lastAppliedWindowId = null;
}

export function listMaintenanceWindows(): MaintenanceWindow[] {
  return [...windows].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export function scheduleMaintenanceWindow(input: MaintenanceWindowInput): MaintenanceWindow {
  const startsAt = parseIso(input.startsAt);
  const endsAt = parseIso(input.endsAt);

  if (endsAt.getTime() <= startsAt.getTime()) {
    throw new Error('endsAt must be after startsAt');
  }

  const window: MaintenanceWindow = {
    id: generateWindowId(),
    title: input.title.trim(),
    reason: input.reason?.trim() || undefined,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    createdAt: new Date().toISOString(),
    createdBy: input.actor,
  };

  windows.push(window);
  windows.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return window;
}

export function cancelMaintenanceWindow(windowId: string): boolean {
  const index = windows.findIndex((entry) => entry.id === windowId);
  if (index === -1) {
    return false;
  }
  windows.splice(index, 1);
  if (lastAppliedWindowId === windowId) {
    lastAppliedWindowId = null;
  }
  return true;
}

function isWindowActive(window: MaintenanceWindow, now: Date): boolean {
  const start = parseIso(window.startsAt).getTime();
  const end = parseIso(window.endsAt).getTime();
  const ts = now.getTime();
  return ts >= start && ts < end;
}

export function getActiveMaintenanceWindow(now = new Date()): MaintenanceWindow | null {
  return listMaintenanceWindows().find((window) => isWindowActive(window, now)) ?? null;
}

export function getNextMaintenanceWindow(now = new Date()): MaintenanceWindow | null {
  const ts = now.getTime();
  return (
    listMaintenanceWindows().find((window) => parseIso(window.startsAt).getTime() > ts) ?? null
  );
}

export function buildMaintenanceStatusPayload(now = new Date()): MaintenanceStatusPayload {
  const mode = getMaintenanceModeState();
  return {
    maintenanceMode: {
      enabled: mode.enabled,
      reason: mode.reason,
      updatedAt: mode.updatedAt,
      retryAfterSeconds: mode.retryAfterSeconds,
    },
    activeWindow: getActiveMaintenanceWindow(now),
    nextWindow: getNextMaintenanceWindow(now),
    serverTime: now.toISOString(),
  };
}

function retryAfterSecondsForWindow(window: MaintenanceWindow, now: Date): number {
  const endMs = parseIso(window.endsAt).getTime();
  const remaining = Math.max(1, Math.ceil((endMs - now.getTime()) / 1000));
  return remaining;
}

/** Apply scheduled window state to maintenance mode. */
export function syncMaintenanceModeWithWindows(now = new Date()): void {
  const active = getActiveMaintenanceWindow(now);
  const previous = getMaintenanceModeState();

  if (active) {
    const reason = active.reason || `Scheduled maintenance: ${active.title}`;
    const retryAfterSeconds = retryAfterSecondsForWindow(active, now);

    if (!previous.enabled || lastAppliedWindowId !== active.id) {
      updateMaintenanceModeState({
        enabled: true,
        reason,
        retryAfterSeconds,
        actor: 'maintenance-window-scheduler',
      });
      logMaintenanceTransition({
        enabled: true,
        actor: 'maintenance-window-scheduler',
        reason,
        retryAfterSeconds,
        previousEnabled: previous.enabled,
      });
      lastAppliedWindowId = active.id;
      logger.log('info', 'Maintenance window activated', {
        windowId: active.id,
        title: active.title,
        endsAt: active.endsAt,
      });
    } else if (previous.retryAfterSeconds !== retryAfterSeconds) {
      updateMaintenanceModeState({ retryAfterSeconds, actor: 'maintenance-window-scheduler' });
    }
    return;
  }

  if (lastAppliedWindowId && previous.enabled && previous.updatedBy === 'maintenance-window-scheduler') {
    updateMaintenanceModeState({
      enabled: false,
      reason: undefined,
      actor: 'maintenance-window-scheduler',
    });
    logMaintenanceTransition({
      enabled: false,
      actor: 'maintenance-window-scheduler',
      retryAfterSeconds: previous.retryAfterSeconds,
      previousEnabled: true,
    });
    logger.log('info', 'Maintenance window ended', { windowId: lastAppliedWindowId });
    lastAppliedWindowId = null;
  }
}

export function startMaintenanceWindowScheduler(
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
): () => void {
  if (schedulerHandle) {
    clearInterval(schedulerHandle);
  }

  syncMaintenanceModeWithWindows();
  schedulerHandle = setInterval(() => {
    try {
      syncMaintenanceModeWithWindows();
    } catch (error) {
      logger.log('error', 'Maintenance window scheduler tick failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, pollIntervalMs);

  if (schedulerHandle.unref) {
    schedulerHandle.unref();
  }

  return () => {
    if (schedulerHandle) {
      clearInterval(schedulerHandle);
      schedulerHandle = null;
    }
  };
}
