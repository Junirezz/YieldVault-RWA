/**
 * @file listEndpoints.ts
 * List endpoints with pagination and filtering support.
 *
 * Provides consistent list endpoints for:
 * - Transactions
 * - Portfolio holdings
 * - Vault history
 */

import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { Readable } from 'stream';
import {
  parsePaginationQuery,
  paginateWithCursor,
  paginateWithOffset,
  sortItems,
  sendPaginatedResponse,
  encodeCursor,
  PaginationConfig,
  createPaginatedResponse,
  createPaginationEnvelope,
  PaginatedResponse,
} from './pagination';
import { DateRangeParseError, parseUtcDateRange, type ParsedUtcDateRange } from './dateRange';
import { getApyHistory } from './apySnapshot';
import { cacheMiddleware } from './middleware/cache';
import { requireAuth, AuthenticatedRequest } from './auth';
import { normalizeWalletAddress } from './walletUtils';
import { validateApiKey } from './middleware/apiKeyAuth';
import { hasPermission, Permission } from './middleware/rbac';
import {
  buildExportMetadataHeaderValue,
  recordExportJob,
  resolveExportGeneratedBy,
} from './exportJobs';
import { tenantGuard } from './middleware/tenantGuard';
import { createTimeoutFor } from './middleware/timeoutMiddleware';
import { getPrismaClient } from './prismaClient';

const router = Router();
const CACHE_TTL_MS = parseInt(process.env.CACHE_LIST_ENDPOINTS_TTL_MS || '30000', 10);

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * @openapi
 * components:
 *   schemas:
 *     Transaction:
 *       type: object
 *       required: [id, type, status, amount, asset, timestamp, transactionHash, walletAddress]
 *       properties:
 *         id: { type: string }
 *         type: { type: string, enum: [deposit, withdrawal] }
 *         status: { type: string, enum: [pending, completed, failed] }
 *         amount: { type: string }
 *         asset: { type: string }
 *         timestamp: { type: string, format: "date-time" }
 *         transactionHash: { type: string }
 *         walletAddress: { type: string }
 */
export interface Transaction {
  id: string;
  type: 'deposit' | 'withdrawal';
  status: 'pending' | 'completed' | 'failed';
  amount: string;
  asset: string;
  timestamp: string;
  transactionHash: string;
  walletAddress: string;
  [key: string]: unknown;
}

export type ExportFormat = 'csv' | 'json';

interface ExportRequest extends AuthenticatedRequest {
  exportAsAdmin?: boolean;
}

/**
 * @openapi
 * components:
 *   schemas:
 *     PortfolioHolding:
 *       type: object
 *       properties:
 *         id: { type: string }
 *         asset: { type: string }
 *         vaultName: { type: string }
 *         symbol: { type: string }
 *         shares: { type: number }
 *         apy: { type: number }
 *         valueUsd: { type: number }
 *         unrealizedGainUsd: { type: number }
 *         issuer: { type: string }
 *         status: { type: string, enum: [active, pending] }
 *         walletAddress: { type: string }
 */
interface PortfolioHolding {
  id: string;
  asset: string;
  vaultName: string;
  symbol: string;
  shares: number;
  apy: number;
  valueUsd: number;
  unrealizedGainUsd: number;
  issuer: string;
  status: 'active' | 'pending';
  walletAddress: string;
  [key: string]: unknown;
}

/**
 * @openapi
 * components:
 *   schemas:
 *     VaultHistoryPoint:
 *       type: object
 *       properties:
 *         date: { type: string, format: "date" }
 *         value: { type: number }
 */
interface VaultHistoryPoint {
  date: string;
  value: number;
  [key: string]: unknown;
}

export interface WalletStateQuery {
  limit?: number;
  cursor?: string;
  page?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  type?: string;
  status?: string;
  from?: string;
  to?: string;
  walletAddress?: string;
}

export interface TransactionExportQuery extends Omit<WalletStateQuery, 'limit' | 'cursor' | 'page'> {
  startDate?: string;
  endDate?: string;
}

export interface TransactionExportArtifact {
  body: string;
  checksum: string;
  checksumAlgorithm: 'sha256';
  rowCount: number;
  contentType: string;
  extension: ExportFormat;
}

// ─── Mock Data ──────────────────────────────────────────────────────────────

