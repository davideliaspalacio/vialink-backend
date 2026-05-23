import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { AgentProfile, AgentStatus } from '@prisma/client';
import { CitiesService } from '../cities/cities.service';
import type { AppConfig } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';
import { AgentEngineService } from './agent-engine.service';
import { PROFILE_MIX, PROFILE_SPAWNS, PROFILES } from './profiles/profiles';

export interface SimulatorStatus {
  status: 'STOPPED' | 'RUNNING';
  agent_count: number;
  agents_by_profile: Record<string, number>;
  actions_last_minute: number;
  llm_calls_last_minute: number;
  ticks_processed: number;
  last_tick_ms: number | null;
  started_at: string | null;
}

interface AgentRow {
  id: string;
  profile_type: AgentProfile;
  name: string;
  home_lat: number;
  home_lng: number;
  work_lat: number | null;
  work_lng: number | null;
  status: AgentStatus;
  current_lat: number | null;
  current_lng: number | null;
  current_trip_id: string | null;
  schedule: unknown;
}

/**
 * Vialink Simulator — orchestrator.
 *
 * Owns the lifecycle of the agent fleet:
 *   - start({ agent_count }) creates N profiles + simulator_agents rows
 *   - tick (scheduled): pulls all active agents and runs AgentEngine.tick per agent
 *   - stop() pauses the tick loop (agents stay in DB)
 *   - reset() deletes all simulator data (agents + their fake profiles + events)
 *
 * The fake profiles created for agents have email ending in @vialink.simulator
 * so they're trivial to identify and clean up.
 */
