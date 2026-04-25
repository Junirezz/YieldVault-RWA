import type { Response, NextFunction, RequestHandler } from 'express';
import type { CorrelationIdRequest } from './correlationId';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  correlationId?: string;
  method?: string;
  url?: string;
  durationMs?: number;
  status?: number;
  errorCode?: string;
  [key: string]: unknown;
}

class Logger {
  private minLevel: LogLevel = 'info';
  private readonly levelOrder: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  configure(minLevel: LogLevel): void {
    this.minLevel = minLevel;
  }

  log(
    level: LogLevel,
    message: string,
    fields?: Partial<LogEntry>,
  ): void {
    if (this.levelOrder[level] < this.levelOrder[this.minLevel]) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...fields,
    };

    /* eslint-disable-next-line no-console */
    console.log(JSON.stringify(entry));
  }
}

export const logger = new Logger();

export const structuredLoggingMiddleware: RequestHandler = (
  req: CorrelationIdRequest,
  res: Response,
  next: NextFunction,
): void => {
  const startTime = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - startTime;
    const level: LogLevel =
      res.statusCode >= 500
        ? 'error'
        : res.statusCode >= 400
          ? 'warn'
          : 'info';

    logger.log(level, `${req.method} ${req.path}`, {
      correlationId: req.correlationId,
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      durationMs,
    });
  });

  next();
};
