-- CreateEnum
CREATE TYPE "route_mode" AS ENUM ('TRADITIONAL', 'BRT', 'METRO');

-- CreateEnum
CREATE TYPE "landmark_type" AS ENUM ('UNIVERSITY', 'MALL', 'HOSPITAL', 'SQUARE', 'TRANSPORT_HUB', 'NEIGHBORHOOD', 'LANDMARK');

-- CreateEnum
CREATE TYPE "bus_status" AS ENUM ('IN_SERVICE', 'OUT_OF_SERVICE', 'BREAK');

-- CreateEnum
CREATE TYPE "trip_status" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "wait_status" AS ENUM ('WAITING', 'ALERTED', 'BOARDED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "incident_type" AS ENUM ('TRAFFIC', 'FULL_BUS', 'NO_BUS_PASSING', 'ACCIDENT');

-- CreateEnum
CREATE TYPE "favorite_target" AS ENUM ('LANDMARK', 'ROUTE');

-- CreateEnum
CREATE TYPE "agent_profile" AS ENUM ('STUDENT_UNINORTE', 'STREET_VENDOR', 'EXECUTIVE_NORTE', 'HOUSEWIFE_SURORIENTE', 'TOURIST', 'NIGHTLIFE_ATTENDEE');

-- CreateEnum
CREATE TYPE "agent_status" AS ENUM ('IDLE', 'WALKING', 'WAITING_BUS', 'ON_BUS', 'AT_DESTINATION');

-- CreateTable
CREATE TABLE "cities" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "center" geography(Point, 4326) NOT NULL,
    "bbox" geography(Polygon, 4326),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "device_id" TEXT,
    "city_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routes" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#1E5EFF',
    "mode" "route_mode" NOT NULL DEFAULT 'TRADITIONAL',
    "stops_are_fixed" BOOLEAN NOT NULL DEFAULT false,
    "operator" TEXT,
    "city_id" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_corridors" (
    "route_id" UUID NOT NULL,
    "path" geography(LineString, 4326) NOT NULL,
    "length_m" INTEGER NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'OUTBOUND',

    CONSTRAINT "route_corridors_pkey" PRIMARY KEY ("route_id")
);

-- CreateTable
CREATE TABLE "landmarks" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "landmark_type" NOT NULL,
    "address" TEXT,
    "location" geography(Point, 4326) NOT NULL,
    "city_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "landmarks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_landmarks" (
    "route_id" UUID NOT NULL,
    "landmark_id" UUID NOT NULL,
    "distance_to_corridor_m" INTEGER NOT NULL,
    "fraction_of_corridor" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "route_landmarks_pkey" PRIMARY KEY ("route_id","landmark_id")
);

