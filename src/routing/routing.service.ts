import { Injectable, Logger } from '@nestjs/common';
import type { LatLng } from '../common/types/geo';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Vialink — Routing engine.
 *
 * Dado (user_location, destination), encuentra las mejores combinaciones
 * de (paradero abordaje, ruta, bus específico, paradero descenso) y las
 * rankea por tiempo total puerta-a-puerta.
 *
 * Modelo:
 *   total = walk_to_board + wait_bus + ride_in_bus + walk_from_alight
 *
 * Las dos caminatas son aproximadas como línea recta (Phase 6 podría
 * usar Mapbox Directions walking para precisión). 1 cuadra Barranquilla
 * ≈ 100m, velocidad ~80m/min (1.3 m/s).
 */

const WALK_SPEED_M_PER_MIN = 80;
const BLOCK_LENGTH_M = 100;
const MIN_WAIT_SECONDS = 30; // si el bus está justo encima del paradero

interface CandidateRow {
  board_landmark_id: string;
  board_landmark_name: string;
  board_lat: number;
  board_lng: number;
  walk_to_board_m: number;
  route_id: string;
  route_code: string;
  route_name: string;
  route_color: string;
  length_m: number;
  board_fraction: number;
  alight_landmark_id: string;
  alight_landmark_name: string;
  alight_lat: number;
  alight_lng: number;
  walk_from_alight_m: number;
  alight_fraction: number;
}

interface BusOnRouteRow {
  id: string;
  plate: string;
  fraction_of_corridor: number;
  speed_kmh: number;
  direction: number;
}

interface PolylinePointRow {
  lat: number;
  lng: number;
}

export interface RouteRecommendation {
  rank: number;
  total_minutes: number;
  walking_to_board: {
    paradero: { id: string; name: string; lat: number; lng: number };
    distance_m: number;
    blocks: number;
    duration_minutes: number;
  };
  bus: {
    id: string;
    plate: string;
    route_id: string;
    route_code: string;
    route_name: string;
    route_color: string;
    wait_minutes: number;
    ride_minutes: number;
  };
  walking_from_alight: {
    paradero: { id: string; name: string; lat: number; lng: number };
    distance_m: number;
    blocks: number;
    duration_minutes: number;
  };
  /** Polyline del tramo en bus (board → alight) para dibujar en el mapa. */
  polyline_bus: { lat: number; lng: number }[];
}

@Injectable()
export class RoutingService {
  private readonly logger = new Logger(RoutingService.name);

  constructor(private readonly prisma: PrismaService) {}

