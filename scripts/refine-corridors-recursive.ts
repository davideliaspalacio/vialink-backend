/**
 * Vialink — Refine corridor polylines so no segment is > 50m.
 *
 * Problem after snap-corridors-to-roads.ts:
 *   Mapbox Directions devuelve un polyline siguiendo calles pero solo
 *   pone puntos en los giros. Entre giros largos (autopistas, avenidas
 *   sin curvas) hay saltos de 100-1100m en línea recta. PostGIS interpola
 *   linealmente entre esos puntos al posicionar al bus → el bus visualmente
 *   "atraviesa edificios" porque su línea entre punto N y N+1 corta cuadras.
 *
 * Solution:
 *   1. Densificar el polyline (insertar puntos cada ~25m linealmente)
 *   2. Pasar esos puntos por Mapbox Map Matching API que los ajusta
 *      a la red vial real
 *   3. Map Matching tiene límite de 100 coords por request → batchear
 *   4. Repetir hasta que no haya segmentos > 50m (max 3 iteraciones)
 *
 * Idempotente. Run:
 *   pnpm refine-corridors
 *   pnpm refine-corridors --dry-run
 *   pnpm refine-corridors --only=C12,S12
 */

// ============================================================
// .env loader
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
const MATCHING_URL = 'https://api.mapbox.com/matching/v5/mapbox/driving';
const TARGET_MAX_SEGMENT_M = 50;
const DENSIFY_INTERVAL_M = 25; // insert intermediate points every 25m before snapping
const MAX_COORDS_PER_REQUEST = 100; // Mapbox Map Matching hard limit
const RADIUS_M = 25; // tolerance per point for snapping
const MAX_ITERATIONS = 3;
const RATE_DELAY_MS = 250;

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const ONLY = argv.find((a) => a.startsWith('--only='))?.slice(7).split(',') ?? null;

interface CorridorRow {
  route_id: string;
  code: string;
  mode: string;
  wkt: string;
}

interface MapMatchingResponse {
  code: string;
  matchings?: Array<{
    geometry: { type: 'LineString'; coordinates: [number, number][] };
    confidence: number;
  }>;
  message?: string;
}

const prisma = new PrismaClient();

// ============================================================
// Main
// ============================================================

async function main() {
  if (!MAPBOX_TOKEN || MAPBOX_TOKEN.includes('placeholder')) {
    throw new Error('MAPBOX_ACCESS_TOKEN no configurado en .env');
  }
  console.log('🔧 Refine corridors so every segment is < 50m');
  if (DRY_RUN) console.log('🔍 DRY RUN');
  if (ONLY) console.log(`🎯 Solo: ${ONLY.join(', ')}`);
  console.log();

  const filter = ONLY ? `AND r.code = ANY('{${ONLY.join(',')}}')` : '';
  const corridors = await prisma.$queryRawUnsafe<CorridorRow[]>(`
    SELECT r.id AS route_id, r.code, r.mode::text AS mode,
           ST_AsText(rc.path::geometry) AS wkt
    FROM routes r
    JOIN route_corridors rc ON rc.route_id = r.id
    WHERE r.active = true ${filter}
    ORDER BY r.code;
  `);

  console.log(`Procesando ${corridors.length} corridors…\n`);

  let okCount = 0;
  let skipCount = 0;

  for (const c of corridors) {
    const original = parseLineString(c.wkt);
    const beforeStats = segmentStats(original);

    process.stdout.write(
      `▸ ${c.code.padEnd(4)} ${c.mode.padEnd(11)} ${original.length} pts | max ${beforeStats.maxM.toFixed(0)}m, ${beforeStats.over50} segs >50m → `,
    );

    if (beforeStats.maxM <= TARGET_MAX_SEGMENT_M) {
      console.log('✓ ya OK, skip');
      skipCount++;
      continue;
    }

    let current = original;
    let iteration = 0;
    let success = true;

    while (iteration < MAX_ITERATIONS) {
      const stats = segmentStats(current);
      if (stats.maxM <= TARGET_MAX_SEGMENT_M) break;

      try {
        current = await refineOnce(current);
      } catch (err) {
        console.log(`❌ iter ${iteration + 1}: ${(err as Error).message}`);
        success = false;
        break;
      }
      iteration++;
    }

    if (!success) {
      skipCount++;
      continue;
    }

    const afterStats = segmentStats(current);
    process.stdout.write(
      `${current.length} pts | max ${afterStats.maxM.toFixed(0)}m, ${afterStats.over50} segs >50m`,
    );

    if (DRY_RUN) {
      console.log(' (dry-run)');
      okCount++;
    } else {
      try {
        await updateCorridor(c.route_id, current);
        console.log(' ✓');
        okCount++;
      } catch (err) {
        console.log(` ❌ DB: ${(err as Error).message}`);
      }
    }

    await sleep(RATE_DELAY_MS);
  }

  console.log();
  console.log(`✅ OK: ${okCount}  ⏭️  Skip: ${skipCount}`);
  if (DRY_RUN) console.log('\n🔍 DRY RUN — para aplicar, corre sin --dry-run');
}

// ============================================================
// Refinement pass
// ============================================================

/**
 * One pass: densify + Map-Match.
 * Returns a new polyline that should have fewer/smaller segments.
 */