-- CreateTable
CREATE TABLE "fixed_stops" (
    "id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "sequence" INTEGER NOT NULL,
    "location" geography(Point, 4326) NOT NULL,
    "fraction_of_corridor" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "fixed_stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buses" (
    "id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "plate" TEXT NOT NULL,
    "current_location" geography(Point, 4326) NOT NULL,
    "fraction_of_corridor" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "speed_kmh" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "heading" DOUBLE PRECISION,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "bus_status" NOT NULL DEFAULT 'IN_SERVICE',

    CONSTRAINT "buses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bus_positions" (
    "id" UUID NOT NULL,
    "bus_id" UUID NOT NULL,
    "location" geography(Point, 4326) NOT NULL,
    "fraction_of_corridor" DOUBLE PRECISION NOT NULL,
    "speed_kmh" DOUBLE PRECISION NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bus_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trips" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "bus_id" UUID,
    "boarding_location" geography(Point, 4326) NOT NULL,
    "dropoff_location" geography(Point, 4326) NOT NULL,
    "boarding_landmark_id" UUID,
    "dropoff_landmark_id" UUID,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "estimated_arrival_at" TIMESTAMP(3),
    "status" "trip_status" NOT NULL DEFAULT 'IN_PROGRESS',

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wait_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "route_id" UUID,
    "wait_location" geography(Point, 4326) NOT NULL,
    "notify_seconds_before" INTEGER NOT NULL DEFAULT 180,
    "status" "wait_status" NOT NULL DEFAULT 'WAITING',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "alerted_bus_id" UUID,

    CONSTRAINT "wait_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "route_id" UUID,
    "type" "incident_type" NOT NULL,
    "location" geography(Point, 4326) NOT NULL,
    "description" TEXT,
    "reported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ratings" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "stars" INTEGER NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favorites" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "target_type" "favorite_target" NOT NULL,
    "landmark_id" UUID,
    "route_id" UUID,
    "alias" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_messages" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "suggested_action" JSONB,
    "latency_ms" INTEGER,
    "tool_calls" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "simulator_agents" (
    "id" UUID NOT NULL,
    "profile_type" "agent_profile" NOT NULL,
    "name" TEXT NOT NULL,
    "home_location" geography(Point, 4326) NOT NULL,
    "work_location" geography(Point, 4326),
    "schedule" JSONB NOT NULL,
    "status" "agent_status" NOT NULL DEFAULT 'IDLE',
    "current_location" geography(Point, 4326),
    "current_route_id" UUID,
    "current_trip_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "simulator_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "simulator_events" (
    "id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "action_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "location" geography(Point, 4326),
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "simulator_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cached_walking_paths" (
    "id" UUID NOT NULL,
    "from_geohash" TEXT NOT NULL,
    "to_geohash" TEXT NOT NULL,
    "path" geography(LineString, 4326) NOT NULL,
    "distance_m" INTEGER NOT NULL,
    "duration_s" INTEGER NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cached_walking_paths_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cities_code_key" ON "cities"("code");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_email_key" ON "profiles"("email");

-- CreateIndex
CREATE INDEX "routes_city_id_mode_idx" ON "routes"("city_id", "mode");

-- CreateIndex
CREATE UNIQUE INDEX "routes_city_id_code_key" ON "routes"("city_id", "code");

-- CreateIndex
CREATE INDEX "landmarks_city_id_idx" ON "landmarks"("city_id");

-- CreateIndex
CREATE INDEX "route_landmarks_route_id_fraction_of_corridor_idx" ON "route_landmarks"("route_id", "fraction_of_corridor");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_stops_route_id_sequence_key" ON "fixed_stops"("route_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "buses_plate_key" ON "buses"("plate");

-- CreateIndex
CREATE INDEX "buses_route_id_status_idx" ON "buses"("route_id", "status");

-- CreateIndex
CREATE INDEX "bus_positions_bus_id_recorded_at_idx" ON "bus_positions"("bus_id", "recorded_at");

-- CreateIndex
CREATE INDEX "trips_user_id_status_idx" ON "trips"("user_id", "status");

-- CreateIndex
CREATE INDEX "wait_sessions_status_started_at_idx" ON "wait_sessions"("status", "started_at");

-- CreateIndex
CREATE INDEX "incidents_reported_at_idx" ON "incidents"("reported_at");

-- CreateIndex
CREATE UNIQUE INDEX "ratings_trip_id_key" ON "ratings"("trip_id");

-- CreateIndex
CREATE UNIQUE INDEX "favorites_user_id_target_type_landmark_id_route_id_key" ON "favorites"("user_id", "target_type", "landmark_id", "route_id");

-- CreateIndex
CREATE INDEX "assistant_messages_user_id_created_at_idx" ON "assistant_messages"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "simulator_agents_profile_type_status_idx" ON "simulator_agents"("profile_type", "status");

-- CreateIndex
CREATE INDEX "simulator_events_occurred_at_idx" ON "simulator_events"("occurred_at");

-- CreateIndex
CREATE INDEX "simulator_events_agent_id_occurred_at_idx" ON "simulator_events"("agent_id", "occurred_at");

-- CreateIndex
CREATE INDEX "cached_walking_paths_from_geohash_idx" ON "cached_walking_paths"("from_geohash");

-- CreateIndex
CREATE UNIQUE INDEX "cached_walking_paths_from_geohash_to_geohash_key" ON "cached_walking_paths"("from_geohash", "to_geohash");

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_corridors" ADD CONSTRAINT "route_corridors_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landmarks" ADD CONSTRAINT "landmarks_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_landmarks" ADD CONSTRAINT "route_landmarks_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_landmarks" ADD CONSTRAINT "route_landmarks_landmark_id_fkey" FOREIGN KEY ("landmark_id") REFERENCES "landmarks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_stops" ADD CONSTRAINT "fixed_stops_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buses" ADD CONSTRAINT "buses_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bus_positions" ADD CONSTRAINT "bus_positions_bus_id_fkey" FOREIGN KEY ("bus_id") REFERENCES "buses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_bus_id_fkey" FOREIGN KEY ("bus_id") REFERENCES "buses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wait_sessions" ADD CONSTRAINT "wait_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_landmark_id_fkey" FOREIGN KEY ("landmark_id") REFERENCES "landmarks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulator_events" ADD CONSTRAINT "simulator_events_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "simulator_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