// Kept in sync with VALID_TEST_WALLET in src/__tests__/setup.ts — both must be
// a real, checksum-valid Ed25519 public key (not just regex-shaped) since
// some endpoints validate wallet addresses via StrKey.isValidEd25519PublicKey.
const MOCK_WALLET_ADDRESS = 'GBF2VOZSQLF2BZRW6NIDETV2L3I6GHXZUEFSIESELEAGATV2FYTOHOHI';

const MOCK_TRANSACTIONS: Transaction[] = Array.from({ length: 100 }, (_, i) => ({
  id: `tx-${i + 1}`,
  type: i % 2 === 0 ? 'deposit' : 'withdrawal',
  status: i % 11 === 0 ? 'failed' : i % 3 === 0 ? 'pending' : 'completed',
  amount: (Math.random() * 1000).toFixed(2),
  asset: ['XLM', 'USDC', 'yUSDC', 'RWA'][i % 4],
  timestamp: new Date(Date.now() - i * 3600000).toISOString(),
  transactionHash: `hash-${i + 1}-${Math.random().toString(36).substring(7)}`,
  walletAddress: MOCK_WALLET_ADDRESS,
}));

const MOCK_PORTFOLIO_HOLDINGS: PortfolioHolding[] = Array.from({ length: 50 }, (_, i) => ({
  id: `holding-${i + 1}`,
  asset: ['XLM', 'USDC', 'yUSDC', 'RWA'][i % 4],
  vaultName: `Vault ${Math.floor(i / 4) + 1}`,
  symbol: ['XLM', 'USDC', 'yUSDC', 'RWA'][i % 4],
  shares: Math.floor(Math.random() * 1000),
  apy: 2 + Math.random() * 8,
  valueUsd: Math.random() * 10000,
  unrealizedGainUsd: Math.random() * 1000 - 500,
  issuer: 'YieldVault',
  status: i % 10 === 0 ? 'pending' : 'active',
  walletAddress: MOCK_WALLET_ADDRESS,
}));

const MOCK_VAULT_HISTORY: VaultHistoryPoint[] = Array.from({ length: 365 }, (_, i) => ({
  date: new Date(Date.now() - (365 - i) * 86400000).toISOString().split('T')[0],
  value: 100 + i * 0.05 + Math.random() * 0.1,
}));

// ─── Pagination Configs ─────────────────────────────────────────────────────

const TRANSACTION_PAGINATION_CONFIG: Partial<PaginationConfig> = {
  defaultLimit: 20,
  maxLimit: 100,
  defaultSortBy: 'timestamp',
  defaultSortOrder: 'desc',
};

const PORTFOLIO_PAGINATION_CONFIG: Partial<PaginationConfig> = {
  defaultLimit: 20,
  maxLimit: 100,
  defaultSortBy: 'valueUsd',
  defaultSortOrder: 'desc',
};

const VAULT_HISTORY_PAGINATION_CONFIG: Partial<PaginationConfig> = {
  defaultLimit: 30,
  maxLimit: 365,
  defaultSortBy: 'date',
  defaultSortOrder: 'desc',
};

// ─── Helper Functions ───────────────────────────────────────────────────────

/**
 * Filter transactions by type and wallet address.
 */
function filterTransactions(
  transactions: Transaction[],
  filters: { type?: string; status?: string; walletAddress?: string; from?: string; to?: string }
): Transaction[] {
  const from = filters.from ? Date.parse(filters.from) : null;
  const to = filters.to ? Date.parse(filters.to) : null;
  const normalizedWallet = filters.walletAddress ? normalizeWalletAddress(filters.walletAddress) : null;

  return transactions.filter((tx) => {
    if (filters.type && filters.type !== 'all' && tx.type !== filters.type) {
      return false;
    }
    if (filters.status && filters.status !== 'all' && tx.status !== filters.status) {
      return false;
    }
    if (normalizedWallet && normalizeWalletAddress(tx.walletAddress) !== normalizedWallet) {
      return false;
    }
    const transactionTime = Date.parse(tx.timestamp);
    if (Number.isNaN(transactionTime)) {
      return false;
    }
    if (from !== null && transactionTime < from) {
      return false;
    }
    if (to !== null && transactionTime > to) {
      return false;
    }
    return true;
  });
}

