ALTER TABLE public.driver_profiles
  DROP CONSTRAINT IF EXISTS driver_profiles_large_vehicle_type_required;
ALTER TABLE public.driver_profiles
  ADD CONSTRAINT driver_profiles_large_vehicle_type_required
  CHECK (
    vehicle_category::text <> 'large'
    OR (vehicle_type IS NOT NULL AND vehicle_type IN ('kia_cargo','kia_passenger','bus'))
  ) NOT VALID;

ALTER TABLE public.service_requests
  DROP CONSTRAINT IF EXISTS service_requests_large_vehicle_type_required;
ALTER TABLE public.service_requests
  ADD CONSTRAINT service_requests_large_vehicle_type_required
  CHECK (
    type::text <> 'taxi'
    OR vehicle_category::text <> 'large'
    OR (vehicle_type IS NOT NULL AND vehicle_type IN ('kia_cargo','kia_passenger','bus'))
  ) NOT VALID;

CREATE INDEX IF NOT EXISTS driver_profiles_large_vehicle_type_dispatch_idx
  ON public.driver_profiles (vehicle_type, user_id)
  WHERE vehicle_category = 'large'
    AND available = true
    AND status = 'approved';

DO $migration$
DECLARE
  v_def text;
  v_old text := $old$    NEW.vehicle_type := COALESCE(NEW.vehicle_type,
      CASE WHEN COALESCE(NEW.notes,'') ILIKE '%كيا ركاب%' THEN 'kia_passenger' ELSE 'kia_cargo' END);$old$;
  v_new text := $new$    IF NEW.vehicle_type IS NULL
       OR NEW.vehicle_type NOT IN ('kia_cargo','kia_passenger','bus') THEN
      RAISE EXCEPTION 'يرجى تحديد نوع المركبة الكبيرة: كيا حمل أو كيا ركاب أو باص';
    END IF;$new$;
  v_updated text;
BEGIN
  SELECT pg_get_functiondef('public.prepare_taxi_request()'::regprocedure) INTO v_def;
  IF position(v_old in v_def) = 0 THEN
    RAISE EXCEPTION 'prepare_taxi_request large vehicle type anchor missing; refusing unsafe replacement';
  END IF;
  v_updated := replace(v_def, v_old, v_new);
  EXECUTE v_updated;
END
$migration$;

DO $migration$
DECLARE
  v_def text;
  v_updated text;
  v_old_filter text := 'AND (r.vehicle_type IS NULL OR dp.vehicle_type = r.vehicle_type)';
  v_new_filter text := 'AND dp.vehicle_type = r.vehicle_type';
  v_old_ring text := 'FROM public.get_dispatch_ring(''large_driver'', q.stage)';
  v_new_ring text := 'FROM public.get_regional_dispatch_ring(''large_driver'', q.stage, r.governorate_key, ''all'')';
BEGIN
  SELECT pg_get_functiondef('public.advance_taxi_dispatch(uuid)'::regprocedure) INTO v_def;
  IF position(v_old_filter in v_def) = 0 THEN
    RAISE EXCEPTION 'advance_taxi_dispatch vehicle filter anchor missing; refusing unsafe replacement';
  END IF;
  IF position(v_old_ring in v_def) = 0 THEN
    RAISE EXCEPTION 'advance_taxi_dispatch regional ring anchor missing; refusing unsafe replacement';
  END IF;
  v_updated := replace(v_def, v_old_filter, v_new_filter);
  v_updated := replace(v_updated, v_old_ring, v_new_ring);
  EXECUTE v_updated;
END
$migration$;

COMMENT ON CONSTRAINT driver_profiles_large_vehicle_type_required ON public.driver_profiles
  IS 'A large-vehicle provider must register exactly one supported subtype.';
COMMENT ON CONSTRAINT service_requests_large_vehicle_type_required ON public.service_requests
  IS 'A large-vehicle taxi request must explicitly choose cargo, passenger, or bus.';
