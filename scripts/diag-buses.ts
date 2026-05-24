/**
 * Vialink — Diagnóstico de buses estáticos.
 *
 * Imprime, para cada bus IN_SERVICE:
 *   - speed_kmh, fraction_of_corridor, status
 *   - length_m del corridor (si el bus no se mueve, ojo a length=0/NULL)
 *   - last_seen_at + segundos desde el último update
 *   - delta_fraction_estimado por tick (con la fórmula del BusEngine)
 *
 * Flagea (🟡) los buses que NO deberían avanzar este tick:
 *   - speed_kmh ≤ 0
 *   - length_m IS NULL o 0
 *   - status != IN_SERVICE
 *   - last_seen_at > 10s (BusEngine no los está procesando)
 *
 * Run:
 *   pnpm ts-node scripts/diag-buses.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

(function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf-8');
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
})();

import { PrismaClient } from '@prisma/client';

const TICK_MS = 1000;
const STALE_LAST_SEEN_S = 10;

interface DiagRow {
  bus_id: string;
  plate: string;
  route_code: string;
  status: string;
  speed_kmh: number;
  fraction: number;
  length_m: number | null;
  last_seen_at: Date;
  seconds_since_seen: number;
}

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.$queryRawUnsafe<DiagRow[]>(`
    SELECT
      b.id AS bus_id,
      b.plate,
      r.code AS route_code,
      b.status::text AS status,
      b.speed_kmh,
      b.fraction_of_corridor AS fraction,
      rc.length_m,
      b.last_seen_at,
      EXTRACT(EPOCH FROM (NOW() - b.last_seen_at))::int AS seconds_since_seen
    FROM buses b
    JOIN routes r ON r.id = b.route_id
    LEFT JOIN route_corridors rc ON rc.route_id = b.route_id
    ORDER BY r.mode, r.code, b.plate;
  `);

  const tickSec = TICK_MS / 1000;
  const total = rows.length;
  const moving: DiagRow[] = [];
  const stuck: { row: DiagRow; reason: string }[] = [];

  console.log(`\n📊 ${total} buses en DB\n`);
  console.log(
    'plate    route status      speed  fraction  length_m  last_seen  delta/tick  flag',
  );
  console.log(
    '─────── ───── ──────────  ─────  ────────  ────────  ─────────  ──────────  ────',
  );

  for (const r of rows) {
    let reason = '';
    let flag = '✅';
    if (r.status !== 'IN_SERVICE') {
      reason = `status=${r.status}`;
      flag = '🔴';
    } else if (r.length_m == null || r.length_m <= 0) {
      reason = `length_m=${r.length_m}`;
      flag = '🟡';
    } else if (r.speed_kmh <= 0) {
      reason = `speed=0`;
      flag = '🟡';
    } else if (r.seconds_since_seen > STALE_LAST_SEEN_S) {
      reason = `stale ${r.seconds_since_seen}s`;
      flag = '🟠';
    }

    const deltaFraction =
      r.length_m && r.length_m > 0 && r.speed_kmh > 0
        ? (r.speed_kmh * 1000.0 / 3600.0 * tickSec) / r.length_m
        : 0;

    console.log(
      `${r.plate.padEnd(7)} ${r.route_code.padEnd(5)} ${r.status.padEnd(10)}  ` +
        `${r.speed_kmh.toFixed(1).padStart(5)}  ` +
        `${r.fraction.toFixed(4).padStart(6)}  ` +
        `${String(r.length_m ?? 'NULL').padStart(8)}  ` +
        `${String(r.seconds_since_seen).padStart(6)}s    ` +
        `${deltaFraction.toExponential(2).padStart(8)}  ` +
        `${flag} ${reason}`,
    );

    if (reason) stuck.push({ row: r, reason });
    else moving.push(r);
  }

  console.log('\n─── Resumen ───');
  console.log(`✅ Moviéndose:    ${moving.length}`);
  console.log(`⚠️  Problemáticos: ${stuck.length}`);

  if (stuck.length > 0) {
    console.log('\nDetalle de problemáticos:');
    const byReason = new Map<string, number>();
    for (const s of stuck) {
      const key = s.reason.replace(/\d+/g, 'N');
      byReason.set(key, (byReason.get(key) ?? 0) + 1);
    }
    for (const [reason, count] of byReason) {
      console.log(`   ${count}× ${reason}`);
    }
  }

  // Speed distribution
  const speeds = rows.filter((r) => r.speed_kmh > 0).map((r) => r.speed_kmh);
  if (speeds.length > 0) {
    speeds.sort((a, b) => a - b);
    const min = speeds[0];
    const max = speeds[speeds.length - 1];
    const median = speeds[Math.floor(speeds.length / 2)];
    console.log(
      `\nSpeed (km/h): min=${min.toFixed(1)} median=${median.toFixed(1)} max=${max.toFixed(1)}`,
    );
  }
}

main()
  .catch((err) => {
    console.error('[diag-buses] FAILED', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
