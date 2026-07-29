import { isPersistedApiKeyUsable } from '../middleware/apiKeyAuth';

describe('persisted API key soft-delete authentication (Issue #1047)', () => {
  it('rejects a soft-deleted API key', () => {
    expect(
      isPersistedApiKeyUsable({
        isActive: true,
        deletedAt: new Date(),
        tenant: { deletedAt: null },
      })
    ).toBe(false);
  });

  it('rejects an otherwise active key when its tenant is deleted', () => {
    expect(
      isPersistedApiKeyUsable({
        isActive: true,
        deletedAt: null,
        tenant: { deletedAt: new Date() },
      })
    ).toBe(false);
  });

  it('accepts an active key only when its tenant is also active', () => {
    expect(
      isPersistedApiKeyUsable({
        isActive: true,
        deletedAt: null,
        tenant: { deletedAt: null },
      })
    ).toBe(true);
    expect(
      isPersistedApiKeyUsable({
        isActive: false,
        deletedAt: null,
        tenant: { deletedAt: null },
      })
    ).toBe(false);
  });
});
