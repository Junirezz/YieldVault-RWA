import request from 'supertest';
import app from '../index';
import { registerApiKey } from '../middleware/apiKeyAuth';
import {
  Permission,
  roleHasPermission,
  resolveAdminRoutePermission,
} from '../middleware/rbac';

describe('RBAC', () => {
  const viewerKey = 'viewer-test-key';
  const operatorKey = 'operator-test-key';
  const adminKey = 'admin-test-key';
  const superAdminKey = 'super-admin-test-key';

  beforeEach(() => {
    registerApiKey(viewerKey, { role: 'viewer' });
    registerApiKey(operatorKey, { role: 'operator' });
    registerApiKey(adminKey, { role: 'admin' });
    registerApiKey(superAdminKey, { role: 'super-admin' });
  });

  describe('roleHasPermission()', () => {
    it('grants read-only access to viewers', () => {
      expect(roleHasPermission('viewer', Permission.ADMIN_READ)).toBe(true);
      expect(roleHasPermission('viewer', Permission.CONFIG_WRITE)).toBe(false);
    });

    it('allows operators to mutate operational config but not privileged webhook fields', () => {
      expect(roleHasPermission('operator', Permission.CONFIG_WRITE)).toBe(true);
      expect(roleHasPermission('operator', Permission.WEBHOOKS_WRITE)).toBe(true);
      expect(roleHasPermission('operator', Permission.WEBHOOKS_PRIVILEGED)).toBe(false);
      expect(roleHasPermission('operator', Permission.IMPERSONATE)).toBe(false);
    });

    it('grants super-admin all permissions', () => {
      expect(roleHasPermission('super-admin', Permission.IDEMPOTENCY_FLUSH)).toBe(true);
      expect(roleHasPermission('super-admin', Permission.API_KEYS_SUPER)).toBe(true);
    });
  });

  describe('admin route enforcement', () => {
    it('allows viewers to read admin metrics', async () => {
      const res = await request(app)
        .get('/admin/cache/stats')
        .set('Authorization', `ApiKey ${viewerKey}`);

      expect(res.status).toBe(200);
    });

    it('denies viewers from maintenance parameter updates', async () => {
      const res = await request(app)
        .post('/admin/maintenance')
        .set('Authorization', `ApiKey ${viewerKey}`)
        .send({ enabled: true, reason: 'test' });

      expect(res.status).toBe(403);
      expect(res.body.requiredPermission).toBe(Permission.CONFIG_WRITE);
    });

    it('allows operators to run config write operations', async () => {
      const res = await request(app)
        .post('/admin/cache/invalidate')
        .set('Authorization', `ApiKey ${operatorKey}`)
        .send({ pattern: 'vault:*' });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/invalidated/i);
    });

    it('denies operators from impersonation', async () => {
      const res = await request(app)
        .get('/admin/impersonate/GABCDEFGHIJKLMNOPQRSTUVWXYZ234567')
        .set('Authorization', `ApiKey ${operatorKey}`);

      expect(res.status).toBe(403);
      expect(res.body.requiredPermission).toBe(Permission.IMPERSONATE);
    });

    it('denies operators from updating webhook url (privileged parameter)', async () => {
      const create = await request(app)
        .post('/admin/webhooks')
        .set('Authorization', `ApiKey ${adminKey}`)
        .send({ url: 'https://example.com/hook', eventTypes: ['transaction.deposit.created'] });

      expect(create.status).toBe(201);
      const id = create.body.endpoint.id;

      const patch = await request(app)
        .patch(`/admin/webhooks/${id}`)
        .set('Authorization', `ApiKey ${operatorKey}`)
        .send({ url: 'https://evil.example/hook' });

      expect(patch.status).toBe(403);
      expect(patch.body.requiredPermission).toBe(Permission.WEBHOOKS_PRIVILEGED);
    });

    it('allows operators to toggle webhook enabled flag', async () => {
      const create = await request(app)
        .post('/admin/webhooks')
        .set('Authorization', `ApiKey ${adminKey}`)
        .send({ url: 'https://example.com/hook2', eventTypes: ['transaction.deposit.created'] });

      const id = create.body.endpoint.id;

      const patch = await request(app)
        .patch(`/admin/webhooks/${id}`)
        .set('Authorization', `ApiKey ${operatorKey}`)
        .send({ enabled: false });

      expect(patch.status).toBe(200);
    });

    it('denies admins from flushing the full idempotency store', async () => {
      const res = await request(app)
        .delete('/admin/idempotency/keys')
        .set('Authorization', `ApiKey ${adminKey}`);

      expect(res.status).toBe(403);
      expect(res.body.requiredPermission).toBe(Permission.IDEMPOTENCY_FLUSH);
    });

    it('allows super-admin to flush the idempotency store', async () => {
      const res = await request(app)
        .delete('/admin/idempotency/keys')
        .set('Authorization', `ApiKey ${superAdminKey}`);

      expect(res.status).toBe(200);
    });
  });

  describe('resolveAdminRoutePermission()', () => {
    it('maps maintenance POST to config write', () => {
      const req = {
        method: 'POST',
        path: '/admin/maintenance',
        baseUrl: '',
      } as import('express').Request;

      expect(resolveAdminRoutePermission(req)).toBe(Permission.CONFIG_WRITE);
    });
  });
});
