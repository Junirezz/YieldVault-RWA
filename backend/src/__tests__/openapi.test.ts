import request from 'supertest';
import express from 'express';
import { specs, setupSwagger } from '../swagger';

describe('OpenAPI documentation', () => {
  const spec = specs as unknown as {
    openapi: string;
    info: { title: string; description: string };
    paths: Record<string, unknown>;
    components: { securitySchemes?: Record<string, unknown> };
  };

  it('produces a valid OpenAPI 3.1 spec with documented paths', () => {
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.info.title).toContain('YieldVault');
    const paths = Object.keys(spec.paths ?? {});
    expect(paths).toEqual(
      expect.arrayContaining([
        '/health',
        '/auth/login',
        '/api/v1/vault/deposits',
        '/admin/webhooks',
      ]),
    );
  });

  it('documents authentication and rate limiting', () => {
    const components = spec.components as { securitySchemes?: Record<string, unknown> };
    expect(components.securitySchemes).toBeDefined();
    expect(components.securitySchemes?.apiKeyAuth).toBeDefined();
    expect(components.securitySchemes?.bearerAuth).toBeDefined();
    expect(spec.info.description).toMatch(/Rate limit/i);
  });

  it('serves the spec and Swagger UI over HTTP', async () => {
    const app = express();
    setupSwagger(app);

    const res = await request(app).get('/docs/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.1.0');

    const ui = await request(app).get('/docs/');
    expect(ui.status).toBe(200);
    expect(ui.text).toMatch(/swagger/i);
  });
});
