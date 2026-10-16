import crypto from 'crypto';
import {
  registerWebhookEndpoint,
  verifyWebhookEndpoint,
  resetWebhookState,
  emitTransactionEvent,
  buildWebhookSignedEnvelope,
  createWebhookSignature,
  markWebhookDeliverySeen,
  verifyIncomingWebhookPayload,
} from '../webhookDelivery';

describe('Webhook endpoint verification handshake', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    resetWebhookState();
    process.env.WEBHOOK_ALLOW_UNVERIFIED = 'false';
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('registers endpoints as pending verification and disabled by default', () => {
    const endpoint = registerWebhookEndpoint({ url: 'https://example.com/hook' });
    expect(endpoint.verificationStatus).toBe('pending');
    expect(endpoint.enabled).toBe(false);
  });

  it('marks endpoint verified when challenge is echoed correctly', async () => {
    let capturedChallenge = '';
    global.fetch = jest.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      capturedChallenge = body.challenge;
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ challenge: body.challenge }),
      } as Response;
    }) as typeof fetch;

    const endpoint = registerWebhookEndpoint({ url: 'https://example.com/hook' });
    expect(capturedChallenge).toBeTruthy();

    const verified = await verifyWebhookEndpoint(endpoint.id);
    expect(verified?.verificationStatus).toBe('verified');
    expect(verified?.enabled).toBe(true);
    expect(verified?.verifiedAt).toBeTruthy();
  });

  it('does not deliver events to unverified endpoints by default', async () => {
    registerWebhookEndpoint({ url: 'https://example.com/hook' });
    const deliveredCount = await emitTransactionEvent('transaction.deposit.created', {
      transactionId: 'tx-1',
      amount: '100',
      asset: 'USDC',
      walletAddress: `G${'A'.repeat(55)}`,
      transactionHash: '0xabc',
      status: 'pending',
      timestamp: new Date().toISOString(),
    });

    expect(deliveredCount).toBe(0);
  });

  it('signs webhook deliveries with a timestamped envelope and rejects replays', () => {
    const endpoint = registerWebhookEndpoint({ url: 'https://example.com/hook', enabled: true });
    const delivery = {
      id: 'whd_test_delivery',
      endpointId: endpoint.id,
      endpointUrl: endpoint.url,
      eventType: 'transaction.deposit.created' as const,
      status: 'pending' as const,
      attempts: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const payload = {
      transactionId: 'tx-replay-1',
      amount: '100',
      asset: 'USDC',
      walletAddress: `G${'A'.repeat(55)}`,
      transactionHash: '0xabc',
      status: 'pending',
      timestamp: new Date().toISOString(),
    };

    const envelope = buildWebhookSignedEnvelope(delivery, payload);
    const signature = createWebhookSignature('shared-secret', envelope);

    expect(signature).toHaveLength(64);
    expect(markWebhookDeliverySeen(delivery.endpointId, delivery.id, envelope.sentAt)).toBe(true);
    expect(markWebhookDeliverySeen(delivery.endpointId, delivery.id, envelope.sentAt)).toBe(false);
  });

  it('stores no plaintext secret and verifies signatures using the persisted hash', () => {
    const secret = 'test-key-42';
    const endpoint = registerWebhookEndpoint({
      url: 'https://example.com/hook',
      enabled: true,
      secret,
    });
    const delivery = {
      id: 'whd_hash_test',
      endpointId: endpoint.id,
      endpointUrl: endpoint.url,
      eventType: 'transaction.deposit.created' as const,
      status: 'pending' as const,
      attempts: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const envelope = buildWebhookSignedEnvelope(delivery, {
      transactionId: 'tx-hash-test',
      amount: '100',
      asset: 'USDC',
      walletAddress: `G${'A'.repeat(55)}`,
      transactionHash: '0xdef',
      status: 'pending',
      timestamp: new Date().toISOString(),
    });
    const secretHash = crypto.createHash('sha256').update(secret).digest('hex');
    const signature = createWebhookSignature(secretHash, envelope);

    expect(JSON.stringify(endpoint)).not.toContain(secret);
    expect(verifyIncomingWebhookPayload(endpoint.id, envelope, signature).verified).toBe(true);
  });
});
