/**
 * @file services/documents.ts
 * Presigned S3 POST generation for vault document uploads (Issue #1439).
 *
 * The requested `contentType` is validated server-side against a whitelist
 * (`image/*` or `application/pdf`) and the same restriction is embedded in the
 * signed POST policy so S3 itself rejects any other Content-Type.
 */

import { createHmac, randomUUID } from 'crypto';
import { AppError } from '../errors';

export const ALLOWED_CONTENT_TYPE_PREFIXES = ['image/', 'application/pdf'] as const;

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const POLICY_TTL_SECONDS = 300;

/** 400 — contentType is not on the upload whitelist. */
export class InvalidContentTypeError extends AppError {
  constructor(contentType: unknown) {
    super(
      'Content type not allowed. Only images and PDF documents may be uploaded.',
      400,
      'INVALID_CONTENT_TYPE',
      true,
      { contentType },
    );
  }
}

export type PresignedPostCondition =
  | Record<string, string>
  | [string, string, string]
  | [string, number, number];

export interface PresignedUpload {
  url: string;
  key: string;
  fields: Record<string, string>;
  conditions: PresignedPostCondition[];
  expiresAt: string;
}

export interface PresignConfig {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): PresignConfig {
  return {
    bucket: env.S3_DOCUMENTS_BUCKET ?? env.S3_BUCKET ?? '',
    region: env.AWS_REGION ?? 'us-east-1',
    accessKeyId: env.AWS_ACCESS_KEY_ID ?? '',
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY ?? '',
    endpoint: env.S3_ENDPOINT,
  };
}

/** Returns the whitelist prefix the content type matches, or null if none. */
export function matchAllowedPrefix(contentType: unknown): string | null {
  if (typeof contentType !== 'string') return null;
  const normalized = contentType.trim().toLowerCase();
  return ALLOWED_CONTENT_TYPE_PREFIXES.find((p) => normalized.startsWith(p)) ?? null;
}

export function assertAllowedContentType(contentType: unknown): string {
  if (matchAllowedPrefix(contentType) === null) {
    throw new InvalidContentTypeError(contentType);
  }
  return (contentType as string).trim().toLowerCase();
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

/**
 * Generate presigned POST parameters (SigV4) for a vault document upload.
 * Throws InvalidContentTypeError (HTTP 400 / INVALID_CONTENT_TYPE) before any
 * signing happens if the content type is not whitelisted.
 */
export function generatePresignedUpload(
  params: { vaultId: string; filename: string; contentType: unknown },
  config: PresignConfig = configFromEnv(),
  now: Date = new Date(),
): PresignedUpload {
  const contentType = assertAllowedContentType(params.contentType);
  const prefix = matchAllowedPrefix(contentType) as string;

  const safeName = params.filename.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128) || 'file';
  const key = `vaults/${params.vaultId}/documents/${randomUUID()}-${safeName}`;

  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const credential = `${config.accessKeyId}/${dateStamp}/${config.region}/s3/aws4_request`;
  const expiresAt = new Date(now.getTime() + POLICY_TTL_SECONDS * 1000);

  // S3 ANDs policy conditions, so emitting both `image/` and `application/pdf`
  // starts-with rules would reject every upload. Emit the rule for the
  // whitelist prefix the (already validated) content type falls under.
  const conditions: PresignedPostCondition[] = [
    { bucket: config.bucket },
    { key },
    ['starts-with', '$Content-Type', prefix],
    ['content-length-range', 1, MAX_DOCUMENT_BYTES],
    { 'x-amz-algorithm': 'AWS4-HMAC-SHA256' },
    { 'x-amz-credential': credential },
    { 'x-amz-date': amzDate },
  ];

  const policy = Buffer.from(
    JSON.stringify({ expiration: expiresAt.toISOString(), conditions }),
  ).toString('base64');

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, dateStamp), config.region), 's3'),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(policy).digest('hex');

  return {
    url: config.endpoint
      ? `${config.endpoint.replace(/\/$/, '')}/${config.bucket}`
      : `https://${config.bucket}.s3.${config.region}.amazonaws.com`,
    key,
    fields: {
      key,
      'Content-Type': contentType,
      'x-amz-algorithm': 'AWS4-HMAC-SHA256',
      'x-amz-credential': credential,
      'x-amz-date': amzDate,
      policy,
      'x-amz-signature': signature,
    },
    conditions,
    expiresAt: expiresAt.toISOString(),
  };
}
