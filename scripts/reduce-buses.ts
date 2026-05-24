/**
 * Vialink — Reduce bus count per route without re-seeding.
 *
 * Why this exists:
 *   El seed inicial creaba 8 buses por ruta BRT y 5 por ruta tradicional
 *   (86 buses totales en 16 rutas). Para el demo eso es ruido visual.
 *   Este script reduce a 2 por BRT y 1 por TRADITIONAL/otra (~18 buses).
 *
 *   No usamos `pnpm seed` porque eso REGENERARÍA los corridors a partir
 *   de los waypoints originales del seed, perdiendo el refinamiento de
 *   snap-corridors + refine-corridors (16000+ puntos sobre calles reales).
 *
 * Es idempotente: corre dos veces, deja el mismo número final.
 *
 * Run:
 *   pnpm ts-node scripts/reduce-buses.ts
 *   pnpm ts-node scripts/reduce-buses.ts --dry-run
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

(function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf-8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key] || process.env[key] === '') {
      process.env[key] = value;
    }
  }
})();

import { PrismaClient } from '@prisma/client';

const DRY_RUN = process.argv.includes('--dry-run');
const TARGET_BRT = 2;
const TARGET_OTHER = 1;

const prisma = new PrismaClient();

interface CountRow {
  code: string;
  mode: string;
  bus_count: number;
}

async function main() {
  console.log(`[reduce-buses] target BRT=${TARGET_BRT}, OTHER=${TARGET_OTHER}${DRY_RUN ? ' (dry-run)' : ''}`);

  const before = await prisma.$queryRawUnsafe<CountRow[]>(`
    SELECT r.code, r.mode::text AS mode, COUNT(b.id)::int AS bus_count
    FROM buses b
    JOIN routes r ON r.id = b.route_id
    GROUP BY r.code, r.mode
    ORDER BY r.mode, r.code;
  `);
  const totalBefore = before.reduce((s, r) => s + r.bus_count, 0);
  console.log(`\nAntes: ${totalBefore} buses en ${before.length} rutas`);
  for (const r of before) {
    console.log(`  ${r.code.padEnd(4)} ${r.mode.padEnd(11)} ${r.bus_count} buses`);
  }

  // Identify rows to delete: keep top N (by created_at) per route, drop the rest.
  // BRT keeps 2, others keep 1.
  const sql = `
    WITH ranked AS (
      SELECT b.id, b.route_id,
        r.mode::text AS mode,
        ROW_NUMBER() OVER (
          PARTITION BY b.route_id ORDER BY b.id ASC
        ) AS rn
      FROM buses b
      JOIN routes r ON r.id = b.route_id
    ),
    to_delete AS (
      SELECT id FROM ranked
      WHERE (mode = 'BRT' AND rn > ${TARGET_BRT})
         OR (mode <> 'BRT' AND rn > ${TARGET_OTHER})
    )
    ${DRY_RUN
      ? 'SELECT COUNT(*)::int AS would_delete FROM to_delete'
      : 'DELETE FROM buses WHERE id IN (SELECT id FROM to_delete)'};
  `;

  if (DRY_RUN) {
    const [{ would_delete }] = await prisma.$queryRawUnsafe<{ would_delete: number }[]>(sql);
    console.log(`\n[dry-run] Borraría ${would_delete} buses`);
  } else {
    const deleted = await prisma.$executeRawUnsafe(sql);
    console.log(`\nBorrados: ${deleted} buses`);
  }

  const after = await prisma.$queryRawUnsafe<CountRow[]>(`
    SELECT r.code, r.mode::text AS mode, COUNT(b.id)::int AS bus_count
    FROM buses b
    JOIN routes r ON r.id = b.route_id
    GROUP BY r.code, r.mode
    ORDER BY r.mode, r.code;
  `);
  const totalAfter = after.reduce((s, r) => s + r.bus_count, 0);
  console.log(`\nDespues: ${totalAfter} buses en ${after.length} rutas`);
  for (const r of after) {
    console.log(`  ${r.code.padEnd(4)} ${r.mode.padEnd(11)} ${r.bus_count} buses`);
  }
}

main()
  .catch((err) => {
    console.error('[reduce-buses] FAILED', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
