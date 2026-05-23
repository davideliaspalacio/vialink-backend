import { Injectable, NotFoundException } from '@nestjs/common';
import type { LandmarkType } from '@prisma/client';
import { CitiesService } from '../cities/cities.service';
import { PrismaService } from '../prisma/prisma.service';

interface NearbyLandmarkRow {
  id: string;
  name: string;
  type: LandmarkType;
  lat: number;
  lng: number;
  distance_m: number;
  routes_passing_count: number;
}

interface LandmarkDetailRow {
  id: string;
  name: string;
  type: LandmarkType;
  address: string | null;
  lat: number;
  lng: number;
}

interface RouteForLandmark {
  id: string;
  code: string;
  name: string;
  color: string;
  mode: string;
  distance_to_corridor_m: number;
}

interface SearchRow {
  id: string;
  name: string;
  type: LandmarkType;
  lat: number;
  lng: number;
  similarity: number;
}

@Injectable()
export class LandmarksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cities: CitiesService,
  ) {}

  async findNearby(params: {
    lat: number;
    lng: number;
    radius_m: number;
    limit: number;
    cityCode?: string;
  }) {
    const cityId = await this.cities.getIdByCode(params.cityCode ?? 'BAQ');

    const rows = await this.prisma.$queryRawUnsafe<NearbyLandmarkRow[]>(
      `
      SELECT
        l.id,
        l.name,
        l.type,
        ST_Y(l.location::geometry) AS lat,
        ST_X(l.location::geometry) AS lng,
        ST_Distance(l.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)::int AS distance_m,
        (SELECT COUNT(*)::int FROM route_landmarks rl WHERE rl.landmark_id = l.id) AS routes_passing_count
      FROM landmarks l
      WHERE l.city_id = $3::uuid
        AND ST_DWithin(l.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $4)
      ORDER BY distance_m ASC
      LIMIT $5;
      `,
      params.lng,
      params.lat,
      cityId,
      params.radius_m,
      params.limit,
    );

    return {
      landmarks: rows.map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type,
        location: { lat: r.lat, lng: r.lng },
        distance_m: r.distance_m,
        routes_passing_count: r.routes_passing_count,
      })),
    };
  }

  async findById(id: string) {
    const detailRows = await this.prisma.$queryRawUnsafe<LandmarkDetailRow[]>(
      `
      SELECT
        id, name, type, address,
        ST_Y(location::geometry) AS lat,
        ST_X(location::geometry) AS lng
      FROM landmarks WHERE id = $1::uuid;
      `,
      id,
    );
    if (detailRows.length === 0) {
      throw new NotFoundException(`Landmark ${id} not found`);
    }
    const l = detailRows[0];

    const routes = await this.prisma.$queryRawUnsafe<RouteForLandmark[]>(
      `
      SELECT
        r.id, r.code, r.name, r.color, r.mode::text AS mode,
        rl.distance_to_corridor_m
      FROM route_landmarks rl
      JOIN routes r ON r.id = rl.route_id
      WHERE rl.landmark_id = $1::uuid
        AND r.active = true
      ORDER BY rl.distance_to_corridor_m ASC;
      `,
      id,
    );

    return {
      id: l.id,
      name: l.name,
      type: l.type,
      address: l.address,
      location: { lat: l.lat, lng: l.lng },
      routes: routes.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        color: r.color,
        mode: r.mode,
        distance_to_corridor_m: r.distance_to_corridor_m,
        // status will be enriched by BusEngine info later (Bloque 2.C)
        status: 'OPERATING' as const,
      })),
    };
  }

  async search(params: { q: string; cityCode?: string; limit: number }) {
    const cityId = await this.cities.getIdByCode(params.cityCode ?? 'BAQ');

    const rows = await this.prisma.$queryRawUnsafe<SearchRow[]>(
      `
      SELECT
        id, name, type,
        ST_Y(location::geometry) AS lat,
        ST_X(location::geometry) AS lng,
        similarity(name, $1) AS similarity
      FROM landmarks
      WHERE city_id = $2::uuid
        AND (name ILIKE '%' || $1 || '%' OR similarity(name, $1) > 0.2)
      ORDER BY similarity DESC, name ASC
      LIMIT $3;
      `,
      params.q,
      cityId,
      params.limit,
    );

    return {
      results: rows.map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type,
        location: { lat: r.lat, lng: r.lng },
      })),
    };
  }
}
