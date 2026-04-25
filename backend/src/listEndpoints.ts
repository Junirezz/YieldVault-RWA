/**
 * @file listEndpoints.ts
 * List endpoints with pagination and filtering support.
 * 
 * Provides consistent list endpoints for:
 * - Transactions
 * - Portfolio holdings
 * - Vault history
 */

import { Router, Request, Response } from 'express';
import {
  parsePaginationQuery,
  paginateWithCursor,
  sortItems,
  sendPaginatedResponse,
  encodeCursor,
  PaginationConfig,
} from './pagination';

const router = Router();

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * @openapi
 * components:
 *   schemas:
 *     Transaction:
 *       type: object
 *       properties:
 *         id: { type: string }
 *         type: { type: string, enum: [deposit, withdrawal] }
 *         amount: { type: string }
 *         asset: { type: string }
 *         timestamp: { type: string, format: "date-time" }
 *         transactionHash: { type: string }
 *         walletAddress: { type: string }
 */
interface Transaction {
  id: string;
  type: 'deposit' | 'withdrawal';
  amount: string;
  asset: string;
  timestamp: string;
  transactionHash: string;
  walletAddress: string;
  [key: string]: unknown;
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

// ─── Mock Data ──────────────────────────────────────────────────────────────

const MOCK_TRANSACTIONS: Transaction[] = Array.from({ length: 100 }, (_, i) => ({
  id: `tx-${i + 1}`,
  type: i % 2 === 0 ? 'deposit' : 'withdrawal',
  amount: (Math.random() * 1000).toFixed(2),
  asset: ['XLM', 'USDC', 'yUSDC', 'RWA'][i % 4],
  timestamp: new Date(Date.now() - i * 3600000).toISOString(),
  transactionHash: `hash-${i + 1}-${Math.random().toString(36).substring(7)}`,
  walletAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz234567',
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
  walletAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz234567',
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
  filters: { type?: string; walletAddress?: string }
): Transaction[] {
  return transactions.filter((tx) => {
    if (filters.type && filters.type !== 'all' && tx.type !== filters.type) {
      return false;
    }
    if (filters.walletAddress && tx.walletAddress !== filters.walletAddress) {
      return false;
    }
    return true;
  });
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
 */
router.get('/transactions', (req: Request, res: Response) => {
  try {
    const pagination = parsePaginationQuery(req, TRANSACTION_PAGINATION_CONFIG);
    const filters = {
      type: req.query.type as string | undefined,
      walletAddress: req.query.walletAddress as string | undefined,
    };

    // Filter transactions
    let filtered = filterTransactions(MOCK_TRANSACTIONS, filters);

    // Sort transactions
    if (pagination.sortBy) {
      filtered = sortItems(filtered, pagination.sortBy, pagination.sortOrder || 'desc');
    }

    // Paginate with cursor
    const { data, pagination: paginationMeta } = paginateWithCursor(
      filtered,
      pagination,
      (tx) => encodeCursor(tx.id)
    );

    sendPaginatedResponse(res, data, paginationMeta);
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: 'Failed to fetch transactions',
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
router.get('/portfolio/holdings', (req: Request, res: Response) => {
  try {
    const pagination = parsePaginationQuery(req, PORTFOLIO_PAGINATION_CONFIG);
    const filters = {
      status: req.query.status as string | undefined,
      walletAddress: req.query.walletAddress as string | undefined,
    };

    // Filter holdings
    let filtered = filterPortfolioHoldings(MOCK_PORTFOLIO_HOLDINGS, filters);

    // Sort holdings
    if (pagination.sortBy) {
      filtered = sortItems(filtered, pagination.sortBy, pagination.sortOrder || 'desc');
    }

    // Paginate with cursor
    const { data, pagination: paginationMeta } = paginateWithCursor(
      filtered,
      pagination,
      (holding) => encodeCursor(holding.id)
    );

    sendPaginatedResponse(res, data, paginationMeta);
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
router.get('/vault/history', (req: Request, res: Response) => {
  try {
    const pagination = parsePaginationQuery(req, VAULT_HISTORY_PAGINATION_CONFIG);
    const filters = {
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
    };

    // Filter history
    let filtered = filterVaultHistory(MOCK_VAULT_HISTORY, filters);

    // Sort history
    if (pagination.sortBy) {
      filtered = sortItems(filtered, pagination.sortBy, pagination.sortOrder || 'desc');
    }

    // Paginate with cursor
    const { data, pagination: paginationMeta } = paginateWithCursor(
      filtered,
      pagination,
      (point) => encodeCursor(point.date)
    );

    sendPaginatedResponse(res, data, paginationMeta);
  } catch (error) {
    console.error('Error fetching vault history:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: 'Failed to fetch vault history',
    });
  }
});

export default router;
