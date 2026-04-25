import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { randomUUID } from 'crypto';

const CORRELATION_ID_HEADER = 'X-Correlation-ID';

declare global {
  namespace Express {
    interface Request {
      correlationId: string;
    }
  }
}

export type CorrelationIdRequest = Request;

export const correlationIdMiddleware: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const correlationId =
    (req.get?.(CORRELATION_ID_HEADER) as string) || randomUUID();

  req.correlationId = correlationId;
  res.setHeader(CORRELATION_ID_HEADER, correlationId);

  next();
};
