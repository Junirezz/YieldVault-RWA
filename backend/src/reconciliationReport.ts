/**
 * @file reconciliationReport.ts
 * Deterministic reconciliation report endpoint for ledger vs database drift.
 *
 * Compares on-chain ledger events (from Horizon/Soroban) against persisted
 * database state and produces a drift summary. Useful for identifying
 * missed events, duplicates, and amount mismatches.
 *
 * Issue #724
 */

import type { Request, Response } from 'express';
import { getPrismaClient } from './prismaClient';
import { logger } from './middleware/structuredLogging';
import { getCurrentTraceId } from './tracing';
import { sendApiError } from './middleware/apiError';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface LedgerRecord {
  transactionHash: string;
  type: string;
  amount: string;
  walletAddress: string;
  timestamp: string;
}

export interface DriftEntry {
  transactionHash: string;
  issue: 'MISSING_IN_DB' | 'MISSING_ON_LEDGER' | 'AMOUNT_MISMATCH' | 'TYPE_MISMATCH';
  details: Record<string, unknown>;
}

export interface ReconciliationSummary {
  generatedAt: string;
  traceId: string | undefined;
  window: {
    from: string;
    to: string;
  };
  counts: {
    ledgerRecords: number;
    databaseRecords: number;
    matched: number;
    drifted: number;
  };
  driftEntries: DriftEntry[];
  status: 'CLEAN' | 'DRIFT_DETECTED';
}

export type LedgerFetcher = (from: string, to: string) => Promise<LedgerRecord[]>;

let lastAutomatedSummary: ReconciliationSummary | null = null;
let lastAutomatedRunAt: string | null = null;

export function getLastAutomatedReconciliationSummary(): ReconciliationSummary | null {
  return lastAutomatedSummary;
}

export function getLastAutomatedReconciliationRunAt(): string | null {
  return lastAutomatedRunAt;
}

export function resetReconciliationStateForTests(): void {
  lastAutomatedSummary = null;
  lastAutomatedRunAt = null;
}

// ─── Ledger Fetcher ─────────────────────────────────────────────────────────

/**
 * Fetches recent transaction records from the Horizon API for reconciliation.
 * In production, this queries the Stellar Horizon /transactions endpoint.
 * Falls back gracefully if Horizon is unreachable.
 */
