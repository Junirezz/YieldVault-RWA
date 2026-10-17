import { formatWalletForLog, isValidStellarAddress } from './walletUtils';

const REDACTED_VALUE = '[REDACTED]';

const SENSITIVE_KEY_PATTERN =
  /(pass(word)?|secret|token|api[-_]?key|authorization|cookie|session|private[-_]?key|seed|mnemonic|credential)/i;

const WALLET_KEY_PATTERN =
  /(wallet[-_]?address|wallet)/i;

const SENSITIVE_VALUE_PATTERN =
  /(bearer\s+[a-z0-9._-]+|sk_(live|test)_[a-z0-9]+|xox[baprs]-[a-z0-9-]+|ghp_[a-z0-9]+)/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function redactPrimitive(value: unknown, key?: string): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  if (SENSITIVE_VALUE_PATTERN.test(value)) {
    return REDACTED_VALUE;
  }

  if ((key && WALLET_KEY_PATTERN.test(key)) || isValidStellarAddress(value)) {
    return formatWalletForLog(value);
  }

  return value;
}

export function redactSensitiveLogAttributes<T>(input: T): T {
  if (Array.isArray(input)) {
    return input.map((item) => redactSensitiveLogAttributes(item)) as T;
  }

  if (!isPlainObject(input)) {
    return redactPrimitive(input) as T;
  }

  const output: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      output[key] = REDACTED_VALUE;
      continue;
    }

    if (Array.isArray(value) || isPlainObject(value)) {
      output[key] = redactSensitiveLogAttributes(value);
      continue;
    }

    output[key] = redactPrimitive(value, key);
  }

  return output as T;
}
