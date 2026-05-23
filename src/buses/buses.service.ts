import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface BusListRow {
  id: string;
  plate: string;
  route_id: string;
  route_code: string;
  lat: number;
  lng: number;
  heading: number | null;
  speed_kmh: number;
  fraction_of_corridor: number;
  last_seen_at: Date;
  status: string;
}

@Injectable()
export class BusesService {
  constructor(private readonly prisma: PrismaService) {}

  async listAllInService(cityCode = 'BAQ') {
    return this.prisma.$queryRawUnsafe<BusListRow[]>(
      `
      SELECT
        b.id, b.plate, b.route_id,
        r.code AS route_code,
        ST_Y(b.current_location::geometry) AS lat,
        ST_X(b.current_location::geometry) AS lng,
        b.heading, b.speed_kmh, b.fraction_of_corridor,
        b.last_seen_at, b.status::text AS status
      FROM buses b
      JOIN routes r ON r.id = b.route_id
      JOIN cities c ON c.id = r.city_id
      WHERE b.status = 'IN_SERVICE'
        AND c.code = $1;
      `,
      cityCode.toUpperCase(),
    );
  }

  async countInService(): Promise<number> {
    const rows = await this.prisma.$queryRawUnsafe<{ count: number }[]>(
      `SELECT COUNT(*)::int AS count FROM buses WHERE status = 'IN_SERVICE';`,
    );
    return rows[0]?.count ?? 0;
  }
}
