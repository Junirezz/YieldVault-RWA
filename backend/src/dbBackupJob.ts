/**
 * @file dbBackupJob.ts
 * Daily database backup job with S3-compatible off-site storage (Issue #376).
 *
 * Schedules a daily backup that:
 *  1. Runs pg_dump and gzip-compresses the output in memory.
 *  2. Uploads the compressed dump to an S3-compatible bucket.
 *  3. Prunes backup objects older than BACKUP_RETENTION_DAYS (default 30).
 *  4. Sends a Slack and/or email alert if the job fails after all retries.
 *
 * Environment variables:
 *  BACKUP_ENABLED              – set to 'false' to disable (default: true)
 *  BACKUP_S3_BUCKET            – required: destination bucket name
 *  BACKUP_S3_PREFIX            – key prefix inside the bucket (default: 'backups/')
 *  BACKUP_S3_REGION            – AWS/S3-compatible region (default: 'us-east-1')
 *  BACKUP_S3_ENDPOINT          – custom endpoint URL for S3-compatible stores (MinIO, R2, B2…)
 *  AWS_ACCESS_KEY_ID           – S3 access key
 *  AWS_SECRET_ACCESS_KEY       – S3 secret key
 *  BACKUP_RETENTION_DAYS       – days to keep backups (default: 30)
 *  BACKUP_SCHEDULE_HOUR_UTC    – UTC hour to run daily backup (default: 2)
 *  BACKUP_SLACK_WEBHOOK_URL    – Slack incoming webhook for failure alerts
 *  BACKUP_ALERT_EMAIL          – email address for failure alerts
 *  DATABASE_URL                – Postgres connection string (already required by Prisma)
 */

import { spawn } from 'child_process';
import { createGzip } from 'zlib';
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { emailService } from './emailService';
import { logger } from './middleware/structuredLogging';
import { runJobWithRetry, registerJobHandler } from './jobGovernance';

// ─── Register Job Handler ───────────────────────────────────────────────────
registerJobHandler('databaseBackup', () => runDbBackupJob());

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BackupResult {
  key: string;
  sizeBytes: number;
  deletedCount: number;
}

interface S3ListObjectsResponse {
  Contents?: Array<{
    Key?: string;
    LastModified?: Date;
  }>;
  NextContinuationToken?: string;
}

// ─── Config helpers ───────────────────────────────────────────────────────────

function getRetentionDays(): number {
  return parseInt(process.env.BACKUP_RETENTION_DAYS || '30', 10);
}

function getS3Prefix(): string {
  return process.env.BACKUP_S3_PREFIX || 'backups/';
}

export function buildS3Client(): S3Client {
  const endpoint = process.env.BACKUP_S3_ENDPOINT;
  return new S3Client({
    region: process.env.BACKUP_S3_REGION || 'us-east-1',
    ...(endpoint ? { endpoint } : {}),
    ...(process.env.AWS_ACCESS_KEY_ID
      ? {
          credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
          },
        }
      : {}),
    // Path-style addressing is required for most self-hosted S3-compatible stores.
    forcePathStyle: !!endpoint,
  });
}

// ─── pg_dump + gzip ──────────────────────────────────────────────────────────

export async function dumpDatabase(): Promise<Buffer> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');

  return new Promise<Buffer>((resolve, reject) => {
    let settled = false;
    const fail = (err: Error) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    };

    const child = spawn('pg_dump', ['--dbname', databaseUrl], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const gzip = createGzip();
    const chunks: Buffer[] = [];

    child.stdout.pipe(gzip);
    gzip.on('data', (chunk: Buffer) => chunks.push(chunk));
    gzip.on('end', () => {
      if (!settled) {
        settled = true;
        resolve(Buffer.concat(chunks));
      }
    });
    gzip.on('error', fail);

    child.on('error', fail);
    child.on('close', (code) => {
      if (code !== 0) {
        fail(new Error(`pg_dump exited with code ${code}`));
      }
    });

    child.stderr.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) logger.log('warn', 'pg_dump stderr output', { message: msg });
    });
  });
}

// ─── S3 upload ────────────────────────────────────────────────────────────────

export async function uploadBackup(key: string, body: Buffer): Promise<void> {
  const bucket = process.env.BACKUP_S3_BUCKET;
  if (!bucket) throw new Error('BACKUP_S3_BUCKET is not set');

  const client = buildS3Client();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: 'application/gzip',
      ContentLength: body.length,
      Metadata: {
        createdAt: new Date().toISOString(),
      },
    }),
  );
}

