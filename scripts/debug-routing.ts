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

const USER = { lat: 11.0186, lng: -74.8499 }; // Uninorte
const DEST = { lat: 11.0046, lng: -74.8083 }; // Buenavista
const MAX_WALK = 500;

async function main() {
  console.log(`\n=== Routes whose corridor is within ${MAX_WALK}m of BOTH user and dest ===`);
  const nearby = await prisma.$queryRawUnsafe<
    { code: string; corridor_dist_to_user_m: number; corridor_dist_to_dest_m: number }[]
  >(`
    SELECT r.code,
      ST_Distance(rc.path, ST_SetSRID(ST_MakePoint(${USER.lng}, ${USER.lat}), 4326)::geography)::int AS corridor_dist_to_user_m,
      ST_Distance(rc.path, ST_SetSRID(ST_MakePoint(${DEST.lng}, ${DEST.lat}), 4326)::geography)::int AS corridor_dist_to_dest_m
    FROM routes r JOIN route_corridors rc ON rc.route_id = r.id
    WHERE r.active = true
      AND ST_DWithin(rc.path, ST_SetSRID(ST_MakePoint(${USER.lng}, ${USER.lat}), 4326)::geography, ${MAX_WALK})
      AND ST_DWithin(rc.path, ST_SetSRID(ST_MakePoint(${DEST.lng}, ${DEST.lat}), 4326)::geography, ${MAX_WALK})
    ORDER BY r.code;
  `);
  console.log(nearby);

  console.log(`\n=== Paraderos on S12 within ${MAX_WALK * 1.5}m of user ===`);
  const board = await prisma.$queryRawUnsafe<
    { name: string; distance_to_corridor_m: number; walk_m: number; fraction: number }[]
  >(`
    SELECT l.name,
      rl.distance_to_corridor_m,
      ST_Distance(l.location, ST_SetSRID(ST_MakePoint(${USER.lng}, ${USER.lat}), 4326)::geography)::int AS walk_m,
      rl.fraction_of_corridor AS fraction
    FROM route_landmarks rl
    JOIN landmarks l ON l.id = rl.landmark_id
    JOIN routes r ON r.id = rl.route_id
    WHERE r.code = 'S12'
      AND ST_DWithin(l.location, ST_SetSRID(ST_MakePoint(${USER.lng}, ${USER.lat}), 4326)::geography, ${MAX_WALK * 1.5})
    ORDER BY walk_m;
  `);
  console.log(board);

  console.log(`\n=== Paraderos on S12 within ${MAX_WALK * 1.5}m of dest ===`);
  const alight = await prisma.$queryRawUnsafe<
    { name: string; distance_to_corridor_m: number; walk_m: number; fraction: number }[]
  >(`
    SELECT l.name,
      rl.distance_to_corridor_m,
      ST_Distance(l.location, ST_SetSRID(ST_MakePoint(${DEST.lng}, ${DEST.lat}), 4326)::geography)::int AS walk_m,
      rl.fraction_of_corridor AS fraction
    FROM route_landmarks rl
    JOIN landmarks l ON l.id = rl.landmark_id
    JOIN routes r ON r.id = rl.route_id
    WHERE r.code = 'S12'
      AND ST_DWithin(l.location, ST_SetSRID(ST_MakePoint(${DEST.lng}, ${DEST.lat}), 4326)::geography, ${MAX_WALK * 1.5})
    ORDER BY walk_m;
  `);
  console.log(alight);
}
main().catch(console.error).finally(() => prisma.$disconnect());
