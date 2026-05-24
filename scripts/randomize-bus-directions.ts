/**
 * One-shot: randomiza direction de buses existentes (50/50 forward/backward)
 * para que el demo arranque con buses moviéndose en ambos sentidos.
 *
 * Run: pnpm ts-node scripts/randomize-bus-directions.ts
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

const prisma = new PrismaClient({
  datasourceUrl: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
});

async function main() {
  const updated = await prisma.$executeRawUnsafe(
    `UPDATE buses SET direction = CASE WHEN random() < 0.5 THEN 1 ELSE -1 END;`,
  );
  const rows = await prisma.$queryRawUnsafe<
    { direction: number; n: number }[]
  >(
    `SELECT direction, COUNT(*)::int AS n FROM buses GROUP BY direction ORDER BY direction;`,
  );
  console.log(`Updated ${updated} buses. Distribución:`);
  for (const r of rows) {
    console.log(`   direction=${r.direction}: ${r.n} buses`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
