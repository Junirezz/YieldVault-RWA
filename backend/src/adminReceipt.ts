import crypto from 'crypto';
import { prisma } from './prisma';

export interface AdminActionReceipt {
  id: string;
  action: string;
  actor: string;
  timestamp: string;
  inputHash: string;
  resultingState: Record<string, unknown>;
  signature: string;
}

export function assertAdminReceiptSecretValid(): void {
  const isProduction = process.env.NODE_ENV === 'production';
  const secret = process.env.ADMIN_ACTION_RECEIPT_SECRET;

  if (isProduction) {
    if (!secret || !secret.trim()) {
      console.error(
        '[adminReceipt] FATAL – ADMIN_ACTION_RECEIPT_SECRET is required in production.\n' +
        'Set ADMIN_ACTION_RECEIPT_SECRET environment variable and restart the server.'
      );
      process.exit(1);
    }
  } else {
    if (!secret) {
      console.warn(
        '[adminReceipt] WARNING – ADMIN_ACTION_RECEIPT_SECRET is not set. ' +
        'Using insecure default secret for development/test. ' +
        'This MUST be changed before deploying to production.'
      );
    }
  }
}

// Run validation at startup
assertAdminReceiptSecretValid();

function getReceiptSecret(): string {
  return process.env.ADMIN_ACTION_RECEIPT_SECRET || 'dev-receipt-secret-change-me';
}

/**
 * Generates an immutable, signed receipt for a critical admin action.
 */
export async function generateAdminReceipt(params: {
  action: string;
  actor: string;
  input: unknown;
  resultingState: Record<string, unknown>;
}): Promise<AdminActionReceipt> {
  const { action, actor, input, resultingState } = params;
  const timestamp = new Date().toISOString();
  
  // 1. Calculate input hash
  const inputHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(input))
    .digest('hex');

  // 2. Prepare payload for signing
  const payload = {
    action,
    actor,
    timestamp,
    inputHash,
    resultingState,
  };

  // 3. Generate HMAC signature
  const signature = crypto
    .createHmac('sha256', getReceiptSecret())
    .update(JSON.stringify(payload))
    .digest('hex');

  try {
    const record = await prisma.adminActionReceipt.create({
      data: {
        action,
        actor,
        timestamp: new Date(timestamp),
        inputHash,
        resultingState: JSON.stringify(resultingState),
        signature,
      },
    });

    return {
      id: record.id,
      action: record.action,
      actor: record.actor,
      timestamp: record.timestamp.toISOString(),
      inputHash: record.inputHash,
      resultingState: resultingState,
      signature: record.signature,
    };
  } catch {
    return {
      id: `receipt-${Date.now()}`,
      action,
      actor,
      timestamp,
      inputHash,
      resultingState,
      signature,
    };
  }
}

/**
 * Verifies the integrity of a receipt signature.
 */
export function verifyReceiptSignature(receipt: AdminActionReceipt): boolean {
  const payload = {
    action: receipt.action,
    actor: receipt.actor,
    timestamp: receipt.timestamp,
    inputHash: receipt.inputHash,
    resultingState: receipt.resultingState,
  };

  const expectedSignature = crypto
    .createHmac('sha256', getReceiptSecret())
    .update(JSON.stringify(payload))
    .digest('hex');

  const providedBuffer = Buffer.from(receipt.signature, 'utf8');
  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

/**
 * Retrieves a receipt by ID.
 */
export async function getAdminReceipt(id: string): Promise<AdminActionReceipt | null> {
  try {
    const record = await prisma.adminActionReceipt.findUnique({
      where: { id },
    });

    if (!record) return null;

    return {
      id: record.id,
      action: record.action,
      actor: record.actor,
      timestamp: record.timestamp.toISOString(),
      inputHash: record.inputHash,
      resultingState: JSON.parse(record.resultingState),
      signature: record.signature,
    };
  } catch {
    return null;
  }
}

/**
 * Lists receipts with filters.
 */
export async function listAdminReceipts(filters: {
  action?: string;
  actor?: string;
  limit?: number;
}): Promise<AdminActionReceipt[]> {
  try {
    const records = await prisma.adminActionReceipt.findMany({
      where: {
        ...(filters.action ? { action: filters.action } : {}),
        ...(filters.actor ? { actor: filters.actor } : {}),
      },
      orderBy: {
        timestamp: 'desc',
      },
      take: filters.limit || 50,
    });

    return records.map((record) => ({
      id: record.id,
      action: record.action,
      actor: record.actor,
      timestamp: record.timestamp.toISOString(),
      inputHash: record.inputHash,
      resultingState: JSON.parse(record.resultingState),
      signature: record.signature,
    }));
  } catch {
    return [];
  }
}
