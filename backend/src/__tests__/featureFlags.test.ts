import { FeatureFlagService } from '../featureFlags';

describe('FeatureFlagService', () => {
  let svc: FeatureFlagService;

  beforeEach(() => {
    svc = new FeatureFlagService();
    delete process.env.FEATURE_FLAGS;
    delete process.env.FEATURE_FLAGS_PATH;
  });

  afterEach(() => {
    delete process.env.FEATURE_FLAGS;
    delete process.env.FEATURE_FLAGS_PATH;
  });

  it('returns false when no flags are configured', () => {
    expect(svc.isEnabled('deposit-v2')).toBe(false);
  });

  it('returns true for a globally enabled flag', () => {
    process.env.FEATURE_FLAGS = JSON.stringify({ 'deposit-v2': { enabled: true } });
    expect(svc.isEnabled('deposit-v2')).toBe(true);
  });

  it('returns false for a disabled flag', () => {
    process.env.FEATURE_FLAGS = JSON.stringify({ 'deposit-v2': { enabled: false } });
    expect(svc.isEnabled('deposit-v2')).toBe(false);
  });

  it('returns true for a wallet in the allowlist', () => {
    process.env.FEATURE_FLAGS = JSON.stringify({
      'deposit-v2': { enabled: true, allowlist: ['WALLET_A', 'WALLET_B'] },
    });
    expect(svc.isEnabled('deposit-v2', 'WALLET_A')).toBe(true);
  });

  it('returns false for a wallet NOT in the allowlist', () => {
    process.env.FEATURE_FLAGS = JSON.stringify({
      'deposit-v2': { enabled: true, allowlist: ['WALLET_A'] },
    });
    expect(svc.isEnabled('deposit-v2', 'WALLET_C')).toBe(false);
  });

  it('returns false when allowlist is set but no wallet provided', () => {
    process.env.FEATURE_FLAGS = JSON.stringify({
      'deposit-v2': { enabled: true, allowlist: ['WALLET_A'] },
    });
    expect(svc.isEnabled('deposit-v2')).toBe(false);
  });

  describe('getPublicFlags', () => {
    it('returns an empty snapshot when no flags are configured', () => {
      expect(svc.getPublicFlags()).toEqual({});
    });

    it('exposes the configured value of allow-listed flags', () => {
      process.env.FEATURE_FLAGS = JSON.stringify({
        'deposit-v2': { enabled: true },
        'strategy-selection': { enabled: false },
      });
      expect(svc.getPublicFlags()).toEqual({
        'deposit-v2': true,
        'strategy-selection': false,
      });
    });

    it('omits non-allow-listed flags so internal flags cannot leak', () => {
      process.env.FEATURE_FLAGS = JSON.stringify({
        'deposit-v2': { enabled: true },
        'internal-experiment': { enabled: true },
      });
      expect(svc.getPublicFlags()).toEqual({ 'deposit-v2': true });
    });

    it('never discloses per-wallet allowlists (reports the anonymous view)', () => {
      process.env.FEATURE_FLAGS = JSON.stringify({
        'deposit-v2': { enabled: true, allowlist: ['WALLET_A', 'WALLET_B'] },
      });
      const snapshot = svc.getPublicFlags();
      expect(snapshot).toEqual({ 'deposit-v2': false });
      expect(JSON.stringify(snapshot)).not.toContain('WALLET_A');
    });
  });
});
