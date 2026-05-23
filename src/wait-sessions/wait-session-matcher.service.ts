import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import {
  InternalEvents,
  type WaitSessionAlertEvent,
} from '../realtime/realtime-events';
import { RealtimeEventBus } from '../realtime/realtime-event-bus.service';

interface MatchRow {
  wait_session_id: string;
  user_id: string;
  bus_id: string;
  route_code: string;
  eta_seconds: number;
  distance_m: number;
}

/**
 * Vialink — Wait session matcher.
 *
 * Every 5 seconds, scans wait_sessions where status='WAITING' and finds the
 * nearest IN_SERVICE bus on the requested route (or any route, if not
 * specified) that:
 *   - has a corridor passing within 100m of the wait location
 *   - has not yet passed the user's point on that corridor
 *   - has ETA <= notify_seconds_before
 *
 * When matched, atomically transitions wait_session to ALERTED and emits
 * `wait_session.alert` to the WS gateway.
 *
 * Idempotent: the UPDATE ... WHERE status='WAITING' clause ensures no
 * duplicate alerts for the same session.
 */
@Injectable()
export class WaitSessionMatcherService {
  private readonly logger = new Logger(WaitSessionMatcherService.name);
  private alertsEmitted = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: RealtimeEventBus,
  ) {}

  @Interval('wait-session-matcher', 5000)
  async runMatchPass() {
    try {
      // Find matches: nearest bus per wait_session within threshold
      const matches = await this.prisma.$queryRawUnsafe<MatchRow[]>(
        `
        WITH eligible AS (
          SELECT
            ws.id AS wait_session_id,
            ws.user_id,
            ws.notify_seconds_before,
            ws.route_id AS pinned_route_id,
            ws.wait_location
          FROM wait_sessions ws
          WHERE ws.status = 'WAITING'
            AND ws.started_at > NOW() - INTERVAL '30 minutes'
        ),
        candidates AS (
          SELECT
            e.wait_session_id,
            e.user_id,
            e.notify_seconds_before,
            b.id AS bus_id,
            r.code AS route_code,
            ST_LineLocatePoint(rc.path::geometry, e.wait_location::geometry) AS user_fraction,
            b.fraction_of_corridor AS bus_fraction,
            b.speed_kmh,
            rc.length_m,
            ST_Distance(rc.path, e.wait_location) AS dist_to_corridor_m
          FROM eligible e
          JOIN routes r ON r.active = true
            AND (e.pinned_route_id IS NULL OR r.id = e.pinned_route_id)
          JOIN route_corridors rc ON rc.route_id = r.id
          JOIN buses b ON b.route_id = r.id
            AND b.status = 'IN_SERVICE'
            AND b.speed_kmh > 1
            AND b.last_seen_at > NOW() - INTERVAL '5 minutes'
          WHERE ST_DWithin(rc.path, e.wait_location, 150)
        ),
        with_eta AS (
          SELECT
            c.*,
            (c.user_fraction - c.bus_fraction) * c.length_m AS distance_m,
            ((c.user_fraction - c.bus_fraction) * c.length_m / (c.speed_kmh * 1000.0 / 3600.0))::int AS eta_seconds
          FROM candidates c
          WHERE c.bus_fraction < c.user_fraction
        ),
        best AS (
          SELECT DISTINCT ON (we.wait_session_id)
            we.wait_session_id, we.user_id, we.bus_id, we.route_code,
            we.eta_seconds, we.distance_m::int AS distance_m, we.notify_seconds_before
          FROM with_eta we
          WHERE we.eta_seconds <= we.notify_seconds_before
          ORDER BY we.wait_session_id, we.eta_seconds ASC
        )
        UPDATE wait_sessions ws
        SET status = 'ALERTED'::wait_status, alerted_bus_id = b.bus_id
        FROM best b
        WHERE ws.id = b.wait_session_id AND ws.status = 'WAITING'
        RETURNING
          ws.id AS wait_session_id,
          ws.user_id,
          b.bus_id,
          b.route_code,
          b.eta_seconds,
          b.distance_m;
        `,
      );

      for (const m of matches) {
        const ev: WaitSessionAlertEvent = {
          waitSessionId: m.wait_session_id,
          userId: m.user_id,
          busId: m.bus_id,
          routeCode: m.route_code,
          etaSeconds: m.eta_seconds,
          distanceM: m.distance_m,
          timestamp: new Date().toISOString(),
        };
        this.eventBus.emit(InternalEvents.WaitSessionAlert, ev);
        this.alertsEmitted++;
      }

      if (matches.length > 0) {
        this.logger.log(`🔔 alerted ${matches.length} wait session(s)`);
      }
    } catch (err) {
      this.logger.error('Matcher pass failed', err);
    }
  }

  getStats() {
    return { alertsEmitted: this.alertsEmitted };
  }
}
