describe('Flaky test retry mitigation', () => {
  let attemptCount = 0;

  it('forces flaky test to fail on first run and asserts retry passes', () => {
    attemptCount++;
    if (attemptCount === 1) {
      throw new Error('Simulated transient failure on 1st run');
    }

    expect(attemptCount).toBeGreaterThanOrEqual(2);
  });

  it('verifies that normal tests without flakiness pass on the first attempt', () => {
    expect(true).toBe(true);
  });
});
