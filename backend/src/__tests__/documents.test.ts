/**
 * Tests for S3 presigned upload content-type whitelist (Issue #1439).
 */

import express from 'express';
import request from 'supertest';
import { errorHandler } from '../errors';
import {
  generatePresignedUpload,
  InvalidContentTypeError,
  type PresignConfig,
} from '../services/documents';

const config: PresignConfig = {
  bucket: 'test-bucket',
  region: 'us-east-1',
  accessKeyId: 'AKIATEST',
  secretAccessKey: 'secret',
};

function makeApp() {
  const app = express();
  app.use(express.json());
  app.post('/documents/presign', (req, res, next) => {
    try {
      res.json(
        generatePresignedUpload(
          { vaultId: 'v1', filename: req.body.filename ?? 'f', contentType: req.body.contentType },
          config,
        ),
      );
    } catch (err) {
      next(err);
    }
  });
  app.use(errorHandler);
  return app;
}

describe('generatePresignedUpload content-type whitelist', () => {
  it.each(['text/html', 'application/x-msdownload', 'application/javascript', '', undefined])(
    'rejects %p with INVALID_CONTENT_TYPE',
    (contentType) => {
      expect(() => generatePresignedUpload({ vaultId: 'v', filename: 'a', contentType }, config))
        .toThrow(InvalidContentTypeError);
    },
  );

  it('does not accept a whitelisted prefix hidden behind another type', () => {
    expect(() =>
      generatePresignedUpload({ vaultId: 'v', filename: 'a', contentType: 'text/html; image/png' }, config),
    ).toThrow(InvalidContentTypeError);
  });

  it('accepts images and embeds a matching starts-with condition', () => {
    const r = generatePresignedUpload({ vaultId: 'v', filename: 'a.png', contentType: 'image/png' }, config);
    expect(r.fields['Content-Type']).toBe('image/png');
    expect(r.conditions).toContainEqual(['starts-with', '$Content-Type', 'image/']);
    expect(r.fields.policy).toBeDefined();
    expect(r.fields['x-amz-signature']).toMatch(/^[0-9a-f]{64}$/);
  });

  it('accepts PDFs and embeds a matching starts-with condition', () => {
    const r = generatePresignedUpload({ vaultId: 'v', filename: 'a.pdf', contentType: 'application/pdf' }, config);
    expect(r.conditions).toContainEqual(['starts-with', '$Content-Type', 'application/pdf']);
  });
});

describe('POST /documents/presign', () => {
  it('returns 400 INVALID_CONTENT_TYPE for text/html', async () => {
    const res = await request(makeApp()).post('/documents/presign').send({ contentType: 'text/html' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('INVALID_CONTENT_TYPE');
  });

  it.each(['image/jpeg', 'application/pdf'])('returns 200 for %s', async (contentType) => {
    const res = await request(makeApp()).post('/documents/presign').send({ contentType });
    expect(res.status).toBe(200);
    expect(res.body.fields['Content-Type']).toBe(contentType);
  });
});
