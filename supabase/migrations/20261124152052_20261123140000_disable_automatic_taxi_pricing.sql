-- Project decision: automatic demand and traffic price adjustments remain disabled.
-- Keep the demand monitor data separate from the customer-facing taxi quote.

UPDATE public.taxi_pricing_auto_controls
SET auto_monitor_enabled = false,
    traffic_surcharge_cap_percent = 0,
    demand_increase_cap_percent = 0,
    demand_discount_cap_percent = 0,
    auto_demand_percent = 0,
    auto_updated_at = now(),
    updated_at = now();

ALTER TABLE public.taxi_pricing_auto_controls
  ALTER COLUMN auto_monitor_enabled SET DEFAULT false;

ALTER TABLE public.taxi_pricing_auto_controls
  DROP CONSTRAINT IF EXISTS taxi_pricing_auto_controls_auto_monitor_disabled;

ALTER TABLE public.taxi_pricing_auto_controls
  ADD CONSTRAINT taxi_pricing_auto_controls_auto_monitor_disabled
  CHECK (auto_monitor_enabled = false);

CREATE OR REPLACE FUNCTION public.admin_update_taxi_auto_monitor_settings(
  p_governorate_key text,
  p_enabled boolean,
  p_traffic_cap numeric,
  p_demand_increase_cap numeric,
  p_demand_discount_cap numeric
)
RETURNS public.taxi_pricing_auto_controls
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_row public.taxi_pricing_auto_controls%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_governorate_key NOT IN (
    'all','baghdad','basra','nineveh','erbil','sulaymaniyah','duhok','kirkuk',
    'najaf','karbala','babil','anbar','diyala','saladin','wasit','dhiqar','maysan','muthanna','qadisiyah'
  ) THEN
    RAISE EXCEPTION 'invalid_governorate';
  END IF;
  IF p_enabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'automatic_taxi_pricing_disabled';
  END IF;
  IF p_traffic_cap IS NULL OR p_traffic_cap NOT BETWEEN 0 AND 200
     OR p_demand_increase_cap IS NULL OR p_demand_increase_cap NOT BETWEEN 0 AND 100
     OR p_demand_discount_cap IS NULL OR p_demand_discount_cap NOT BETWEEN 0 AND 50 THEN
    RAISE EXCEPTION 'invalid_automatic_pricing_limits';
  END IF;
  IF NOT public.admin_has_permission(
    'pricing.peak.edit',
    CASE WHEN p_governorate_key='all' THEN 'global' ELSE 'governorate' END,
    CASE WHEN p_governorate_key='all' THEN NULL ELSE p_governorate_key END
  ) THEN
    RAISE EXCEPTION 'missing_pricing_permission';
  END IF;

  INSERT INTO public.taxi_pricing_auto_controls(
    governorate_key,auto_monitor_enabled,traffic_surcharge_cap_percent,
    demand_increase_cap_percent,demand_discount_cap_percent,auto_demand_percent
  )
  VALUES(p_governorate_key,false,0,0,0,0)
  ON CONFLICT(governorate_key) DO UPDATE SET
    auto_monitor_enabled=false,
    traffic_surcharge_cap_percent=0,
    demand_increase_cap_percent=0,
    demand_discount_cap_percent=0,
    auto_demand_percent=0,
    auto_updated_at=now(),
    updated_at=now()
  RETURNING * INTO v_row;

  INSERT INTO public.audit_logs(user_id,action,target_type,target_id,details)
  VALUES(v_actor,'pricing.taxi.auto_monitor.disabled','taxi_pricing_auto_controls',
    p_governorate_key,to_jsonb(v_row));
  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_update_taxi_auto_monitor_settings(text,boolean,numeric,numeric,numeric)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_update_taxi_auto_monitor_settings(text,boolean,numeric,numeric,numeric)
  TO authenticated;
