import { spawn } from 'child_process';
import * as net from 'net';

export interface WaitForDbOptions {
  host?: string;
  port?: number;
  user?: string;
  database?: string;
  timeoutSeconds?: number;
  intervalMs?: number;
  checker?: () => Promise<boolean>;
  logger?: {
    log: (msg: string) => void;
    error: (msg: string) => void;
  };
}

export function parseDatabaseUrl(urlStr?: string): {
  host?: string;
  port?: number;
  user?: string;
  database?: string;
} {
  if (!urlStr) return {};
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname || undefined;
    const port = parsed.port ? parseInt(parsed.port, 10) : undefined;
    const user = parsed.username || undefined;
    const database = parsed.pathname ? parsed.pathname.replace(/^\//, '') : undefined;
    return { host, port, user, database };
  } catch {
    return {};
  }
}

export async function checkTcpConnection(host: string, port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let isResolved = false;

    const cleanup = () => {
      socket.removeAllListeners();
      socket.destroy();
    };

    socket.setTimeout(timeoutMs);

    socket.once('connect', () => {
      if (!isResolved) {
        isResolved = true;
        cleanup();
        resolve(true);
      }
    });

    socket.once('timeout', () => {
      if (!isResolved) {
        isResolved = true;
        cleanup();
        resolve(false);
      }
    });

    socket.once('error', () => {
      if (!isResolved) {
        isResolved = true;
        cleanup();
        resolve(false);
      }
    });

    socket.connect(port, host);
  });
}

export async function checkPgIsReadyCli(
  host: string,
  port: number,
  user: string,
  database: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('pg_isready', ['-h', host, '-p', String(port), '-U', user, '-d', database]);

    child.on('error', () => {
      resolve(false);
    });

    child.on('exit', (code) => {
      resolve(code === 0);
    });
  });
}

export async function checkPgIsReadyInDocker(
  user: string,
  database: string,
  containerNames = ['yieldvault-postgres', 'yieldvault-postgres-1', 'postgres'],
): Promise<boolean> {
  for (const container of containerNames) {
    const ok = await new Promise<boolean>((resolve) => {
      const child = spawn('docker', ['exec', container, 'pg_isready', '-U', user, '-d', database]);
      child.on('error', () => resolve(false));
      child.on('exit', (code) => resolve(code === 0));
    });
    if (ok) return true;
  }
  return false;
}

export async function defaultDbChecker(
  host: string,
  port: number,
  user: string,
  database: string,
): Promise<boolean> {
  const cliOk = await checkPgIsReadyCli(host, port, user, database);
  if (cliOk) return true;

  const dockerOk = await checkPgIsReadyInDocker(user, database);
  if (dockerOk) return true;

  return checkTcpConnection(host, port);
}

export async function waitForDb(options: WaitForDbOptions = {}): Promise<{
  success: boolean;
  elapsedSeconds: number;
  message: string;
}> {
  const dbUrlConfig = parseDatabaseUrl(process.env.DATABASE_URL);

  const host = options.host ?? process.env.POSTGRES_HOST ?? dbUrlConfig.host ?? 'localhost';
  const port = options.port ?? (process.env.POSTGRES_PORT ? parseInt(process.env.POSTGRES_PORT, 10) : undefined) ?? dbUrlConfig.port ?? 5432;
  const user = options.user ?? process.env.POSTGRES_USER ?? dbUrlConfig.user ?? 'postgres';
  const database = options.database ?? process.env.POSTGRES_DB ?? dbUrlConfig.database ?? 'yieldvault';
  const timeoutSeconds = options.timeoutSeconds ?? (process.env.WAIT_FOR_DB_TIMEOUT ? parseInt(process.env.WAIT_FOR_DB_TIMEOUT, 10) : 30);
  const intervalMs = options.intervalMs ?? 1000;
  const logger = options.logger ?? console;

  const checker = options.checker ?? (() => defaultDbChecker(host, port, user, database));

  logger.log(
    `Waiting for PostgreSQL (${host}:${port}, db: ${database}, user: ${user}) to be ready (timeout: ${timeoutSeconds}s)...`,
  );

  const startTime = Date.now();
  const maxTime = startTime + timeoutSeconds * 1000;

  while (Date.now() <= maxTime) {
    try {
      const ready = await checker();
      if (ready) {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        const msg = `PostgreSQL is ready after ${elapsed}s!`;
        logger.log(msg);
        return { success: true, elapsedSeconds: elapsed, message: msg };
      }
    } catch {
      // Ignored and retried
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    logger.log(`Waiting for PostgreSQL... (${elapsed}/${timeoutSeconds}s)`);

    if (Date.now() + intervalMs > maxTime) {
      break;
    }
    await new Promise((res) => setTimeout(res, intervalMs));
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const errMsg = `Error: Timed out waiting ${timeoutSeconds}s for PostgreSQL to become ready at ${host}:${port}`;
  logger.error(errMsg);
  return { success: false, elapsedSeconds: elapsed, message: errMsg };
}

// If run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  waitForDb().then((res) => {
    if (!res.success) {
      process.exit(1);
    }
  });
}
