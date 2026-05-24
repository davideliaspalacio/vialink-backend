/**
 * Observa un bus por N segundos imprimiendo fraction + direction + heading
 * cada ~1s. Útil para verificar el bounce en los extremos del corridor.
 *
 * Run: pnpm ts-node scripts/observe-bus.ts QWQ617 30
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

const plate = process.argv[2] ?? 'QWQ617';
const seconds = parseInt(process.argv[3] ?? '20', 10);

async function main() {
  console.log(
    `\nObservando ${plate} por ${seconds}s (lookups cada 1s):\n`,
  );
  console.log('t      fraction  dir  heading  Δfrac');

  let prev: { fraction: number; direction: number } | null = null;
  const start = Date.now();
  while ((Date.now() - start) / 1000 < seconds) {
    const [b] = await prisma.$queryRawUnsafe<
      {
        fraction: number;
        direction: number;
        heading: number | null;
      }[]
    >(`
      SELECT fraction_of_corridor::float AS fraction, direction, heading
      FROM buses WHERE plate = '${plate}';
    `);

    const arrow = b.direction === 1 ? '→' : '←';
    const dfrac = prev ? (b.fraction - prev.fraction).toFixed(5) : '   —';
    const bounceMark =
      prev && prev.direction !== b.direction ? ' 🔁 BOUNCE' : '';
    const t = ((Date.now() - start) / 1000).toFixed(1);
    console.log(
      `${t.padStart(4)}s  ${b.fraction.toFixed(5).padStart(7)}  ${arrow}    ${(b.heading ?? 0).toFixed(0).padStart(3)}°    ${dfrac.padStart(7)}${bounceMark}`,
    );
    prev = { fraction: b.fraction, direction: b.direction };
    await new Promise((r) => setTimeout(r, 250));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
