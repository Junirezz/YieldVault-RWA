import { z } from 'zod';
import { LogLevel } from '../middleware/structuredLogging';

const VALID_LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z
      .string()
      .or(z.number())
      .transform((val) => Number(val))
      .pipe(z.number().int().min(1).max(65535))
      .default(3000),
    LOG_LEVEL: z
      .string()
      .optional()
      .transform((val) => {
        if (!val) return 'info' as LogLevel;
        const lower = val.toLowerCase();
        if (VALID_LOG_LEVELS.includes(lower as any)) {
          return lower as LogLevel;
        }
        console.warn(`[config] WARNING – Invalid LOG_LEVEL "${val}". Falling back to "info".`);
        return 'info' as LogLevel;
      }),
    DRAIN_TIMEOUT_MS: z
      .string()
      .or(z.number())
      .transform((val) => Number(val))
      .pipe(z.number().int().min(100).max(300000))
      .default(30000),
    CACHE_TTL_MS: z
      .string()
      .or(z.number())
      .transform((val) => Number(val))
      .pipe(z.number().int().min(0))
      .default(60000),
    JWT_SECRET: z.string().optional(),
    JWT_ACCESS_TTL_SECONDS: z
      .string()
      .or(z.number())
      .transform((val) => Number(val))
      .pipe(z.number().int().min(1).max(86400 * 30))
      .default(900),
    JWT_REFRESH_TTL_SECONDS: z
      .string()
      .or(z.number())
      .transform((val) => Number(val))
      .pipe(z.number().int().min(1).max(86400 * 365))
      .default(604800),
    ADMIN_ACTION_RECEIPT_SECRET: z.string().optional(),
    DATABASE_URL: z.string().optional(),
    VAULT_CONTRACT_ID: z.string().optional(),
    SOROBAN_RPC_URL: z.string().optional(),
    REDIS_URL: z.string().optional(),
    POSITION_RECONCILIATION_INTERVAL_MS: z
      .string()
      .or(z.number())
      .transform((val) => Number(val))
      .pipe(z.number().int().min(100))
      .default(30000),
    EVENT_POLL_INTERVAL_MS: z
      .string()
      .or(z.number())
      .transform((val) => Number(val))
      .pipe(z.number().int().min(100))
      .default(5000),
    PG_DUMP_TIMEOUT_MS: z
      .string()
      .or(z.number())
      .transform((val) => Number(val))
      .pipe(z.number().int().min(1000))
      .default(60000),
  })
  .passthrough();

export type EnvConfig = z.infer<typeof envSchema>;

export function parseEnv(rawEnv: Record<string, string | undefined> = process.env): EnvConfig {
  const result = envSchema.safeParse(rawEnv);

  if (!result.success) {
    const errorDetails = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ');
    const msg = `[config] FATAL – Environment validation failed: ${errorDetails}`;
    console.error(msg);
    if (rawEnv.NODE_ENV === 'production' || process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
    throw new Error(msg);
  }

  const parsed = result.data;

  if (parsed.NODE_ENV === 'production') {
    if (!parsed.ADMIN_ACTION_RECEIPT_SECRET || !parsed.ADMIN_ACTION_RECEIPT_SECRET.trim()) {
      const msg = '[config] FATAL – ADMIN_ACTION_RECEIPT_SECRET is required in production';
      console.error(msg);
      process.exit(1);
    }
  }

  return parsed;
}

export const env = parseEnv();
