import request from 'supertest';
import express, { Express } from 'express';
import { corsMiddleware } from '../middleware/cors';

describe('CORS Middleware', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    // Set a dummy environment origin for testing
    process.env.CORS_ALLOWED_ORIGINS = 'http://trusted-frontend.com,https://app.yieldvault.finance';
    process.env.NODE_ENV = 'production';
    
    app.use(corsMiddleware);
    app.get('/test', (req, res) => {
      res.status(200).json({ message: 'Success' });
    });
  });

  it('should allow requests from a trusted origin', async () => {
    const response = await request(app)
      .get('/test')
      .set('Origin', 'http://trusted-frontend.com');

    expect(response.status).toBe(200);
    expect(response.header['access-control-allow-origin']).toBe('http://trusted-frontend.com');
    expect(response.header['access-control-allow-credentials']).toBe('true');
  });

  it('should allow requests from another trusted origin', async () => {
    const response = await request(app)
      .get('/test')
      .set('Origin', 'https://app.yieldvault.finance');

    expect(response.status).toBe(200);
    expect(response.header['access-control-allow-origin']).toBe('https://app.yieldvault.finance');
  });

  it('should reject requests from an untrusted origin with 403', async () => {
    const response = await request(app)
      .get('/test')
      .set('Origin', 'http://malicious-site.com');

    expect(response.status).toBe(403);
    expect(response.body).toHaveProperty('error', 'Forbidden');
    expect(response.body).toHaveProperty('message', 'CORS policy: This origin is not allowed access.');
    expect(response.header['access-control-allow-origin']).toBeUndefined();
  });

  it('should allow requests with no origin (e.g., mobile apps, curl)', async () => {
    const response = await request(app).get('/test');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('message', 'Success');
  });

  it('should return correct headers for preflight OPTIONS requests from trusted origin', async () => {
    const response = await request(app)
      .options('/test')
      .set('Origin', 'http://trusted-frontend.com')
      .set('Access-Control-Request-Method', 'POST');

    expect(response.status).toBe(200);
    expect(response.header['access-control-allow-origin']).toBe('http://trusted-frontend.com');
    expect(response.header['access-control-allow-methods']).toContain('POST');
  });

  it('should reject preflight OPTIONS requests from untrusted origin with 403', async () => {
    const response = await request(app)
      .options('/test')
      .set('Origin', 'http://malicious-site.com')
      .set('Access-Control-Request-Method', 'POST');

    expect(response.status).toBe(403);
  });
});