// ─── Retention pruning ───────────────────────────────────────────────────────

export async function pruneOldBackups(): Promise<number> {
  const bucket = process.env.BACKUP_S3_BUCKET;
  if (!bucket) throw new Error('BACKUP_S3_BUCKET is not set');

  const retentionDays = getRetentionDays();
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);

  const client = buildS3Client();
  let deleted = 0;
  let continuationToken: string | undefined;

  do {
    const listResp = (await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: getS3Prefix(),
        ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
      }),
    )) as S3ListObjectsResponse;

    for (const obj of listResp.Contents ?? []) {
      if (obj.LastModified && obj.Key && obj.LastModified < cutoff) {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: obj.Key }));
        deleted += 1;
        logger.log('info', 'Pruned old backup', { key: obj.Key, lastModified: obj.LastModified });
      }
    }

    continuationToken = listResp.NextContinuationToken;
  } while (continuationToken);

  return deleted;
}

// ─── Failure alerts ──────────────────────────────────────────────────────────

export async function sendBackupFailureAlert(error: Error): Promise<void> {
  const ts = new Date().toISOString();
  const message = `Database backup failed at ${ts}: ${error.message}`;

  logger.log('error', 'Database backup failure alert dispatched', {
    error: error.message,
    timestamp: ts,
  });

  const slackUrl = process.env.BACKUP_SLACK_WEBHOOK_URL;
  if (slackUrl) {
    try {
      const resp = await fetch(slackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `:rotating_light: *YieldVault DB Backup Failed*\n>${message}`,
        }),
      });
      if (!resp.ok) {
        logger.log('warn', 'Slack backup alert returned non-OK status', { status: resp.status });
      }
    } catch (err) {
      logger.log('error', 'Failed to POST Slack backup alert', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const alertEmail = process.env.BACKUP_ALERT_EMAIL;
  if (alertEmail) {
    await emailService.sendEmail({
      to: alertEmail,
      subject: 'YieldVault: Database Backup Failed',
      text: message,
      html: `<p><strong>Database backup failed</strong></p><p>${message}</p>`,
    });
  }
}

// ─── Core job ────────────────────────────────────────────────────────────────

export async function runDbBackupJob(): Promise<BackupResult> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const date = new Date().toISOString().slice(0, 10);
  const key = `${getS3Prefix()}${date}/${timestamp}.sql.gz`;

  logger.log('info', 'Database backup job started', { key });

  const body = await dumpDatabase();
  await uploadBackup(key, body);

  logger.log('info', 'Database backup uploaded', { key, sizeBytes: body.length });

  const deletedCount = await pruneOldBackups();

  logger.log('info', 'Database backup job completed', {
    key,
    sizeBytes: body.length,
    deletedCount,
  });

  return { key, sizeBytes: body.length, deletedCount };
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

function msUntilNextBackupUtc(): number {
  const scheduleHour = parseInt(process.env.BACKUP_SCHEDULE_HOUR_UTC || '2', 10);
  const now = new Date();
  const next = new Date();
  next.setUTCHours(scheduleHour, 0, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime() - now.getTime();
}

let schedulerTimer: ReturnType<typeof setTimeout> | null = null;

export function startDbBackupScheduler(): () => void {
  const enabled = process.env.BACKUP_ENABLED !== 'false';
  if (!enabled) {
    logger.log('info', 'DB backup scheduler disabled via BACKUP_ENABLED=false');
    return () => {};
  }

  const schedule = async () => {
    try {
      await runJobWithRetry('databaseBackup', () => runDbBackupJob());
    } catch (err) {
      await sendBackupFailureAlert(
        err instanceof Error ? err : new Error(String(err)),
      );
    } finally {
      const delay = msUntilNextBackupUtc();
      logger.log('info', 'DB backup next run scheduled', {
        inMs: delay,
        nextRun: new Date(Date.now() + delay).toISOString(),
      });
      schedulerTimer = setTimeout(schedule, delay);
    }
  };

  const initialDelay = msUntilNextBackupUtc();
  logger.log('info', 'DB backup scheduler started', {
    firstRunIn: initialDelay,
    nextRun: new Date(Date.now() + initialDelay).toISOString(),
  });
  schedulerTimer = setTimeout(schedule, initialDelay);

  return () => {
    if (schedulerTimer) {
      clearTimeout(schedulerTimer);
      schedulerTimer = null;
      logger.log('info', 'DB backup scheduler stopped');
    }
  };
}
