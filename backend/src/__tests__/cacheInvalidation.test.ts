import { registerInvalidationHook, triggerCacheInvalidation } from '../middleware/cache';

describe('triggerCacheInvalidation', () => {
  it('skips non-array hook results without throwing', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    registerInvalidationHook(
      (() => undefined) as unknown as (eventType: string, metadata?: Record<string, unknown>) => string[],
    );
    registerInvalidationHook(
      (() => ['GET:/health']) as (eventType: string, metadata?: Record<string, unknown>) => string[],
    );

    expect(() => triggerCacheInvalidation('test.event')).not.toThrow();
    expect(triggerCacheInvalidation('test.event').patternsInvalidated).toContain('GET:/health');
    errorSpy.mockRestore();
  });
});