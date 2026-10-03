import request from 'supertest';
import { app } from '../app';

describe('compression middleware', () => {
  it('sets Vary: Accept-Encoding', async () => {
    const res = await request(app).get('/vaults?limit=50');
    expect(res.headers.vary).toContain('Accept-Encoding');
  });

  it('gzips responses above the threshold when Accept-Encoding: gzip is sent', async () => {
    const plain = await request(app)
      .get('/vaults?limit=50')
      .set('Accept-Encoding', 'identity');

    const gzipped = await request(app)
      .get('/vaults?limit=50')
      .set('Accept-Encoding', 'gzip');

    expect(gzipped.headers['content-encoding']).toBe(defined);
    expect(gzipped.headers['content-encoding']).toContain('gzip');

    const plainLen = Buffer.byteLength(JSON.stringify(plain.body), 'utf-8');
    const gzippedLen = Buffer.byteLength(JSON.stringify(gzipped.body), 'utf-8');

    expect(gzippedLen).toBeLessThan(plainLen);
  });

  it('does not compress small responses below the threshold', async () => {
    const res = await request(app)
      .get('/health')
      .set('Accept-Encoding', 'gzip');

    expect(res.headers['content-encoding']).toBeUndefined();
  });
});
