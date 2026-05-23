import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval, SchedulerRegistry } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import {
  InternalEvents,
  type BusPositionEvent,
} from '../realtime/realtime-events';
import { RealtimeEventBus } from '../realtime/realtime-event-bus.service';
import type { AppConfig } from '../config/configuration';

/**
 * Vialink — Bus engine.
 *
 * Core infrastructure (NOT part of the simulator).
 * Every SIMULATOR_BUS_TICK_MS, advances every IN_SERVICE bus along its
 * route corridor based on its current speed, recomputes its GPS via
 * ST_LineInterpolatePoint, persists it, and emits a `bus.position_updated`
 * event to the RealtimeEventBus for WS broadcast.
 *
 * Bulk update uses a single CTE-based UPDATE to avoid N round trips.
 */

interface BusTickRow {
  id: string;
  route_id: string;
  route_code: string;
  city_code: string;
  length_m: number;
  speed_kmh: number;
  current_fraction: number;
}

interface UpdatedBusRow {
  id: string;
  route_id: string;
  route_code: string;
  city_code: string;
  fraction_of_corridor: number;
  speed_kmh: number;
  heading: number | null;
  lat: number;
  lng: number;
}

@Injectable()
export class BusEngineService implements OnModuleInit {
  private readonly logger = new Logger(BusEngineService.name);
  private readonly tickMs: number;
  private isTicking = false;
  private ticksProcessed = 0;
  private busesMovedLastTick = 0;
  private enabled = true;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: RealtimeEventBus,
    private readonly schedulerRegistry: SchedulerRegistry,
    config: ConfigService<AppConfig, true>,
  ) {
    this.tickMs = config.get('SIMULATOR_BUS_TICK_MS', { infer: true });
  }

  onModuleInit() {
    this.logger.log(
      `🚌 BusEngine armed (tick=${this.tickMs}ms). First tick in ${this.tickMs}ms.`,
    );
  }

  /**
   * Runs at SIMULATOR_BUS_TICK_MS interval (default 1000ms).
   * Re-entrant safe: if a tick takes >tickMs, the next one is skipped.
   */
  @Interval('bus-engine-tick', 1000)
  async tick() {
    if (!this.enabled) return;
    if (this.isTicking) {
      this.logger.warn('Skipping tick — previous tick still running');
      return;
    }
    this.isTicking = true;
    const start = Date.now();

    try {
      const updated = await this.advanceAll();
      this.busesMovedLastTick = updated.length;
      this.ticksProcessed++;

      // Emit events (after DB commit)
      for (const u of updated) {
        const ev: BusPositionEvent = {
          busId: u.id,
          routeId: u.route_id,
          routeCode: u.route_code,
          cityCode: u.city_code,
          location: { lat: u.lat, lng: u.lng },
          heading: u.heading,
          speedKmh: u.speed_kmh,
          fractionOfCorridor: u.fraction_of_corridor,
          timestamp: new Date().toISOString(),
        };
        this.eventBus.emit(InternalEvents.BusPosition, ev);
      }

      const elapsed = Date.now() - start;
      if (this.ticksProcessed % 10 === 0) {
        this.logger.debug(
          `tick #${this.ticksProcessed}: moved ${updated.length} buses in ${elapsed}ms`,
        );
      }
      if (elapsed > this.tickMs * 0.8) {
        this.logger.warn(
          `tick took ${elapsed}ms (>${(this.tickMs * 0.8).toFixed(0)}ms budget)`,
        );
      }
    } catch (err) {
      this.logger.error('BusEngine tick failed', err);
    } finally {
      this.isTicking = false;
    }
  }

  /**
   * Advances all IN_SERVICE buses by one tick.
   * Uses a single UPDATE ... FROM (subquery) ... RETURNING for efficiency.
   *
   * Movement model:
   *   meters_advanced = speed_kmh × (1000 / 3600) × (tick_ms / 1000)
   *   new_fraction    = (old_fraction + meters_advanced / corridor_length_m) % 1
   *   new_location    = ST_LineInterpolatePoint(corridor.path, new_fraction)
   */
  private async advanceAll(): Promise<UpdatedBusRow[]> {
    const tickSeconds = this.tickMs / 1000;

    return this.prisma.$queryRawUnsafe<UpdatedBusRow[]>(
      `
      WITH raw_advance AS (
        SELECT
          b.id,
          b.route_id,
          r.code AS route_code,
          c.code AS city_code,
          rc.length_m,
          b.speed_kmh,
          -- raw advance (may exceed 1.0 if bus loops past the end)
          (b.fraction_of_corridor
            + (b.speed_kmh * 1000.0 / 3600.0 * ${tickSeconds}) / NULLIF(rc.length_m, 0)
          )::double precision AS raw_fraction
        FROM buses b
        JOIN routes r ON r.id = b.route_id
        JOIN cities c ON c.id = r.city_id
        JOIN route_corridors rc ON rc.route_id = b.route_id
        WHERE b.status = 'IN_SERVICE'
          AND rc.length_m IS NOT NULL
          AND rc.length_m > 0
      ),
      advanced AS (
        SELECT
          ra.id, ra.route_id, ra.route_code, ra.city_code,
          ra.length_m, ra.speed_kmh,
          -- Wrap to [0, 1) using FLOOR (portable, no type cast issues)
          (ra.raw_fraction - FLOOR(ra.raw_fraction))::double precision AS new_fraction
        FROM raw_advance ra
      ),
      with_geom AS (
        SELECT
          a.*,
          ST_LineInterpolatePoint(rc.path::geometry, a.new_fraction)::geography AS new_location,
          -- Heading: bearing from old point to new point
          degrees(ST_Azimuth(
            ST_LineInterpolatePoint(rc.path::geometry, GREATEST(a.new_fraction - 0.001, 0)),
            ST_LineInterpolatePoint(rc.path::geometry, LEAST(a.new_fraction + 0.001, 1))
          )) AS new_heading
        FROM advanced a
        JOIN route_corridors rc ON rc.route_id = a.route_id
      )
      UPDATE buses b
      SET
        fraction_of_corridor = w.new_fraction,
        current_location = w.new_location,
        heading = w.new_heading,
        last_seen_at = NOW()
      FROM with_geom w
      WHERE b.id = w.id
      RETURNING
        b.id,
        w.route_id,
        w.route_code,
        w.city_code,
        b.fraction_of_corridor,
        b.speed_kmh,
        b.heading,
        ST_Y(b.current_location::geometry) AS lat,
        ST_X(b.current_location::geometry) AS lng;
      `,
    );
  }

  // ---------- Control ----------

  pause() {
    this.enabled = false;
    this.logger.log('⏸️  BusEngine paused');
  }

  resume() {
    this.enabled = true;
    this.logger.log('▶️  BusEngine resumed');
  }

  getStatus() {
    return {
      enabled: this.enabled,
      isTicking: this.isTicking,
      tickMs: this.tickMs,
      ticksProcessed: this.ticksProcessed,
      busesMovedLastTick: this.busesMovedLastTick,
    };
  }
}
