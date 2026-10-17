import type { Request } from 'express';

jest.mock('../prisma', () => ({ prisma: {} }));
jest.mock('../apiKeyAudit', () => ({
  getApiKeyFingerprintFromHash: (hash: string) => `sha256:${hash.slice(0, 4)}`,
}));

import { buildExportMetadataHeaderValue, resolveExportGeneratedBy, type ExportJobRecord } from '../exportJobs';

function reqWith(headers: Record<string, string>, extra: Record<string, unknown> = {}): Request {
  return { get: (n: string) => headers[n.toLowerCase()], ...extra } as unknown as Request;
}

describe('exportJobs', () => {
  describe('resolveExportGeneratedBy', () => {
    it('prefers the API key fingerprint', () => {
      expect(resolveExportGeneratedBy(reqWith({}, { authApiKeyHash: 'abcdef' }))).toBe('apiKey:sha256:abcd');
    });

    it('falls back to JWT subject, then headers, then unknown', () => {
      expect(resolveExportGeneratedBy(reqWith({}, { jwtPayload: { sub: 'user-1' } }))).toBe('user-1');
      expect(resolveExportGeneratedBy(reqWith({ 'x-admin-id': 'admin-9' }))).toBe('admin-9');
      expect(resolveExportGeneratedBy(reqWith({}))).toBe('unknown');
    });
  });

  it('serialises export metadata for the response header', () => {
    const job = {
      id: 'job-1',
      checksum: 'c',
      checksumAlgorithm: 'sha256',
      generatedBy: 'me',
      rowCount: 3,
      createdAt: '2026-01-01T00:00:00.000Z',
      fileName: 'f.csv',
    } as ExportJobRecord;
    expect(JSON.parse(buildExportMetadataHeaderValue(job))).toEqual({
      exportJobId: 'job-1',
      checksum: 'c',
      checksumAlgorithm: 'sha256',
      generatedBy: 'me',
      rowCount: 3,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });
});
