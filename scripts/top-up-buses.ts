/**
 * Vialink — Top-up de buses por ruta para garantizar mínimos.
 *
 * Para cada ruta calcula cuántos buses faltan vs el target (2 TRAD, 3 BRT)
 * y los inserta. NO toca los buses existentes ni el corridor.
 *
 * Direction se asigna alternando: el primer bus nuevo en una ruta queda
 * +1, el segundo -1, etc. — así cada ruta tiene cobertura bidireccional.
 *
 * Idempotente: si ya hay suficientes buses, no hace nada.
 *
 * Run: pnpm ts-node scripts/top-up-buses.ts
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

const TARGET_BRT = 3;
const TARGET_TRAD = 2;

interface RouteRow {
  id: string;
  code: string;
  mode: string;
  current_count: number;
}

function randomPlate(): string {
  const letters = Array.from({ length: 3 }, () =>
    String.fromCharCode(65 + Math.floor(Math.random() * 26)),
  ).join('');
  const digits = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  return `${letters}${digits}`;
}

async function main() {
  const routes = await prisma.$queryRawUnsafe<RouteRow[]>(`
    SELECT r.id, r.code, r.mode::text AS mode,
      (SELECT COUNT(*)::int FROM buses b WHERE b.route_id = r.id) AS current_count
    FROM routes r
    JOIN cities c ON c.id = r.city_id
    WHERE c.code = 'BAQ' AND r.active = true
    ORDER BY r.mode, r.code;
  `);

  let totalAdded = 0;
  for (const r of routes) {
    const target = r.mode === 'BRT' ? TARGET_BRT : TARGET_TRAD;
    const missing = Math.max(0, target - r.current_count);
    if (missing === 0) {
      console.log(`   ✓ ${r.code.padEnd(4)} ${r.mode.padEnd(11)} ${r.current_count}/${target}`);
      continue;
    }

    const minSpeed = r.mode === 'BRT' ? 30 : 20;
    const maxSpeed = r.mode === 'BRT' ? 45 : 35;

    for (let i = 0; i < missing; i++) {
      const fraction = Math.random();
      const speed = minSpeed + Math.random() * (maxSpeed - minSpeed);
      const heading = Math.floor(Math.random() * 360);
      // Alterna dirección: si ya hay 1 bus, el nuevo va al revés
      // (asumimos los existentes están con direction random, esto al menos
      // suma diversidad).
      const direction = (r.current_count + i) % 2 === 0 ? 1 : -1;

      let attempts = 0;
      while (attempts < 5) {
        const plate = randomPlate();
        try {
          await prisma.$executeRawUnsafe(`
            INSERT INTO buses (id, route_id, plate, current_location,
              fraction_of_corridor, speed_kmh, heading, direction,
              last_seen_at, status)
            VALUES (
              gen_random_uuid(),
              '${r.id}'::uuid,
              '${plate}',
              (SELECT ST_LineInterpolatePoint(path::geometry, ${fraction})::geography FROM route_corridors WHERE route_id = '${r.id}'::uuid),
              ${fraction}, ${speed.toFixed(2)}, ${heading}, ${direction},
              NOW(), 'IN_SERVICE'::bus_status
            );
          `);
          totalAdded++;
          break;
        } catch (err) {
          attempts++;
          if (attempts === 5) {
            console.error(`   ✗ ${r.code} bus #${i + 1}: plate collision retry exhausted`);
          }
        }
      }
    }
    console.log(`   + ${r.code.padEnd(4)} ${r.mode.padEnd(11)} ${r.current_count} → ${r.current_count + missing}  (agregados ${missing})`);
  }

  const [{ total }] = await prisma.$queryRawUnsafe<{ total: number }[]>(
    `SELECT COUNT(*)::int AS total FROM buses;`,
  );
  console.log(`\n✅ Top-up completo. Total buses ahora: ${total} (agregados ${totalAdded})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
