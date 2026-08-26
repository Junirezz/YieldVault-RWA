import express, { Request, Response } from 'express';
import request from 'supertest';
import { API_V1_PREFIX, API_V2_PREFIX, resolveApiVersionFromPath, versionRoutingMiddleware } from '../middleware/versionRouting';
import { apiVersionMiddleware } from '../middleware/versionNegotiation';
import { versionsDiscoveryHandler } from '../routes/apiVersions';

describe('resolveApiVersionFromPath', () => {
  it('maps /api/v1 paths to v1', () => {
    expect(resolveApiVersionFromPath('/api/v1/vault/summary')).toEqual({
      version: 'v1',
      source: 'path',
    });
  });

  it('maps /api/v2 paths to v2', () => {
    expect(resolveApiVersionFromPath('/api/v2/vaults/primary/health')).toEqual({
      version: 'v2',
      source: 'path',
    });
  });

  it('treats unversioned resource paths as legacy v1', () => {
    expect(resolveApiVersionFromPath('/vault/summary')).toEqual({
      version: 'v1',
      source: 'legacy',
    });
  });
});

describe('versionRoutingMiddleware', () => {
  const app = express();
  app.use(versionRoutingMiddleware);
  app.use(apiVersionMiddleware);
  app.get('/api/v1/ping', (req: Request, res: Response) => {
    res.json({ version: req.apiVersion, source: req.apiVersionSource });
  });
  app.get('/api/v2/ping', (req: Request, res: Response) => {
    res.json({ version: req.apiVersion, source: req.apiVersionSource });
  });
  app.get('/api/versions', versionsDiscoveryHandler);

  it(`sets X-API-Version-Path to ${API_V1_PREFIX} for v1 routes`, async () => {
    const res = await request(app).get('/api/v1/ping');
    expect(res.status).toBe(200);
    expect(res.headers['x-api-version-path']).toBe(API_V1_PREFIX);
    expect(res.body).toEqual({ version: 'v1', source: 'path' });
  });

  it(`sets X-API-Version-Path to ${API_V2_PREFIX} for v2 routes`, async () => {
    const res = await request(app).get('/api/v2/ping');
    expect(res.status).toBe(200);
    expect(res.headers['x-api-version-path']).toBe(API_V2_PREFIX);
    expect(res.body).toEqual({ version: 'v2', source: 'path' });
  });

  it('still honors version negotiation headers', async () => {
    const res = await request(app).get('/api/v1/ping').set('Accept-Version', '99.0.0');
    expect(res.status).toBe(406);
  });

  it('documents versions, prefixes, and deprecation policy', async () => {
    const res = await request(app).get('/api/versions');
    expect(res.status).toBe(200);
    expect(res.body.versions[0].prefix).toBe('/api/v1');
    expect(res.body.negotiation.headers).toContain('X-API-Version');
    expect(res.body.deprecation.successorPrefix).toBe('/api/v1');
  });
});
