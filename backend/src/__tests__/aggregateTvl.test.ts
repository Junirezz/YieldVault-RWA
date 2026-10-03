jest.mock('../prisma', () => ({ prisma: {} }));

import { aggregateTvl } from '../operationalMetrics';

describe('aggregateTvl', () => {
  it('sums 0.1, 0.2 and 0.3 without float drift', () => {
    const result = aggregateTvl([{ tvlUsd: '0.1' }, { tvlUsd: '0.2' }, { tvlUsd: '0.3' }]);
    expect(result).toBe('0.60');
    expect(result).not.toBe('0.6000000001');
  });

  it('returns 0.00 for no vaults', () => {
    expect(aggregateTvl([])).toBe('0.00');
  });

  it('treats null/undefined tvl as zero', () => {
    expect(aggregateTvl([{ tvlUsd: null }, {}, { tvlUsd: '1.005' }])).toBe('1.01');
  });
});
