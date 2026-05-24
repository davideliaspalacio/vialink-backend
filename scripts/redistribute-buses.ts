/**
 * Distribuye los buses de cada ruta uniformemente sobre el corridor
 * para que SIEMPRE haya un bus razonablemente cerca de cualquier
 * paradero, y alterna direcciones (+1, -1, +1, …) para cobertura
 * bidireccional.
 *
 * Para ruta con N buses: fractions = 0.5/N, 1.5/N, 2.5/N, …
 * (offset 0.5/N para no ponerlos en los extremos donde rebotan inmediato)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

(function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
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

interface BusRow {
  id: string;
  route_id: string;
  route_code: string;
}

async function main() {
  // Buses agrupados por ruta, ordenados estable por id
  const buses = await prisma.$queryRawUnsafe<BusRow[]>(`
    SELECT b.id, b.route_id, r.code AS route_code
    FROM buses b JOIN routes r ON r.id = b.route_id
    ORDER BY r.code, b.id;
  `);

  // Agrupar por route_id
  const byRoute = new Map<string, BusRow[]>();
  for (const b of buses) {
    const arr = byRoute.get(b.route_id) ?? [];
    arr.push(b);
    byRoute.set(b.route_id, arr);
  }

  let updated = 0;
  for (const [routeId, arr] of byRoute) {
    const n = arr.length;
    for (let i = 0; i < n; i++) {
      const fraction = (i + 0.5) / n;
      const direction = i % 2 === 0 ? 1 : -1;
      const bus = arr[i];
      await prisma.$executeRawUnsafe(`
        UPDATE buses
        SET fraction_of_corridor = ${fraction},
            direction = ${direction},
            current_location = (
              SELECT ST_LineInterpolatePoint(path::geometry, ${fraction})::geography
              FROM route_corridors WHERE route_id = '${routeId}'::uuid
            )
        WHERE id = '${bus.id}'::uuid;
      `);
      updated++;
    }
    console.log(
      `   ${arr[0].route_code.padEnd(4)} ${n} buses → fracciones ${Array.from({ length: n }, (_, i) => ((i + 0.5) / n).toFixed(2)).join(', ')}`,
    );
  }
  console.log(`\n✅ Redistribuidos ${updated} buses`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
