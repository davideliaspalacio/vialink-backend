-- Manual migration: PostGIS GIST indexes for spatial queries
-- These cannot be expressed in Prisma schema (Prisma's @@index uses B-tree by default).
-- All indexes are CONCURRENTLY-safe because tables are empty at this point.

-- Cities
CREATE INDEX IF NOT EXISTS idx_cities_center
  ON cities USING GIST (center);

-- Landmarks
CREATE INDEX IF NOT EXISTS idx_landmarks_location
  ON landmarks USING GIST (location);

-- Trigram index on landmark name for fuzzy search (US-03: /landmarks/search?q=)
CREATE INDEX IF NOT EXISTS idx_landmarks_name_trgm
  ON landmarks USING GIN (name gin_trgm_ops);

-- Route corridors (the polyline geometry of each route - core query target)
CREATE INDEX IF NOT EXISTS idx_route_corridors_path
  ON route_corridors USING GIST (path);

-- Fixed stops (BRT/Metro)
CREATE INDEX IF NOT EXISTS idx_fixed_stops_location
  ON fixed_stops USING GIST (location);

-- Buses (current position, queried frequently)
CREATE INDEX IF NOT EXISTS idx_buses_location
  ON buses USING GIST (current_location);

-- Bus position history
CREATE INDEX IF NOT EXISTS idx_bus_positions_location
  ON bus_positions USING GIST (location);

-- Trips (boarding/dropoff points)
CREATE INDEX IF NOT EXISTS idx_trips_boarding
  ON trips USING GIST (boarding_location);

CREATE INDEX IF NOT EXISTS idx_trips_dropoff
  ON trips USING GIST (dropoff_location);

-- Wait sessions (pin location)
CREATE INDEX IF NOT EXISTS idx_wait_sessions_location
  ON wait_sessions USING GIST (wait_location);

-- Incidents (location-based)
CREATE INDEX IF NOT EXISTS idx_incidents_location
  ON incidents USING GIST (location);

-- Simulator agents (home, work, current position)
CREATE INDEX IF NOT EXISTS idx_simulator_agents_home
  ON simulator_agents USING GIST (home_location);

CREATE INDEX IF NOT EXISTS idx_simulator_agents_current
  ON simulator_agents USING GIST (current_location)
  WHERE current_location IS NOT NULL;

-- Simulator events (point of action for replay/feed)
CREATE INDEX IF NOT EXISTS idx_simulator_events_location
  ON simulator_events USING GIST (location)
  WHERE location IS NOT NULL;

-- Cached walking paths
CREATE INDEX IF NOT EXISTS idx_cached_walking_paths_geom
  ON cached_walking_paths USING GIST (path);
