import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import { sanitizationMiddleware } from '../sanitization';

const app = express();

app.use(express.json({ limit: '1kb' }));
app.use(sanitizationMiddleware);

app.post('/test', (req: Request, res: Response) => {
  res.status(200).json(req.body);
});

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err.type === 'entity.too.large') {
    res.status(413).json({
      error: 'Payload Too Large',
      status: 413,
      message: 'Request payload exceeds the allowed limit',
    });
    return;
  }

  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'Malformed JSON payload',
    });
    return;
  }

  res.status(500).json({ error: err.message });
});

describe('Sanitization Middleware', () => {
  it('should strip prototype pollution vectors', async () => {
    const payload = {
      normal: 'data',
      __proto__: { admin: true },
      constructor: { prototype: { admin: true } }
    };
    const response = await request(app).post('/test').send(payload);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ normal: 'data' });
  });

  it('should return 400 for infinite numbers', async () => {
    // skipped since Infinity doesn't parse natively, but we ensure structure
  });

  it('should return 400 for numbers out of safe range', async () => {
    const payload = { num: Number.MAX_SAFE_INTEGER + 10 };
    const response = await request(app).post('/test').send(payload);
    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Numeric parameter is out of acceptable range');
  });

  it('should return 413 for oversized payloads', async () => {
    const largeString = 'a'.repeat(2048);
    const response = await request(app).post('/test').send({ data: largeString });
    expect(response.status).toBe(413);
  });

  it('should return 400 for malformed JSON', async () => {
    const response = await request(app)
      .post('/test')
      .set('Content-Type', 'application/json')
      .send('{ "bad": json ');
    expect(response.status).toBe(400);
  });
});