  async recommend(params: {
    userLocation: LatLng;
    destination: LatLng;
    maxWalkingM: number;
    maxAlternatives: number;
  }): Promise<{
    user_location: LatLng;
    destination: LatLng;
    recommendations: RouteRecommendation[];
    generated_at: string;
  }> {
    const start = Date.now();

    // Step 1: SQL composite — encuentra todos los triples (board, route, alight)
    // viables. Cada fila tiene la info del paradero de abordaje, la ruta, y el
    // mejor paradero de descenso sobre esa misma ruta cerca del destino.
    const candidates = await this.findCandidates(params);

    if (candidates.length === 0) {
      this.logger.log(
        `No candidates found within ${params.maxWalkingM}m of user/dest`,
      );
      return {
        user_location: params.userLocation,
        destination: params.destination,
        recommendations: [],
        generated_at: new Date().toISOString(),
      };
    }

    // Step 2: para cada candidato, busca el siguiente bus que llega al paradero
    // de abordaje. Computa wait + ride. Aborta candidatos sin bus disponible.
    const enriched: Array<{
      candidate: CandidateRow;
      bus: BusOnRouteRow;
      waitSeconds: number;
      rideSeconds: number;
      totalSeconds: number;
      /**
       * Score de ranking: igual a totalSeconds pero con un PENALTY
       * extra sobre el wait time. La espera se percibe psicológicamente
       * mucho peor que el viaje en bus (el user está parado, no avanza).
       * Multiplicar wait × 1.5 hace que el algoritmo prefiera rutas
       * donde el bus está más cerca aunque el viaje en bus sea más largo.
       * El user NO ve este número, solo lo usa para ordenar.
       */
      rankScore: number;
    }> = [];

    /** Factor de penalización del wait time en el ranking. 1.5 = 50% extra
     *  peso al wait. Si el bus está a 23 min, el ranking lo trata como 34 min
     *  efectivos, lo cual baja drásticamente las opciones con buses lejanos. */
    const WAIT_PENALTY = 1.5;

    for (const c of candidates) {
      const bus = await this.findNextBus(c.route_id, c.board_fraction);
      if (!bus) continue;

      const waitSeconds = this.computeBusEtaToBoard(bus, c);
      const rideSeconds = this.computeRideSeconds(bus.speed_kmh, c);
      const walkToBoardSec = Math.ceil(
        (c.walk_to_board_m / WALK_SPEED_M_PER_MIN) * 60,
      );
      const walkFromAlightSec = Math.ceil(
        (c.walk_from_alight_m / WALK_SPEED_M_PER_MIN) * 60,
      );

      // Si el bus llega ANTES de que el user pueda caminar al paradero, el
      // bus se va sin él. Sumamos al menos walkToBoardSec como floor del wait.
      const effectiveWaitSec = Math.max(waitSeconds, walkToBoardSec);

      const totalSec =
        walkToBoardSec + effectiveWaitSec + rideSeconds + walkFromAlightSec;

      // Score de ranking con penalty al wait
      const rankScore =
        walkToBoardSec +
        effectiveWaitSec * WAIT_PENALTY +
        rideSeconds +
        walkFromAlightSec;

      enriched.push({
        candidate: c,
        bus,
        waitSeconds: effectiveWaitSec - walkToBoardSec, // wait NETO desde que llegó
        rideSeconds,
        totalSeconds: totalSec,
        rankScore,
      });
    }

    if (enriched.length === 0) {
      this.logger.log(
        `${candidates.length} candidates but no buses available on any of them`,
      );
      return {
        user_location: params.userLocation,
        destination: params.destination,
        recommendations: [],
        generated_at: new Date().toISOString(),
      };
    }

    // Step 3: ranking dual.
    //
    //   PRIMARY (rank 1):     mejor rankScore (total con wait penalty)
    //                         = "el mejor viaje overall"
    //   ALTERNATIVAS (2+):    ordenadas por walk_to_board_m ASC
    //                         = "las rutas que pasan más cerca de VOS"
    //
    // Esto refleja el pedido del user: las alternativas mostradas deben
    // ser las que pasan más cerca de ÉL, no las próximas mejores en
    // tiempo total. El user quiere ver visualmente "todos estos buses
    // pasan cerquita, cualquiera me sirve".
    enriched.sort((a, b) => a.rankScore - b.rankScore);
    const primary = enriched[0];
    const rest = enriched.slice(1);
    // Re-sort el resto por proximidad al user (walk_to_board ASC).
    rest.sort(
      (a, b) =>
        a.candidate.walk_to_board_m - b.candidate.walk_to_board_m,
    );

    const seenRoutes = new Set<string>();
    const top: typeof enriched = [];
    if (primary) {
      top.push(primary);
      seenRoutes.add(primary.candidate.route_id);
    }
    for (const e of rest) {
      if (seenRoutes.has(e.candidate.route_id)) continue;
      seenRoutes.add(e.candidate.route_id);
      top.push(e);
      if (top.length >= params.maxAlternatives) break;
    }

    // Step 4: para cada top, traemos el polyline del tramo bus
    const recommendations: RouteRecommendation[] = [];
    for (let i = 0; i < top.length; i++) {
      const t = top[i];
      const polyline = await this.fetchBusSegmentPolyline(
        t.candidate.route_id,
        t.candidate.board_fraction,
        t.candidate.alight_fraction,
      );

      recommendations.push(
        this.composeRecommendation(i + 1, t, polyline),
      );
    }

    const elapsed = Date.now() - start;
    this.logger.log(
      `recommend: ${candidates.length} candidates → ${enriched.length} viable → top ${recommendations.length} in ${elapsed}ms`,
    );

    return {
      user_location: params.userLocation,
      destination: params.destination,
      recommendations,
      generated_at: new Date().toISOString(),
    };
  }

  // -------- Internals --------

