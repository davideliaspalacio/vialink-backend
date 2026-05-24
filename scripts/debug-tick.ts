/**
 * Run a single BusEngine tick manually and show before/after state
 * for one bus. Lets us see if the SQL itself is correct.
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

const plate = process.argv[2] ?? 'QWQ617';
const tickSec = 1.5;

async function showState(label: string) {
  const [r] = await prisma.$queryRawUnsafe<
    {
      plate: string;
      direction: number;
      fraction: number;
      speed: number;
      heading: number | null;
    }[]
  >(`
    SELECT plate, direction, fraction_of_corridor::float AS fraction,
      speed_kmh AS speed, heading
    FROM buses WHERE plate = '${plate}';
  `);
  console.log(
    `${label.padEnd(15)} dir=${r.direction === 1 ? '→' : '←'}  fraction=${r.fraction.toFixed(5)}  speed=${r.speed.toFixed(1)}  heading=${(r.heading ?? 0).toFixed(0)}°`,
  );
  return r;
}

async function main() {
  console.log(`\n🔍 Trace de tick para ${plate}\n`);
  const before = await showState('BEFORE');

  // Compute expected:
  const [lr] = await prisma.$queryRawUnsafe<{ length_m: number }[]>(`
    SELECT rc.length_m FROM route_corridors rc
    JOIN buses b ON b.route_id = rc.route_id
    WHERE b.plate = '${plate}';
  `);
  const expectedDelta =
    (before.direction * before.speed * 1000 / 3600 * tickSec) / lr.length_m;
  const expectedRaw = before.fraction + expectedDelta;
  console.log(`\n📐 Cálculo esperado:`);
  console.log(`   length_m = ${lr.length_m}`);
  console.log(`   delta = ${expectedDelta.toFixed(6)} (con dir=${before.direction})`);
  console.log(`   raw_fraction = ${expectedRaw.toFixed(6)}`);
  if (expectedRaw < 0) console.log(`   → BOUNCE: new_fraction = ${(-expectedRaw).toFixed(6)}, new_dir = ${-before.direction}`);
  else if (expectedRaw > 1) console.log(`   → BOUNCE: new_fraction = ${(2 - expectedRaw).toFixed(6)}, new_dir = ${-before.direction}`);
  else console.log(`   → SIN bounce: new_fraction = ${expectedRaw.toFixed(6)}, new_dir = ${before.direction}`);

  // Run the actual SQL from advanceAll() but for ONE bus only
  console.log(`\n⚙️  Ejecutando SQL del tick...`);
  const updated = await prisma.$queryRawUnsafe<
    {
      id: string;
      fraction_of_corridor: number;
      direction: number;
      heading: number | null;
    }[]
  >(`
    WITH raw_advance AS (
      SELECT
        b.id,
        b.route_id,
        rc.length_m,
        b.speed_kmh,
        b.direction,
        (b.fraction_of_corridor
          + b.direction * (b.speed_kmh * 1000.0 / 3600.0 * ${tickSec})
            / NULLIF(rc.length_m, 0)
        )::double precision AS raw_fraction
      FROM buses b
      JOIN route_corridors rc ON rc.route_id = b.route_id
      WHERE b.plate = '${plate}'
        AND b.status = 'IN_SERVICE'
        AND rc.length_m > 0
    ),
    advanced AS (
      SELECT
        ra.id, ra.route_id, ra.length_m, ra.speed_kmh,
        CASE
          WHEN ra.raw_fraction > 1.0 THEN GREATEST(0.0::double precision, 2.0 - ra.raw_fraction)
          WHEN ra.raw_fraction < 0.0 THEN LEAST(1.0::double precision, -ra.raw_fraction)
          ELSE ra.raw_fraction
        END AS new_fraction,
        CASE
          WHEN ra.raw_fraction > 1.0 OR ra.raw_fraction < 0.0 THEN -ra.direction
          ELSE ra.direction
        END::smallint AS new_direction
      FROM raw_advance ra
    ),
    with_geom AS (
      SELECT
        a.*,
        ST_LineInterpolatePoint(rc.path::geometry, a.new_fraction)::geography AS new_location,
        degrees(ST_Azimuth(
          ST_LineInterpolatePoint(rc.path::geometry, CASE WHEN a.new_direction = 1 THEN GREATEST(a.new_fraction - 0.001, 0) ELSE LEAST(a.new_fraction + 0.001, 1) END),
          ST_LineInterpolatePoint(rc.path::geometry, CASE WHEN a.new_direction = 1 THEN LEAST(a.new_fraction + 0.001, 1) ELSE GREATEST(a.new_fraction - 0.001, 0) END)
        )) AS new_heading
      FROM advanced a JOIN route_corridors rc ON rc.route_id = a.route_id
    )
    UPDATE buses b SET
      fraction_of_corridor = w.new_fraction,
      direction = w.new_direction,
      current_location = w.new_location,
      heading = w.new_heading,
      last_seen_at = NOW()
    FROM with_geom w
    WHERE b.id = w.id
    RETURNING b.id, b.fraction_of_corridor, b.direction, b.heading;
  `);
  console.log(`   Filas actualizadas: ${updated.length}`);
  if (updated.length > 0) {
    console.log(
      `   nueva direction=${updated[0].direction}  fraction=${updated[0].fraction_of_corridor.toFixed(5)}  heading=${(updated[0].heading ?? 0).toFixed(0)}°`,
    );
  }

  const after = await showState('AFTER');
  console.log(
    `\n   Δfraction = ${(after.fraction - before.fraction).toFixed(5)}  ` +
      `dir change: ${before.direction} → ${after.direction}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
