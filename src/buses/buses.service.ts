import {
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { LatLng } from '../common/types/geo';
import { parseLineStringWkt } from '../common/types/geo';
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

interface BusDetailRow {
  bus_id: string;
  plate: string;
  bus_lat: number;
  bus_lng: number;
  heading: number | null;
  speed_kmh: number;
  fraction_of_corridor: number;
  bus_status: string;
  last_seen_at: Date;
  route_id: string;
  route_code: string;
  route_name: string;
  route_color: string;
  route_mode: string;
  route_operator: string | null;
  length_m: number;
  polyline_wkt: string;
}

interface NextLandmarkRow {
  id: string;
  name: string;
  type: string;
  lat: number;
  lng: number;
  fraction_of_corridor: number;
}

interface UserFractionRow {
  user_fraction: number;
  nearest_lat: number;
  nearest_lng: number;
}

export interface BusDetailsResponse {
  bus: {
    id: string;
    plate: string;
    location: LatLng;
    heading: number | null;
    speed_kmh: number;
    fraction_of_corridor: number;
    status: string;
    last_seen_at: Date;
  };
  route: {
    id: string;
    code: string;
    name: string;
    color: string;
    mode: string;
    operator: string | null;
    length_km: number;
  };
  polyline: {
    type: 'Feature';
    geometry: { type: 'LineString'; coordinates: [number, number][] };
    properties: { route_id: string; code: string; color: string };
  };
  next_landmark: {
    id: string;
    name: string;
    type: string;
    location: LatLng;
    eta_seconds: number | null;
    distance_m: number;
  } | null;
  eta_to_user: {
    eta_seconds: number | null;
    distance_m: number;
    nearest_corridor_point: LatLng;
  } | null;
  stats: {
    completed_km: number;
    completed_pct: number;
    remaining_km: number;
  };
}

interface CacheEntry {
  expiresAt: number;
  payload: BusDetailsResponse;
}

@Injectable()
export class BusesService {
  private readonly logger = new Logger(BusesService.name);
  private readonly detailsCache = new Map<string, CacheEntry>();
  private readonly CACHE_TTL_MS = 1_000; // 1 second — absorbs rapid re-clicks

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Detailed bus info for the "click on bus" modal in the frontend.
   * Returns bus + route + polyline + next_landmark + optional eta_to_user.
   *
   * Cache: 1s TTL keyed by busId+lat+lng to absorb rapid re-renders
   * without hammering DB. Real-time position still comes via WS bus_position.
   *
   * Errors:
   *   404 if bus does not exist
   *   410 if bus.status !== 'IN_SERVICE'
   */
  async getBusDetails(
    busId: string,
    userLocation?: LatLng,
  ): Promise<BusDetailsResponse> {
    const cacheKey = this.detailsCacheKey(busId, userLocation);
    const now = Date.now();
    const cached = this.detailsCache.get(cacheKey);
    if (cached && cached.expiresAt > now) return cached.payload;

    // 1) Bus + route + corridor in a single query
    const rows = await this.prisma.$queryRawUnsafe<BusDetailRow[]>(
      `
      SELECT
        b.id AS bus_id, b.plate,
        ST_Y(b.current_location::geometry) AS bus_lat,
        ST_X(b.current_location::geometry) AS bus_lng,
        b.heading, b.speed_kmh, b.fraction_of_corridor,
        b.status::text AS bus_status, b.last_seen_at,
        r.id AS route_id, r.code AS route_code, r.name AS route_name,
        r.color AS route_color, r.mode::text AS route_mode,
        r.operator AS route_operator,
        rc.length_m,
        ST_AsText(rc.path::geometry) AS polyline_wkt
      FROM buses b
      JOIN routes r ON r.id = b.route_id
      JOIN route_corridors rc ON rc.route_id = r.id
      WHERE b.id = $1::uuid;
      `,
      busId,
    );

    if (rows.length === 0) {
      throw new NotFoundException(`Bus ${busId} no encontrado`);
    }
    const r = rows[0];

    if (r.bus_status !== 'IN_SERVICE') {
      throw new GoneException('Este bus completó su recorrido o está fuera de servicio');
    }

    // 2) next_landmark = first landmark with fraction > bus.fraction
    const lmRows = await this.prisma.$queryRawUnsafe<NextLandmarkRow[]>(
      `
      SELECT l.id, l.name, l.type::text AS type,
        ST_Y(l.location::geometry) AS lat,
        ST_X(l.location::geometry) AS lng,
        rl.fraction_of_corridor
      FROM route_landmarks rl
      JOIN landmarks l ON l.id = rl.landmark_id
      WHERE rl.route_id = $1::uuid
        AND rl.fraction_of_corridor > $2::float
      ORDER BY rl.fraction_of_corridor ASC
      LIMIT 1;
      `,
      r.route_id,
      r.fraction_of_corridor,
    );

    let nextLandmark: BusDetailsResponse['next_landmark'] = null;
    if (lmRows.length > 0) {
      const lm = lmRows[0];
      const distanceM = (lm.fraction_of_corridor - r.fraction_of_corridor) * r.length_m;
      nextLandmark = {
        id: lm.id,
        name: lm.name,
        type: lm.type,
        location: { lat: lm.lat, lng: lm.lng },
        eta_seconds: this.computeEta(distanceM, r.speed_kmh),
        distance_m: Math.round(distanceM),
      };
    }

    // 3) eta_to_user if location provided AND user hasn't been passed
    let etaToUser: BusDetailsResponse['eta_to_user'] = null;
    if (userLocation) {
      const userRows = await this.prisma.$queryRawUnsafe<UserFractionRow[]>(
        `
        SELECT
          ST_LineLocatePoint(rc.path::geometry,
            ST_SetSRID(ST_MakePoint($2, $3), 4326)) AS user_fraction,
          ST_Y(ST_ClosestPoint(rc.path::geometry,
            ST_SetSRID(ST_MakePoint($2, $3), 4326))::geometry) AS nearest_lat,
          ST_X(ST_ClosestPoint(rc.path::geometry,
            ST_SetSRID(ST_MakePoint($2, $3), 4326))::geometry) AS nearest_lng
        FROM route_corridors rc WHERE rc.route_id = $1::uuid;
        `,
        r.route_id,
        userLocation.lng,
        userLocation.lat,
      );

      if (userRows.length > 0 && userRows[0].user_fraction > r.fraction_of_corridor) {
        const distanceM = (userRows[0].user_fraction - r.fraction_of_corridor) * r.length_m;
        etaToUser = {
          eta_seconds: this.computeEta(distanceM, r.speed_kmh),
          distance_m: Math.round(distanceM),
          nearest_corridor_point: {
            lat: userRows[0].nearest_lat,
            lng: userRows[0].nearest_lng,
          },
        };
      }
    }

    // 4) Polyline + stats
    const polylineCoords = parseLineStringWkt(r.polyline_wkt);
    const totalKm = r.length_m / 1000;
    const completedKm = r.fraction_of_corridor * totalKm;

    const payload: BusDetailsResponse = {
      bus: {
        id: r.bus_id,
        plate: r.plate,
        location: { lat: r.bus_lat, lng: r.bus_lng },
        heading: r.heading,
        speed_kmh: r.speed_kmh,
        fraction_of_corridor: r.fraction_of_corridor,
        status: r.bus_status,
        last_seen_at: r.last_seen_at,
      },
      route: {
        id: r.route_id,
        code: r.route_code,
        name: r.route_name,
        color: r.route_color,
        mode: r.route_mode,
        operator: r.route_operator,
        length_km: +(r.length_m / 1000).toFixed(2),
      },
      polyline: {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: polylineCoords },
        properties: {
          route_id: r.route_id,
          code: r.route_code,
          color: r.route_color,
        },
      },
      next_landmark: nextLandmark,
      eta_to_user: etaToUser,
      stats: {
        completed_km: +completedKm.toFixed(2),
        completed_pct: +r.fraction_of_corridor.toFixed(3),
        remaining_km: +(totalKm - completedKm).toFixed(2),
      },
    };

    this.detailsCache.set(cacheKey, {
      expiresAt: now + this.CACHE_TTL_MS,
      payload,
    });

    // Light GC
    if (this.detailsCache.size > 500) {
      for (const [k, v] of this.detailsCache) {
        if (v.expiresAt <= now) this.detailsCache.delete(k);
      }
    }

    return payload;
  }

  private computeEta(distanceM: number, speedKmh: number): number | null {
    if (speedKmh <= 1) return null;
    return Math.round(distanceM / ((speedKmh * 1000) / 3600));
  }

  private detailsCacheKey(busId: string, loc?: LatLng): string {
    if (!loc) return busId;
    return `${busId}:${loc.lat.toFixed(4)}:${loc.lng.toFixed(4)}`;
  }

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
