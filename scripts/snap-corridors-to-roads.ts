/**
 * Vialink — Snap route corridors to real streets using Mapbox Directions API.
 *
 * Why this exists:
 *   The initial seed dibujó cada corridor a mano con 6-11 waypoints, lo que
 *   significa que entre cada par de puntos el bus se mueve en LÍNEA RECTA
 *   (PostGIS ST_LineInterpolatePoint). Visualmente esto se ve como buses
 *   atravesando edificios o saliéndose de la malla vial.
 *
 *   Este script toma esos waypoints y los envía a Mapbox Directions API,
 *   que devuelve un polyline real con cientos de puntos siguiendo calles.
 *   Reemplaza route_corridors.path y reinterpola posiciones de buses.
 *
 * Es idempotente: se puede correr varias veces. Cada ejecución re-snapea
 * desde los waypoints originales (que vienen del seed).
 *
 * Run:
 *   pnpm snap-corridors
 *   pnpm snap-corridors --dry-run        # ver qué haría sin tocar la DB
 *   pnpm snap-corridors --only=C12,B7    # solo ciertas rutas
 */

// ============================================================
// .env loader (script independiente, no usa @nestjs/config)
// ============================================================
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

const MAPBOX_TOKEN = process.env.MAPBOX_ACCESS_TOKEN;
const PROFILE = 'driving'; // mapbox profile: driving | driving-traffic | walking | cycling
const MAPBOX_BASE = `https://api.mapbox.com/directions/v5/mapbox/${PROFILE}`;
const RATE_DELAY_MS = 200; // pause between calls (overkill since limit is 600/min)

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const ONLY = argv.find((a) => a.startsWith('--only='))?.slice(7).split(',') ?? null;

interface CorridorRow {
  route_id: string;
  code: string;
  mode: string;
  wkt: string;
  current_length_m: number;
}

interface MapboxDirectionsResponse {
  code: string;
  routes: Array<{
    geometry: {
      type: 'LineString';
      coordinates: [number, number][];
    };
    distance: number; // meters
    duration: number; // seconds
  }>;
  message?: string;
}

const prisma = new PrismaClient();

async function main() {
  if (!MAPBOX_TOKEN || MAPBOX_TOKEN.includes('placeholder')) {
    throw new Error('MAPBOX_ACCESS_TOKEN no configurado en .env');
  }
  console.log(`🗺️  Snap corridors to real roads (Mapbox ${PROFILE})`);
  if (DRY_RUN) console.log('🔍 DRY RUN — no se tocará la DB');
  if (ONLY) console.log(`🎯 Solo rutas: ${ONLY.join(', ')}`);
  console.log();

  const filter = ONLY ? `AND r.code = ANY('{${ONLY.join(',')}}')` : '';
  const corridors = await prisma.$queryRawUnsafe<CorridorRow[]>(`
    SELECT r.id AS route_id, r.code, r.mode::text AS mode,
           ST_AsText(rc.path::geometry) AS wkt,
           rc.length_m AS current_length_m
    FROM routes r
    JOIN route_corridors rc ON rc.route_id = r.id
    WHERE r.active = true ${filter}
    ORDER BY r.code;
  `);

  if (corridors.length === 0) {
    console.log('No hay rutas para procesar');
    return;
  }

  console.log(`Procesando ${corridors.length} corridors…\n`);

  let okCount = 0;
  let skipCount = 0;
  let totalPointsBefore = 0;
  let totalPointsAfter = 0;

  for (const c of corridors) {
    const waypoints = parseLineString(c.wkt);
    totalPointsBefore += waypoints.length;

    if (waypoints.length < 2) {
      console.log(`▸ ${c.code.padEnd(4)} ${c.mode.padEnd(11)} ⚠️  Solo ${waypoints.length} waypoints, skip`);
      skipCount++;
      continue;
    }
    if (waypoints.length > 25) {
      console.log(`▸ ${c.code.padEnd(4)} ${c.mode.padEnd(11)} ⚠️  ${waypoints.length} waypoints > 25, skip`);
      skipCount++;
      continue;
    }

    process.stdout.write(`▸ ${c.code.padEnd(4)} ${c.mode.padEnd(11)} ${waypoints.length} wp → `);

    let snapped: [number, number][];
    let snappedDistance: number;
    try {
      const result = await snapToRoads(waypoints);
      snapped = result.coordinates;
      snappedDistance = result.distance;
    } catch (err) {
      console.log(`❌ ${(err as Error).message}`);
      skipCount++;
      continue;
    }
    totalPointsAfter += snapped.length;

    const oldKm = (c.current_length_m / 1000).toFixed(2);
    const newKm = (snappedDistance / 1000).toFixed(2);
    process.stdout.write(`${snapped.length} puntos · ${oldKm}km → ${newKm}km`);

    if (DRY_RUN) {
      console.log(' (dry-run, sin cambios)');
      okCount++;
    } else {
      try {
        await updateCorridor(c.route_id, snapped, Math.round(snappedDistance));
        console.log(' ✓');
        okCount++;
      } catch (err) {
        console.log(` ❌ DB error: ${(err as Error).message}`);
      }
    }

    // Polite delay (Mapbox limit is 600/min, esto es 5/sec — muy conservador)
    await sleep(RATE_DELAY_MS);
  }

  console.log();
  console.log(`✅ OK: ${okCount}  ⏭️  Skip: ${skipCount}`);
  console.log(`Puntos: ${totalPointsBefore} (a mano) → ${totalPointsAfter} (snapped) [${(totalPointsAfter / totalPointsBefore).toFixed(1)}x detalle]`);
  if (DRY_RUN) {
    console.log('\n🔍 DRY RUN — para aplicar, corre sin --dry-run');
  }
}

