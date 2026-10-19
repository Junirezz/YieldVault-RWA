jest.mock('../middleware/structuredLogging', () => ({
  logger: { log: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../referralService', () => ({ referralService: {} }));
jest.mock('../middleware/cache', () => ({
  cacheMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import {
  buildReferralCodeErrorBody,
  buildReferralStatsErrorBody,
  buildReferralStatsNotFoundBody,
  buildReferralWalletRequiredBody,
} from '../referralEndpoints';

describe('referralEndpoints error bodies', () => {
  it('uses the canonical error envelope with the expected statuses', () => {
    expect(buildReferralWalletRequiredBody()).toMatchObject({ status: 400, message: 'Wallet address is required' });
    expect(buildReferralStatsNotFoundBody()).toMatchObject({ status: 404, retryable: false });
    expect(buildReferralStatsErrorBody()).toMatchObject({ status: 500, retryable: true });
    expect(buildReferralCodeErrorBody()).toMatchObject({ status: 500, message: 'Failed to get referral code' });
  });
});