  private async findCandidates(params: {
    userLocation: LatLng;
    destination: LatLng;
    maxWalkingM: number;
  }): Promise<CandidateRow[]> {
    // Una ruta es CANDIDATA si tiene paraderos servibles cerca del user
    // Y cerca del destino. "Cerca" para el paradero es max_walking_m.
    // "Cerca" para el corridor es 2x (algunas paraderos están a 200-600m
    // del corridor pero igual son válidos puntos de abordaje).
    const corridorRadius = Math.round(params.maxWalkingM * 2);

    return this.prisma.$queryRawUnsafe<CandidateRow[]>(
      `
      WITH
      user_pt AS (
        SELECT ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography AS g
      ),
      dest_pt AS (
        SELECT ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography AS g
      ),
      -- Rutas que pasan por el área general (corridor a ≤2× walking),
      -- O que tienen al menos un paradero registrado cerca del user.
      -- Damos preferencia a las que también pasan cerca del destino.
      nearby_routes AS (
        SELECT DISTINCT r.id AS route_id, r.code, r.name, r.color, rc.length_m
        FROM routes r
        JOIN route_corridors rc ON rc.route_id = r.id
        CROSS JOIN user_pt
        CROSS JOIN dest_pt
        WHERE r.active = true
          AND ST_DWithin(rc.path, user_pt.g, ${corridorRadius})
          AND ST_DWithin(rc.path, dest_pt.g, ${corridorRadius})
      )
      SELECT
        board.landmark_id AS board_landmark_id,
        board.name AS board_landmark_name,
        board.lat AS board_lat,
        board.lng AS board_lng,
        board.walk_m AS walk_to_board_m,
        nr.route_id,
        nr.code AS route_code,
        nr.name AS route_name,
        nr.color AS route_color,
        nr.length_m,
        board.fraction AS board_fraction,
        alight.landmark_id AS alight_landmark_id,
        alight.name AS alight_landmark_name,
        alight.lat AS alight_lat,
        alight.lng AS alight_lng,
        alight.walk_m AS walk_from_alight_m,
        alight.fraction AS alight_fraction
      FROM nearby_routes nr
      CROSS JOIN user_pt
      CROSS JOIN dest_pt
      JOIN LATERAL (
        -- Mejor paradero de abordaje: cualquier paradero registrado en
        -- esta ruta dentro del walking radius del user.
        SELECT
          rl.landmark_id, l.name,
          ST_Y(l.location::geometry) AS lat,
          ST_X(l.location::geometry) AS lng,
          ST_Distance(l.location, user_pt.g) AS walk_m,
          rl.fraction_of_corridor AS fraction
        FROM route_landmarks rl
        JOIN landmarks l ON l.id = rl.landmark_id
        WHERE rl.route_id = nr.route_id
          AND ST_DWithin(l.location, user_pt.g, $5)
        ORDER BY ST_Distance(l.location, user_pt.g)
        LIMIT 1
      ) board ON true
      JOIN LATERAL (
        -- Mejor paradero de descenso: dentro del walking radius del dest,
        -- y DESPUÉS del board en el corridor (para que el bus llegue allá).
        SELECT
          rl2.landmark_id, l2.name,
          ST_Y(l2.location::geometry) AS lat,
          ST_X(l2.location::geometry) AS lng,
          ST_Distance(l2.location, dest_pt.g) AS walk_m,
          rl2.fraction_of_corridor AS fraction
        FROM route_landmarks rl2
        JOIN landmarks l2 ON l2.id = rl2.landmark_id
        WHERE rl2.route_id = nr.route_id
          AND rl2.fraction_of_corridor > board.fraction
          AND ST_DWithin(l2.location, dest_pt.g, $5)
        ORDER BY ST_Distance(l2.location, dest_pt.g)
        LIMIT 1
      ) alight ON true
      ORDER BY (board.walk_m + alight.walk_m);
      `,
      params.userLocation.lng,
      params.userLocation.lat,
      params.destination.lng,
      params.destination.lat,
      params.maxWalkingM,
    );
  }