// ============================================================
// Mapbox call
// ============================================================

async function snapToRoads(waypoints: [number, number][]): Promise<{
  coordinates: [number, number][];
  distance: number;
}> {
  const coords = waypoints.map(([lng, lat]) => `${lng},${lat}`).join(';');
  const url = `${MAPBOX_BASE}/${coords}?geometries=geojson&overview=full&access_token=${MAPBOX_TOKEN}`;

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Mapbox ${res.status}: ${body.slice(0, 150)}`);
  }
  const data = (await res.json()) as MapboxDirectionsResponse;
  if (data.code !== 'Ok' || !data.routes?.[0]) {
    throw new Error(`Mapbox: ${data.message ?? data.code}`);
  }
  return {
    coordinates: data.routes[0].geometry.coordinates,
    distance: data.routes[0].distance,
  };
}

// ============================================================
// DB updates
// ============================================================

async function updateCorridor(
  routeId: string,
  coords: [number, number][],
  distanceM: number,
): Promise<void> {
  const lineWKT = `LINESTRING(${coords.map(([lng, lat]) => `${lng} ${lat}`).join(', ')})`;

  // 1. Update the corridor path itself
  await prisma.$executeRawUnsafe(
    `
    UPDATE route_corridors
    SET path = ST_SetSRID(ST_GeomFromText($2), 4326)::geography,
        length_m = $3
    WHERE route_id = $1::uuid;
    `,
    routeId, lineWKT, distanceM,
  );

  // 2. Reinterpolate every bus on this route to its same fraction on the new polyline
  await prisma.$executeRawUnsafe(
    `
    UPDATE buses b
    SET current_location = ST_LineInterpolatePoint(rc.path::geometry, b.fraction_of_corridor)::geography
    FROM route_corridors rc
    WHERE rc.route_id = $1::uuid AND b.route_id = $1::uuid;
    `,
    routeId,
  );

  // 3. Recompute route_landmarks (fraction + distance) against the new polyline
  await prisma.$executeRawUnsafe(
    `
    UPDATE route_landmarks rl
    SET
      fraction_of_corridor = ST_LineLocatePoint(
        (SELECT path::geometry FROM route_corridors WHERE route_id = rl.route_id),
        (SELECT location::geometry FROM landmarks WHERE id = rl.landmark_id)
      ),
      distance_to_corridor_m = ST_Distance(
        (SELECT path FROM route_corridors WHERE route_id = rl.route_id),
        (SELECT location FROM landmarks WHERE id = rl.landmark_id)
      )::int
    WHERE rl.route_id = $1::uuid;
    `,
    routeId,
  );
}

// ============================================================
// Helpers
// ============================================================

function parseLineString(wkt: string): [number, number][] {
  const m = /^LINESTRING\((.+)\)$/.exec(wkt.trim());
  if (!m) return [];
  return m[1].split(',').map((pair) => {
    const [lng, lat] = pair.trim().split(/\s+/).map(Number);
    return [lng, lat] as [number, number];
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ============================================================
// Run
// ============================================================

main()
  .catch((err) => {
    console.error('❌', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
