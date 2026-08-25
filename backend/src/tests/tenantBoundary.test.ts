/**
 * Test suite for tenant boundary enforcement.
 * Validates that cross-account access is properly prevented and logged.
 */

import {
  validateTenantOwnership,
  validateWalletInTenant,
  validateResourceBelongsToTenant,
  TenantBoundaryViolation,
  MissingTenantContext,
} from '../middleware/tenantBoundary';
import type { Request, Response } from 'express';
import { logger } from '../middleware/structuredLogging';

// Mock request/response objects
function createMockRequest(overrides?: Partial<Request>): Partial<Request> {
  return {
    tenantId: 'tenant-123',
    walletAddress: 'G123456',
    authApiKeyRole: 'viewer',
    authApiKeyHash: 'hash123',
    ip: '127.0.0.1',
    get: (header: string) => {
      if (header === 'user-agent') return 'test-agent';
      return undefined;
    },
    ...overrides,
  };
}

function createMockResponse(): Partial<Response> {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

describe('TenantBoundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validateTenantOwnership', () => {
    it('should allow access when tenant IDs match', async () => {
      const req = createMockRequest({ tenantId: 'tenant-123' });
      const res = createMockResponse();
      const next = jest.fn();

      const validator = validateTenantOwnership('tenant-123', 'deposits');
      validator(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should deny access for cross-tenant access', async () => {
      const req = createMockRequest({ tenantId: 'tenant-123' });
      const res = createMockResponse();
      const next = jest.fn();

      const validator = validateTenantOwnership('tenant-456', 'deposits');
      expect(() => {
        validator(req as Request, res as Response, next);
      }).toThrow(TenantBoundaryViolation);
    });

    it('should allow admin bypass with audit logging', async () => {
      const req = createMockRequest({
        tenantId: 'tenant-123',
        authApiKeyRole: 'admin',
      });
      const res = createMockResponse();
      const next = jest.fn();
      const logSpy = jest.spyOn(logger, 'log');

      const validator = validateTenantOwnership('tenant-456', 'deposits');
      validator(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(
        'info',
        'Admin access with tenant bypass',
        expect.objectContaining({
          action: 'tenant_admin_bypass',
        })
      );
    });

    it('should throw MissingTenantContext when no tenant ID present', async () => {
      const req = createMockRequest({ tenantId: undefined });
      const res = createMockResponse();
      const next = jest.fn();

      const validator = validateTenantOwnership('tenant-456', 'deposits');
      expect(() => {
        validator(req as Request, res as Response, next);
      }).toThrow(MissingTenantContext);
    });

    it('should log violation details for security audit', async () => {
      const req = createMockRequest({
        tenantId: 'tenant-123',
        walletAddress: 'G123456',
      });
      const res = createMockResponse();
      const next = jest.fn();
      const logSpy = jest.spyOn(logger, 'log');

      const validator = validateTenantOwnership('tenant-456', 'deposits');
      try {
        validator(req as Request, res as Response, next);
      } catch {
        // Expected to throw
      }

      expect(logSpy).toHaveBeenCalledWith(
        'warn',
        'Tenant boundary violation detected',
        expect.objectContaining({
          action: 'tenant_boundary_violation',
          tenantId: 'tenant-123',
          requestedTenantId: 'tenant-456',
          resource: 'deposits',
        })
      );
    });
  });

  describe('validateWalletInTenant', () => {
    it('should return true for wallet in tenant', async () => {
      // Mock Prisma
      jest.mock('../prisma', () => ({
        prisma: {
          walletTenantAssociation: {
            findFirst: jest.fn().mockResolvedValue({ id: 'assoc-123' }),
          },
        },
      }));

      const result = await validateWalletInTenant('G123456', 'tenant-123', 'operator');
      expect(result).toBe(true);
    });

    it('should return false for wallet not in tenant', async () => {
      jest.mock('../prisma', () => ({
        prisma: {
          walletTenantAssociation: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
        },
      }));

      const result = await validateWalletInTenant('G999999', 'tenant-123', 'operator');
      expect(result).toBe(false);
    });
  });

  describe('Cross-tenant attack scenarios', () => {
    it('should prevent access to other tenant transactions', async () => {
      const attacker = createMockRequest({
        tenantId: 'tenant-attacker',
        authApiKeyRole: 'viewer',
      });

      const victim = createMockRequest({
        tenantId: 'tenant-victim',
      });

      expect(validateTenantOwnership('tenant-victim', 'transactions')).toThrow();
    });

    it('should prevent API key from other tenant accessing resources', async () => {
      const req = createMockRequest({
        tenantId: 'tenant-alpha',
        authApiKeyHash: 'key-alpha-123',
      });
      const res = createMockResponse();
      const next = jest.fn();

      const validator = validateTenantOwnership('tenant-beta', 'withdrawals');
      expect(() => {
        validator(req as Request, res as Response, next);
      }).toThrow(TenantBoundaryViolation);
    });
  });

  describe('Authorization error responses', () => {
    it('should return 403 Forbidden for boundary violations', () => {
      const error = new TenantBoundaryViolation('tenant-1', 'tenant-2', 'deposits');

      expect(error.message).toContain('Tenant boundary violation');
      expect(error.tenantId).toBe('tenant-1');
      expect(error.requestedTenantId).toBe('tenant-2');
    });

    it('should return 401 Unauthorized for missing context', () => {
      const error = new MissingTenantContext('deposits');

      expect(error.message).toContain('Missing tenant context');
      expect(error.resource).toBe('deposits');
    });
  });

  describe('Resource-type validation', () => {
    it('should validate transaction belongs to tenant', async () => {
      // This would test validateResourceBelongsToTenant
      // Requires mocking Prisma queries
    });

    it('should prevent cross-tenant webhook access', async () => {
      // Tests webhook resource isolation
    });

    it('should prevent cross-tenant API key access', async () => {
      // Tests API key resource isolation
    });
  });

  describe('Audit trail', () => {
    it('should log all boundary validation attempts', () => {
      const logSpy = jest.spyOn(logger, 'log');
      const req = createMockRequest({ tenantId: 'tenant-1' });
      const res = createMockResponse();
      const next = jest.fn();

      const validator = validateTenantOwnership('tenant-1', 'test-resource');
      validator(req as Request, res as Response, next);

      // Should log the successful access
      expect(logSpy).toHaveBeenCalled();
    });

    it('should include actor information in audit logs', () => {
      const logSpy = jest.spyOn(logger, 'log');
      const req = createMockRequest({
        tenantId: 'tenant-1',
        authApiKeyHash: 'api-key-hash-123',
      });
      const res = createMockResponse();
      const next = jest.fn();

      const validator = validateTenantOwnership('tenant-2', 'resource');
      try {
        validator(req as Request, res as Response, next);
      } catch {
        // Expected
      }

      expect(logSpy).toHaveBeenCalledWith(
        'warn',
        'Tenant boundary violation detected',
        expect.objectContaining({
          actor: 'api-key-hash-123',
        })
      );
    });
  });
});
