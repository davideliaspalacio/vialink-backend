import { Injectable, Logger } from '@nestjs/common';
import type { LatLng } from '../../common/types/geo';
import { DiscoveryService } from '../../discovery/discovery.service';
import { GeocodingService } from '../../geocoding/geocoding.service';
import { LandmarksService } from '../../landmarks/landmarks.service';
import { RoutesService } from '../../routes/routes.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Vialink Assistant — handlers for Claude's tool calls.
 *
 * Each method matches one of the tools in `tool-definitions.ts`.
 * Output is always JSON-serializable (Claude gets the result back as a string).
 */
@Injectable()
export class AssistantToolsService {
  private readonly logger = new Logger(AssistantToolsService.name);

  constructor(
    private readonly landmarks: LandmarksService,
    private readonly routes: RoutesService,
    private readonly discovery: DiscoveryService,
    private readonly geocoding: GeocodingService,
    private readonly prisma: PrismaService,
  ) {}

  async find_landmark(input: { query: string }) {
    const result = await this.landmarks.search({
      q: input.query,
      cityCode: 'BAQ',
      limit: 5,
    });
    return {
      results: result.results.map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type,
        lat: r.location.lat,
        lng: r.location.lng,
      })),
    };
  }

  async find_routes_near(input: { lat: number; lng: number; radius_m?: number }) {
    const result = await this.routes.findNearby({
      lat: input.lat,
      lng: input.lng,
      radius_m: input.radius_m ?? 100,
      cityCode: 'BAQ',
    });
    return {
      routes: result.routes.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        mode: r.mode,
        distance_m: r.distance_m,
      })),
    };
  }

  async get_buses_at_point(input: { lat: number; lng: number }) {
    const result = await this.discovery.getBusesAtPoint(
      { lat: input.lat, lng: input.lng },
      100,
      'BAQ',
    );
    return {
      routes: result.routes.map((r) => ({
        route_id: r.route.id,
        // route_display es el campo que el LLM DEBE usar al hablar con
        // el user. route_code es solo identificador interno.
        route_display: r.route.name,
        route_name: r.route.name,
        route_code: r.route.code,
        next_bus: r.next_buses[0]
          ? {
              bus_id: r.next_buses[0].bus_id,
              plate: r.next_buses[0].plate,
              eta_seconds: r.next_buses[0].eta_seconds,
              distance_m: r.next_buses[0].distance_m,
            }
          : null,
        status: r.status,
      })),
    };
  }

  async calculate_trip(input: {
    from_lat: number;
    from_lng: number;
    to_lat: number;
    to_lng: number;
    from_landmark_id?: string;
    to_landmark_id?: string;
  }) {
    // Find routes near `from`
    const fromRoutes = await this.routes.findNearby({
      lat: input.from_lat,
      lng: input.from_lng,
      radius_m: 200,
      cityCode: 'BAQ',
    });

    // For each candidate, check if it also passes near `to` and compute ETA
    const options: {
      route_id: string;
      route_display: string;
      route_code: string;
      route_name: string;
      wait_seconds: number | null;
      in_bus_seconds: number;
      total_seconds: number;
      distance_to_dest_corridor_m: number;
    }[] = [];
    for (const r of fromRoutes.routes.slice(0, 8)) {
      const rows = await this.prisma.$queryRawUnsafe<
        {
          length_m: number;
          from_fraction: number;
          to_fraction: number;
          dist_to_to_m: number;
        }[]
      >(
        `
        SELECT
          rc.length_m,
          ST_LineLocatePoint(rc.path::geometry, ST_SetSRID(ST_MakePoint($2, $3), 4326)) AS from_fraction,
          ST_LineLocatePoint(rc.path::geometry, ST_SetSRID(ST_MakePoint($4, $5), 4326)) AS to_fraction,
          ST_Distance(rc.path, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography) AS dist_to_to_m
        FROM route_corridors rc
        WHERE rc.route_id = $1::uuid;
        `,
        r.id,
        input.from_lng,
        input.from_lat,
        input.to_lng,
        input.to_lat,
      );
      if (rows.length === 0) continue;
      const row = rows[0];
      if (row.dist_to_to_m > 250) continue; // destination not on this route

      // Get the closest incoming bus to `from`
      const busAtFrom = await this.discovery.getBusesAtPoint(
        { lat: input.from_lat, lng: input.from_lng },
        150,
        'BAQ',
      );
      const myRoute = busAtFrom.routes.find((br) => br.route.id === r.id);
      const nextBusEta = myRoute?.next_buses[0]?.eta_seconds ?? null;

      const distanceM = Math.abs((row.to_fraction - row.from_fraction) * row.length_m);
      const inBusSec = Math.round(distanceM / (22 * 1000 / 3600)); // 22 km/h avg
      const totalSec = (nextBusEta ?? 300) + inBusSec; // assume 5min wait if unknown

      options.push({
        route_id: r.id,
        // route_display es el campo "user-facing" que el LLM debe usar.
        // route_code queda solo para referencia interna.
        route_display: r.name,
        route_name: r.name,
        route_code: r.code,
        wait_seconds: nextBusEta,
        in_bus_seconds: inBusSec,
        total_seconds: totalSec,
        distance_to_dest_corridor_m: Math.round(row.dist_to_to_m),
      });
    }

    options.sort((a, b) => a.total_seconds - b.total_seconds);

    return {
      best_option: options[0] ?? null,
      alternatives: options.slice(1, 4),
      message:
        options.length === 0
          ? 'No se encontró una ruta directa entre estos puntos.'
          : undefined,
    };
  }

  async geocode_address(input: { address: string }) {
    try {
      const r = await this.geocoding.geocodeToPoint(input.address);
      return {
        found: true,
        formatted_address: r.formatted_address,
        lat: r.location.lat,
        lng: r.location.lng,
      };
    } catch (err) {
      return {
        found: false,
        error: (err as Error).message ?? 'No se encontró la dirección',
      };
    }
  }

  /**
   * Dispatcher: receives tool name + input, returns result.
   * Throws if tool name unknown.
   */
  async invoke(toolName: string, input: Record<string, unknown>): Promise<unknown> {
    const start = Date.now();
    let result: unknown;
    try {
      switch (toolName) {
        case 'find_landmark':
          result = await this.find_landmark(input as { query: string });
          break;
        case 'find_routes_near':
          result = await this.find_routes_near(
            input as { lat: number; lng: number; radius_m?: number },
          );
          break;
        case 'get_buses_at_point':
          result = await this.get_buses_at_point(
            input as { lat: number; lng: number },
          );
          break;
        case 'calculate_trip':
          result = await this.calculate_trip(
            input as {
              from_lat: number;
              from_lng: number;
              to_lat: number;
              to_lng: number;
            },
          );
          break;
        case 'geocode_address':
          result = await this.geocode_address(input as { address: string });
          break;
        default:
          throw new Error(`Unknown tool: ${toolName}`);
      }
      this.logger.debug(
        `tool ${toolName} (${Date.now() - start}ms): ${JSON.stringify(input).slice(0, 100)}`,
      );
      return result;
    } catch (err) {
      this.logger.error(`tool ${toolName} failed`, err);
      return { error: (err as Error).message };
    }
  }
}
