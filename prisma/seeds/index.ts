/**
 * Vialink — Seed orquestador
 *
 * Crea desde cero (con upserts idempotentes):
 *   1. Ciudad Barranquilla
 *   2. 80 landmarks
 *   3. 16 rutas (14 TRADITIONAL + 2 BRT) con corridors PostGIS
 *   4. RouteLandmark calculado por proximidad (ST_DWithin < 300m)
 *   5. FixedStops para rutas BRT
 *   6. ~5 buses por ruta TRADITIONAL, ~8 por BRT, con posición inicial
 *      distribuida en el corridor (fracción aleatoria)
 *
 * Idempotente: se puede correr varias veces sin duplicados. Para reset,
 * usar `pnpm prisma migrate reset` y luego `pnpm seed`.
 *
 * Run: `pnpm seed`
 */

import { PrismaClient, RouteMode } from '@prisma/client';
import { LANDMARKS_BAQ } from './data/landmarks-baq';
import { ALL_ROUTES, type RouteSeed } from './data/routes-baq';

const prisma = new PrismaClient();

const BAQ_CITY_CODE = 'BAQ';
const BAQ_CITY_NAME = 'Barranquilla';
const BAQ_CENTER_LAT = 10.9685;
const BAQ_CENTER_LNG = -74.7813;
// Landmark proximity threshold for auto-mapping to route corridors
const LANDMARK_NEAR_CORRIDOR_M = 300;

// ============================================================
// PostGIS helpers (raw SQL, since Prisma Unsupported can't be set via model API)
// ============================================================

function pointSql(lng: number, lat: number): string {
  return `ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`;
}

function lineStringSql(points: readonly (readonly [number, number])[]): string {
  const coords = points.map(([lng, lat]) => `${lng} ${lat}`).join(', ');
  return `ST_SetSRID(ST_GeomFromText('LINESTRING(${coords})'), 4326)::geography`;
}

// ============================================================
// Seed steps
// ============================================================

async function seedCity(): Promise<string> {
  // Upsert by unique code
  await prisma.$executeRawUnsafe(`
    INSERT INTO cities (id, code, name, center, created_at)
    VALUES (gen_random_uuid(), '${BAQ_CITY_CODE}', '${BAQ_CITY_NAME}', ${pointSql(BAQ_CENTER_LNG, BAQ_CENTER_LAT)}, NOW())
    ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, center = EXCLUDED.center;
  `);

  const city = await prisma.city.findUnique({
    where: { code: BAQ_CITY_CODE },
    select: { id: true },
  });
  if (!city) throw new Error('City BAQ not found after upsert');
  console.log(`✅ City: ${BAQ_CITY_NAME} (${city.id})`);
  return city.id;
}

async function seedLandmarks(cityId: string): Promise<number> {
  // Wipe + reinsert (idempotent and simpler than upsert with composite key)
  await prisma.$executeRawUnsafe(`DELETE FROM landmarks WHERE city_id = '${cityId}'::uuid;`);

  for (const l of LANDMARKS_BAQ) {
    const addr = l.address ? `'${l.address.replace(/'/g, "''")}'` : 'NULL';
    await prisma.$executeRawUnsafe(`
      INSERT INTO landmarks (id, name, type, address, location, city_id, created_at)
      VALUES (gen_random_uuid(), '${l.name.replace(/'/g, "''")}', '${l.type}'::landmark_type, ${addr}, ${pointSql(l.lng, l.lat)}, '${cityId}'::uuid, NOW());
    `);
  }
  console.log(`✅ Landmarks: ${LANDMARKS_BAQ.length}`);
  return LANDMARKS_BAQ.length;
}

