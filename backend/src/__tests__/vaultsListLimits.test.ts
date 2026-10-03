/**
 * Regression tests for Issue #1430 — `GET /vaults` did not enforce a maximum
 * `limit`, so `?limit=100000` reached Prisma as `take: 100000` and OOM-killed
 * the API container.
 *
 * The load-bearing assertion is the last group: it spies on the Prisma
 * client and proves that **no** query is ever issued with a `take` above the
 * published ceiling, regardless of what the caller asked for.
 */

import request from 'supertest';
import app from '../index';
import { getPrismaClient } from '../prismaClient';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE,
  MAX_PAGE_SIZE,
  LIMIT_EXCEEDED_CODE,
  PaginationLimitError,
  enforcePaginationLimits,
  resolvePagination,
} from '../middleware/paginationGuard';
import { DEFAULT_PAGINATION_CONFIG, parsePaginationQuery } from '../pagination';
import { specs } from '../swagger';
import { VaultListResponseSchema, validateResponseAgainstSchema } from '../apiContractSnapshots';
import { prisma } from '../prisma';
import * as fs from 'fs';
import * as path from 'path';

const VAULTS_PATH = '/api/v1/vaults';

/** Smallest `take` the route may ever issue: one lookahead row. */
const MAX_ALLOWED_TAKE = MAX_PAGE_SIZE + 1;

const prismaClient = getPrismaClient();

async function seedVaults(count: number): Promise<void> {
  const existing = await prisma.vault.count();
  if (existing >= count) return;

  for (let i = existing; i < count; i += 1) {
    await prismaClient.vault.create({
      data: {
        tenantId: 'tenant-1430',
        aum: 1000 + i,
        tvlUsd: `${1000 + i}.00`,
      },
    });
  }
}

