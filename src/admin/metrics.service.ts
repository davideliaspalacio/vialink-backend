import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { CitiesService } from '../cities/cities.service';
import type { AppConfig } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import {
  InternalEvents,
  type MetricsUpdateEvent,
} from '../realtime/realtime-events';
import { RealtimeEventBus } from '../realtime/realtime-event-bus.service';

export interface AppMetrics {
  active_users: number;
  active_trips: number;
  ai_questions_per_minute: number;
  incidents_last_hour: number;
  buses_in_service: number;
  active_wait_sessions: number;
}

interface SnapshotRow {
  active_trips: number;
  ai_questions_per_minute: number;
  incidents_last_hour: number;
  buses_in_service: number;
  active_wait_sessions: number;
}

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);
  private readonly cityCode: string;
  private lastSnapshot: AppMetrics | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: RealtimeEventBus,
    private readonly gateway: RealtimeGateway,
    private readonly cities: CitiesService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.cityCode = 'BAQ';
  }

  @Interval('metrics-broadcast', 2000)
  async tick() {
    try {
      const metrics = await this.snapshot();
      this.lastSnapshot = metrics;

      const ev: MetricsUpdateEvent = {
        cityCode: this.cityCode,
        metrics: {
          activeUsers: metrics.active_users,
          activeTrips: metrics.active_trips,
          aiQuestionsPerMinute: metrics.ai_questions_per_minute,
          incidentsLastHour: metrics.incidents_last_hour,
          busesInService: metrics.buses_in_service,
        },
        timestamp: new Date().toISOString(),
      };
      this.eventBus.emit(InternalEvents.MetricsUpdate, ev);
    } catch (err) {
      this.logger.error('Metrics tick failed', err);
    }
  }

  async snapshot(): Promise<AppMetrics> {
    // Single query: 5 aggregates in one round-trip
    const [row] = await this.prisma.$queryRawUnsafe<SnapshotRow[]>(
      `
      SELECT
        (SELECT COUNT(*)::int FROM trips WHERE status = 'IN_PROGRESS') AS active_trips,
        (SELECT COUNT(*)::int FROM assistant_messages WHERE created_at > NOW() - INTERVAL '60 seconds') AS ai_questions_per_minute,
        (SELECT COUNT(*)::int FROM incidents WHERE reported_at > NOW() - INTERVAL '1 hour') AS incidents_last_hour,
        (SELECT COUNT(*)::int FROM buses WHERE status = 'IN_SERVICE' AND last_seen_at > NOW() - INTERVAL '5 minutes') AS buses_in_service,
        (SELECT COUNT(*)::int FROM wait_sessions WHERE status = 'WAITING') AS active_wait_sessions;
      `,
    );

    // Active users = WS connections in city room
    const stats = this.gateway.getStats();
    const activeUsers =
      stats.rooms.find((r) => r.room === `city:${this.cityCode}`)?.clients ?? 0;

    return {
      active_users: activeUsers,
      active_trips: row.active_trips,
      ai_questions_per_minute: row.ai_questions_per_minute,
      incidents_last_hour: row.incidents_last_hour,
      buses_in_service: row.buses_in_service,
      active_wait_sessions: row.active_wait_sessions,
    };
  }

  getLastSnapshot(): AppMetrics | null {
    return this.lastSnapshot;
  }
}
