import { Injectable } from '@nestjs/common';
import type { IncidentType } from '@prisma/client';
import { CitiesService } from '../cities/cities.service';
import type { LatLng } from '../common/types/geo';
import { PrismaService } from '../prisma/prisma.service';
import {
  InternalEvents,
  type IncidentReportedEvent,
} from '../realtime/realtime-events';
import { RealtimeEventBus } from '../realtime/realtime-event-bus.service';

interface IncidentRow {
  id: string;
  type: IncidentType;
  route_id: string | null;
  route_code: string | null;
  lat: number;
  lng: number;
  description: string | null;
  reported_at: Date;
  reporter_name: string | null;
}

@Injectable()
export class IncidentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cities: CitiesService,
    private readonly eventBus: RealtimeEventBus,
  ) {}

  async report(params: {
    userId: string | null;
    type: IncidentType;
    location: LatLng;
    routeId?: string;
    description?: string;
    cityCode?: string;
  }) {
    // Always pass all 6 params; NULL on the SQL side handles missing values.
    const rows = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `
      INSERT INTO incidents (id, user_id, route_id, type, location, description, reported_at)
      VALUES (
        gen_random_uuid(),
        $1::uuid,
        $2::uuid,
        $3::incident_type,
        ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography,
        $6,
        NOW()
      )
      RETURNING id;
      `,
      params.userId,
      params.routeId ?? null,
      params.type,
      params.location.lng,
      params.location.lat,
      params.description ?? null,
    );

    const incidentId = rows[0].id;

    const ev: IncidentReportedEvent = {
      incidentId,
      incidentType: params.type,
      routeId: params.routeId ?? null,
      cityCode: (params.cityCode ?? 'BAQ').toUpperCase(),
      location: params.location,
      timestamp: new Date().toISOString(),
    };
    this.eventBus.emit(InternalEvents.IncidentReported, ev);

    return { id: incidentId, type: params.type, location: params.location };
  }

  async nearby(params: {
    location: LatLng;
    radiusM: number;
    sinceMinutes: number;
  }) {
    const rows = await this.prisma.$queryRawUnsafe<IncidentRow[]>(
      `
      SELECT
        i.id, i.type, i.route_id, r.code AS route_code,
        ST_Y(i.location::geometry) AS lat,
        ST_X(i.location::geometry) AS lng,
        i.description, i.reported_at,
        p.name AS reporter_name
      FROM incidents i
      LEFT JOIN routes r ON r.id = i.route_id
      LEFT JOIN profiles p ON p.id = i.user_id
      WHERE ST_DWithin(i.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
        AND i.reported_at > NOW() - ($4 || ' minutes')::interval
      ORDER BY i.reported_at DESC
      LIMIT 100;
      `,
      params.location.lng,
      params.location.lat,
      params.radiusM,
      String(params.sinceMinutes),
    );

    return {
      incidents: rows.map((i) => ({
        id: i.id,
        type: i.type,
        route: i.route_id
          ? { id: i.route_id, code: i.route_code }
          : null,
        location: { lat: i.lat, lng: i.lng },
        description: i.description,
        reported_at: i.reported_at,
        reporter_name: i.reporter_name,
      })),
    };
  }
}
