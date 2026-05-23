-- Partial unique index: at most ONE active trip per user.
-- Prevents race conditions where two concurrent POST /trips create two
-- IN_PROGRESS trips for the same user.
CREATE UNIQUE INDEX IF NOT EXISTS one_active_trip_per_user
  ON trips (user_id)
  WHERE status = 'IN_PROGRESS';
