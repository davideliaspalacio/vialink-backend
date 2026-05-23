import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TripStatus } from '@prisma/client';
import type { LatLng } from '../common/types/geo';
import { PrismaService } from '../prisma/prisma.service';
import {
  InternalEvents,
  type TripUpdateEvent,
} from '../realtime/realtime-events';
import { RealtimeEventBus } from '../realtime/realtime-event-bus.service';

interface ActiveTripRow {
  id: string;
  route_id: string;
  route_code: string;
  route_color: string;
  bus_id: string | null;
  bus_plate: string | null;
  boarding_lat: number;
  boarding_lng: number;
  dropoff_lat: number;
  dropoff_lng: number;
  boarding_landmark_id: string | null;
  dropoff_landmark_id: string | null;
  started_at: Date;
  estimated_arrival_at: Date | null;
  status: TripStatus;
}

@Injectable()
export class TripsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: RealtimeEventBus,
  ) {}

  async createTrip(params: {
    userId: string;
    routeId: string;
    boardingLocation: LatLng;
    dropoffLocation: LatLng;
    boardingLandmarkId?: string;
    dropoffLandmarkId?: string;
  }) {
    // Verify the route exists + grab its corridor length for ETA estimation
    const routes = await this.prisma.$queryRawUnsafe<
      {
        id: string;
        code: string;
        color: string;
        length_m: number;
        boarding_fraction: number;
        dropoff_fraction: number;
      }[]
    >(
      `
      SELECT
        r.id, r.code, r.color, rc.length_m,
        ST_LineLocatePoint(rc.path::geometry, ST_SetSRID(ST_MakePoint($2, $3), 4326)) AS boarding_fraction,
        ST_LineLocatePoint(rc.path::geometry, ST_SetSRID(ST_MakePoint($4, $5), 4326)) AS dropoff_fraction
      FROM routes r
      JOIN route_corridors rc ON rc.route_id = r.id
      WHERE r.id = $1::uuid AND r.active = true;
      `,
      params.routeId,
      params.boardingLocation.lng,
      params.boardingLocation.lat,
      params.dropoffLocation.lng,
      params.dropoffLocation.lat,
    );
    if (routes.length === 0) {
      throw new BadRequestException('Route not found or inactive');
    }
    const route = routes[0];
    // Traditional bus routes effectively operate both directions (ida y vuelta);
    // we don't enforce downstream order. Use absolute distance for ETA.
    const distanceM = Math.abs(
      (route.dropoff_fraction - route.boarding_fraction) * route.length_m,
    );
    // Conservative estimate: average 22 km/h end-to-end (includes wait + traffic)
    const estimatedSec = Math.max(60, Math.round(distanceM / (22 * 1000 / 3600)));
    const estimatedArrivalAt = new Date(Date.now() + estimatedSec * 1000);

    // Insert (partial unique index prevents duplicate active trip)
    try {
      const inserted = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
        `
        INSERT INTO trips (
          id, user_id, route_id, boarding_location, dropoff_location,
          boarding_landmark_id, dropoff_landmark_id,
          started_at, estimated_arrival_at, status
        )
        VALUES (
          gen_random_uuid(), $1::uuid, $2::uuid,
          ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography,
          ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography,
          $7::uuid,
          $8::uuid,
          NOW(),
          $9::timestamptz,
          'IN_PROGRESS'::trip_status
        )
        RETURNING id;
        `,
        params.userId,
        params.routeId,
        params.boardingLocation.lng,
        params.boardingLocation.lat,
        params.dropoffLocation.lng,
        params.dropoffLocation.lat,
        params.boardingLandmarkId ?? null,
        params.dropoffLandmarkId ?? null,
        estimatedArrivalAt,
      );
      const tripId = inserted[0].id;

      // Emit trip_update event
      const ev: TripUpdateEvent = {
        tripId,
        userId: params.userId,
        routeId: params.routeId,
        status: 'IN_PROGRESS',
        currentLocation: params.boardingLocation,
        remainingSeconds: estimatedSec,
        timestamp: new Date().toISOString(),
      };
      this.eventBus.emit(InternalEvents.TripUpdate, ev);

      return this.findById(tripId, params.userId);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError ||
        (err as { code?: string }).code === '23505'
      ) {
        throw new ConflictException(
          'You already have an active trip. Complete or cancel it first.',
        );
      }
      throw err;
    }
  }

  async getActive(userId: string) {
    const rows = await this.queryTrip({ userId, statusFilter: 'IN_PROGRESS' });
    return { trip: rows[0] ?? null };
  }

  async findById(tripId: string, requesterId: string) {
    const rows = await this.queryTrip({ id: tripId, userId: requesterId });
    if (rows.length === 0) {
      throw new NotFoundException('Trip not found');
    }
    return rows[0];
  }

  async updateStatus(
    tripId: string,
    userId: string,
    status: 'COMPLETED' | 'CANCELLED',
  ) {
    const result = await this.prisma.$executeRawUnsafe(
      `
      UPDATE trips
      SET status = $3::trip_status, ended_at = NOW()
      WHERE id = $1::uuid AND user_id = $2::uuid AND status = 'IN_PROGRESS';
      `,
      tripId,
      userId,
      status,
    );
    if (result === 0) {
      throw new NotFoundException('Active trip not found');
    }

    const trip = await this.findById(tripId, userId);
    const ev: TripUpdateEvent = {
      tripId,
      userId,
      routeId: trip.route.id,
      status,
      timestamp: new Date().toISOString(),
    };
    this.eventBus.emit(InternalEvents.TripUpdate, ev);
    return trip;
  }

  async rate(
    tripId: string,
    userId: string,
    stars: number,
    comment?: string,
  ) {
    // Verify trip belongs to user and is completed
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      select: { userId: true, status: true },
    });
    if (!trip || trip.userId !== userId) {
      throw new NotFoundException('Trip not found');
    }
    if (trip.status !== 'COMPLETED') {
      throw new BadRequestException('Trip must be completed to rate it');
    }

    const rating = await this.prisma.rating.upsert({
      where: { tripId },
      create: { userId, tripId, stars, comment },
      update: { stars, comment },
    });
    return { id: rating.id, stars: rating.stars, comment: rating.comment };
  }

  // ---------- Internals ----------

  private async queryTrip(filter: {
    id?: string;
    userId: string;
    statusFilter?: TripStatus;
  }) {
    const conditions: string[] = ['t.user_id = $1::uuid'];
    const params: (string | TripStatus)[] = [filter.userId];
    if (filter.id) {
      params.push(filter.id);
      conditions.push(`t.id = $${params.length}::uuid`);
    }
    if (filter.statusFilter) {
      params.push(filter.statusFilter);
      conditions.push(`t.status = $${params.length}::trip_status`);
    }

    const rows = await this.prisma.$queryRawUnsafe<ActiveTripRow[]>(
      `
      SELECT
        t.id,
        t.route_id, r.code AS route_code, r.color AS route_color,
        t.bus_id, b.plate AS bus_plate,
        ST_Y(t.boarding_location::geometry) AS boarding_lat,
        ST_X(t.boarding_location::geometry) AS boarding_lng,
        ST_Y(t.dropoff_location::geometry) AS dropoff_lat,
        ST_X(t.dropoff_location::geometry) AS dropoff_lng,
        t.boarding_landmark_id, t.dropoff_landmark_id,
        t.started_at, t.estimated_arrival_at, t.status
      FROM trips t
      JOIN routes r ON r.id = t.route_id
      LEFT JOIN buses b ON b.id = t.bus_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY t.started_at DESC
      LIMIT 1;
      `,
      ...params,
    );

    return rows.map((row) => ({
      id: row.id,
      route: {
        id: row.route_id,
        code: row.route_code,
        color: row.route_color,
      },
      bus: row.bus_id
        ? { id: row.bus_id, plate: row.bus_plate ?? '' }
        : null,
      boarding_location: { lat: row.boarding_lat, lng: row.boarding_lng },
      dropoff_location: { lat: row.dropoff_lat, lng: row.dropoff_lng },
      boarding_landmark_id: row.boarding_landmark_id,
      dropoff_landmark_id: row.dropoff_landmark_id,
      started_at: row.started_at,
      estimated_arrival_at: row.estimated_arrival_at,
      status: row.status,
    }));
  }
}
