/**
 * Session audit trail tracking for security and debugging.
 * 
 * Records all session lifecycle events:
 * - Creation (initial login)
 * - Refresh (token rotation)
 * - Revocation (logout, suspicious activity)
 * - Expiration
 * 
 * Enables:
 * - Security incident investigation
 * - User support for "where did I log in" queries
 * - Anomaly detection
 */

import { prisma } from './prisma';
import { logger } from './middleware/structuredLogging';
import { requestIdStorage } from './requestContext';
import { getCurrentTraceId } from './tracing';

export type SessionEventType = 'created' | 'refreshed' | 'revoked' | 'expired' | 'failed';
export type SessionEventReason = 
  | 'user_logout'
  | 'token_rotation'
  | 'token_expiration'
  | 'suspicious_activity'
  | 'compromised'
  | 'login_success'
  | 'login_failure'
  | 'refresh_success'
  | 'refresh_failure';

export interface SessionAuditEntry {
  walletAddress: string;
  eventType: SessionEventType;
  reason: SessionEventReason;
  sessionId: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, any>;
  correlationId?: string;
  traceId?: string;
}

/**
 * Records a session event to the audit trail.
 */
export async function recordSessionEvent(entry: SessionAuditEntry): Promise<void> {
  try {
    const ctx = requestIdStorage.getStore();
    const correlationId = entry.correlationId || ctx?.correlationId;
    const traceId = entry.traceId || getCurrentTraceId();

    await prisma.sessionAuditLog.create({
      data: {
        walletAddress: entry.walletAddress,
        eventType: entry.eventType,
        reason: entry.reason,
        sessionId: entry.sessionId,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        metadata: entry.metadata,
        correlationId,
        traceId,
        timestamp: new Date(),
      },
    });

    logger.debug('Session event recorded', {
      walletAddress: entry.walletAddress,
      eventType: entry.eventType,
      reason: entry.reason,
      correlationId,
    });
  } catch (err) {
    logger.error('Failed to record session event', {
      error: err instanceof Error ? err.message : String(err),
      walletAddress: entry.walletAddress,
    });
    // Don't throw - audit logging failure shouldn't block auth flow
  }
}

/**
 * Gets session history for a wallet address.
 * Useful for security investigations and user support.
 */
export async function getSessionHistory(
  walletAddress: string,
  limit: number = 50,
  offsetDays: number = 30,
) {
  try {
    const since = new Date(Date.now() - offsetDays * 24 * 60 * 60 * 1000);

    const events = await prisma.sessionAuditLog.findMany({
      where: {
        walletAddress,
        timestamp: { gte: since },
      },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });

    return events;
  } catch (err) {
    logger.error('Failed to retrieve session history', {
      error: err instanceof Error ? err.message : String(err),
      walletAddress,
    });
    return [];
  }
}

/**
 * Detects suspicious session activity patterns.
 * Returns a score (0-1) where 1 is most suspicious.
 */
export async function detectSuspiciousActivity(
  walletAddress: string,
  ipAddress?: string,
  userAgent?: string,
): Promise<{ suspicious: boolean; score: number; reasons: string[] }> {
  const reasons: string[] = [];
  let score = 0;

  try {
    // Get recent activity
    const recentHours = 24;
    const since = new Date(Date.now() - recentHours * 60 * 60 * 1000);

    const recentEvents = await prisma.sessionAuditLog.findMany({
      where: {
        walletAddress,
        timestamp: { gte: since },
      },
    });

    // Check for multiple failed login attempts
    const failedLogins = recentEvents.filter(e => e.reason === 'login_failure').length;
    if (failedLogins >= 3) {
      score += 0.3;
      reasons.push(`${failedLogins} failed login attempts in ${recentHours}h`);
    }

    // Check for unusual geographic/device pattern
    const ips = new Set(recentEvents.map(e => e.ipAddress).filter(Boolean));
    if (ips.size > 3) {
      score += 0.2;
      reasons.push(`Activity from ${ips.size} different IP addresses`);
    }

    const userAgents = new Set(recentEvents.map(e => e.userAgent).filter(Boolean));
    if (userAgents.size > 3) {
      score += 0.2;
      reasons.push(`Activity from ${userAgents.size} different user agents`);
    }

    // Check for rapid token rotations (possible token theft)
    const refreshes = recentEvents.filter(e => e.reason === 'refresh_success');
    if (refreshes.length > 20) {
      score += 0.2;
      reasons.push(`${refreshes.length} token refreshes in ${recentHours}h (potential token theft)`);
    }

    // Check for unusual time-of-day activity (if user has established pattern)
    const weekOfEvents = recentEvents.filter(
      e => e.timestamp > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    );
    if (weekOfEvents.length > 0) {
      const hours = new Set(weekOfEvents.map(e => e.timestamp.getHours()));
      if (hours.size === 1) {
        // All activity in same hour - possible automation
        const hour = Array.from(hours)[0];
        score += 0.15;
        reasons.push(`All activity clustered at hour ${hour} (possible automation)`);
      }
    }

    return {
      suspicious: score > 0.4,
      score: Math.min(score, 1),
      reasons,
    };
  } catch (err) {
    logger.error('Failed to detect suspicious activity', {
      error: err instanceof Error ? err.message : String(err),
      walletAddress,
    });
    return { suspicious: false, score: 0, reasons: [] };
  }
}

/**
 * Gets a summary of session activity for a wallet.
 */
export async function getSessionActivitySummary(walletAddress: string) {
  try {
    const summary = await prisma.sessionAuditLog.groupBy({
      by: ['eventType', 'reason'],
      where: { walletAddress },
      _count: true,
      orderBy: { _count: { eventType: 'desc' } },
    });

    const lastActive = await prisma.sessionAuditLog.findFirst({
      where: { walletAddress },
      orderBy: { timestamp: 'desc' },
    });

    return {
      walletAddress,
      totalEvents: summary.reduce((sum, s) => sum + s._count, 0),
      lastActive: lastActive?.timestamp,
      eventCounts: summary,
    };
  } catch (err) {
    logger.error('Failed to get session activity summary', {
      error: err instanceof Error ? err.message : String(err),
      walletAddress,
    });
    return null;
  }
}
