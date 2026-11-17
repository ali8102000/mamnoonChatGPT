-- Admin-controlled dispatch distance rings. Offers remain 60 seconds each.
-- Three rings are sent in order, then the same three rings are retried once.
BEGIN;

CREATE TABLE IF NOT EXISTS public.dispatch_radius_settings (
  provider_type text NOT NULL CHECK (provider_type IN ('technician', 'taxi', 'large_vehicle')),
  zone_no smallint NOT NULL CHECK (zone_no BETWEEN 1 AND 3),
  min_km numeric(7,2) NOT NULL CHECK (min_km >= 0),
  max_km numeric(7,2) NOT NULL CHECK (max_km > min_km AND max_km <= 55),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id),
  PRIMARY KEY (provider_type, zone_no)
);

INSERT INTO public.dispatch_radius_settings(provider_type, zone_no, min_km, max_km)
VALUES
  ('taxi', 1, 0, 1), ('taxi', 2, 1, 3), ('taxi', 3, 3, 5),
  ('large_vehicle', 1, 0, 5), ('large_vehicle', 2, 5, 25), ('large_vehicle', 3, 25, 55),
  ('technician', 1, 0, 5), ('technician', 2, 5, 25), ('technician', 3, 25, 55)
ON CONFLICT (provider_type, zone_no) DO NOTHING;

ALTER TABLE public.dispatch_radius_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dispatch_radius_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dispatch_radius_settings TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_dispatch_radius_settings()
RETURNS TABLE (
  provider_type text,
  zone_no smallint,
  min_km numeric,
  max_km numeric,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_admin_access(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
  SELECT s.provider_type, s.zone_no, s.min_km, s.max_km, s.updated_at
  FROM public.dispatch_radius_settings s
  ORDER BY CASE s.provider_type WHEN 'taxi' THEN 1 WHEN 'large_vehicle' THEN 2 ELSE 3 END, s.zone_no;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_dispatch_radius_group(
  p_provider_type text,
  p_rings jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
  v_previous_max numeric := 0;
  v_ring record;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_admin_access(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF p_provider_type NOT IN ('technician', 'taxi', 'large_vehicle')
     OR jsonb_typeof(p_rings) <> 'array'
     OR jsonb_array_length(p_rings) <> 3 THEN
    RAISE EXCEPTION 'invalid_dispatch_rings';
  END IF;

  FOR v_ring IN
    SELECT (item->>'zone_no')::integer AS zone_no,
           (item->>'min_km')::numeric AS min_km,
           (item->>'max_km')::numeric AS max_km
    FROM jsonb_array_elements(p_rings) item
    ORDER BY (item->>'zone_no')::integer
  LOOP
    IF v_ring.zone_no NOT BETWEEN 1 AND 3
       OR v_ring.min_km < 0
       OR v_ring.max_km <= v_ring.min_km
       OR v_ring.max_km > 55
       OR v_ring.min_km <> v_previous_max THEN
      RAISE EXCEPTION 'invalid_or_overlapping_dispatch_rings';
    END IF;
    v_previous_max := v_ring.max_km;
  END LOOP;

  SELECT count(*) INTO v_count
  FROM jsonb_array_elements(p_rings) item
  WHERE (item->>'zone_no')::integer BETWEEN 1 AND 3;
  IF v_count <> 3 THEN RAISE EXCEPTION 'all_three_zones_required'; END IF;

  UPDATE public.dispatch_radius_settings s
  SET min_km = (item->>'min_km')::numeric,
      max_km = (item->>'max_km')::numeric,
      updated_at = now(),
      updated_by = auth.uid()
  FROM jsonb_array_elements(p_rings) item
  WHERE s.provider_type = p_provider_type
    AND s.zone_no = (item->>'zone_no')::integer;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_dispatch_radius_settings() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_update_dispatch_radius_group(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_dispatch_radius_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_dispatch_radius_group(text, jsonb) TO authenticated;

-- Wire the real dispatch workers to the settings rows. Keep their existing
-- offer expiry (60 seconds), two complete passes (six stages), eligibility,
-- subscription checks, and cancellation behavior intact.
DO $$
DECLARE
  v_definition text;
BEGIN
  v_definition := pg_get_functiondef('public.advance_taxi_dispatch(uuid)'::regprocedure);

  IF position('(ARRAY[5, 25, 55]::numeric[])[v_zone]' IN v_definition) = 0
     OR position('(ARRAY[0, 5, 25]::numeric[])[v_zone]' IN v_definition) = 0
     OR position('(ARRAY[1, 3, 5]::numeric[])[v_zone]' IN v_definition) = 0
     OR position('(ARRAY[0, 1, 3]::numeric[])[v_zone]' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'taxi_dispatch_definition_does_not_match_expected_baseline';
  END IF;

  v_definition := replace(v_definition,
    '(ARRAY[5, 25, 55]::numeric[])[v_zone]',
    '(SELECT max_km FROM public.dispatch_radius_settings WHERE provider_type = ''large_vehicle'' AND zone_no = v_zone)');
  v_definition := replace(v_definition,
    '(ARRAY[0, 5, 25]::numeric[])[v_zone]',
    '(SELECT min_km FROM public.dispatch_radius_settings WHERE provider_type = ''large_vehicle'' AND zone_no = v_zone)');
  v_definition := replace(v_definition,
    '(ARRAY[1, 3, 5]::numeric[])[v_zone]',
    '(SELECT max_km FROM public.dispatch_radius_settings WHERE provider_type = ''taxi'' AND zone_no = v_zone)');
  v_definition := replace(v_definition,
    '(ARRAY[0, 1, 3]::numeric[])[v_zone]',
    '(SELECT min_km FROM public.dispatch_radius_settings WHERE provider_type = ''taxi'' AND zone_no = v_zone)');
  EXECUTE v_definition;

  v_definition := pg_get_functiondef('public.advance_service_dispatch(uuid)'::regprocedure);
  IF position('(ARRAY[5, 25, 55]::numeric[])[v_zone]' IN v_definition) = 0
     OR position('(ARRAY[0, 5, 25]::numeric[])[v_zone]' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'service_dispatch_definition_does_not_match_expected_baseline';
  END IF;
  v_definition := replace(v_definition,
    '(ARRAY[5, 25, 55]::numeric[])[v_zone]',
    '(SELECT max_km FROM public.dispatch_radius_settings WHERE provider_type = ''technician'' AND zone_no = v_zone)');
  v_definition := replace(v_definition,
    '(ARRAY[0, 5, 25]::numeric[])[v_zone]',
    '(SELECT min_km FROM public.dispatch_radius_settings WHERE provider_type = ''technician'' AND zone_no = v_zone)');
  EXECUTE v_definition;
END;
$$;

COMMIT;