export async function fetchLedgerRecords(
  from: string,
  to: string,
): Promise<LedgerRecord[]> {
  const horizonUrl = process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org';
  const vaultAddress = process.env.VAULT_PUBLIC_ADDRESS;

  if (!vaultAddress) {
    logger.log('warn', 'VAULT_PUBLIC_ADDRESS not set — ledger reconciliation will use DB-only mode');
    return [];
  }

  try {
    const url = `${horizonUrl}/accounts/${vaultAddress}/transactions?limit=200&order=asc`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      logger.log('warn', `Horizon returned ${response.status} during reconciliation`);
      return [];
    }

    const data = await response.json() as any;
    const records: LedgerRecord[] = [];

    for (const record of data?._embedded?.records ?? []) {
      const createdAt = record.created_at;
      if (createdAt < from || createdAt > to) continue;

      records.push({
        transactionHash: record.hash,
        type: record.memo_type === 'text' && record.memo?.startsWith('withdraw') ? 'withdrawal' : 'deposit',
        amount: record.fee_charged || '0',
        walletAddress: record.source_account,
        timestamp: createdAt,
      });
    }

    return records;
  } catch (err) {
    logger.log('error', 'Failed to fetch ledger records for reconciliation', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

// ─── Database Fetcher ───────────────────────────────────────────────────────

export async function fetchDatabaseRecords(
  from: string,
  to: string,
): Promise<LedgerRecord[]> {
  const prisma = getPrismaClient();

  try {
    const transactions = await prisma.transaction.findMany({
      where: {
        timestamp: {
          gte: new Date(from),
          lte: new Date(to),
        },
      },
      orderBy: { timestamp: 'asc' },
      take: 5000,
    });

    return transactions.map((tx: any) => ({
      transactionHash: tx.id,
      type: tx.type,
      amount: String(tx.amount),
      walletAddress: tx.user,
      timestamp: tx.timestamp instanceof Date ? tx.timestamp.toISOString() : String(tx.timestamp),
    }));
  } catch (err) {
    logger.log('warn', 'Failed to fetch database records for reconciliation — model may not exist', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

// ─── Reconciliation Logic ───────────────────────────────────────────────────

export function reconcile(
  ledgerRecords: LedgerRecord[],
  dbRecords: LedgerRecord[],
): { matched: number; driftEntries: DriftEntry[] } {
  const dbByHash = new Map<string, LedgerRecord>();
  for (const rec of dbRecords) {
    dbByHash.set(rec.transactionHash, rec);
  }

  const ledgerByHash = new Map<string, LedgerRecord>();
  for (const rec of ledgerRecords) {
    ledgerByHash.set(rec.transactionHash, rec);
  }

  const driftEntries: DriftEntry[] = [];
  let matched = 0;

  for (const ledgerRec of ledgerRecords) {
    const dbRec = dbByHash.get(ledgerRec.transactionHash);
    if (!dbRec) {
      driftEntries.push({
        transactionHash: ledgerRec.transactionHash,
        issue: 'MISSING_IN_DB',
        details: {
          ledgerType: ledgerRec.type,
          ledgerAmount: ledgerRec.amount,
          ledgerWallet: ledgerRec.walletAddress,
          ledgerTimestamp: ledgerRec.timestamp,
        },
      });
      continue;
    }

    if (ledgerRec.amount !== dbRec.amount) {
      driftEntries.push({
        transactionHash: ledgerRec.transactionHash,
        issue: 'AMOUNT_MISMATCH',
        details: {
          ledgerAmount: ledgerRec.amount,
          databaseAmount: dbRec.amount,
        },
      });
      continue;
    }

    if (ledgerRec.type !== dbRec.type) {
      driftEntries.push({
        transactionHash: ledgerRec.transactionHash,
        issue: 'TYPE_MISMATCH',
        details: {
          ledgerType: ledgerRec.type,
          databaseType: dbRec.type,
        },
      });
      continue;
    }

    matched++;
  }

  for (const dbRec of dbRecords) {
    if (!ledgerByHash.has(dbRec.transactionHash) && ledgerRecords.length > 0) {
      driftEntries.push({
        transactionHash: dbRec.transactionHash,
        issue: 'MISSING_ON_LEDGER',
        details: {
          databaseType: dbRec.type,
          databaseAmount: dbRec.amount,
          databaseWallet: dbRec.walletAddress,
          databaseTimestamp: dbRec.timestamp,
        },
      });
    }
  }

  return { matched, driftEntries };
}

export interface RunReconciliationOptions {
  from?: string;
  to?: string;
  traceId?: string;
  ledgerFetcher?: LedgerFetcher;
  persistSnapshot?: boolean;
  storeAsAutomated?: boolean;
}

export async function runReconciliationReport(
  options: RunReconciliationOptions = {},
): Promise<ReconciliationSummary> {
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - getReconciliationWindowMs());

  const from = options.from || defaultFrom.toISOString();
  const to = options.to || now.toISOString();
  const traceId = options.traceId;
  const ledgerFetcher = options.ledgerFetcher || fetchLedgerRecords;

  const [ledgerRecords, dbRecords] = await Promise.all([
    ledgerFetcher(from, to),
    fetchDatabaseRecords(from, to),
  ]);

  const { matched, driftEntries } = reconcile(ledgerRecords, dbRecords);

  const report: ReconciliationSummary = {
    generatedAt: now.toISOString(),
    traceId,
    window: { from, to },
    counts: {
      ledgerRecords: ledgerRecords.length,
      databaseRecords: dbRecords.length,
      matched,
      drifted: driftEntries.length,
    },
    driftEntries: driftEntries.slice(0, 100),
    status: driftEntries.length === 0 ? 'CLEAN' : 'DRIFT_DETECTED',
  };

  if (options.storeAsAutomated) {
    lastAutomatedSummary = report;
    lastAutomatedRunAt = report.generatedAt;
  }

  if (options.persistSnapshot !== false && options.storeAsAutomated) {
    await persistReconciliationSnapshot(report);
  }

  return report;
}

function getReconciliationWindowMs(): number {
  const hours = parseInt(process.env.RECONCILIATION_WINDOW_HOURS || '24', 10);
  return Math.max(1, hours) * 60 * 60 * 1000;
}

async function persistReconciliationSnapshot(report: ReconciliationSummary): Promise<void> {
  try {
    const prisma = getPrismaClient();
    await prisma.reconciliationSnapshot.create({
      data: {
        id: `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        generatedAt: new Date(report.generatedAt),
        traceId: report.traceId ?? null,
        status: report.status,
        windowFrom: new Date(report.window.from),
        windowTo: new Date(report.window.to),
        summaryJson: JSON.stringify(report),
        driftCount: report.counts.drifted,
      },
    });
  } catch (error) {
    logger.log('warn', 'Failed to persist reconciliation snapshot', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ─── Handler ────────────────────────────────────────────────────────────────

export async function reconciliationReportHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const traceId = getCurrentTraceId();

  logger.log('info', 'Reconciliation report requested', {
    traceId,
    from: req.query.from,
    to: req.query.to,
    requestedBy: req.get('x-admin-address') || 'unknown',
  });

  const report = await runReconciliationReport({
    from: req.query.from as string | undefined,
    to: req.query.to as string | undefined,
    traceId,
    storeAsAutomated: false,
    persistSnapshot: false,
  });

  res.status(200).json(report);
}

export async function automatedReconciliationSummaryHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const summary = getLastAutomatedReconciliationSummary();
  if (!summary) {
    sendApiError(req, res, {
      status: 404,
      code: 'RECONCILIATION_SUMMARY_NOT_FOUND',
      message: 'No automated reconciliation summary available yet',
    });
    return;
  }

  res.status(200).json({
    summary,
    lastRunAt: getLastAutomatedReconciliationRunAt(),
    requestedBy: req.get('x-admin-address') || 'unknown',
  });
}
