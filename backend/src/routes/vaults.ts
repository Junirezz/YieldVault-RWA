import { Router, Request, Response, NextFunction } from 'express';
import type { Prisma } from '@prisma/client';
import { getPrismaClient } from '../prismaClient';
import { validateApiKey } from '../middleware/apiKeyAuth';
import {
  createPaginatedResponse,
  createPaginationEnvelope,
  parsePaginationQuery,
} from '../pagination';
import { buildVaultFilterHash, vaultCountCache } from '../vaultCountCache';

const router = Router();

/** GET /vaults: fresh page rows with a five-second cached, tenant-scoped total. */
router.get('/', validateApiKey, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawTenant = req.query.tenantId;
    if (rawTenant !== undefined && (typeof rawTenant !== 'string' || !rawTenant.trim())) {
      res.status(400).json({ error: 'tenantId must be a non-empty string' });
      return;
    }
    const isAdmin = ['admin', 'super-admin'].includes(req.authApiKeyRole || '');
    const tenantId = isAdmin ? (rawTenant as string | undefined) : req.authApiKeyTenantId;
    if (
      !isAdmin &&
      (!tenantId || tenantId === 'unknown' || (rawTenant && rawTenant !== tenantId))
    ) {
      res.status(403).json({ error: 'Vault access requires a matching authenticated tenant' });
      return;
    }

    const where: Prisma.VaultWhereInput = { deletedAt: null, ...(tenantId ? { tenantId } : {}) };
    const query = parsePaginationQuery(req, { defaultSortBy: 'createdAt' });
    const limit = query.limit || 20;
    const page = query.page || 1;
    const sortBy = query.sortBy || 'createdAt';
    if (!['createdAt', 'updatedAt', 'id', 'aum'].includes(sortBy) || query.cursor) {
      res
        .status(400)
        .json({ error: 'Use page pagination and sortBy createdAt, updatedAt, id or aum' });
      return;
    }
    const skip = (page - 1) * limit;
    if (!Number.isSafeInteger(skip) || skip > 2147483647) {
      res.status(400).json({ error: 'Page offset is too large' });
      return;
    }
    const prisma = getPrismaClient();
    const orderBy: Prisma.VaultOrderByWithRelationInput[] = [{ [sortBy]: query.sortOrder }];
    if (sortBy !== 'id') orderBy.push({ id: query.sortOrder });
    const [data, count] = await Promise.all([
      prisma.vault.findMany({ where, skip, take: limit, orderBy }),
      vaultCountCache.get(buildVaultFilterHash(where), () => prisma.vault.count({ where })),
    ]);
    res.setHeader('X-Cache', count.status);
    res.setHeader('Cache-Control', 'no-store');
    res.json(
      createPaginatedResponse(
        data,
        createPaginationEnvelope({
          count: data.length,
          limit,
          total: count.total,
          currentPage: page,
          totalPages: Math.max(1, Math.ceil(count.total / limit)),
          hasNextPage: skip + data.length < count.total,
          hasPrevPage: page > 1,
        })
      )
    );
  } catch (error) {
    next(error);
  }
});

export default router;