function parseDateFilter(value: string | undefined, boundary: 'start' | 'end'): number | null {
  if (!value) {
    return null;
  }

  const hasTimeComponent = value.includes('T');
  const normalizedValue = hasTimeComponent
    ? value
    : boundary === 'start'
      ? `${value}T00:00:00.000Z`
      : `${value}T23:59:59.999Z`;
  const timestamp = Date.parse(normalizedValue);

  return Number.isNaN(timestamp) ? null : timestamp;
}

function isTransactionInDateRange(
  timestamp: string,
  from: number | null,
  to: number | null
): boolean {
  const transactionTime = Date.parse(timestamp);

  if (Number.isNaN(transactionTime)) {
    return false;
  }
  if (from !== null && transactionTime < from) {
    return false;
  }
  if (to !== null && transactionTime > to) {
    return false;
  }

  return true;
}

function filterTransactionsForExport(
  query: WalletStateQuery & { startDate?: string; endDate?: string; walletAddress?: string }
): Transaction[] {
  const sortBy = query.sortBy ?? TRANSACTION_PAGINATION_CONFIG.defaultSortBy;
  const sortOrder = query.sortOrder ?? TRANSACTION_PAGINATION_CONFIG.defaultSortOrder ?? 'desc';
  const from = query.startDate ?? query.from;
  const to = query.endDate ?? query.to;

  let filtered = filterTransactions(MOCK_TRANSACTIONS, {
    type: query.type,
    status: query.status,
    from,
    to,
    walletAddress: query.walletAddress,
  });

  if (sortBy) {
    filtered = sortItems(filtered, sortBy, sortOrder);
  }

  return filtered;
}

