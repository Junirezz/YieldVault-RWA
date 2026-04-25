import { Server } from 'http';
import type { Socket } from 'net';
import { logger } from './middleware/structuredLogging';

export class GracefulShutdownHandler {
  private drainTimeout: number;
  private server: Server | null = null;
  private activeConnections = new Set<Socket>();

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

  private shutdown(signal: string): void {
    logger.log('info', `${signal} received, starting graceful shutdown`);

    if (!this.server) {
      process.exit(0);
    }

    // Stop accepting new connections
    this.server.close(() => {
      logger.log('info', 'Server closed, no longer accepting connections');
      process.exit(0);
    });

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
  }
}