  private async findNextBus(
    routeId: string,
    boardFraction: number,
  ): Promise<BusOnRouteRow | null> {
    const rows = await this.prisma.$queryRawUnsafe<BusOnRouteRow[]>(
      `
      SELECT id, plate, fraction_of_corridor, speed_kmh, direction
      FROM buses
      WHERE route_id = $1::uuid
        AND status = 'IN_SERVICE'
      ORDER BY fraction_of_corridor;
      `,
      routeId,
    );
    if (rows.length === 0) return null;

    // Pick the bus that will reach boardFraction soonest given each one's
    // current position and direction. We compute fraction-distance traveled.
    let best: BusOnRouteRow | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const bus of rows) {
      const dist = this.computeFractionDistance(
        bus.fraction_of_corridor,
        bus.direction,
        boardFraction,
      );
      if (dist < bestDist) {
        bestDist = dist;
        best = bus;
      }
    }
    return best;
  }

  /**
   * Distancia EN FRACCIÓN que el bus tiene que recorrer hasta llegar al
   * boardFraction, considerando dirección y bounces en los extremos.
   * Devuelve siempre un valor positivo (o 0 si el bus está justo encima).
   */
  private computeFractionDistance(
    busFraction: number,
    direction: number,
    boardFraction: number,
  ): number {
    if (direction === 1) {
      if (busFraction <= boardFraction) {
        // Bus viene antes del paradero, va hacia él. Directo.
        return boardFraction - busFraction;
      }
      // Bus pasó el paradero forward. Va a tener que llegar a 1, bouncear, y
      // volver hasta boardFraction.
      return 1.0 - busFraction + (1.0 - boardFraction);
    }
    // direction === -1
    if (busFraction >= boardFraction) {
      // Bus viene después del paradero, va hacia atrás hacia él. Directo.
      return busFraction - boardFraction;
    }
    // Bus está antes del paradero pero yendo hacia 0. Va a 0, bouncea, y
    // vuelve hasta boardFraction.
    return busFraction + boardFraction;
  }

  private computeBusEtaToBoard(
    bus: BusOnRouteRow,
    c: CandidateRow,
  ): number {
    if (bus.speed_kmh < 1) return MIN_WAIT_SECONDS; // bus stuck → asumir 30s
    const distFraction = this.computeFractionDistance(
      bus.fraction_of_corridor,
      bus.direction,
      c.board_fraction,
    );
    const distM = distFraction * c.length_m;
    const speedMs = (bus.speed_kmh * 1000) / 3600;
    return Math.max(MIN_WAIT_SECONDS, Math.round(distM / speedMs));
  }

  private computeRideSeconds(
    speedKmh: number,
    c: CandidateRow,
  ): number {
    if (speedKmh < 1) return 60; // unknown
    const distFraction = Math.abs(c.alight_fraction - c.board_fraction);
    const distM = distFraction * c.length_m;
    const speedMs = (speedKmh * 1000) / 3600;
    return Math.max(60, Math.round(distM / speedMs));
  }

  private async fetchBusSegmentPolyline(
    routeId: string,
    fromFraction: number,
    toFraction: number,
  ): Promise<PolylinePointRow[]> {
    const a = Math.min(fromFraction, toFraction);
    const b = Math.max(fromFraction, toFraction);
    const rows = await this.prisma.$queryRawUnsafe<
      { wkt: string }[]
    >(
      `
      SELECT ST_AsText(
        ST_LineSubstring(rc.path::geometry, $2::float, $3::float)
      ) AS wkt
      FROM route_corridors rc
      WHERE rc.route_id = $1::uuid;
      `,
      routeId,
      a,
      b,
    );
    if (rows.length === 0) return [];

    // Parse simple LINESTRING(lng lat, lng lat, ...) → [{lat, lng}]
    const wkt = rows[0].wkt;
    const m = wkt.match(/LINESTRING\((.+)\)/);
    if (!m) return [];
    const pts: PolylinePointRow[] = [];
    for (const pair of m[1].split(',')) {
      const [lng, lat] = pair.trim().split(/\s+/).map(Number);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        pts.push({ lat, lng });
      }
    }
    // Si fraction A > B (al revés), invertimos para que vaya de board → alight
    if (fromFraction > toFraction) pts.reverse();
    return pts;
  }

  private composeRecommendation(
    rank: number,
    e: {
      candidate: CandidateRow;
      bus: BusOnRouteRow;
      waitSeconds: number;
      rideSeconds: number;
      totalSeconds: number;
    },
    polyline: PolylinePointRow[],
  ): RouteRecommendation {
    const c = e.candidate;

    const walkToBoardMin = Math.max(
      1,
      Math.round(c.walk_to_board_m / WALK_SPEED_M_PER_MIN),
    );
    const walkFromAlightMin = Math.max(
      1,
      Math.round(c.walk_from_alight_m / WALK_SPEED_M_PER_MIN),
    );

    return {
      rank,
      total_minutes: Math.max(1, Math.round(e.totalSeconds / 60)),
      walking_to_board: {
        paradero: {
          id: c.board_landmark_id,
          name: c.board_landmark_name,
          lat: c.board_lat,
          lng: c.board_lng,
        },
        distance_m: Math.round(c.walk_to_board_m),
        blocks: Math.max(1, Math.round(c.walk_to_board_m / BLOCK_LENGTH_M)),
        duration_minutes: walkToBoardMin,
      },
      bus: {
        id: e.bus.id,
        plate: e.bus.plate,
        route_id: c.route_id,
        route_code: c.route_code,
        route_name: c.route_name,
        route_color: c.route_color,
        wait_minutes: Math.max(1, Math.round(e.waitSeconds / 60)),
        ride_minutes: Math.max(1, Math.round(e.rideSeconds / 60)),
      },
      walking_from_alight: {
        paradero: {
          id: c.alight_landmark_id,
          name: c.alight_landmark_name,
          lat: c.alight_lat,
          lng: c.alight_lng,
        },
        distance_m: Math.round(c.walk_from_alight_m),
        blocks: Math.max(1, Math.round(c.walk_from_alight_m / BLOCK_LENGTH_M)),
        duration_minutes: walkFromAlightMin,
      },
      polyline_bus: polyline,
    };
  }
}
