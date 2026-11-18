-- Cache exact driving-route results only. No straight-line or estimated route is stored.
CREATE TABLE IF NOT EXISTS public.route_distance_cache (
  route_key text PRIMARY KEY CHECK (route_key ~ '^[a-f0-9]{64}$'),
  distance_meters double precision NOT NULL CHECK (distance_meters > 0),
  duration_seconds double precision NOT NULL CHECK (duration_seconds > 0),
  route_source text NOT NULL CHECK (route_source IN ('google_routes','osrm')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS route_distance_cache_expires_at_idx
  ON public.route_distance_cache (expires_at);

ALTER TABLE public.route_distance_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.route_distance_cache FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.route_distance_cache TO service_role;
