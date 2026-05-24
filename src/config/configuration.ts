import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';

/**
 * Environment variables schema with validation.
 * Throws at startup if any required var is missing or malformed.
 */
const envSchema = z.object({
  // Server
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z
    .enum(['development', 'staging', 'production', 'test'])
    .default('development'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173,http://localhost:3000')
    .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),

  // Database
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url().optional(),

  // Supabase
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_JWT_SECRET: z.string().min(1).optional(),

  // LLM
  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_MODEL: z.string().default('claude-haiku-4-5-20251001'),

  // Walking paths
  MAPBOX_ACCESS_TOKEN: z.string().optional(),
  OPENROUTESERVICE_API_KEY: z.string().optional(),

  // Simulator
  SIMULATOR_DEFAULT_AGENTS: z.coerce.number().int().positive().default(500),
  SIMULATOR_LLM_PROBABILITY: z.coerce.number().min(0).max(1).default(0.1),
  SIMULATOR_TICK_MS: z.coerce.number().int().positive().default(1000),
  // 500ms = 2 updates/sec por bus → CSS transition matched en el frontend
  // hace que el movimiento se vea continuo. Subir solo si hay >100 buses.
  SIMULATOR_BUS_TICK_MS: z.coerce.number().int().positive().default(500),
  /**
   * Time-acceleration factor for the simulator. 1.0 = real time
   * (a walk of 800m takes 10 minutes). For the pitch use 10-20x so
   * agents visibly cycle through walk→wait→board→arrive in <1 minute.
   */
  SIMULATOR_SPEED_MULTIPLIER: z.coerce.number().positive().default(10),

  // Throttling
  THROTTLE_TTL_MS: z.coerce.number().int().positive().default(60_000),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(120),
  ASSISTANT_THROTTLE_LIMIT: z.coerce.number().int().positive().default(5),
});

export type AppConfig = z.infer<typeof envSchema>;

/**
 * Reads .env from disk and returns parsed key/value pairs.
 * We do this manually to avoid issues where shell-level empty
 * env vars (e.g. ANTHROPIC_API_KEY="") shadow .env values.
 */
function readDotEnv(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return {};

  const raw = fs.readFileSync(envPath, 'utf-8');
  const result: Record<string, string> = {};

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip optional surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

/**
 * Validates process.env merged with .env, preferring .env values
 * when process.env has an empty string for the same key.
 *
 * Called by NestJS ConfigModule at startup.
 */
export function validateEnv(env: Record<string, unknown>): AppConfig {
  const fromFile = readDotEnv();

  const merged: Record<string, unknown> = { ...env };
  for (const [k, v] of Object.entries(fromFile)) {
    const existing = merged[k];
    if (existing === undefined || existing === '') {
      merged[k] = v;
    }
  }

  const result = envSchema.safeParse(merged);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`❌ Invalid environment variables:\n${issues}`);
  }
  return result.data;
}