async function seedRoute(route: RouteSeed, cityId: string): Promise<{ id: string; lengthM: number }> {
  // Upsert route by (cityId, code)
  await prisma.$executeRawUnsafe(`
    INSERT INTO routes (id, code, name, color, mode, stops_are_fixed, operator, city_id, active, created_at)
    VALUES (gen_random_uuid(), '${route.code}', '${route.name.replace(/'/g, "''")}', '${route.color}', '${route.mode}'::route_mode, ${route.stopsAreFixed}, '${route.operator}', '${cityId}'::uuid, true, NOW())
    ON CONFLICT (city_id, code) DO UPDATE SET
      name = EXCLUDED.name,
      color = EXCLUDED.color,
      mode = EXCLUDED.mode,
      stops_are_fixed = EXCLUDED.stops_are_fixed,
      operator = EXCLUDED.operator;
  `);

  const dbRoute = await prisma.route.findUnique({
    where: { cityId_code: { cityId, code: route.code } },
    select: { id: true },
  });
  if (!dbRoute) throw new Error(`Route ${route.code} not found after upsert`);
  const routeId = dbRoute.id;

  // Upsert corridor (compute length on insert)
  const corridorLine = lineStringSql(route.corridor);
  await prisma.$executeRawUnsafe(`
    INSERT INTO route_corridors (route_id, path, length_m, direction)
    VALUES ('${routeId}'::uuid, ${corridorLine}, ST_Length(${corridorLine})::int, 'OUTBOUND')
    ON CONFLICT (route_id) DO UPDATE SET
      path = EXCLUDED.path,
      length_m = EXCLUDED.length_m;
  `);

  // Get computed length
  const [{ length_m }] = await prisma.$queryRawUnsafe<{ length_m: number }[]>(
    `SELECT length_m FROM route_corridors WHERE route_id = '${routeId}'::uuid;`,
  );
  return { id: routeId, lengthM: length_m };
}

async function seedRouteLandmarks(routeId: string, cityId: string): Promise<number> {
  // For each landmark in the city, if within LANDMARK_NEAR_CORRIDOR_M of this
  // route's corridor, insert into route_landmarks with computed fraction.
  await prisma.$executeRawUnsafe(`DELETE FROM route_landmarks WHERE route_id = '${routeId}'::uuid;`);

  const result = await prisma.$executeRawUnsafe(`
    INSERT INTO route_landmarks (route_id, landmark_id, distance_to_corridor_m, fraction_of_corridor)
    SELECT
      '${routeId}'::uuid,
      l.id,
      ST_Distance(rc.path, l.location)::int AS distance_to_corridor_m,
      ST_LineLocatePoint(rc.path::geometry, l.location::geometry) AS fraction_of_corridor
    FROM landmarks l
    JOIN route_corridors rc ON rc.route_id = '${routeId}'::uuid
    WHERE l.city_id = '${cityId}'::uuid
      AND ST_DWithin(rc.path, l.location, ${LANDMARK_NEAR_CORRIDOR_M});
  `);
  return result;
}

async function seedFixedStops(route: RouteSeed, routeId: string): Promise<number> {
  if (!route.fixedStops || route.fixedStops.length === 0) return 0;
  await prisma.$executeRawUnsafe(`DELETE FROM fixed_stops WHERE route_id = '${routeId}'::uuid;`);

  for (const s of route.fixedStops) {
    // Compute fraction_of_corridor for this stop on the route's corridor
    const code = s.code ? `'${s.code}'` : 'NULL';
    await prisma.$executeRawUnsafe(`
      INSERT INTO fixed_stops (id, route_id, name, code, sequence, location, fraction_of_corridor)
      VALUES (
        gen_random_uuid(),
        '${routeId}'::uuid,
        '${s.name.replace(/'/g, "''")}',
        ${code},
        ${s.sequence},
        ${pointSql(s.lng, s.lat)},
        (SELECT ST_LineLocatePoint(path::geometry, ${pointSql(s.lng, s.lat)}::geometry) FROM route_corridors WHERE route_id = '${routeId}'::uuid)
      );
    `);
  }
  return route.fixedStops.length;
}