function escapeCsv(value: unknown): string {
  const serialized = String(value ?? '');
  const escaped = serialized.replace(/"/g, '""');
  return `"${escaped}"`;
}

function buildCsvRow(row: Transaction): string {
  return [
    row.id,
    row.type,
    row.status,
    row.amount,
    row.asset,
    row.timestamp,
    row.transactionHash,
    row.walletAddress,
  ]
    .map(escapeCsv)
    .join(',');
}

function resolveExportFormat(raw: unknown): ExportFormat | null {
  if (raw === 'csv' || raw === 'json') {
    return raw;
  }
  return null;
}

function authenticateTransactionExport(req: ExportRequest, res: Response, next: () => void): void {
  const authHeader = req.get('Authorization') || '';
  if (authHeader.startsWith('ApiKey ')) {
    validateApiKey(req, res, () => {
      if (!hasPermission(req, Permission.EXPORTS_WRITE)) {
        res.status(403).json({
          error: 'Forbidden',
          status: 403,
          message: 'Operator role or higher is required for admin transaction export',
          requiredPermission: Permission.EXPORTS_WRITE,
        });
        return;
      }
      req.exportAsAdmin = true;
      next();
    });
    return;
  }

  requireAuth(req, res, () => {
    req.exportAsAdmin = false;
    next();
  });
}

function streamTransactionsAsJson(res: Response, rows: Transaction[]): void {
  async function* generate(): AsyncGenerator<string> {
    yield '{"data":[';
    for (let i = 0; i < rows.length; i++) {
      if (i > 0) {
        yield ',';
      }
      yield JSON.stringify(rows[i]);
    }
    yield ']}';
  }

  Readable.from(generate()).pipe(res);
}

function streamTransactionsAsCsv(res: Response, rows: Transaction[]): void {
  async function* generate(): AsyncGenerator<string> {
    yield 'id,type,status,amount,asset,timestamp,transactionHash,walletAddress\r\n';
    for (const row of rows) {
      yield `${buildCsvRow(row)}\r\n`;
    }
  }

  Readable.from(generate()).pipe(res);
}
/**
 * Filter portfolio holdings by status and wallet address.
 */
function filterPortfolioHoldings(
  holdings: PortfolioHolding[],
  filters: { status?: string; walletAddress?: string }
): PortfolioHolding[] {
  return holdings.filter((holding) => {
    if (filters.status && filters.status !== 'all' && holding.status !== filters.status) {
      return false;
    }
    if (filters.walletAddress && holding.walletAddress !== filters.walletAddress) {
      return false;
    }
    return true;
  });
}

/**
 * Filter vault history by date range.
 */
function filterVaultHistory(
  history: VaultHistoryPoint[],
  filters: { from?: string; to?: string }
): VaultHistoryPoint[] {
  return history.filter((point) => {
    if (filters.from && point.date < filters.from) {
      return false;
    }
    if (filters.to && point.date > filters.to) {
      return false;
    }
    return true;
  });
}

function parseDateRangeOrThrow(filters: { from?: string; to?: string }): ParsedUtcDateRange {
  return parseUtcDateRange(filters);
}

/** Map a Prisma Transaction row to the public Transaction shape. */
function dbRowToTransaction(row: {
  id: string;
  user: string;
  amount: string;
  type: string;
  status: string | null;
  referralCode: string | null;
  timestamp: Date;
}): Transaction {
  return {
    id: row.id,
    type: row.type as 'deposit' | 'withdrawal',
    status: (row.status ?? 'completed') as 'pending' | 'completed' | 'failed',
    amount: row.amount,
    asset: 'USDC',
    timestamp: row.timestamp.toISOString(),
    transactionHash: '',
    walletAddress: row.user,
  };
}

export async function buildTransactionsResponse(
  query: WalletStateQuery
): Promise<PaginatedResponse<Transaction>> {
  const prisma = getPrismaClient();
  const limit = query.limit ?? TRANSACTION_PAGINATION_CONFIG.defaultLimit ?? 20;
  const normalizedDateRange = parseDateRangeOrThrow({ from: query.from, to: query.to });

  const sortBy = query.sortBy ?? TRANSACTION_PAGINATION_CONFIG.defaultSortBy ?? 'timestamp';
  const sortOrder = query.sortOrder ?? TRANSACTION_PAGINATION_CONFIG.defaultSortOrder ?? 'desc';

  const where = {
    ...(query.type ? { type: query.type } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.walletAddress ? { user: normalizeWalletAddress(query.walletAddress) } : {}),
    ...((normalizedDateRange.normalizedStart || normalizedDateRange.normalizedEnd)
      ? {
          timestamp: {
            ...(normalizedDateRange.normalizedStart ? { gte: new Date(normalizedDateRange.normalizedStart) } : {}),
            ...(normalizedDateRange.normalizedEnd ? { lte: new Date(normalizedDateRange.normalizedEnd) } : {}),
          },
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.transaction.count({ where: where as any }),
    prisma.transaction.findMany({
      where: where as any,
      orderBy: { [sortBy === 'timestamp' ? 'timestamp' : 'timestamp']: sortOrder },
      take: limit + 1,
      ...(query.cursor
        ? { cursor: { id: Buffer.from(query.cursor, 'base64url').toString('utf-8') }, skip: 1 }
        : query.page && query.page > 1
          ? { skip: (query.page - 1) * limit }
          : {}),
    }),
  ]);

  const hasNextPage = rows.length > limit;
  const data = hasNextPage ? rows.slice(0, limit) : rows;
  const mapped = data.map(dbRowToTransaction);

  const pagination = createPaginationEnvelope({
    count: mapped.length,
    limit,
    total,
    hasNextPage,
    hasPrevPage: !!(query.cursor || (query.page && query.page > 1)),
    nextCursor: hasNextPage && data.length > 0 ? encodeCursor(data[data.length - 1].id) : null,
    currentPage: query.page ?? null,
    totalPages: query.page ? Math.ceil(total / limit) : null,
  });

  return createPaginatedResponse(mapped, pagination, {
    normalizedDateRange:
      normalizedDateRange.start || normalizedDateRange.end ? normalizedDateRange : undefined,
  });
}

export function getTransactionsForExport(query: TransactionExportQuery): Transaction[] {
  const filters = {
    type: query.type,
    status: query.status,
    from: query.startDate ?? query.from,
    to: query.endDate ?? query.to,
    walletAddress: query.walletAddress,
  };
  const sortBy = query.sortBy ?? TRANSACTION_PAGINATION_CONFIG.defaultSortBy;
  const sortOrder = query.sortOrder ?? TRANSACTION_PAGINATION_CONFIG.defaultSortOrder ?? 'desc';

  let filtered = filterTransactions(MOCK_TRANSACTIONS, filters);
  if (sortBy) {
    filtered = sortItems(filtered, sortBy, sortOrder);
  }

  return filtered;
}

export function buildTransactionExportArtifact(
  format: ExportFormat,
  query: TransactionExportQuery,
): TransactionExportArtifact {
  const transactions = getTransactionsForExport(query);
  const body =
    format === 'csv'
      ? buildTransactionsCsvExportBody(transactions)
      : buildTransactionsJsonExportBody(transactions);

  return {
    body,
    checksum: crypto.createHash('sha256').update(body, 'utf8').digest('hex'),
    checksumAlgorithm: 'sha256',
    rowCount: transactions.length,
    contentType: format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
    extension: format,
  };
}

export function createTransactionsJsonExportStream(query: TransactionExportQuery): Readable {
  const transactions = getTransactionsForExport(query);

  async function* generate(): AsyncGenerator<string> {
    yield '{"data":[';
    for (let index = 0; index < transactions.length; index += 1) {
      if (index > 0) {
        yield ',';
      }
      yield JSON.stringify(transactions[index]);
    }
    yield ']}';
  }

  return Readable.from(generate());
}

export function createTransactionsCsvExportStream(query: TransactionExportQuery): Readable {
  const transactions = getTransactionsForExport(query);
  const columns: Array<keyof Transaction> = [
    'id',
    'type',
    'status',
    'amount',
    'asset',
    'timestamp',
    'transactionHash',
    'walletAddress',
  ];

  async function* generate(): AsyncGenerator<string> {
    yield `${columns.join(',')}\r\n`;
    for (const transaction of transactions) {
      const row = columns
        .map((column) => escapeCsvValue(transaction[column]))
        .join(',');
      yield `${row}\r\n`;
    }
  }

  return Readable.from(generate());
}

function buildTransactionsJsonExportBody(transactions: Transaction[]): string {
  return JSON.stringify({ data: transactions });
}

function buildTransactionsCsvExportBody(transactions: Transaction[]): string {
  const columns: Array<keyof Transaction> = [
    'id',
    'type',
    'status',
    'amount',
    'asset',
    'timestamp',
    'transactionHash',
    'walletAddress',
  ];

  const rows = transactions.map((transaction) =>
    columns.map((column) => escapeCsvValue(transaction[column])).join(','),
  );

  return `${columns.join(',')}\r\n${rows.map((row) => `${row}\r\n`).join('')}`;
}

function escapeCsvValue(value: unknown): string {
  const serialized = value == null ? '' : String(value);
  const escaped = serialized.replace(/"/g, '""');
  return `"${escaped}"`;
}

export function buildPortfolioHoldingsResponse(
  query: WalletStateQuery
): PaginatedResponse<PortfolioHolding> {
  const pagination = {
    limit: query.limit ?? PORTFOLIO_PAGINATION_CONFIG.defaultLimit ?? 20,
    cursor: query.cursor,
    sortBy: query.sortBy ?? PORTFOLIO_PAGINATION_CONFIG.defaultSortBy,
    sortOrder: query.sortOrder ?? PORTFOLIO_PAGINATION_CONFIG.defaultSortOrder ?? 'desc',
  };
  const filters = {
    status: query.status,
    walletAddress: query.walletAddress,
  };

  let filtered = filterPortfolioHoldings(MOCK_PORTFOLIO_HOLDINGS, filters);
  if (pagination.sortBy) {
    filtered = sortItems(filtered, pagination.sortBy, pagination.sortOrder, ['valueUsd', 'id']);
  }

  const paginated = paginateWithCursor(filtered, pagination, (holding) =>
    encodeCursor(holding.id)
  );

  return createPaginatedResponse(paginated.data, paginated.pagination);
}

export function buildVaultHistoryResponse(
  query: Pick<WalletStateQuery, 'limit' | 'cursor' | 'sortBy' | 'sortOrder' | 'from' | 'to'>
): PaginatedResponse<VaultHistoryPoint> {
  const pagination = {
    limit: query.limit ?? VAULT_HISTORY_PAGINATION_CONFIG.defaultLimit ?? 30,
    cursor: query.cursor,
    sortBy: query.sortBy ?? VAULT_HISTORY_PAGINATION_CONFIG.defaultSortBy,
    sortOrder: query.sortOrder ?? VAULT_HISTORY_PAGINATION_CONFIG.defaultSortOrder ?? 'desc',
  };
  const filters = {
    from: query.from,
    to: query.to,
  };
  const normalizedDateRange = parseDateRangeOrThrow(filters);

  let filtered = filterVaultHistory(MOCK_VAULT_HISTORY, {
    from: normalizedDateRange.normalizedStart?.slice(0, 10),
    to: normalizedDateRange.normalizedEnd?.slice(0, 10),
  });
  if (pagination.sortBy) {
    filtered = sortItems(filtered, pagination.sortBy, pagination.sortOrder, ['date']);
  }

  const paginated = paginateWithCursor(filtered, pagination, (point) =>
    encodeCursor(point.date)
  );

  return createPaginatedResponse(paginated.data, paginated.pagination, {
    normalizedDateRange: normalizedDateRange.start || normalizedDateRange.end ? normalizedDateRange : undefined,
  });
}

// ─── Endpoints ──────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/v1/transactions:
 *   get:
 *     summary: List transactions
 *     description: Returns a paginated list of transactions with optional filtering.
 *     tags: [Transactions]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: cursor
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: type
 *         schema: { type: string, enum: [deposit, withdrawal, all] }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, completed, failed, all] }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: walletAddress
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: List of transactions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Transaction'
 *                 pagination:
 *                   $ref: '#/components/schemas/PaginationMeta'
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 */
router.get('/transactions', 
  cacheMiddleware({ ttl: CACHE_TTL_MS }),
  tenantGuard({ 
    walletParamPath: 'query.walletAddress', 
    allowAdminBypass: true, 
    adminBypassPermission: Permission.ADMIN_READ 
  }),
  createTimeoutFor.read(),
  async (req: Request, res: Response) => {
  try {
    const pagination = parsePaginationQuery(req, TRANSACTION_PAGINATION_CONFIG);
    const response = await buildTransactionsResponse({
      ...pagination,
      type: req.query.type as string | undefined,
      status: req.query.status as string | undefined,
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
      walletAddress: req.query.walletAddress as string | undefined,
    });

    res.status(200).json(response);
  } catch (error) {
    if (error instanceof DateRangeParseError) {
      res.status(400).json({
        error: 'Bad Request',
        status: 400,
        message: error.message,
      });
      return;
    }
    console.error('Error fetching transactions:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: 'Failed to fetch transactions',
    });
  }
});

