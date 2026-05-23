import { Injectable, NotFoundException } from '@nestjs/common';
import type { RouteMode } from '@prisma/client';
import { CitiesService } from '../cities/cities.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  parseLineStringWkt,
  type GeoJSONFeature,
} from '../common/types/geo';

export interface RouteListItem {
  id: string;
  code: string;
  name: string;
  color: string;
  mode: RouteMode;
  operator: string | null;
  landmarks_count: number;
  length_km: number | null;
}

interface RouteDetailRow {
  id: string;
  code: string;
  name: string;
  color: string;
  mode: RouteMode;
  operator: string | null;
  length_m: number;
}

export interface RouteLandmarkItem {
  id: string;
  name: string;
  type: string;
  fraction_of_corridor: number;
  distance_to_corridor_m: number;
}

interface CorridorRow {
  wkt: string;
  code: string;
  color: string;
  route_id: string;
}

interface BusRow {
  id: string;
  plate: string;
  lat: number;
  lng: number;
  heading: number | null;
  speed_kmh: number;
  fraction_of_corridor: number;
  last_seen_at: Date;
}

export interface NearbyRouteItem {
  id: string;
  code: string;
  name: string;
  color: string;
  mode: RouteMode;
  distance_m: number;
}

@Injectable()
export class RoutesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cities: CitiesService,
  ) {}

  async list(cityCode: string, mode?: RouteMode) {
    const cityId = await this.cities.getIdByCode(cityCode);

    const rows = await this.prisma.$queryRawUnsafe<RouteListItem[]>(
      `
      SELECT
        r.id, r.code, r.name, r.color, r.mode, r.operator,
        (SELECT COUNT(*)::int FROM route_landmarks rl WHERE rl.route_id = r.id) AS landmarks_count,
        ROUND((rc.length_m / 1000.0)::numeric, 2)::float AS length_km
      FROM routes r
      LEFT JOIN route_corridors rc ON rc.route_id = r.id
      WHERE r.city_id = $1::uuid
        AND r.active = true
        ${mode ? `AND r.mode = '${mode}'::route_mode` : ''}
      ORDER BY r.code ASC;
      `,
      cityId,
    );

    return { routes: rows };
  }

  async findById(id: string) {
    const detailRows = await this.prisma.$queryRawUnsafe<RouteDetailRow[]>(
      `
      SELECT
        r.id, r.code, r.name, r.color, r.mode, r.operator,
        rc.length_m
      FROM routes r
      LEFT JOIN route_corridors rc ON rc.route_id = r.id
      WHERE r.id = $1::uuid;
      `,
      id,
    );
    if (detailRows.length === 0) {
      throw new NotFoundException(`Route ${id} not found`);
    }
    const r = detailRows[0];

    const landmarks = await this.prisma.$queryRawUnsafe<RouteLandmarkItem[]>(
      `
      SELECT
        l.id, l.name, l.type::text AS type,
        rl.fraction_of_corridor,
        rl.distance_to_corridor_m
      FROM route_landmarks rl
      JOIN landmarks l ON l.id = rl.landmark_id
      WHERE rl.route_id = $1::uuid
      ORDER BY rl.fraction_of_corridor ASC;
      `,
      id,
    );

    const [{ count: active_buses_count }] = await this.prisma.$queryRawUnsafe<
      { count: number }[]
    >(
      `SELECT COUNT(*)::int AS count FROM buses WHERE route_id = $1::uuid AND status = 'IN_SERVICE';`,
      id,
    );

    return {
      id: r.id,
      code: r.code,
      name: r.name,
      color: r.color,
      mode: r.mode,
      operator: r.operator,
      length_km: r.length_m ? +(r.length_m / 1000).toFixed(2) : null,
      landmarks,
      active_buses_count,
    };
  }

  async corridorGeoJson(id: string): Promise<GeoJSONFeature> {
    const rows = await this.prisma.$queryRawUnsafe<CorridorRow[]>(
      `
      SELECT
        ST_AsText(rc.path::geometry) AS wkt,
        r.code, r.color, r.id AS route_id
      FROM route_corridors rc
      JOIN routes r ON r.id = rc.route_id
      WHERE r.id = $1::uuid;
      `,
      id,
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Corridor for route ${id} not found`);
    }
    const { wkt, code, color, route_id } = rows[0];
    return {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: parseLineStringWkt(wkt),
      },
      properties: { route_id, code, color },
    };
  }

  async buses(id: string) {
    const rows = await this.prisma.$queryRawUnsafe<BusRow[]>(
      `
      SELECT
        b.id, b.plate,
        ST_Y(b.current_location::geometry) AS lat,
        ST_X(b.current_location::geometry) AS lng,
        b.heading, b.speed_kmh, b.fraction_of_corridor, b.last_seen_at
      FROM buses b
      WHERE b.route_id = $1::uuid
        AND b.status = 'IN_SERVICE'
      ORDER BY b.fraction_of_corridor ASC;
      `,
      id,
    );

    return {
      buses: rows.map((b) => ({
        id: b.id,
        plate: b.plate,
        location: { lat: b.lat, lng: b.lng },
        heading: b.heading,
        speed_kmh: b.speed_kmh,
        fraction_of_corridor: b.fraction_of_corridor,
        last_seen_at: b.last_seen_at,
      })),
    };
  }

  async findNearby(params: { lat: number; lng: number; radius_m: number; cityCode: string }) {
    const cityId = await this.cities.getIdByCode(params.cityCode);

    const rows = await this.prisma.$queryRawUnsafe<NearbyRouteItem[]>(
      `
      SELECT
        r.id, r.code, r.name, r.color, r.mode,
        ST_Distance(rc.path, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)::int AS distance_m
      FROM routes r
      JOIN route_corridors rc ON rc.route_id = r.id
      WHERE r.city_id = $3::uuid
        AND r.active = true
        AND ST_DWithin(rc.path, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $4)
      ORDER BY distance_m ASC;
      `,
      params.lng,
      params.lat,
      cityId,
      params.radius_m,
    );

    return { routes: rows };
  }
}