function randomPlate(): string {
  // Colombian plate format: 3 letters + 3 digits
  const letters = Array.from({ length: 3 }, () =>
    String.fromCharCode(65 + Math.floor(Math.random() * 26)),
  ).join('');
  const digits = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  return `${letters}${digits}`;
}

async function seedBuses(route: RouteSeed, routeId: string, count: number): Promise<number> {
  await prisma.$executeRawUnsafe(`DELETE FROM buses WHERE route_id = '${routeId}'::uuid;`);

  let actuallyInserted = 0;
  for (let i = 0; i < count; i++) {
    const fraction = Math.random();
    // Speed: 20-35 km/h tradicional, 30-45 BRT
    const minSpeed = route.mode === 'BRT' ? 30 : 20;
    const maxSpeed = route.mode === 'BRT' ? 45 : 35;
    const speed = minSpeed + Math.random() * (maxSpeed - minSpeed);
    // Heading: 0-359 (random initial, BusEngine will recompute)
    const heading = Math.floor(Math.random() * 360);
    // Direction inicial random: la mitad de los buses arrancan
    // avanzando y la otra mitad devolviéndose. Visualmente más vivo.
    const direction = Math.random() < 0.5 ? 1 : -1;

    // Generate unique plate (retry on collision)
    let plate = randomPlate();
    let attempts = 0;
    while (attempts < 5) {
      try {
        await prisma.$executeRawUnsafe(`
          INSERT INTO buses (id, route_id, plate, current_location, fraction_of_corridor, speed_kmh, heading, direction, last_seen_at, status)
          VALUES (
            gen_random_uuid(),
            '${routeId}'::uuid,
            '${plate}',
            (SELECT ST_LineInterpolatePoint(path::geometry, ${fraction})::geography FROM route_corridors WHERE route_id = '${routeId}'::uuid),
            ${fraction},
            ${speed.toFixed(2)},
            ${heading},
            ${direction},
            NOW(),
            'IN_SERVICE'::bus_status
          );
        `);
        actuallyInserted++;
        break;
      } catch (err) {
        // Likely plate collision, retry
        plate = randomPlate();
        attempts++;
      }
    }
  }
  return actuallyInserted;
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log('🌱 Seeding Vialink — Barranquilla\n');

  const cityId = await seedCity();
  await seedLandmarks(cityId);

  let totalRoutes = 0;
  let totalBuses = 0;
  let totalRouteLandmarks = 0;
  let totalFixedStops = 0;

  for (const route of ALL_ROUTES) {
    const { id: routeId, lengthM } = await seedRoute(route, cityId);
    const rlCount = await seedRouteLandmarks(routeId, cityId);
    const fsCount = await seedFixedStops(route, routeId);
    // Densidad reducida para demo (75% menos vs 8/5).
    // BRT (Transmetro) sigue con más buses porque son rutas troncales largas.
    const busCount = route.mode === 'BRT' ? 2 : 1;
    const buses = await seedBuses(route, routeId, busCount);

    totalRoutes++;
    totalBuses += buses;
    totalRouteLandmarks += rlCount;
    totalFixedStops += fsCount;

    const lengthKm = (lengthM / 1000).toFixed(2);
    console.log(
      `   ▸ ${route.code.padEnd(4)} ${route.mode.padEnd(11)} ${lengthKm.padStart(6)} km · ${rlCount.toString().padStart(2)} landmarks · ${fsCount} fixed_stops · ${buses} buses`,
    );
  }

  console.log(`\n✅ Routes:           ${totalRoutes}`);
  console.log(`✅ RouteLandmarks:   ${totalRouteLandmarks}`);
  console.log(`✅ FixedStops:       ${totalFixedStops}`);
  console.log(`✅ Buses:            ${totalBuses}`);
  console.log('\n🎉 Seed complete\n');
}

main()
  .catch((err) => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
