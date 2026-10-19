import { redactSensitiveAttributes } from '../redaction';

describe('redactSensitiveAttributes', () => {
  it('redacts sensitive keys regardless of case and separators', () => {
    const result = redactSensitiveAttributes({
      Authorization: 'Bearer abc',
      'X-Api-Key': 'k',
      password: 'p',
      signature: 's',
      nonce: 'n',
      safe: 'visible',
    });

    expect(result).toEqual({
      Authorization: '[REDACTED]',
      'X-Api-Key': '[REDACTED]',
      password: '[REDACTED]',
      signature: '[REDACTED]',
      nonce: '[REDACTED]',
      safe: 'visible',
    });
  });

  it('redacts nested objects and arrays without mutating the input', () => {
    const input = { items: [{ refresh_token: 'r', id: 1 }], meta: { secret: 'x', ok: true } };
    const result = redactSensitiveAttributes(input);

    expect(result).toEqual({
      items: [{ refresh_token: '[REDACTED]', id: 1 }],
      meta: { secret: '[REDACTED]', ok: true },
    });
    expect(input.items[0].refresh_token).toBe('r');
  });

  it('returns primitives and null unchanged', () => {
    expect(redactSensitiveAttributes('token')).toBe('token');
    expect(redactSensitiveAttributes(42)).toBe(42);
    expect(redactSensitiveAttributes(null)).toBeNull();
  });
});
