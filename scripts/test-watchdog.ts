/**
 * Vialink — Test del watchdog del BusEngine.
 *
 * 1. Pone speed=0 a un bus random
 * 2. Espera 35s (watchdog corre cada 30s)
 * 3. Verifica que ese bus volvió a tener speed > 0
 *
 * Run: pnpm ts-node scripts/test-watchdog.ts
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

const prisma = new PrismaClient();

async function main() {
  const [target] = await prisma.$queryRawUnsafe<
    { id: string; plate: string; route_code: string; speed_kmh: number }[]
  >(`
    SELECT b.id, b.plate, r.code AS route_code, b.speed_kmh
    FROM buses b JOIN routes r ON r.id = b.route_id
    WHERE b.status = 'IN_SERVICE'
    ORDER BY random() LIMIT 1;
  `);

  if (!target) {
    console.error('No hay buses IN_SERVICE para testear.');
    process.exit(1);
  }

  console.log(
    `🎯 Target: ${target.plate} (${target.route_code}) speed actual=${target.speed_kmh.toFixed(1)} km/h`,
  );

  await prisma.$executeRawUnsafe(
    `UPDATE buses SET speed_kmh = 0 WHERE id = '${target.id}'::uuid;`,
  );
  console.log(`💀 Speed seteado a 0`);

  const wait = 35;
  console.log(`⏳ Esperando ${wait}s para que el watchdog corra...`);

  for (let s = wait; s > 0; s -= 5) {
    await new Promise((r) => setTimeout(r, 5000));
    const [now] = await prisma.$queryRawUnsafe<
      { speed_kmh: number; status: string }[]
    >(`
      SELECT speed_kmh, status::text AS status
      FROM buses WHERE id = '${target.id}'::uuid;
    `);
    console.log(
      `   t=-${s - 5}s: speed=${now.speed_kmh.toFixed(2)} status=${now.status}`,
    );
    if (now.speed_kmh > 0) {
      console.log(`\n✅ Watchdog funcionó. Recuperó ${target.plate} en <${wait - s + 5}s.`);
      return;
    }
  }

  console.log(`\n❌ Watchdog NO recuperó ${target.plate} en ${wait}s.`);
  process.exit(1);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
