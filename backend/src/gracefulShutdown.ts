import { Server } from 'http';
import type { Socket } from 'net';
import { logger } from './middleware/structuredLogging';

// Default bound on the DB/job cleanup step so a hung disconnect can't wedge
// the process indefinitely once connections have already drained.
const DEFAULT_CLEANUP_TIMEOUT_MS = 10000;

export class GracefulShutdownHandler {
  private drainTimeout: number;
  private cleanupTimeout: number;
  private server: Server | null = null;
  private activeConnections = new Set<Socket>();
  private cleanupTasks: (() => Promise<void>)[] = [];
  private shuttingDown = false;

  constructor(drainTimeoutMs: number = 30000, cleanupTimeoutMs: number = DEFAULT_CLEANUP_TIMEOUT_MS) {
    this.drainTimeout = drainTimeoutMs;
    this.cleanupTimeout = cleanupTimeoutMs;
  }

  /**
   * True from the moment a shutdown signal is received. Request-handling
   * code (e.g. the shutdown-gate middleware) uses this to start rejecting
   * new work with a 503 before the listener actually stops accepting sockets.
   */
  isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  register(server: Server): void {
    this.server = server;

    server.on('connection', (socket: Socket) => {
      this.activeConnections.add(socket);

      socket.on('close', () => {
        this.activeConnections.delete(socket);
      });
    });

    const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];
    signals.forEach((signal) => {
      process.on(signal, () => this.shutdown(signal));
    });
  }

  /**
   * Register an asynchronous cleanup task to be run during shutdown.
   */
  onShutdown(task: () => Promise<void>): void {
    this.cleanupTasks.push(task);
  }

  private async shutdown(signal: string): Promise<void> {
    logger.log('info', `${signal} received, starting graceful shutdown`);

    // Flip the gate immediately: request-handling middleware checks this to
    // start returning 503s before the listener has actually stopped accepting.
    this.shuttingDown = true;

    if (!this.server) {
      await this.runCleanupTasks();
      process.exit(0);
      return;
    }

    // Force-destroy any remaining sockets if the drain takes too long, so a
    // slow/stuck client can't block shutdown forever. This only forces the
    // HTTP drain; cleanup still runs afterwards so DB connections close
    // cleanly instead of being torn down mid-transaction.
    const drainTimer = setTimeout(() => {
      logger.log(
        'warn',
        `Drain timeout exceeded (${this.drainTimeout}ms), closing ${this.activeConnections.size} active connections`,
      );

      this.activeConnections.forEach((socket) => {
        socket.destroy();
      });
    }, this.drainTimeout);

    drainTimer.unref();

    try {
      // Stop accepting new connections and wait for in-flight requests
      // (and any transaction they hold open) to finish before touching
      // the database connection or background jobs.
      await new Promise<void>((resolve) => {
        this.server!.close(() => {
          logger.log('info', 'Server closed, no longer accepting connections');
          resolve();
        });
      });

      clearTimeout(drainTimer);

      // Only now run registered cleanup tasks (DB disconnect, job/poller
      // shutdown) — in-flight work has already completed or been drained,
      // so this can no longer interrupt a mid-commit transaction.
      await this.runCleanupTasks();

      process.exit(0);
    } catch (error) {
      logger.log('error', 'Error during graceful shutdown', {
        error: error instanceof Error ? error.message : String(error)
      });
      process.exit(1);
    }
  }

  private async runCleanupTasks(): Promise<void> {
    const cleanup = Promise.all(
      this.cleanupTasks.map((task) =>
        task().catch((err) => {
          logger.log('error', 'Cleanup task failed during shutdown', {
            error: err instanceof Error ? err.message : String(err),
          });
        }),
      ),
    );

    let timeoutHandle: NodeJS.Timeout;
    const timeout = new Promise<void>((resolve) => {
      timeoutHandle = setTimeout(() => {
        logger.log(
          'warn',
          `Cleanup tasks did not complete within ${this.cleanupTimeout}ms, proceeding with shutdown`,
        );
        resolve();
      }, this.cleanupTimeout);
      timeoutHandle.unref();
    });

    await Promise.race([cleanup, timeout]);
    clearTimeout(timeoutHandle!);
  }
}
