import request from 'supertest';
import { context, propagation, trace } from '@opentelemetry/api';
import app from '../index';
import { prisma } from '../prisma';
import * as tracing from '../tracing';

const activeContext = { testSpan: true };
const fixedSpan = {
  spanContext: () => ({
    traceId: 'abc123',
    spanId: 'span456',
    traceFlags: 1,
    isRemote: false,
  }),
};

describe('vault outbox trace propagation', () => {
  const originalAllowlistEnabled = process.env.ALLOWLIST_ENABLED;

  beforeEach(async () => {
    process.env.ALLOWLIST_ENABLED = 'false';
    await prisma.eventOutbox.deleteMany({});
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    if (typeof originalAllowlistEnabled === 'string') {
      process.env.ALLOWLIST_ENABLED = originalAllowlistEnabled;
    } else {
      delete process.env.ALLOWLIST_ENABLED;
    }
    await prisma.eventOutbox.deleteMany({});
  });

  it('persists trace identifiers from the active deposit span', async () => {
    jest.spyOn(context, 'active').mockReturnValue(activeContext as never);
    jest.spyOn(context, 'with');
    jest.spyOn(trace, 'getSpan').mockReturnValue(fixedSpan as never);
    const startSpan = jest
      .spyOn(tracing, 'withSpan')
      .mockImplementation(async (_name, fn) =>
        context.with(activeContext as never, () => fn(fixedSpan as never))
      );
    jest.spyOn(propagation, 'inject').mockImplementation((_ctx, carrier) => {
      carrier.traceparent = '00-abc123-span456-01';
    });

    const response = await request(app).post('/api/v1/vault/deposits').send({
      amount: '100',
      asset: 'USDC',
      walletAddress: 'G234567ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQ',
    });
    expect(response.status).toBe(201);

    await new Promise((resolve) => setTimeout(resolve, 30));
    const entry = await prisma.eventOutbox.findFirst({
      where: { eventType: 'transaction.deposit.created' },
    });

    expect(entry).not.toBeNull();
    expect(JSON.parse(entry!.payload).metadata.trace).toEqual({
      traceId: 'abc123',
      spanId: 'span456',
    });
    expect(propagation.inject).toHaveBeenCalledWith(activeContext, expect.any(Object));
    expect(context.with).toHaveBeenCalledWith(activeContext, expect.any(Function));
    expect(startSpan).toHaveBeenCalledWith('vault.deposit', expect.any(Function));
  });

  it('writes deposits without trace metadata when no span is active', async () => {
    const response = await request(app).post('/api/v1/vault/deposits').send({
      amount: '100',
      asset: 'USDC',
      walletAddress: 'G234567ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQ',
    });
    expect(response.status).toBe(201);

    await new Promise((resolve) => setTimeout(resolve, 30));
    const entry = await prisma.eventOutbox.findFirst({
      where: { eventType: 'transaction.deposit.created' },
    });

    expect(entry).not.toBeNull();
    expect(JSON.parse(entry!.payload).metadata).toBeUndefined();
  });
});
