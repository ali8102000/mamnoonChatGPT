-- Fix the periodic taxi monitor to use the governorate classification
-- already stored by Mamnoon's request/location pipeline. There is no
-- governorate_boundaries table in this project.
CREATE OR REPLACE FUNCTION public.refresh_taxi_pricing_monitor()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $monitor$
DECLARE
  v_key text;
  v_drivers integer;
  v_observed integer;
  v_waiting integer;
  v_ratio numeric;
  v_raw_percent numeric;
  v_enabled boolean;
  v_increase_cap numeric;
  v_discount_cap numeric;
BEGIN
  -- Only explicitly configured global/governorate controls are monitored.
  FOR v_key IN
    SELECT governorate_key FROM public.taxi_pricing_auto_controls
  LOOP
    IF v_key = 'all' THEN
      SELECT count(DISTINCT pp.user_id)::integer INTO v_observed
      FROM public.provider_presence pp
      JOIN public.driver_profiles dp ON dp.user_id=pp.user_id
      WHERE pp.updated_at > now()-interval '5 minutes'
        AND pp.accuracy_m IS NOT NULL AND pp.accuracy_m<=100
        AND dp.status='approved' AND dp.vehicle_category::text <> 'large'
        AND (dp.suspended_until IS NULL OR dp.suspended_until<=now());

      SELECT count(DISTINCT pp.user_id)::integer INTO v_drivers
      FROM public.provider_presence pp
      JOIN public.driver_profiles dp ON dp.user_id=pp.user_id
      WHERE pp.updated_at > now()-interval '5 minutes'
        AND pp.accuracy_m IS NOT NULL AND pp.accuracy_m<=100
        AND dp.available=true AND dp.status='approved' AND dp.vehicle_category::text <> 'large'
        AND (dp.suspended_until IS NULL OR dp.suspended_until<=now())
        AND NOT EXISTS (
          SELECT 1 FROM public.service_requests ar
          WHERE ar.provider_id=dp.user_id AND ar.status IN ('accepted','in_progress')
        );

      SELECT count(*)::integer INTO v_waiting
      FROM public.service_requests sr
      WHERE sr.type::text='taxi' AND coalesce(sr.vehicle_category::text,'') <> 'large'
        AND sr.status IN ('pending','searching') AND sr.provider_id IS NULL
        AND sr.created_at>now()-interval '15 minutes'
        AND sr.pickup_lat IS NOT NULL AND sr.pickup_lng IS NOT NULL;
    ELSE
      SELECT count(DISTINCT pp.user_id)::integer INTO v_observed
      FROM public.provider_presence pp
      JOIN public.driver_profiles dp ON dp.user_id=pp.user_id
      WHERE pp.updated_at > now()-interval '5 minutes'
        AND pp.accuracy_m IS NOT NULL AND pp.accuracy_m<=100
        AND dp.status='approved' AND dp.vehicle_category::text <> 'large'
        AND (dp.suspended_until IS NULL OR dp.suspended_until<=now())
        AND public.infer_governorate_key(pp.lat::numeric,pp.lng::numeric)=v_key;

      SELECT count(DISTINCT pp.user_id)::integer INTO v_drivers
      FROM public.provider_presence pp
      JOIN public.driver_profiles dp ON dp.user_id=pp.user_id
      WHERE pp.updated_at > now()-interval '5 minutes'
        AND pp.accuracy_m IS NOT NULL AND pp.accuracy_m<=100
        AND dp.available=true AND dp.status='approved' AND dp.vehicle_category::text <> 'large'
        AND (dp.suspended_until IS NULL OR dp.suspended_until<=now())
        AND public.infer_governorate_key(pp.lat::numeric,pp.lng::numeric)=v_key
        AND NOT EXISTS (
          SELECT 1 FROM public.service_requests ar
          WHERE ar.provider_id=dp.user_id AND ar.status IN ('accepted','in_progress')
        );

      SELECT count(*)::integer INTO v_waiting
      FROM public.service_requests sr
      WHERE sr.type::text='taxi' AND coalesce(sr.vehicle_category::text,'') <> 'large'
        AND sr.governorate_key=v_key
        AND sr.status IN ('pending','searching') AND sr.provider_id IS NULL
        AND sr.created_at>now()-interval '15 minutes'
        AND sr.pickup_lat IS NOT NULL AND sr.pickup_lng IS NOT NULL;
    END IF;

    SELECT auto_monitor_enabled,demand_increase_cap_percent,demand_discount_cap_percent
      INTO v_enabled,v_increase_cap,v_discount_cap
    FROM public.taxi_pricing_auto_controls WHERE governorate_key=v_key;

    IF NOT COALESCE(v_enabled,false) THEN CONTINUE; END IF;

    v_ratio := COALESCE(v_drivers,0)::numeric / greatest(COALESCE(v_waiting,0),1);
    v_raw_percent := CASE
      WHEN COALESCE(v_observed,0)=0 THEN 0
      WHEN COALESCE(v_waiting,0)=0 AND COALESCE(v_drivers,0)>0 THEN -10
      WHEN COALESCE(v_waiting,0)=0 THEN 0
      WHEN v_ratio >= 3 THEN -20
      WHEN v_ratio >= 2 THEN -10
      WHEN v_ratio >= 1.25 THEN 0
      WHEN v_ratio >= 0.75 THEN 10
      WHEN v_ratio >= 0.50 THEN 25
      WHEN v_ratio >= 0.25 THEN 40
      ELSE 50
    END;

    UPDATE public.taxi_pricing_auto_controls
    SET auto_active_drivers=COALESCE(v_drivers,0),
        auto_gps_observed=COALESCE(v_observed,0),
        auto_pending_requests=COALESCE(v_waiting,0),
        auto_demand_percent=greatest(-least(COALESCE(v_discount_cap,0),50),
          least(COALESCE(v_increase_cap,0),v_raw_percent)),
        auto_updated_at=now(),
        updated_at=now()
    WHERE governorate_key=v_key;
  END LOOP;
END;
$monitor$;

REVOKE ALL ON FUNCTION public.refresh_taxi_pricing_monitor() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_taxi_pricing_monitor() TO service_role;