async function refineOnce(coords: [number, number][]): Promise<[number, number][]> {
  // 1. Densify with interpolated points so Mapbox has more anchors
  const dense = densify(coords, DENSIFY_INTERVAL_M);

  // 2. Split into chunks of <=100 coords (Map Matching API limit)
  const chunks = chunkArray(dense, MAX_COORDS_PER_REQUEST);

  // 3. Map-Match each chunk
  const snappedChunks: [number, number][][] = [];
  for (const chunk of chunks) {
    if (chunk.length < 2) continue;
    try {
      const snapped = await mapMatch(chunk);
      snappedChunks.push(snapped);
    } catch (err) {
      // If Map Matching fails for this chunk, keep the dense version
      console.warn(`  ⚠️ chunk fail: ${(err as Error).message}, keeping dense`);
      snappedChunks.push(chunk);
    }
    await sleep(RATE_DELAY_MS);
  }

  // 4. Concatenate chunks, deduping the junction point
  return concatChunks(snappedChunks);
}

// ============================================================
// Mapbox Map Matching API
// ============================================================

async function mapMatch(coords: [number, number][]): Promise<[number, number][]> {
  if (coords.length < 2) return coords;
  if (coords.length > 100) {
    throw new Error(`Too many coords for one Map Matching call: ${coords.length}`);
  }

  const coordsStr = coords.map(([lng, lat]) => `${lng},${lat}`).join(';');
  const radiuses = coords.map(() => RADIUS_M).join(';');
  const url = `${MATCHING_URL}/${coordsStr}?geometries=geojson&overview=full&radiuses=${radiuses}&access_token=${MAPBOX_TOKEN}`;

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Mapbox ${res.status}: ${body.slice(0, 150)}`);
  }
  const data = (await res.json()) as MapMatchingResponse;
  if (data.code !== 'Ok' || !data.matchings?.[0]) {
    throw new Error(`Mapbox: ${data.message ?? data.code}`);
  }
  return data.matchings[0].geometry.coordinates;
}

// ============================================================
// Polyline helpers
// ============================================================

function densify(coords: [number, number][], maxDistM: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < coords.length - 1; i++) {
    out.push(coords[i]);
    const d = haversineM(coords[i], coords[i + 1]);
    if (d > maxDistM) {
      const n = Math.ceil(d / maxDistM);
      for (let s = 1; s < n; s++) {
        const t = s / n;
        out.push([
          coords[i][0] + (coords[i + 1][0] - coords[i][0]) * t,
          coords[i][1] + (coords[i + 1][1] - coords[i][1]) * t,
        ]);
      }
    }
  }
  out.push(coords[coords.length - 1]);
  return out;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  if (arr.length <= size) return [arr];
  // Overlap by 1 element so the segment between chunks is matched too
  const chunks: T[][] = [];
  let i = 0;
  while (i < arr.length) {
    const end = Math.min(i + size, arr.length);
    chunks.push(arr.slice(i, end));
    if (end >= arr.length) break;
    i = end - 1; // overlap last point
  }
  return chunks;
}

function concatChunks(chunks: [number, number][][]): [number, number][] {
  if (chunks.length === 0) return [];
  if (chunks.length === 1) return chunks[0];
  const out: [number, number][] = [...chunks[0]];
  for (let i = 1; i < chunks.length; i++) {
    // Skip first point of next chunk (it's the same as last of previous)
    out.push(...chunks[i].slice(1));
  }
  return out;
}

function segmentStats(coords: [number, number][]): {
  maxM: number;
  avgM: number;
  over50: number;
} {
  if (coords.length < 2) return { maxM: 0, avgM: 0, over50: 0 };
  let max = 0;
  let sum = 0;
  let over = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const d = haversineM(coords[i], coords[i + 1]);
    if (d > max) max = d;
    sum += d;
    if (d > 50) over++;
  }
  return { maxM: max, avgM: sum / (coords.length - 1), over50: over };
}

function haversineM(a: [number, number], b: [number, number]): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function parseLineString(wkt: string): [number, number][] {
  const m = /^LINESTRING\((.+)\)$/.exec(wkt.trim());
  if (!m) return [];
  return m[1].split(',').map((pair) => {
    const [lng, lat] = pair.trim().split(/\s+/).map(Number);
    return [lng, lat] as [number, number];
  });
}

// ============================================================
// DB update
// ============================================================

async function updateCorridor(
  routeId: string,
  coords: [number, number][],
): Promise<void> {
  const lineWKT = `LINESTRING(${coords.map(([lng, lat]) => `${lng} ${lat}`).join(', ')})`;

  await prisma.$executeRawUnsafe(
    `
    UPDATE route_corridors
    SET path = ST_SetSRID(ST_GeomFromText($2), 4326)::geography,
        length_m = ST_Length(ST_SetSRID(ST_GeomFromText($2), 4326)::geography)::int
    WHERE route_id = $1::uuid;
    `,
    routeId, lineWKT,
  );

  // Reinterpolate buses to their same fraction on the new polyline
  await prisma.$executeRawUnsafe(
    `
    UPDATE buses b
    SET current_location = ST_LineInterpolatePoint(rc.path::geometry, b.fraction_of_corridor)::geography
    FROM route_corridors rc
    WHERE rc.route_id = $1::uuid AND b.route_id = $1::uuid;
    `,
    routeId,
  );

  // Recompute route_landmarks
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
