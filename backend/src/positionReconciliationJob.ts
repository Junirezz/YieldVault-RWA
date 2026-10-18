import { getPrismaClient } from './prismaClient';
import { logger } from './middleware/structuredLogging';
import { runJobWithRetry, registerJob, registerJobHandler } from './jobGovernance';

registerJobHandler('positionReconciliation', () => runPositionReconciliationJob());
registerJobHandler('reportGeneration', () => runLedgerReconciliationJob());
import { startEventPollingService } from './eventPollingService';
import { updateVaultMetrics } from './metrics';
import Decimal from 'decimal.js';
import {
  runReconciliationReport,
  type ReconciliationSummary,
} from './reconciliationReport';
import {
  recordReconciliationDrift,
  setReconciliationLastRunTimestamp,
  setReconciliationStatus,
} from './metrics';

const prisma = getPrismaClient();

export async function runPositionReconciliationJob(): Promise<void> {
  const contractId = process.env.VITE_VAULT_CONTRACT_ID || process.env.VAULT_CONTRACT_ID;
  if (!contractId) {
    throw new Error('VITE_VAULT_CONTRACT_ID or VAULT_CONTRACT_ID environment variable is not set');
  }

  logger.log('info', 'Position reconciliation job started');

  const pollingService = startEventPollingService({
    rpcUrl: process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org',
    contractId,
    pollIntervalMs: parseInt(process.env.EVENT_POLL_INTERVAL_MS || '10000', 10),
    batchSize: parseInt(process.env.EVENT_REPLAY_BATCH_SIZE || '100', 10),
  });

  await pollingService.pollEvents();

  const state = await prisma.vaultState.findUnique({ where: { id: 1 } });
  if (state) {
    const assets = new Decimal(state.totalAssets);
    const shares = new Decimal(state.totalShares);
    const sharePrice = assets.gt(0) && shares.gt(0) ? assets.div(shares) : new Decimal(1);

    updateVaultMetrics(assets.toNumber(), sharePrice.toNumber());

    logger.log('info', 'Vault metrics updated from on-chain state', {
      tvl: assets.toString(),
      sharePrice: sharePrice.toString(),
    });
  } else {
    updateVaultMetrics(0, 1);
    logger.log('info', 'Vault metrics initialized to default values');
  }

  logger.log('info', 'Position reconciliation job completed');
}

let positionReconciliationTimer: ReturnType<typeof setInterval> | null = null;

export function startPositionReconciliationScheduler(): () => void {
  const enabled = process.env.POSITION_RECONCILIATION_ENABLED !== 'false';
  if (!enabled) {
    logger.log('info', 'Position reconciliation scheduler disabled');
    return () => {};
  }

  const intervalMs = parseInt(process.env.POSITION_RECONCILIATION_INTERVAL_MS || '30000', 10);
  registerJob('positionReconciliation');

  let inFlight = false;
  positionReconciliationTimer = setInterval(() => {
    if (inFlight) {
      logger.log('warn', 'Position reconciliation skipped tick — previous run still in flight');
      return;
    }
    inFlight = true;
    void runJobWithRetry('positionReconciliation', runPositionReconciliationJob)
      .catch((error) => {
        logger.log('error', 'Position reconciliation scheduler error', {
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        inFlight = false;
      });
  }, intervalMs);

  logger.log('info', 'Position reconciliation scheduler started', {
    intervalMs,
  });

  return () => {
    if (positionReconciliationTimer) {
      clearInterval(positionReconciliationTimer);
      positionReconciliationTimer = null;
      logger.log('info', 'Position reconciliation scheduler stopped');
    }
  };
}

// ─── Scheduled ledger drift reconciliation (Issue #724) ─────────────────────

let lastDriftAlertAt = 0;

function getReconciliationIntervalMs(): number {
  return parseInt(process.env.LEDGER_RECONCILIATION_INTERVAL_MS || '300000', 10);
}

function getDriftAlertThreshold(): number {
  return parseInt(process.env.RECONCILIATION_DRIFT_ALERT_THRESHOLD || '1', 10);
}

function getDriftAlertCooldownMs(): number {
  return parseInt(process.env.RECONCILIATION_ALERT_COOLDOWN_MS || '900000', 10);
}

async function sendDriftAlert(report: ReconciliationSummary): Promise<void> {
  const now = Date.now();
  if (now - lastDriftAlertAt < getDriftAlertCooldownMs()) {
    return;
  }

  lastDriftAlertAt = now;
  const webhookUrl = process.env.RECONCILIATION_ALERT_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL;

  logger.log('warn', 'Reconciliation drift detected', {
    drifted: report.counts.drifted,
    reconciliationStatus: report.status,
    window: report.window,
  });

  if (!webhookUrl) {
    return;
  }

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({
        text: `Reconciliation drift detected: ${report.counts.drifted} issue(s) in window ${report.window.from} → ${report.window.to}`,
      }),
    });
  } catch (error) {
    logger.log('error', 'Failed to send reconciliation drift alert', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function runLedgerReconciliationJob(): Promise<ReconciliationSummary> {
  const startedAt = Date.now();
  const report = await runReconciliationReport({
    storeAsAutomated: true,
    persistSnapshot: true,
  });

  setReconciliationLastRunTimestamp(Math.floor(Date.parse(report.generatedAt) / 1000));
  setReconciliationStatus(report.status === 'CLEAN' ? 1 : 0);

  if (report.status === 'DRIFT_DETECTED') {
    for (const entry of report.driftEntries) {
      recordReconciliationDrift(entry.issue);
    }

    if (report.counts.drifted >= getDriftAlertThreshold()) {
      await sendDriftAlert(report);
    }
  }

  logger.log('info', 'Ledger reconciliation job completed', {
    reconciliationStatus: report.status,
    drifted: report.counts.drifted,
    durationMs: Date.now() - startedAt,
  });

  return report;
}

let ledgerReconciliationTimer: ReturnType<typeof setInterval> | null = null;

export function startLedgerReconciliationScheduler(): () => void {
  const enabled = process.env.LEDGER_RECONCILIATION_ENABLED !== 'false';
  if (!enabled) {
    logger.log('info', 'Ledger reconciliation scheduler disabled');
    return () => {};
  }

  const intervalMs = getReconciliationIntervalMs();
  registerJob('reportGeneration');

  let inFlight = false;
  ledgerReconciliationTimer = setInterval(() => {
    if (inFlight) {
      logger.log('warn', 'Ledger reconciliation skipped tick — previous run still in flight');
      return;
    }
    inFlight = true;
    void runJobWithRetry('reportGeneration', runLedgerReconciliationJob)
      .catch((error) => {
        logger.log('error', 'Ledger reconciliation scheduler error', {
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        inFlight = false;
      });
  }, intervalMs);

  logger.log('info', 'Ledger reconciliation scheduler started', { intervalMs });

  return () => {
    if (ledgerReconciliationTimer) {
      clearInterval(ledgerReconciliationTimer);
      ledgerReconciliationTimer = null;
      logger.log('info', 'Ledger reconciliation scheduler stopped');
    }
  };
}

export function resetLedgerReconciliationSchedulerForTests(): void {
  lastDriftAlertAt = 0;
  if (ledgerReconciliationTimer) {
    clearInterval(ledgerReconciliationTimer);
    ledgerReconciliationTimer = null;
  }
}
