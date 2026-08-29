import request from 'supertest';
import express, { Express, Request, Response, NextFunction } from 'express';
import {
  errorHandler,
  notFoundHandler,
  AppError,
  ValidationError,
  NotFoundError,
  ForbiddenError,
  classifyError,
  GeolocationBlockedError,
} from '../errors';

function buildApp(): Express {
  const app = express();
  app.use((req: Request, res: Response, next: NextFunction) => {
    // Simulate correlation-id middleware so the envelope includes it.
    (req as Request & { correlationId: string }).correlationId = 'test-correlation-123';
    next();
  });

  app.get('/boom', () => {
    throw new ValidationError('amount must be positive');
  });
  app.get('/missing', () => {
    throw new NotFoundError('vault not found');
  });
  app.get('/forbidden', () => {
    throw new ForbiddenError('super-admin role is required for impersonation');
  });
  app.get('/unexpected', () => {
    throw new Error('boom raw');
  });
  app.get('/classified-prisma', () => {
    const err = Object.assign(new Error('Unique constraint failed'), {
      name: 'PrismaClientKnownRequestError',
    });
    throw err;
  });

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe('unified error handling', () => {
  const app = buildApp();

  it('returns a standard envelope for operational errors (400)', async () => {
    const res = await request(app).get('/boom');
    expect(res.status).toBe(400);
    expect(res.body.status).toBe(400);
    expect(res.body.message).toBe('amount must be positive');
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.correlationId).toBe('test-correlation-123');
  });

  it('uses NOT_FOUND for missing resources', async () => {
    const res = await request(app).get('/missing');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.message).toBe('vault not found');
  });

  it('uses FORBIDDEN with a user-facing message', async () => {
    const res = await request(app).get('/forbidden');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.body.message).toMatch(/super-admin/i);
  });

  it('hides internals for unexpected (non-operational) errors', async () => {
    const res = await request(app).get('/unexpected');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(res.body.message).not.toContain('boom raw');
    expect(res.body.message).toMatch(/team has been notified/i);
  });

  it('classifies infrastructure errors into operational equivalents', async () => {
    const res = await request(app).get('/classified-prisma');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('emits the standard 404 envelope for unknown routes', async () => {
    const res = await request(app).get('/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  describe('classifyError', () => {
    it('passes through AppError instances', () => {
      const err = new ForbiddenError();
      expect(classifyError(err)).toBe(err);
    });

    it('wraps unknown errors as InternalError', () => {
      const classified = classifyError(new Error('x'));
      expect(classified).toBeInstanceOf(AppError);
      expect(classified.statusCode).toBe(500);
    });

    it('maps a 451 geolocation error', () => {
      const err = new GeolocationBlockedError();
      expect(err.statusCode).toBe(451);
      expect(err.code).toBe('GEO_BLOCKED');
    });
  });
});
