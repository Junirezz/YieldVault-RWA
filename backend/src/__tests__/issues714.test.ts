/**
 * Tests for Issue #714 - maintenance window scheduler and status endpoint.
 */

import request from 'supertest';
import app from '../index';
import {
  resetMaintenanceModeState,
  getMaintenanceModeState,
  updateMaintenanceModeState,
} from '../maintenanceMode';
import {
  buildMaintenanceStatusPayload,
  cancelMaintenanceWindow,
  getActiveMaintenanceWindow,
  getNextMaintenanceWindow,
  resetMaintenanceWindowsForTests,
  scheduleMaintenanceWindow,
  startMaintenanceWindowScheduler,
  syncMaintenanceModeWithWindows,
} from '../maintenanceWindow';

const ADMIN_KEY = process.env.ADMIN_API_KEY || 'test-admin-key';
const AUTH_HEADER = { Authorization: `ApiKey ${ADMIN_KEY}` };

describe('#714 Maintenance window scheduler', () => {
  beforeEach(() => {
    resetMaintenanceModeState();
    resetMaintenanceWindowsForTests();
    updateMaintenanceModeState({ enabled: false });
  });

  afterEach(() => {
    resetMaintenanceModeState();
    resetMaintenanceWindowsForTests();
  });

  it('schedules windows and reports active/next in status payload', () => {
    const now = new Date('2026-06-24T12:00:00.000Z');
    const active = scheduleMaintenanceWindow({
      title: 'DB migration',
      reason: 'Index rebuild',
      startsAt: '2026-06-24T11:30:00.000Z',
      endsAt: '2026-06-24T12:30:00.000Z',
    });
    scheduleMaintenanceWindow({
      title: 'Follow-up patch',
      startsAt: '2026-06-25T02:00:00.000Z',
      endsAt: '2026-06-25T03:00:00.000Z',
    });

    expect(getActiveMaintenanceWindow(now)?.id).toBe(active.id);
    expect(getNextMaintenanceWindow(now)?.title).toBe('Follow-up patch');

    const status = buildMaintenanceStatusPayload(now);
    expect(status.activeWindow?.title).toBe('DB migration');
    expect(status.nextWindow?.title).toBe('Follow-up patch');
    expect(status.serverTime).toBe(now.toISOString());
  });

  it('enables maintenance mode while an active window is in progress', () => {
    const now = new Date('2026-06-24T15:00:00.000Z');
    scheduleMaintenanceWindow({
      title: 'Planned outage',
      startsAt: '2026-06-24T14:00:00.000Z',
      endsAt: '2026-06-24T16:00:00.000Z',
    });

    syncMaintenanceModeWithWindows(now);
    expect(getMaintenanceModeState().enabled).toBe(true);
    expect(getMaintenanceModeState().reason).toContain('Planned outage');
  });

  it('disables scheduler-driven maintenance after the window ends', () => {
    scheduleMaintenanceWindow({
      title: 'Short window',
      startsAt: '2026-06-24T10:00:00.000Z',
      endsAt: '2026-06-24T10:30:00.000Z',
    });

    syncMaintenanceModeWithWindows(new Date('2026-06-24T10:15:00.000Z'));
    expect(getMaintenanceModeState().enabled).toBe(true);

    syncMaintenanceModeWithWindows(new Date('2026-06-24T10:45:00.000Z'));
    expect(getMaintenanceModeState().enabled).toBe(false);
  });

  it('rejects windows where endsAt is not after startsAt', () => {
    expect(() =>
      scheduleMaintenanceWindow({
        title: 'Invalid',
        startsAt: '2026-06-25T12:00:00.000Z',
        endsAt: '2026-06-25T11:00:00.000Z',
      }),
    ).toThrow(/endsAt must be after startsAt/);
  });

  it('cancels a scheduled window by id', () => {
    const window = scheduleMaintenanceWindow({
      title: 'Cancel me',
      startsAt: '2026-07-01T00:00:00.000Z',
      endsAt: '2026-07-01T01:00:00.000Z',
    });

    expect(cancelMaintenanceWindow(window.id)).toBe(true);
    expect(cancelMaintenanceWindow('missing')).toBe(false);
    expect(getNextMaintenanceWindow(new Date('2026-06-24T00:00:00.000Z'))).toBeNull();
  });

  describe('HTTP endpoints', () => {
    it('GET /maintenance/status is public and returns active/next windows', async () => {
      const res = await request(app).get('/maintenance/status');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('maintenanceMode');
      expect(res.body).toHaveProperty('activeWindow');
      expect(res.body).toHaveProperty('nextWindow');
      expect(res.body).toHaveProperty('serverTime');
    });

    it('POST /admin/maintenance/windows schedules a window', async () => {
      const res = await request(app)
        .post('/admin/maintenance/windows')
        .set(AUTH_HEADER)
        .send({
          title: 'Upgrade',
          reason: 'Node bump',
          startsAt: '2026-08-01T01:00:00.000Z',
          endsAt: '2026-08-01T02:00:00.000Z',
        });

      expect(res.status).toBe(201);
      expect(res.body.window.title).toBe('Upgrade');
    });

    it('GET /admin/maintenance/windows lists scheduled windows', async () => {
      await request(app)
        .post('/admin/maintenance/windows')
        .set(AUTH_HEADER)
        .send({
          title: 'Listed window',
          startsAt: '2026-09-01T01:00:00.000Z',
          endsAt: '2026-09-01T02:00:00.000Z',
        });

      const res = await request(app).get('/admin/maintenance/windows').set(AUTH_HEADER);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.windows)).toBe(true);
      expect(res.body.windows.length).toBeGreaterThanOrEqual(1);
    });

    it('allows GET /maintenance/status during active maintenance', async () => {
      updateMaintenanceModeState({ enabled: true });
      const res = await request(app).get('/maintenance/status');
      expect(res.status).toBe(200);
    });
  });

  it('starts and stops the background scheduler', () => {
    const stop = startMaintenanceWindowScheduler(60_000);
    expect(typeof stop).toBe('function');
    stop();
  });
});
