import express, { Request, Response } from 'express';
import request from 'supertest';
import { timeoutMiddleware, createTimeoutFor } from '../middleware/timeoutMiddleware';

describe('timeoutMiddleware', () => {
  it('returns a structured fallback payload when the route exceeds its budget', async () => {
    const app = express();
    app.get(
      '/slow',
      createTimeoutFor.read({
        timeoutMs: 20,
        routeName: '/slow',
        fallbackResponse: () => ({
          error: 'Service Unavailable',
          status: 503,
          code: 'SLOW_ROUTE_TIMEOUT',
          message: 'Slow route timed out',
          stale: true,
        }),
      }),
      async (_req: Request, res: Response) => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (!res.headersSent) {
          res.status(200).json({ ok: true });
        }
      },
    );

    const res = await request(app).get('/slow');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      error: 'Service Unavailable',
      status: 503,
      code: 'SLOW_ROUTE_TIMEOUT',
      message: 'Slow route timed out',
      stale: true,
    });
  });

  it('allows fast requests to complete normally', async () => {
    const app = express();
    app.get(
      '/fast',
      timeoutMiddleware({ timeoutMs: 50 }),
      (_req: Request, res: Response) => {
        res.status(200).json({ ok: true });
      },
    );

    const res = await request(app).get('/fast');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
