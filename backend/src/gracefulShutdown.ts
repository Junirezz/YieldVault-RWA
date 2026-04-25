import { Server } from 'http';
import type { Socket } from 'net';
import { logger } from './middleware/structuredLogging';

export class GracefulShutdownHandler {
  private drainTimeout: number;
  private server: Server | null = null;
  private activeConnections = new Set<Socket>();
  private cleanupTasks: (() => Promise<void>)[] = [];

  constructor(drainTimeoutMs: number = 30000) {
    this.drainTimeout = drainTimeoutMs;
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

    if (!this.server) {
      process.exit(0);
    }

    // Force close after drain timeout
    const drainTimer = setTimeout(() => {
      logger.log(
        'warn',
        `Drain timeout exceeded (${this.drainTimeout}ms), closing ${this.activeConnections.size} active connections`,
      );

      this.activeConnections.forEach((socket) => {
        socket.destroy();
      });

      process.exit(1);
    }, this.drainTimeout);

    drainTimer.unref();

    try {
      // Run registered cleanup tasks (e.g., database shutdown)
      await Promise.all(this.cleanupTasks.map(task => task().catch(err => {
        logger.log('error', 'Cleanup task failed during shutdown', {
          error: err instanceof Error ? err.message : String(err)
        });
      })));

      // Stop accepting new connections and wait for existing ones to close
      this.server.close(() => {
        logger.log('info', 'Server closed, no longer accepting connections');
        clearTimeout(drainTimer);
        process.exit(0);
      });
    } catch (error) {
      logger.log('error', 'Error during graceful shutdown', {
        error: error instanceof Error ? error.message : String(error)
      });
      process.exit(1);
    }
  }
}