router.get('/vault/transactions/export', 
  authenticateTransactionExport, 
  createTimeoutFor.export(), 
  async (req: Request, res: Response) => {
  const exportReq = req as ExportRequest;
  const format = resolveExportFormat(req.query.format);
  if (!format) {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'format query parameter must be either csv or json',
    });
    return;
  }

  const requestedWallet = typeof req.query.walletAddress === 'string' ? req.query.walletAddress : undefined;
  const walletAddress = exportReq.exportAsAdmin
    ? requestedWallet
    : exportReq.jwtPayload?.sub;

  if (!exportReq.exportAsAdmin && requestedWallet && requestedWallet !== exportReq.jwtPayload?.sub) {
    res.status(403).json({
      error: 'Forbidden',
      status: 403,
      message: 'Users can only export their own wallet transaction history',
    });
    return;
  }

  if (!walletAddress) {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'walletAddress is required for admin exports',
    });
    return;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const fileBase = `transaction-history-${walletAddress.slice(0, 8)}-${stamp}`;
  const fileName = `${fileBase}.${format}`;

  try {
    const artifact = buildTransactionExportArtifact(format, {
      type: typeof req.query.type === 'string' ? req.query.type : undefined,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      sortBy: typeof req.query.sortBy === 'string' ? req.query.sortBy : undefined,
      sortOrder: req.query.sortOrder === 'asc' ? 'asc' : 'desc',
      startDate: typeof req.query.startDate === 'string' ? req.query.startDate : undefined,
      endDate: typeof req.query.endDate === 'string' ? req.query.endDate : undefined,
      walletAddress,
    });

    const job = await recordExportJob({
      format,
      fileName,
      contentType: artifact.contentType,
      checksum: artifact.checksum,
      checksumAlgorithm: artifact.checksumAlgorithm,
      generatedBy: resolveExportGeneratedBy(req),
      walletAddress,
      rowCount: artifact.rowCount,
      filters: {
        type: typeof req.query.type === 'string' ? req.query.type : null,
        status: typeof req.query.status === 'string' ? req.query.status : null,
        sortBy: typeof req.query.sortBy === 'string' ? req.query.sortBy : null,
        sortOrder: req.query.sortOrder === 'asc' ? 'asc' : 'desc',
        startDate: typeof req.query.startDate === 'string' ? req.query.startDate : null,
        endDate: typeof req.query.endDate === 'string' ? req.query.endDate : null,
        walletAddress,
      },
    });

    res.setHeader('Content-Type', artifact.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('X-Export-Job-Id', job.id);
    res.setHeader('X-Export-Checksum', artifact.checksum);
    res.setHeader('X-Export-Checksum-Algorithm', artifact.checksumAlgorithm);
    res.setHeader('X-Export-Metadata', buildExportMetadataHeaderValue(job));
    res.status(200).send(artifact.body);
  } catch (error) {
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: error instanceof Error ? error.message : 'Failed to generate transaction export',
    });
  }
});

