import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AgentProfile,
  AgentStatus,
  IncidentType,
} from '@prisma/client';
import { AssistantService } from '../assistant/assistant.service';
import type { LatLng } from '../common/types/geo';
import type { AppConfig } from '../config/configuration';
import { DiscoveryService } from '../discovery/discovery.service';
import { IncidentsService } from '../incidents/incidents.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  InternalEvents,
  type AgentActionEvent,
} from '../realtime/realtime-events';
import { RealtimeEventBus } from '../realtime/realtime-event-bus.service';
import { TripsService } from '../trips/trips.service';
import { PROFILES } from './profiles/profiles';

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
  schedule: AgentSchedule;
}

interface AgentSchedule {
  // pending destination if WALKING / WAITING_BUS
  destinationName?: string;
  destinationLat?: number;
  destinationLng?: number;
  // for WALKING: progress from current → destination
  walkStartLat?: number;
  walkStartLng?: number;
  walkStartedAt?: string;
  walkDurationSec?: number;
  // for WAITING_BUS: route the agent decided to take
  waitingRouteId?: string;
  waitingRouteCode?: string;
  waitingSince?: string;
  // for ON_BUS
  busId?: string;
  busBoardedAt?: string;
}

/**
 * Vialink Simulator — Agent Engine.
 *
 * State machine that runs once per agent per simulator tick:
 *
 *   IDLE
 *     ├─ decide destination → WALKING
 *     └─ no destination → stay IDLE
 *
 *   WALKING (straight-line interpolation home→destination)
 *     └─ on arrival (< 50m) → WAITING_BUS
 *
 *   WAITING_BUS (asks for next bus on its route; ~10% rolls Claude)
 *     ├─ bus reaches user point → ON_BUS (trip created via TripsService)
 *     └─ keeps polling buses-at-point
 *
 *   ON_BUS
 *     └─ at destination (≤ 100m) → AT_DESTINATION
 *
 *   AT_DESTINATION
 *     ├─ complete trip via TripsService
 *     ├─ maybe rate, maybe save favorite
 *     └─ → IDLE (back to top)
 */
