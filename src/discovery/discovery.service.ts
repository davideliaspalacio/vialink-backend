import { Injectable, Logger } from '@nestjs/common';
import type { RouteMode } from '@prisma/client';
import { CitiesService } from '../cities/cities.service';
import type { LatLng } from '../common/types/geo';
import { PrismaService } from '../prisma/prisma.service';

interface BusesAtPointRow {
  route_id: string;
  route_code: string;
  route_name: string;
  route_color: string;
  route_mode: RouteMode;
  route_operator: string | null;
  distance_to_corridor_m: number;
  my_fraction: number;
  next_buses_json: NextBusJson[] | null;
  active_buses_count: number;
}

interface NextBusJson {
  bus_id: string;
  plate: string;
  fraction_of_corridor: number;
  speed_kmh: number;
  distance_m: number;
  eta_seconds: number | null;
  lat: number;
  lng: number;
}

interface CachedEntry {
  expiresAt: number;
  payload: Awaited<ReturnType<DiscoveryService['runQuery']>>;
}

/**
 * Vialink — Discovery service.
 *
 * The heart of the product:
 *   getBusesAtPoint(point) → routes whose corridor passes within radius_m,
 *   each with its next incoming buses + ETA to the user's exact point.
 *
 * In-memory cache (TTL 3s) keyed by (rounded lat/lng + radius) because the
 * frontend map triggers this on every viewport change.
 */
@Injectable()
export class DiscoveryService {
  private readonly logger = new Logger(DiscoveryService.name);
  private readonly cacheTtlMs = 3_000;
  private readonly cache = new Map<string, CachedEntry>();
  private cacheHits = 0;
  private cacheMisses = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cities: CitiesService,
  ) {}

  async getBusesAtPoint(
    location: LatLng,
    radius_m: number,
    cityCode: string,
  ) {
    const key = this.cacheKey(location, radius_m, cityCode);
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > now) {
      this.cacheHits++;
      return cached.payload;
    }
    this.cacheMisses++;

    const payload = await this.runQuery(location, radius_m, cityCode);
    this.cache.set(key, { expiresAt: now + this.cacheTtlMs, payload });

    // Light GC: drop expired entries when cache grows
    if (this.cache.size > 1000) {
      for (const [k, v] of this.cache) {
        if (v.expiresAt <= now) this.cache.delete(k);
      }
    }

    return payload;
  }

  private async runQuery(
    location: LatLng,
    radius_m: number,
    cityCode: string,
  ) {
    const cityId = await this.cities.getIdByCode(cityCode);

    const rows = await this.prisma.$queryRawUnsafe<BusesAtPointRow[]>(
      `
      WITH nearby AS (
        SELECT
          r.id AS route_id,
          r.code AS route_code,
          r.name AS route_name,
          r.color AS route_color,
          r.mode AS route_mode,
          r.operator AS route_operator,
          rc.length_m,
          rc.path,
          ST_Distance(rc.path, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)::int AS distance_to_corridor_m,
          ST_LineLocatePoint(rc.path::geometry, ST_SetSRID(ST_MakePoint($1, $2), 4326)) AS my_fraction
        FROM routes r
        JOIN route_corridors rc ON rc.route_id = r.id
        WHERE r.city_id = $3::uuid
          AND r.active = true
          AND ST_DWithin(rc.path, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $4)
      )
      SELECT
        n.route_id, n.route_code, n.route_name, n.route_color,
        n.route_mode, n.route_operator,
        n.distance_to_corridor_m,
        n.my_fraction::float,
        (
          SELECT json_agg(b_row ORDER BY b_row.eta_seconds NULLS LAST)
          FROM (
            SELECT
              b.id AS bus_id,
              b.plate,
              b.fraction_of_corridor::float,
              b.speed_kmh::float,
              ((n.my_fraction - b.fraction_of_corridor) * n.length_m)::int AS distance_m,
              CASE
                WHEN b.speed_kmh > 1
                  THEN (((n.my_fraction - b.fraction_of_corridor) * n.length_m)
                        / (b.speed_kmh * 1000.0 / 3600.0))::int
                ELSE NULL
              END AS eta_seconds,
              ST_Y(b.current_location::geometry) AS lat,
              ST_X(b.current_location::geometry) AS lng
            FROM buses b
            WHERE b.route_id = n.route_id
              AND b.status = 'IN_SERVICE'
              AND b.fraction_of_corridor < n.my_fraction
              AND b.last_seen_at > NOW() - INTERVAL '5 minutes'
            ORDER BY (n.my_fraction - b.fraction_of_corridor) ASC
            LIMIT 3
          ) b_row
        ) AS next_buses_json,
        (SELECT COUNT(*)::int FROM buses b WHERE b.route_id = n.route_id AND b.status = 'IN_SERVICE') AS active_buses_count
      FROM nearby n
      ORDER BY n.distance_to_corridor_m ASC;
      `,
      location.lng,
      location.lat,
      cityId,
      radius_m,
    );

    return {
      location,
      routes: rows.map((row) => {
        const nextBuses = (row.next_buses_json ?? []).map((b) => ({
          bus_id: b.bus_id,
          plate: b.plate,
          eta_seconds: b.eta_seconds,
          distance_m: b.distance_m,
          current_location: { lat: b.lat, lng: b.lng },
        }));
        const minutesSinceLast = Number.POSITIVE_INFINITY; // placeholder for frequency calc later
        const status =
          row.active_buses_count === 0
            ? 'OFFLINE'
            : nextBuses.length === 0
            ? 'LOW_FREQUENCY'
            : nextBuses[0].eta_seconds !== null && nextBuses[0].eta_seconds > 900
            ? 'LOW_FREQUENCY'
            : 'OPERATING';

        return {
          route: {
            id: row.route_id,
            code: row.route_code,
            color: row.route_color,
            name: row.route_name,
            mode: row.route_mode,
            operator: row.route_operator,
          },
          distance_to_corridor_m: row.distance_to_corridor_m,
          next_buses: nextBuses,
          status,
        };
      }),
    };
  }

  private cacheKey(location: LatLng, radius_m: number, cityCode: string) {
    // Round to ~11m precision (4 decimals at lat ~11°)
    const lat = Math.round(location.lat * 10000) / 10000;
    const lng = Math.round(location.lng * 10000) / 10000;
    return `${cityCode}:${lat}:${lng}:${radius_m}`;
  }

  getCacheStats() {
    const total = this.cacheHits + this.cacheMisses;
    return {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: total === 0 ? 0 : +(this.cacheHits / total).toFixed(3),
      entries: this.cache.size,
      ttlMs: this.cacheTtlMs,
    };
  }
}
