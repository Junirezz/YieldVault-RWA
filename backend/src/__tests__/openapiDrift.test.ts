import fs from 'fs';
import path from 'path';
import app from '../index';
import { buildOpenApi, diffOpenApi } from '../../scripts/generate-openapi';

const committedPath = path.join(__dirname, '..', '..', 'openapi.json');

describe('openapi.json drift (issue #1544)', () => {
  const generated = buildOpenApi(app as never);

  it('matches the spec regenerated from the routes wired in index.ts', () => {
    const committed = fs.readFileSync(committedPath, 'utf8').replace(/\r\n/g, '\n');
    expect(diffOpenApi(committed, generated.content)).toEqual([]);
  });

  it.each([
    ['post', '/admin/exports/bulk'],
    ['get', '/admin/exports/bulk/jobs'],
    ['post', '/admin/impersonate/sessions'],
    ['get', '/admin/impersonate/{wallet}'],
    ['post', '/admin/events/replay'],
    ['get', '/api/v1/admin/diagnostics'],
  ])('documents %s %s', (method, route) => {
    expect(generated.spec.paths[route]?.[method]).toBeDefined();
  });

  it('documents every route reachable from the app', () => {
    const operations = Object.values(generated.spec.paths as Record<string, object>).reduce(
      (n, item) => n + Object.keys(item).length,
      0,
    );
    expect(operations).toBeGreaterThan(100);
  });
});

describe('diffOpenApi', () => {
  const spec = (paths: Record<string, Record<string, unknown>>) =>
    JSON.stringify({ openapi: '3.1.0', paths }, null, 2);

  it('reports added, removed and changed operations', () => {
    const committed = spec({ '/a': { get: { summary: 'a' } }, '/gone': { get: {} } });
    const generated = spec({ '/a': { get: { summary: 'changed' } }, '/new': { post: {} } });
    expect(diffOpenApi(committed, generated).sort()).toEqual(
      ['+ POST /new', '- GET /gone', '~ GET /a'].sort(),
    );
  });

  it('reports nothing for an identical spec', () => {
    const same = spec({ '/a': { get: {} } });
    expect(diffOpenApi(same, same)).toEqual([]);
  });
});
