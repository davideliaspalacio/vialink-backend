#!/usr/bin/env node
/* eslint-disable */
/**
 * Vialink — interactive WebSocket client for testing realtime events.
 *
 * Connects to the local backend's WS gateway, joins the `admin` and
 * `city:BAQ` rooms, and prints events as they arrive with a live counter.
 *
 * Usage:
 *   1. Start the backend:   pnpm start:prod
 *   2. In another terminal: node test/ws-client.js
 *
 * Optional env vars:
 *   WS_URL          (default: http://localhost:3000)
 *   VERBOSE_BUSES=1 (print every single bus_position; off by default — too noisy)
 *   ROOMS=admin,city:BAQ
 */

const { io } = require('socket.io-client');

const WS_URL = process.env.WS_URL || 'http://localhost:3000';
const ROOMS = (process.env.ROOMS || 'admin,city:BAQ')
  .split(',')
  .map((r) => r.trim())
  .filter(Boolean);
const VERBOSE_BUSES = process.env.VERBOSE_BUSES === '1';

// ─── Pretty terminal helpers ───────────────────────────────────────────
const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m', white: '\x1b[37m',
};
const ts = () => new Date().toISOString().slice(11, 19);
const log = (color, tag, ...rest) =>
  console.log(`${c.dim}${ts()}${c.reset} ${color}${tag.padEnd(20)}${c.reset}`, ...rest);

// ─── Stats ────────────────────────────────────────────────────────────
const stats = {
  startedAt: Date.now(),
  total: 0,
  byType: {},
  busesSeen: new Set(),
  lastMetrics: null,
};

const STATS_INTERVAL_MS = 5000;
function printStats() {
  const uptimeS = Math.floor((Date.now() - stats.startedAt) / 1000);
  const eps = (stats.total / Math.max(uptimeS, 1)).toFixed(1);
  const byType = Object.entries(stats.byType)
    .map(([t, n]) => `${c.cyan}${t}${c.reset}=${n}`)
    .join(' ');
  console.log(
    `${c.dim}${'─'.repeat(72)}${c.reset}\n` +
      `${c.bold}📊 Stats${c.reset} (after ${uptimeS}s) — ` +
      `${stats.total} events  ·  ${eps} ev/s  ·  ${stats.busesSeen.size} unique buses\n` +
      `   ${byType}\n` +
      (stats.lastMetrics
        ? `   ${c.yellow}Last metrics_update:${c.reset} ${JSON.stringify(stats.lastMetrics)}\n`
        : '') +
      `${c.dim}${'─'.repeat(72)}${c.reset}`,
  );
}

// ─── Connection ───────────────────────────────────────────────────────
log(c.bold + c.green, '🔌 connecting', `to ${WS_URL}/realtime ...`);

const socket = io(WS_URL, {
  path: '/realtime',
  transports: ['websocket', 'polling'],
});

socket.on('connect', () => {
  log(c.green, '✅ connected', `id=${socket.id}`);
  for (const room of ROOMS) {
    socket.emit('subscribe', { room }, (ack) => {
      log(c.cyan, '📥 subscribed', `room=${room}  ack=${JSON.stringify(ack)}`);
    });
  }
  // ping every 10s to verify connection alive
  setInterval(() => {
    const start = Date.now();
    socket.emit('ping', null, (ack) => {
      log(c.dim, '🏓 ping', `rtt=${Date.now() - start}ms`);
    });
  }, 10_000);
});

socket.on('disconnect', (reason) => log(c.red, '❌ disconnected', reason));
socket.on('connect_error', (err) => log(c.red, '❌ connect_error', err.message));

// ─── Event handlers ───────────────────────────────────────────────────
function track(type, payload) {
  stats.total++;
  stats.byType[type] = (stats.byType[type] || 0) + 1;
}

socket.on('bus_position', (e) => {
  track('bus_position', e);
  stats.busesSeen.add(e.busId);
  if (VERBOSE_BUSES) {
    log(
      c.blue,
      '🚌 bus_position',
      `${e.routeCode.padEnd(4)} ${e.busId.slice(0, 8)} ` +
        `(${e.location.lat.toFixed(4)}, ${e.location.lng.toFixed(4)}) ` +
        `${e.speedKmh.toFixed(0)}km/h frac=${e.fractionOfCorridor.toFixed(3)}`,
    );
  }
});

socket.on('trip_update', (e) => {
  track('trip_update', e);
  log(
    c.magenta,
    '🚗 trip_update',
    `trip=${e.tripId.slice(0, 8)} status=${e.status}` +
      (e.remainingSeconds != null ? `  ETA=${e.remainingSeconds}s` : ''),
  );
});

socket.on('incident_reported', (e) => {
  track('incident_reported', e);
  log(
    c.red,
    '⚠️  incident',
    `${c.bold}${e.incidentType}${c.reset} ` +
      `at (${e.location.lat.toFixed(4)}, ${e.location.lng.toFixed(4)})` +
      (e.routeId ? `  route=${e.routeId.slice(0, 8)}` : ''),
  );
});

socket.on('wait_session_alert', (e) => {
  track('wait_session_alert', e);
  log(
    c.yellow,
    '🔔 wait_alert',
    `${c.bold}Bus ${e.routeCode} llega en ${e.etaSeconds}s${c.reset} ` +
      `(${e.distanceM}m) → wait=${e.waitSessionId.slice(0, 8)}`,
  );
});

socket.on('agent_action', (e) => {
  track('agent_action', e);
  log(
    c.cyan,
    '🤖 agent_action',
    `${e.agentName} → ${c.bold}${e.action}${c.reset}  ` +
      JSON.stringify(e.payload).slice(0, 80),
  );
});

socket.on('metrics_update', (e) => {
  track('metrics_update', e);
  stats.lastMetrics = e.metrics;
  // Don't print every single one — they come every 2s and clutter
});

// ─── Stats loop + graceful shutdown ───────────────────────────────────
setInterval(printStats, STATS_INTERVAL_MS);

process.on('SIGINT', () => {
  console.log('\n');
  printStats();
  console.log(`${c.bold}👋 Bye${c.reset}`);
  socket.close();
  process.exit(0);
});
