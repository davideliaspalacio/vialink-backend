import { Injectable, NotFoundException } from '@nestjs/common';
import type { LatLng } from '../common/types/geo';
import { PrismaService } from '../prisma/prisma.service';

interface WaitSessionRow {
  id: string;
  user_id: string;
  route_id: string | null;
  route_code: string | null;
  route_color: string | null;
  lat: number;
  lng: number;
  notify_seconds_before: number;
  status: string;
  started_at: Date;
}

@Injectable()
export class WaitSessionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(params: {
    userId: string;
    location: LatLng;
    routeId?: string;
    notifySecondsBefore?: number;
  }) {
    const rows = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `
      INSERT INTO wait_sessions (
        id, user_id, route_id, wait_location,
        notify_seconds_before, status, started_at
      )
      VALUES (
        gen_random_uuid(),
        $1::uuid,
        $2::uuid,
        ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography,
        $5,
        'WAITING'::wait_status,
        NOW()
      )
      RETURNING id;
      `,
      params.userId,
      params.routeId ?? null,
      params.location.lng,
      params.location.lat,
      params.notifySecondsBefore ?? 180,
    );

    return this.findById(rows[0].id, params.userId);
  }

  async cancel(id: string, userId: string) {
    const result = await this.prisma.$executeRawUnsafe(
      `
      UPDATE wait_sessions
      SET status = 'CANCELLED'::wait_status, ended_at = NOW()
      WHERE id = $1::uuid AND user_id = $2::uuid AND status = 'WAITING'::wait_status;
      `,
      id,
      userId,
    );
    if (result === 0) {
      throw new NotFoundException('Active wait session not found');
    }
    return { cancelled: true };
  }

  async findById(id: string, userId: string) {
    const rows = await this.prisma.$queryRawUnsafe<WaitSessionRow[]>(
      `
      SELECT
        ws.id, ws.user_id, ws.route_id,
        r.code AS route_code, r.color AS route_color,
        ST_Y(ws.wait_location::geometry) AS lat,
        ST_X(ws.wait_location::geometry) AS lng,
        ws.notify_seconds_before, ws.status::text AS status, ws.started_at
      FROM wait_sessions ws
      LEFT JOIN routes r ON r.id = ws.route_id
      WHERE ws.id = $1::uuid AND ws.user_id = $2::uuid;
      `,
      id,
      userId,
    );
    if (rows.length === 0) {
      throw new NotFoundException('Wait session not found');
    }
    const w = rows[0];
    return {
      id: w.id,
      location: { lat: w.lat, lng: w.lng },
      route: w.route_id
        ? { id: w.route_id, code: w.route_code, color: w.route_color }
        : null,
      notify_seconds_before: w.notify_seconds_before,
      status: w.status,
      started_at: w.started_at,
    };
  }
}