/**
 * @openapi
 * /api/v1/portfolio/holdings:
 *   get:
 *     summary: List portfolio holdings
 *     description: Returns a paginated list of user holdings.
 *     tags: [Portfolio]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [active, pending, all] }
 *       - in: query
 *         name: walletAddress
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: List of holdings
 */
router.get('/portfolio/holdings', 
  cacheMiddleware({ ttl: CACHE_TTL_MS }),
  tenantGuard({ 
    walletParamPath: 'query.walletAddress', 
    allowAdminBypass: true, 
    adminBypassPermission: Permission.ADMIN_READ 
  }),
  createTimeoutFor.read(),
  (req: Request, res: Response) => {
  try {
    const pagination = parsePaginationQuery(req, PORTFOLIO_PAGINATION_CONFIG);
    const response = buildPortfolioHoldingsResponse({
      ...pagination,
      status: req.query.status as string | undefined,
      walletAddress: req.query.walletAddress as string | undefined,
    });

    sendPaginatedResponse(res, response.data, response.pagination);
  } catch (error) {
    console.error('Error fetching portfolio holdings:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: 'Failed to fetch portfolio holdings',
    });
  }
});

/**
 * @openapi
 * /api/v1/vault/history:
 *   get:
 *     summary: List vault history
 *     description: Returns historical data points for vault performance.
 *     tags: [Vault]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 30 }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: Vault history points
 */