describe('Issue #1430 — GET /api/v1/vaults pagination limits', () => {
  beforeAll(async () => {
    await seedVaults(55);
  });

  afterAll(async () => {
    await prisma.vault.deleteMany({ where: { tenantId: 'tenant-1430' } });
  });

  // ─── Defaults and accepted values ──────────────────────────────────────────

  it('defaults to 20 items per page', async () => {
    const res = await request(app).get(VAULTS_PATH);

    expect(res.status).toBe(200);
    expect(res.body.pagination.limit).toBe(DEFAULT_PAGE_SIZE);
    expect(res.body.data.length).toBeLessThanOrEqual(DEFAULT_PAGE_SIZE);
  });

  it('honours the maximum permitted limit', async () => {
    const res = await request(app).get(`${VAULTS_PATH}?limit=${MAX_PAGE_SIZE}`);

    expect(res.status).toBe(200);
    expect(res.body.pagination.limit).toBe(MAX_PAGE_SIZE);
  });

  it('falls back to the default when limit is not a positive integer', async () => {
    for (const raw of ['abc', '0', '-5', '1.5', '']) {
      const res = await request(app).get(`${VAULTS_PATH}?limit=${encodeURIComponent(raw)}`);
      expect(res.status).toBe(200);
      expect(res.body.pagination.limit).toBe(DEFAULT_PAGE_SIZE);
    }
  });

  it('rejects an oversized limit with 400 LIMIT_EXCEEDED', async () => {
    const res = await request(app).get(`${VAULTS_PATH}?limit=100000`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(LIMIT_EXCEEDED_CODE);
    expect(res.body.error).toBe('Bad Request');
    expect(res.body.retryable).toBe(false);
    expect(res.body.message).toContain(String(MAX_PAGE_SIZE));
    expect(res.body.details).toMatchObject({
      field: 'limit',
      requested: 100000,
      maxLimit: MAX_PAGE_SIZE,
    });
  });

  it('rejects every limit above the ceiling, including the boundary + 1', async () => {
    const res = await request(app).get(`${VAULTS_PATH}?limit=${MAX_PAGE_SIZE + 1}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(LIMIT_EXCEEDED_CODE);
  });

  it('never issues a Prisma read with take above the ceiling', async () => {
    const findMany = jest.spyOn(prismaClient.vault, 'findMany');
    const count = jest.spyOn(prismaClient.vault, 'count');

    try {
      const requests = [
        `${VAULTS_PATH}?limit=100000`,
        `${VAULTS_PATH}?limit=999999`,
        `${VAULTS_PATH}?limit=100000&page=3`,
        `${VAULTS_PATH}?limit=51`,
        `${VAULTS_PATH}`,
        `${VAULTS_PATH}?limit=50`,
        `${VAULTS_PATH}?limit=1`,
      ];

      for (const target of requests) {
        await request(app).get(target);
      }

      const takes = findMany.mock.calls.map(([args]) => (args as { take?: number }).take);
      expect(takes.length).toBeGreaterThan(0);
      for (const take of takes) {
        expect(typeof take).toBe('number');
        expect(take!).toBeLessThanOrEqual(MAX_ALLOWED_TAKE);
      }
    } finally {
      findMany.mockRestore();
      count.mockRestore();
    }
  });

  it('rejects the oversized limit before touching the database at all', async () => {
    const findMany = jest.spyOn(prismaClient.vault, 'findMany');
    const count = jest.spyOn(prismaClient.vault, 'count');

    try {
      const res = await request(app).get(`${VAULTS_PATH}?limit=100000`);

      expect(res.status).toBe(400);
      expect(findMany).not.toHaveBeenCalled();
      expect(count).not.toHaveBeenCalled();
    } finally {
      findMany.mockRestore();
      count.mockRestore();
    }
  });

  // ─── Page clamping ─────────────────────────────────────────────────────────

  it('clamps page into 1..1000 instead of rejecting it', async () => {
    const high = await request(app).get(`${VAULTS_PATH}?page=100000`);
    expect(high.status).toBe(200);
    expect(high.body.pagination.currentPage).toBe(MAX_PAGE);

    const low = await request(app).get(`${VAULTS_PATH}?page=-1`);
    expect(low.status).toBe(200);
    expect(low.body.pagination.currentPage).toBe(1);
  });

  it('caps the database offset derived from page', async () => {
    const findMany = jest.spyOn(prismaClient.vault, 'findMany');

    try {
      await request(app).get(`${VAULTS_PATH}?limit=50&page=100000`);
      const [args] = findMany.mock.calls[0] as [{ take: number; skip: number }];

      expect(args.take).toBeLessThanOrEqual(MAX_ALLOWED_TAKE);
      expect(args.skip).toBe((MAX_PAGE - 1) * 50);
    } finally {
      findMany.mockRestore();
    }
  });

  // ─── Response contract ─────────────────────────────────────────────────────

  it('matches the committed vault-list contract snapshot', async () => {
    const res = await request(app).get(`${VAULTS_PATH}?limit=5`);

    expect(res.status).toBe(200);
    const parsed = VaultListResponseSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);
    expect(validateResponseAgainstSchema('GET /api/v1/vaults', res.body).success).toBe(true);
  });

  it('never leaks tenantId', async () => {
    const res = await request(app).get(VAULTS_PATH);

    for (const vault of res.body.data as Array<Record<string, unknown>>) {
      expect(vault).not.toHaveProperty('tenantId');
    }
  });

  // ─── Guard unit behaviour ──────────────────────────────────────────────────

  describe('resolvePagination', () => {
    it('applies the documented defaults', () => {
      expect(resolvePagination({})).toEqual({ limit: DEFAULT_PAGE_SIZE, page: 1 });
    });

    it('throws PaginationLimitError above the ceiling', () => {
      expect(() => resolvePagination({ limit: '100000' })).toThrow(PaginationLimitError);
    });

    it('honours per-route overrides', () => {
      expect(resolvePagination({ limit: '75' }, { maxLimit: 100 })).toEqual({
        limit: 75,
        page: 1,
      });
      expect(() => resolvePagination({ limit: '75' }, { maxLimit: 50 })).toThrow(
        PaginationLimitError,
      );
    });

    it('clamps page and ignores non-integer input', () => {
      expect(resolvePagination({ page: '0' }).page).toBe(1);
      expect(resolvePagination({ page: 'nope' }).page).toBe(1);
      expect(resolvePagination({ page: '100000' }).page).toBe(MAX_PAGE);
      expect(resolvePagination({ page: '3' }).page).toBe(3);
    });

    it('rejects repeated query parameters rather than guessing', () => {
      expect(resolvePagination({ limit: ['10', '20'] }).limit).toBe(DEFAULT_PAGE_SIZE);
    });
  });

  describe('enforcePaginationLimits middleware', () => {
    function runMiddleware(query: Record<string, unknown>) {
      const req = { query } as never;
      const json = jest.fn();
      const res = {
        status: jest.fn(() => ({ json })),
        setHeader: jest.fn(),
      } as never;
      const next = jest.fn();

      enforcePaginationLimits()(req, res, next);
      return { req: req as { resolvedPagination?: { limit: number; page: number } }, json, next };
    }

    it('attaches the resolved pagination and continues', () => {
      const { req, json, next } = runMiddleware({ limit: '25', page: '4' });

      expect(next).toHaveBeenCalledTimes(1);
      expect(json).not.toHaveBeenCalled();
      expect(req.resolvedPagination).toEqual({ limit: 25, page: 4 });
    });

    it('sends 400 LIMIT_EXCEEDED and does not continue', () => {
      const { json, next } = runMiddleware({ limit: '100000' });

      expect(next).not.toHaveBeenCalled();
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ status: 400, code: LIMIT_EXCEEDED_CODE }),
      );
    });
  });

  describe('shared parsePaginationQuery', () => {
    function parse(query: Record<string, unknown>) {
      return parsePaginationQuery({ query } as never);
    }

    it('clamps page to maxPage but keeps the default limit of 20', () => {
      expect(DEFAULT_PAGINATION_CONFIG.defaultLimit).toBe(20);
      expect(parse({})).toMatchObject({ limit: 20 });
      expect(parse({ page: '1000000' })).toMatchObject({ page: MAX_PAGE });
      expect(parse({ page: '-1' })).toMatchObject({ page: 1 });
    });
  });

  // ─── OpenAPI contract ──────────────────────────────────────────────────────

  describe('OpenAPI documentation of the pagination ceiling', () => {
    const spec = specs as unknown as {
      paths: Record<string, { get?: { parameters?: Array<Record<string, unknown>> } }>;
      components: {
        parameters: Record<
          string,
          { name: string; schema: { maximum?: number; minimum?: number; default?: number } }
        >;
      };
    };

    it('publishes maxLimit and the page ceiling as reusable parameters', () => {
      expect(spec.components.parameters.pageSize).toMatchObject({
        name: 'limit',
        schema: { minimum: 1, maximum: MAX_PAGE_SIZE, default: DEFAULT_PAGE_SIZE },
      });
      expect(spec.components.parameters.pageNumber).toMatchObject({
        name: 'page',
        schema: { minimum: 1, maximum: MAX_PAGE },
      });
    });

    it('references those parameters from GET /api/v1/vaults', () => {
      const parameters = spec.paths[VAULTS_PATH]?.get?.parameters ?? [];
      const refs = parameters.map((parameter) => parameter.$ref);

      expect(refs).toContain('#/components/parameters/pageSize');
      expect(refs).toContain('#/components/parameters/pageNumber');
    });

    it('documents the LIMIT_EXCEEDED failure mode', () => {
      const specWithResponses = specs as unknown as {
        paths: Record<
          string,
          { get?: { responses?: Record<string, { content?: Record<string, { example?: { code?: string } }> }> } }
        >;
      };
      const example =
        specWithResponses.paths[VAULTS_PATH]?.get?.responses?.['400']?.content?.[
          'application/json'
        ]?.example;

      expect(example?.code).toBe(LIMIT_EXCEEDED_CODE);
    });

    it('keeps the committed openapi.json in sync with the spec source', () => {
      const committed = JSON.parse(
        fs.readFileSync(path.join(__dirname, '..', '..', 'openapi.json'), 'utf8'),
      ) as typeof specs;

      expect(JSON.stringify(committed)).toBe(JSON.stringify(specs));
    });
  });
});
