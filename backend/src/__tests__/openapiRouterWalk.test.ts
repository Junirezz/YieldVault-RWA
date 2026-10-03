import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import { collectRoutes, mergeDiscoveredRoutes } from '../../scripts/openapiRouterWalk';
import { generateOpenApi } from '../../scripts/generate-openapi';

describe('openapi router traversal', () => {
  it('concatenates mount prefixes for nested routers', () => {
    const app = express();
    const v1 = express.Router();
    const inner = express.Router();
    inner.get('/_test', (_req, res) => res.end());
    inner.post('/items/:id', (_req, res) => res.end());
    v1.use('/nested', inner);
    v1.get('/_test', (_req, res) => res.end());
    app.use('/v1', v1);
    app.get('/health', (_req, res) => res.end());

    const found = collectRoutes(app).map((r) => `${r.method} ${r.path}`).sort();
    expect(found).toEqual([
      'get /health',
      'get /v1/_test',
      'get /v1/nested/_test',
      'post /v1/nested/items/{id}',
    ]);
  });

  it('handles parameterised mount points and root-mounted routers', () => {
    const app = express();
    const r = express.Router({ mergeParams: true });
    r.get('/', (_req, res) => res.end());
    app.use('/wallets/:wallet', r);
    const root = express.Router();
    root.get('/ping', (_req, res) => res.end());
    app.use('/', root);

    const found = collectRoutes(app).map((x) => `${x.method} ${x.path}`).sort();
    expect(found).toEqual(['get /ping', 'get /wallets/{wallet}']);
  });

  it('does not overwrite documented operations', () => {
    const spec = { paths: { '/health': { get: { summary: 'kept' } } } as Record<string, any> };
    const added = mergeDiscoveredRoutes(spec, [
      { method: 'get', path: '/health' },
      { method: 'get', path: '/v1/_test' },
    ]);
    expect(added).toEqual([{ method: 'get', path: '/v1/_test' }]);
    expect(spec.paths['/health'].get.summary).toBe('kept');
  });

  it('writes /v1/_test into the generated openapi.json', () => {
    const app = express();
    const router = express.Router();
    router.get('/_test', (_req, res) => res.end());
    app.use('/v1', router);

    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'openapi-')), 'openapi.json');
    generateOpenApi(app, out);
    const written = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(written.paths['/v1/_test'].get).toBeDefined();
    expect(written.paths['/health']).toBeDefined();
  });
});