router.get('/vault/history', 
  cacheMiddleware({ ttl: CACHE_TTL_MS }), 
  createTimeoutFor.read(), 
  (req: Request, res: Response) => {
  try {
    const pagination = parsePaginationQuery(req, VAULT_HISTORY_PAGINATION_CONFIG);
    const response = buildVaultHistoryResponse({
      ...pagination,
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
    });

    res.status(200).json(response);
  } catch (error) {
    if (error instanceof DateRangeParseError) {
      res.status(400).json({
        error: 'Bad Request',
        status: 400,
        message: error.message,
      });
      return;
    }
    console.error('Error fetching vault history:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: 'Failed to fetch vault history',
    });
  }
});

/**
 * @openapi
 * /api/v1/vault/apy/history:
 *   get:
 *     summary: APY history
 *     description: >
 *       Returns one APY data point per day for the requested range.
 *       Missing days are backfilled with the previous known value (never null).
 *       Snapshots are written nightly by the APY snapshot job (Issue #374).
 *     tags: [Vault]
 *     parameters:
 *       - in: query
 *         name: days
 *         schema: { type: integer, default: 30, minimum: 1, maximum: 365 }
 *         description: Number of calendar days of history to return (max 365).
 *     responses:
 *       200:
 *         description: Array of APY snapshots ordered oldest → newest
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       date: { type: string, format: date }
 *                       apy:  { type: number }
 *                 days: { type: integer }
 *                 count: { type: integer }
 */
router.get('/vault/apy/history', 
  cacheMiddleware({ ttl: parseInt(process.env.CACHE_TTL_MS || '60000', 10) }), 
  createTimeoutFor.read(), 
  async (req: Request, res: Response) => {
  try {
    const rawDays = parseInt((req.query.days as string) || '30', 10);
    const days = Number.isFinite(rawDays) ? rawDays : 30;

    const data = await getApyHistory(days);

    res.json({
      data,
      days,
      count: data.length,
    });
  } catch (err) {
    console.error('Error fetching APY history:', err);
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: 'Failed to fetch APY history',
    });
  }
});

export default router;