@Injectable()
export class AgentEngineService {
  private readonly logger = new Logger(AgentEngineService.name);
  private readonly tickMs: number;
  private readonly llmProbability: number;
  private readonly speedMultiplier: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly discovery: DiscoveryService,
    private readonly trips: TripsService,
    private readonly incidents: IncidentsService,
    private readonly assistant: AssistantService,
    private readonly eventBus: RealtimeEventBus,
    config: ConfigService<AppConfig, true>,
  ) {
    this.tickMs = config.get('SIMULATOR_TICK_MS', { infer: true });
    this.llmProbability = config.get('SIMULATOR_LLM_PROBABILITY', { infer: true });
    this.speedMultiplier = config.get('SIMULATOR_SPEED_MULTIPLIER', { infer: true });
  }

  /**
   * Advance one agent by one tick. Catches all errors so a single
   * misbehaving agent never breaks the orchestrator.
   */
  async tick(agent: AgentRow, hour: number): Promise<void> {
    try {
      const profile = PROFILES[agent.profile_type];
      if (!profile) return;

      // Asleep? Skip.
      if (profile.hours.asleep?.includes(hour)) {
        if (agent.status !== AgentStatus.IDLE) {
          await this.setStatus(agent.id, AgentStatus.IDLE);
        }
        return;
      }

      switch (agent.status) {
        case AgentStatus.IDLE:
          await this.tickIdle(agent, hour);
          break;
        case AgentStatus.WALKING:
          await this.tickWalking(agent);
          break;
        case AgentStatus.WAITING_BUS:
          await this.tickWaitingBus(agent);
          break;
        case AgentStatus.ON_BUS:
          await this.tickOnBus(agent);
          break;
        case AgentStatus.AT_DESTINATION:
          await this.tickAtDestination(agent);
          break;
      }
    } catch (err) {
      this.logger.warn(
        `agent ${agent.id.slice(0, 8)} (${agent.profile_type}) tick error: ${(err as Error).message}`,
      );
    }
  }

  // ============================================================
  // STATE: IDLE
  // ============================================================
  private async tickIdle(agent: AgentRow, hour: number) {
    const profile = PROFILES[agent.profile_type];
    if (!profile.hours.active.includes(hour)) return;

    // Decide destination
    const home: LatLng = { lat: agent.home_lat, lng: agent.home_lng };
    const work: LatLng | null =
      agent.work_lat !== null && agent.work_lng !== null
        ? { lat: agent.work_lat, lng: agent.work_lng }
        : null;
    const destination = profile.pickDestination(home, work, hour, Math.random());
    if (!destination) return;

    const current: LatLng =
      agent.current_lat !== null && agent.current_lng !== null
        ? { lat: agent.current_lat, lng: agent.current_lng }
        : home;

    // Don't walk if already at destination
    const distToDest = haversineMeters(current, destination.location);
    if (distToDest < 50) {
      // Already there, nothing to do
      return;
    }

    // Cap walking distance: in reality the agent walks to the nearest bus
    // corridor (max ~800m) and lets the bus do the long haul. We model this
    // by walking in a straight line for up to MAX_WALK_M toward destination,
    // then transitioning to WAITING_BUS where the engine looks for a route
    // that goes to the REAL destination.
    const MAX_WALK_M = 800;
    const walkRatio = Math.min(1, MAX_WALK_M / distToDest);
    const walkTargetLat = current.lat + (destination.location.lat - current.lat) * walkRatio;
    const walkTargetLng = current.lng + (destination.location.lng - current.lng) * walkRatio;
    const walkDist = Math.min(distToDest, MAX_WALK_M);

    // Real walking duration / speedMultiplier (accelerates for demo)
    const realWalkSec = (walkDist / 1000) / profile.walkingSpeedKmh * 3600;
    const walkSec = Math.max(10, Math.round(realWalkSec / this.speedMultiplier));

    // Schedule keeps the REAL destination (so WAITING_BUS picks the right route)
    // but walk only goes to walkTarget.
    const newSchedule: AgentSchedule = {
      destinationName: destination.name,
      destinationLat: destination.location.lat,
      destinationLng: destination.location.lng,
      walkStartLat: current.lat,
      walkStartLng: current.lng,
      walkStartedAt: new Date().toISOString(),
      walkDurationSec: walkSec,
    };
    // Override the walking target by stashing it in the destination fields of
    // a temporary state. We use the helper trick: keep destinationLat/Lng as
    // the WALK TARGET (so tickWalking interpolates correctly) and stash the
    // REAL destination separately for WAITING_BUS.
    newSchedule.destinationLat = walkTargetLat;
    newSchedule.destinationLng = walkTargetLng;
    (newSchedule as Record<string, unknown>).realDestLat = destination.location.lat;
    (newSchedule as Record<string, unknown>).realDestLng = destination.location.lng;
    (newSchedule as Record<string, unknown>).realDestName = destination.name;

    await this.updateAgent(agent.id, {
      status: AgentStatus.WALKING,
      schedule: newSchedule,
      current_lat: current.lat,
      current_lng: current.lng,
    });

    await this.emitAction(agent, 'walked', {
      destination: destination.name,
      distance_m: Math.round(walkDist),
      total_distance_m: Math.round(distToDest),
      eta_seconds: walkSec,
    }, current);
  }

  // ============================================================
  // STATE: WALKING
  // Position interpolation is done in bulk by SimulatorService BEFORE
  // this tick runs, so here we only check for arrival + transition.
  // ============================================================
  private async tickWalking(agent: AgentRow) {
    const s = agent.schedule;
    if (
      !s.walkStartedAt ||
      s.walkStartLat == null ||
      s.walkStartLng == null ||
      s.destinationLat == null ||
      s.destinationLng == null ||
      !s.walkDurationSec
    ) {
      await this.setStatus(agent.id, AgentStatus.IDLE);
      return;
    }

    const elapsedSec = (Date.now() - new Date(s.walkStartedAt).getTime()) / 1000;
    const progress = Math.min(1, elapsedSec / s.walkDurationSec);
    const lat = s.walkStartLat + (s.destinationLat - s.walkStartLat) * progress;
    const lng = s.walkStartLng + (s.destinationLng - s.walkStartLng) * progress;

    // Position already updated in bulk; only update if we're about to
    // transition (so the AT-arrival event has the right lat/lng).
    if (progress >= 1) {
      // Arrived to wait point — transition to WAITING_BUS.
      // Promote realDest* (set in IDLE when walking was capped) to the
      // actual destination so WAITING_BUS picks a route that goes there.
      const realDestLat = (s as Record<string, unknown>).realDestLat as
        | number
        | undefined;
      const realDestLng = (s as Record<string, unknown>).realDestLng as
        | number
        | undefined;
      const realDestName = (s as Record<string, unknown>).realDestName as
        | string
        | undefined;

      const finalDestLat = realDestLat ?? s.destinationLat;
      const finalDestLng = realDestLng ?? s.destinationLng;
      const finalDestName = realDestName ?? s.destinationName;

      const newSchedule: AgentSchedule = {
        destinationName: finalDestName,
        destinationLat: finalDestLat,
        destinationLng: finalDestLng,
        waitingSince: new Date().toISOString(),
      };
      await this.updateAgent(agent.id, {
        status: AgentStatus.WAITING_BUS,
        schedule: newSchedule,
      });
      await this.emitAction(agent, 'started_waiting', {
        destination: finalDestName,
      }, { lat, lng });
    }
  }

  // ============================================================
  // STATE: WAITING_BUS
  // ============================================================
  private async tickWaitingBus(agent: AgentRow) {
    const s = agent.schedule;
    if (s.destinationLat == null || s.destinationLng == null) {
      await this.setStatus(agent.id, AgentStatus.IDLE);
      return;
    }

    const here: LatLng = {
      lat: agent.current_lat ?? agent.home_lat,
      lng: agent.current_lng ?? agent.home_lng,
    };

    // Roll for AI question (only some % of agents this tick)
    const profile = PROFILES[agent.profile_type];
    if (Math.random() < (profile.weights.askAi ?? 0) * 0.1) {
      // Mark as the slice that hits REAL Claude — within the 10% LLM budget
      if (Math.random() < this.llmProbability) {
        const question =
          profile.questionBank.questions[
            Math.floor(Math.random() * profile.questionBank.questions.length)
          ];
        // Fire and forget — don't block tick on Claude latency
        this.assistant
          .ask({ userId: agent.id, question, location: here })
          .then((r) => {
            void this.emitAction(agent, 'asked_ai', { question, answer_preview: r.answer.slice(0, 80) }, here);
          })
          .catch(() => {
            // Quiet — assistant may be rate-limited or fail
          });
      } else {
        // Silent ask (counted but no real call)
        const question =
          profile.questionBank.questions[
            Math.floor(Math.random() * profile.questionBank.questions.length)
          ];
        await this.emitAction(agent, 'asked_ai', { question, simulated: true }, here);
      }
    }

    // Find best route to destination from here
    const busesHere = await this.discovery.getBusesAtPoint(here, 200, 'BAQ');
    const dest: LatLng = { lat: s.destinationLat, lng: s.destinationLng };

    // Pick a route that ALSO passes near destination
    let chosenRoute: { id: string; code: string } | null = null;
    for (const r of busesHere.routes) {
      // Quick check via discovery again — does this route pass near dest?
      const passesNearDest = await this.routePassesNear(r.route.id, dest);
      const nextBus = r.next_buses[0];
      const eta = nextBus?.eta_seconds;
      if (passesNearDest && nextBus && eta != null) {
        chosenRoute = { id: r.route.id, code: r.route.code };
        if (eta <= (this.tickMs / 1000) * 2) {
          // Bus is essentially here — board!
          await this.boardBus(agent, chosenRoute.id, chosenRoute.code, nextBus.bus_id, here, dest);
          return;
        }
        break; // Stick to first viable route
      }
    }

    // Maybe report incident while waiting (low probability)
    if (Math.random() < (profile.weights.reportIncident ?? 0)) {
      const types: IncidentType[] = ['TRAFFIC', 'NO_BUS_PASSING', 'FULL_BUS'];
      const type = types[Math.floor(Math.random() * types.length)];
      await this.incidents
        .report({
          userId: agent.id,
          type,
          location: here,
          routeId: chosenRoute?.id,
          description: undefined,
          cityCode: 'BAQ',
        })
        .then(() => this.emitAction(agent, 'reported_incident', { type }, here))
        .catch(() => undefined);
    }

    // Timeout: if waiting more than 6 minutes, give up
    if (s.waitingSince) {
      const waitingFor = (Date.now() - new Date(s.waitingSince).getTime()) / 1000;
      if (waitingFor > 360) {
        await this.setStatus(agent.id, AgentStatus.IDLE);
      }
    }
  }

  // ============================================================
  // STATE: ON_BUS
  // Position sync is done in bulk by SimulatorService BEFORE this tick.
  // Here we only check whether the bus has reached destination.
  // ============================================================
  private async tickOnBus(agent: AgentRow) {
    const s = agent.schedule;
    if (!s.busId || s.destinationLat == null || s.destinationLng == null) {
      await this.setStatus(agent.id, AgentStatus.IDLE);
      return;
    }

    if (agent.current_lat == null || agent.current_lng == null) {
      // Bus may have been deleted; bail
      await this.setStatus(agent.id, AgentStatus.IDLE);
      return;
    }

    const busPos: LatLng = { lat: agent.current_lat, lng: agent.current_lng };
    const dest: LatLng = { lat: s.destinationLat, lng: s.destinationLng };

    if (haversineMeters(busPos, dest) < 100) {
      await this.setStatus(agent.id, AgentStatus.AT_DESTINATION);
      await this.emitAction(agent, 'boarded', { destination: s.destinationName, status: 'arrived' }, busPos);
    }
  }

  // ============================================================
  // STATE: AT_DESTINATION
  // ============================================================
  private async tickAtDestination(agent: AgentRow) {
    const profile = PROFILES[agent.profile_type];
    const here: LatLng = {
      lat: agent.current_lat ?? agent.home_lat,
      lng: agent.current_lng ?? agent.home_lng,
    };

    // Complete trip if there is one
    if (agent.current_trip_id) {
      try {
        await this.trips.updateStatus(agent.current_trip_id, agent.id, 'COMPLETED');
        await this.emitAction(agent, 'completed_trip', { trip_id: agent.current_trip_id }, here);

        // Maybe rate
        if (Math.random() < (profile.weights.rateTrip ?? 0)) {
          const stars = 3 + Math.floor(Math.random() * 3); // 3-5
          await this.trips
            .rate(agent.current_trip_id, agent.id, stars)
            .then(() => this.emitAction(agent, 'rated_trip', { stars }, here))
            .catch(() => undefined);
        }
      } catch (err) {
        // Trip might already be completed/cancelled
      }
    }

    // Maybe save favorite (lookup landmark by proximity)
    if (Math.random() < (profile.weights.saveFavorite ?? 0)) {
      const nearby = await this.prisma.$queryRawUnsafe<{ id: string; name: string }[]>(
        `SELECT id, name FROM landmarks
         WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 200)
         LIMIT 1;`,
        here.lng,
        here.lat,
      );
      if (nearby.length > 0) {
        try {
          await this.prisma.favorite.create({
            data: {
              userId: agent.id,
              targetType: 'LANDMARK',
              landmarkId: nearby[0].id,
              alias: 'Visitado',
            },
          });
          await this.emitAction(
            agent,
            'saved_favorite',
            { landmark: nearby[0].name },
            here,
          );
        } catch {
          /* duplicate favorite — ignore */
        }
      }
    }

    // Back to idle (clear trip)
    await this.updateAgent(agent.id, {
      status: AgentStatus.IDLE,
      schedule: {},
      current_trip_id: null,
    });
  }

  // ============================================================
  // Helpers
  // ============================================================

  private async boardBus(
    agent: AgentRow,
    routeId: string,
    routeCode: string,
    busId: string,
    here: LatLng,
    dest: LatLng,
  ) {
    try {
      const trip = await this.trips.createTrip({
        userId: agent.id,
        routeId,
        boardingLocation: here,
        dropoffLocation: dest,
      });
      const newSchedule: AgentSchedule = {
        destinationName: agent.schedule.destinationName,
        destinationLat: agent.schedule.destinationLat,
        destinationLng: agent.schedule.destinationLng,
        busId,
        busBoardedAt: new Date().toISOString(),
      };
      await this.updateAgent(agent.id, {
        status: AgentStatus.ON_BUS,
        schedule: newSchedule,
        current_trip_id: trip.id,
      });
      await this.emitAction(agent, 'started_trip', { route: routeCode, bus_id: busId, trip_id: trip.id }, here);
    } catch (err) {
      // Likely 409 (already has active trip) — go back to IDLE
      await this.setStatus(agent.id, AgentStatus.IDLE);
    }
  }

  private async routePassesNear(routeId: string, point: LatLng): Promise<boolean> {
    const rows = await this.prisma.$queryRawUnsafe<{ ok: boolean }[]>(
      `SELECT ST_DWithin(path, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 250) AS ok
       FROM route_corridors WHERE route_id = $3::uuid;`,
      point.lng,
      point.lat,
      routeId,
    );
    return rows.length > 0 && rows[0].ok === true;
  }

  private async updateAgent(
    id: string,
    patch: Partial<{
      status: AgentStatus;
      schedule: AgentSchedule;
      current_lat: number;
      current_lng: number;
      current_trip_id: string | null;
    }>,
  ): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (patch.status !== undefined) {
      sets.push(`status = $${idx++}::agent_status`);
      params.push(patch.status);
    }
    if (patch.schedule !== undefined) {
      sets.push(`schedule = $${idx++}::jsonb`);
      params.push(JSON.stringify(patch.schedule));
    }
    if (patch.current_lat !== undefined && patch.current_lng !== undefined) {
      sets.push(
        `current_location = ST_SetSRID(ST_MakePoint($${idx++}, $${idx++}), 4326)::geography`,
      );
      params.push(patch.current_lng, patch.current_lat);
    }
    if (patch.current_trip_id !== undefined) {
      sets.push(`current_trip_id = ${patch.current_trip_id === null ? 'NULL' : `$${idx++}::uuid`}`);
      if (patch.current_trip_id !== null) params.push(patch.current_trip_id);
    }
    if (sets.length === 0) return;

    params.push(id);
    await this.prisma.$executeRawUnsafe(
      `UPDATE simulator_agents SET ${sets.join(', ')} WHERE id = $${idx}::uuid;`,
      ...params,
    );
  }

  private async setStatus(id: string, status: AgentStatus): Promise<void> {
    await this.updateAgent(id, { status, schedule: {} });
  }

  private async emitAction(
    agent: AgentRow,
    action: AgentActionEvent['action'],
    payload: Record<string, unknown>,
    location: LatLng | null,
  ): Promise<void> {
    // 1) Emit WS event (fire-and-forget)
    const ev: AgentActionEvent = {
      agentId: agent.id,
      agentName: agent.name,
      agentProfile: agent.profile_type,
      action,
      payload,
      location,
      cityCode: 'BAQ',
      timestamp: new Date().toISOString(),
    };
    this.eventBus.emit(InternalEvents.AgentAction, ev);

    // 2) Persist to simulator_events table for the admin feed
    try {
      if (location) {
        await this.prisma.$executeRawUnsafe(
          `INSERT INTO simulator_events (id, agent_id, action_type, payload, location, occurred_at)
           VALUES (gen_random_uuid(), $1::uuid, $2, $3::jsonb, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, NOW());`,
          agent.id,
          action,
          JSON.stringify(payload),
          location.lng,
          location.lat,
        );
      } else {
        await this.prisma.$executeRawUnsafe(
          `INSERT INTO simulator_events (id, agent_id, action_type, payload, occurred_at)
           VALUES (gen_random_uuid(), $1::uuid, $2, $3::jsonb, NOW());`,
          agent.id,
          action,
          JSON.stringify(payload),
        );
      }
    } catch {
      /* ignore — event log is best-effort */
    }
  }
}

/** Haversine distance between two lat/lng in meters. */
function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
