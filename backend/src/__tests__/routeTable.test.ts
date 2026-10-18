import app from '../index';
import { collectRouteRegistrations } from '../../scripts/openapiRouterWalk';

describe('route table', () => {
  it('registers each method and path exactly once', () => {
    const counts = new Map<string, number>();
    for (const route of collectRouteRegistrations(app as any)) {
      const key = `${route.method.toUpperCase()} ${route.path}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const duplicates = [...counts.entries()].filter(([, count]) => count > 1);
    expect(duplicates).toEqual([]);
    expect(counts.get('GET /admin/jobs/metrics')).toBe(1);
  });
});
