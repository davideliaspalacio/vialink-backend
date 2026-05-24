/**
 * Vialink — Aplica la migración add_bus_direction en producción.
 *
 * Idempotente: usa `ADD COLUMN IF NOT EXISTS`. Puede correrse N veces
 * sin efecto. Trae el SQL del archivo de migración para que ambos
 * (este script + `prisma migrate deploy`) generen exactamente el mismo
 * esquema.
 *
 * Run: pnpm ts-node scripts/apply-direction-migration.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

(function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = t.slice(i + 1).trim();
  }
})();

import { PrismaClient } from '@prisma/client';

// DDL (ALTER TABLE) requiere conexión directa al postgres, no via pgbouncer.
// DIRECT_URL apunta al puerto 5432 sin el pooler.
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const prisma = new PrismaClient({ datasourceUrl: url });

async function main() {
  console.log('🔧 Aplicando migración add_bus_direction...');

  // Hardcoded — el archivo de migración SQL existe para prisma migrate deploy
  // pero acá los ejecutamos uno a uno con $executeRawUnsafe.
  const statements = [
    `ALTER TABLE buses ADD COLUMN IF NOT EXISTS direction smallint NOT NULL DEFAULT 1`,
    `ALTER TABLE buses DROP CONSTRAINT IF EXISTS buses_direction_check`,
    `ALTER TABLE buses ADD CONSTRAINT buses_direction_check CHECK (direction IN (1, -1))`,
  ];

  for (const stmt of statements) {
    await prisma.$executeRawUnsafe(stmt);
    console.log(`   ✅ ${stmt.slice(0, 80)}…`);
  }

  // Sanity check
  const [{ direction_distribution }] = await prisma.$queryRawUnsafe<
    { direction_distribution: string }[]
  >(`
    SELECT json_agg(json_build_object('direction', direction, 'count', n))::text
      AS direction_distribution
    FROM (
      SELECT direction, COUNT(*)::int AS n FROM buses GROUP BY direction
    ) t;
  `);

  console.log(`\n📊 Distribución de direction: ${direction_distribution}`);
  console.log('✅ Migración aplicada.');
}

main()
  .catch((e) => {
    console.error('❌', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