@Injectable()
export class SimulatorService implements OnModuleInit {
  private readonly logger = new Logger(SimulatorService.name);
  private readonly tickMs: number;
  private isRunning = false;
  private isTicking = false;
  private ticksProcessed = 0;
  private lastTickMs: number | null = null;
  private startedAt: Date | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: AgentEngineService,
    private readonly cities: CitiesService,
    private readonly scheduler: SchedulerRegistry,
    config: ConfigService<AppConfig, true>,
  ) {
    this.tickMs = config.get('SIMULATOR_TICK_MS', { infer: true });
  }

  async onModuleInit() {
    this.logger.log(
      `🤖 SimulatorService loaded (tick=${this.tickMs}ms). Not running; POST /admin/simulator/start to begin.`,
    );
  }

  // ============================================================
  // Lifecycle
  // ============================================================

  async start(params: { agent_count: number }) {
    if (this.isRunning) {
      throw new Error('Simulator already running. Stop it first.');
    }
    if (params.agent_count < 1 || params.agent_count > 1000) {
      throw new Error('agent_count must be between 1 and 1000');
    }

    const cityId = await this.cities.getIdByCode('BAQ');
    const existing = await this.prisma.simulatorAgent.count();

    if (existing < params.agent_count) {
      await this.spawnAgents(params.agent_count - existing, cityId);
    } else if (existing > params.agent_count) {
      this.logger.warn(
        `Existing agents (${existing}) > requested (${params.agent_count}); keeping existing.`,
      );
    }

    // Schedule the tick
    const interval = setInterval(() => {
      void this.runTick();
    }, this.tickMs);
    this.scheduler.addInterval('simulator-tick', interval);

    this.isRunning = true;
    this.startedAt = new Date();
    this.logger.log(`▶️  Simulator started with ${params.agent_count} agents`);

    return this.getStatus();
  }

  async stop() {
    if (!this.isRunning) return this.getStatus();
    try {
      this.scheduler.deleteInterval('simulator-tick');
    } catch {
      /* may not exist */
    }
    this.isRunning = false;
    this.logger.log('⏹️  Simulator stopped');
    return this.getStatus();
  }

  async reset() {
    await this.stop();
    // Delete all simulator events + agents + their fake profiles
    await this.prisma.$executeRawUnsafe(`DELETE FROM simulator_events;`);
    await this.prisma.$executeRawUnsafe(`DELETE FROM simulator_agents;`);
    // Cascade delete trips/incidents/favorites/messages tied to fake profiles
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM trips WHERE user_id IN (SELECT id FROM profiles WHERE email LIKE '%@vialink.simulator');`,
    );
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM ratings WHERE user_id IN (SELECT id FROM profiles WHERE email LIKE '%@vialink.simulator');`,
    );
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM incidents WHERE user_id IN (SELECT id FROM profiles WHERE email LIKE '%@vialink.simulator');`,
    );
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM favorites WHERE user_id IN (SELECT id FROM profiles WHERE email LIKE '%@vialink.simulator');`,
    );
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM assistant_messages WHERE user_id IN (SELECT id FROM profiles WHERE email LIKE '%@vialink.simulator');`,
    );
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM profiles WHERE email LIKE '%@vialink.simulator';`,
    );
    this.ticksProcessed = 0;
    this.lastTickMs = null;
    this.startedAt = null;
    this.logger.log('🧹 Simulator reset complete');
    return this.getStatus();
  }

  // ============================================================
  // Tick orchestration
  // ============================================================

  private async runTick() {
    if (this.isTicking) return; // skip if previous tick still running
    this.isTicking = true;
    const start = Date.now();
    try {
      const hour = new Date().getHours();

      // ---- STEP 1: Bulk-update positions of all WALKING agents in one query ----
      // Linear interpolation between walkStart and destination based on elapsed
      // wall-clock time vs walkDurationSec. Clamped to [0,1].
      await this.prisma.$executeRawUnsafe(`
        UPDATE simulator_agents SET current_location = ST_SetSRID(ST_MakePoint(
          (schedule->>'walkStartLng')::float8 + (
            (schedule->>'destinationLng')::float8 - (schedule->>'walkStartLng')::float8
          ) * LEAST(1.0, GREATEST(0.0,
            EXTRACT(EPOCH FROM (NOW() - (schedule->>'walkStartedAt')::timestamptz))
              / NULLIF((schedule->>'walkDurationSec')::float8, 0)
          )),
          (schedule->>'walkStartLat')::float8 + (
            (schedule->>'destinationLat')::float8 - (schedule->>'walkStartLat')::float8
          ) * LEAST(1.0, GREATEST(0.0,
            EXTRACT(EPOCH FROM (NOW() - (schedule->>'walkStartedAt')::timestamptz))
              / NULLIF((schedule->>'walkDurationSec')::float8, 0)
          ))
        ), 4326)::geography
        WHERE status = 'WALKING'
          AND schedule->>'walkStartedAt' IS NOT NULL
          AND schedule->>'walkStartLat' IS NOT NULL
          AND schedule->>'walkStartLng' IS NOT NULL
          AND schedule->>'destinationLat' IS NOT NULL
          AND schedule->>'destinationLng' IS NOT NULL;
      `);

      // ---- STEP 2: Bulk-sync ON_BUS agents to their bus's current position ----
      await this.prisma.$executeRawUnsafe(`
        UPDATE simulator_agents sa
        SET current_location = b.current_location
        FROM buses b
        WHERE sa.status = 'ON_BUS'
          AND (sa.schedule->>'busId')::uuid = b.id;
      `);

      // ---- STEP 3: SELECT all agents (with freshly-updated positions) ----
      const agents = await this.prisma.$queryRawUnsafe<AgentRow[]>(
        `SELECT
           id, profile_type, name,
           ST_Y(home_location::geometry) AS home_lat,
           ST_X(home_location::geometry) AS home_lng,
           ST_Y(work_location::geometry) AS work_lat,
           ST_X(work_location::geometry) AS work_lng,
           status,
           ST_Y(current_location::geometry) AS current_lat,
           ST_X(current_location::geometry) AS current_lng,
           current_trip_id,
           schedule
         FROM simulator_agents;`,
      );

      // Process in parallel batches of 25 to avoid overwhelming DB pool
      const batchSize = 25;
      for (let i = 0; i < agents.length; i += batchSize) {
        const batch = agents.slice(i, i + batchSize);
        await Promise.all(
          batch.map((a) =>
            this.engine.tick(
              { ...a, schedule: (a.schedule as Record<string, unknown>) ?? {} } as never,
              hour,
            ),
          ),
        );
      }

      this.ticksProcessed++;
      this.lastTickMs = Date.now() - start;
      if (this.ticksProcessed % 10 === 0) {
        this.logger.debug(
          `tick #${this.ticksProcessed}: ${agents.length} agents in ${this.lastTickMs}ms`,
        );
      }
      if (this.lastTickMs > this.tickMs) {
        this.logger.warn(
          `tick took ${this.lastTickMs}ms (>${this.tickMs}ms budget)`,
        );
      }
    } catch (err) {
      this.logger.error('Simulator tick failed', err);
    } finally {
      this.isTicking = false;
    }
  }

  // ============================================================
  // Agent spawning
  // ============================================================

  private async spawnAgents(count: number, cityId: string) {
    this.logger.log(`🌱 Spawning ${count} agents...`);
    let created = 0;

    for (let i = 0; i < count; i++) {
      const profile = this.pickProfileByMix();
      const spawn = PROFILE_SPAWNS[profile];
      const home = spawn.homeZones[Math.floor(Math.random() * spawn.homeZones.length)];
      const work =
        spawn.workZones && spawn.workZones.length > 0
          ? spawn.workZones[Math.floor(Math.random() * spawn.workZones.length)]
          : null;

      const homeJittered = jitterLocation(home, 0.005);
      const workJittered = work ? jitterLocation(work, 0.003) : null;

      const names = PROFILES[profile].sampleNames;
      const name = names[Math.floor(Math.random() * names.length)];

      try {
        await this.prisma.$transaction(async (tx) => {
          // Generate UUID up front so profile.id == agent.id (clean relation)
          const idRows = await tx.$queryRawUnsafe<{ id: string }[]>(
            `SELECT gen_random_uuid()::text AS id;`,
          );
          const id = idRows[0].id;
          const emailLocal = `agent-${id.slice(0, 8)}`;
          const email = `${emailLocal}@vialink.simulator`;

          // Create the fake profile (no auth.users entry)
          await tx.$executeRawUnsafe(
            `INSERT INTO profiles (id, email, name, city_id, created_at)
             VALUES ($1::uuid, $2, $3, $4::uuid, NOW())
             ON CONFLICT (email) DO NOTHING;`,
            id,
            email,
            name,
            cityId,
          );

          // Create the simulator_agent row sharing the same id
          if (workJittered) {
            await tx.$executeRawUnsafe(
              `INSERT INTO simulator_agents
                 (id, profile_type, name, home_location, work_location, schedule, status, current_location, created_at)
               VALUES (
                 $1::uuid, $2::agent_profile, $3,
                 ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography,
                 ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography,
                 '{}'::jsonb,
                 'IDLE'::agent_status,
                 ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography,
                 NOW()
               );`,
              id, profile, name,
              homeJittered.lng, homeJittered.lat,
              workJittered.lng, workJittered.lat,
            );
          } else {
            await tx.$executeRawUnsafe(
              `INSERT INTO simulator_agents
                 (id, profile_type, name, home_location, schedule, status, current_location, created_at)
               VALUES (
                 $1::uuid, $2::agent_profile, $3,
                 ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography,
                 '{}'::jsonb,
                 'IDLE'::agent_status,
                 ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography,
                 NOW()
               );`,
              id, profile, name,
              homeJittered.lng, homeJittered.lat,
            );
          }
        });
        created++;
      } catch (err) {
        // Most likely duplicate name+email — skip
      }
    }
    this.logger.log(`🌱 Spawned ${created}/${count} agents`);
  }

  private pickProfileByMix(): AgentProfile {
    const r = Math.random();
    let acc = 0;
    for (const m of PROFILE_MIX) {
      acc += m.weight;
      if (r <= acc) return m.profile;
    }
    return PROFILE_MIX[PROFILE_MIX.length - 1].profile;
  }

  // ============================================================
  // Status
  // ============================================================

  async getStatus(): Promise<SimulatorStatus> {
    const byProfile = await this.prisma.$queryRawUnsafe<
      { profile_type: AgentProfile; count: number }[]
    >(
      `SELECT profile_type, COUNT(*)::int AS count FROM simulator_agents GROUP BY profile_type;`,
    );
    const totalRow = await this.prisma.$queryRawUnsafe<{ count: number }[]>(
      `SELECT COUNT(*)::int AS count FROM simulator_agents;`,
    );
    const total = totalRow[0]?.count ?? 0;

    const recent = await this.prisma.$queryRawUnsafe<
      { actions: number; llm_calls: number }[]
    >(
      `SELECT
         (SELECT COUNT(*)::int FROM simulator_events WHERE occurred_at > NOW() - INTERVAL '60 seconds') AS actions,
         (SELECT COUNT(*)::int FROM simulator_events WHERE action_type = 'asked_ai'
            AND (payload->>'simulated' IS NULL OR payload->>'simulated' = 'false')
            AND occurred_at > NOW() - INTERVAL '60 seconds') AS llm_calls;`,
    );

    return {
      status: this.isRunning ? 'RUNNING' : 'STOPPED',
      agent_count: total,
      agents_by_profile: Object.fromEntries(byProfile.map((r) => [r.profile_type, r.count])),
      actions_last_minute: recent[0]?.actions ?? 0,
      llm_calls_last_minute: recent[0]?.llm_calls ?? 0,
      ticks_processed: this.ticksProcessed,
      last_tick_ms: this.lastTickMs,
      started_at: this.startedAt?.toISOString() ?? null,
    };
  }
}

/** Small lat/lng jitter so agents don't spawn on top of each other. */
function jitterLocation(
  loc: { lat: number; lng: number },
  maxDelta: number,
): { lat: number; lng: number } {
  return {
    lat: loc.lat + (Math.random() - 0.5) * maxDelta * 2,
    lng: loc.lng + (Math.random() - 0.5) * maxDelta * 2,
  };
}
