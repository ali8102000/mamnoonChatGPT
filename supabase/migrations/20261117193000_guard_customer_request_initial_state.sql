-- Customer-created requests must enter dispatch as fresh, unassigned requests.
CREATE OR REPLACE FUNCTION public.guard_customer_request_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_admin_access(auth.uid()) THEN
    IF NEW.customer_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'request_customer_must_match_auth_user';
    END IF;

    NEW.provider_id := NULL;
    NEW.status := 'pending';
    NEW.accepted_at := NULL;
    NEW.started_at := NULL;
    NEW.completed_at := NULL;
    NEW.searching_started_at := NULL;
    NEW.cancelled_by := NULL;
    NEW.cancellation_reason := NULL;
    NEW.admin_notes := NULL;
    NEW.commission := 0;
    NEW.created_at := now();
    NEW.updated_at := now();

    -- Paid urgency is activated only by the guarded pricing RPCs after insert.
    NEW.urgency_multiplier := 1;
    NEW.urgency_percent := 0;
    NEW.urgency_amount := 0;
    NEW.urgency_base_price := NULL;
    NEW.taxi_urgency_enabled := false;
    NEW.taxi_urgency_percent := 0;
    NEW.taxi_peak_percent := 0;
    -- Keep service_urgency_enabled and large_vehicle_urgency_enabled because
    -- those are separate customer-selected dispatch attributes.
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS guard_customer_request_before_insert
  ON public.service_requests;

CREATE TRIGGER guard_customer_request_before_insert
BEFORE INSERT ON public.service_requests
FOR EACH ROW
EXECUTE FUNCTION public.guard_customer_request_insert();

REVOKE ALL ON FUNCTION public.guard_customer_request_insert() FROM PUBLIC, anon, authenticated;

-- Preserve exact polygon-validated governorates supplied by the trusted
-- auto-taxi-pricing edge function; authenticated clients still cannot spoof
-- their pickup governorate.
CREATE OR REPLACE FUNCTION public.guard_regional_service_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_detected_governorate text;
BEGIN
  IF auth.role() = 'service_role'
     AND TG_OP = 'INSERT'
     AND NEW.governorate_key IS NOT NULL THEN
    IF NEW.pickup_lat IS NULL OR NEW.pickup_lng IS NULL THEN
      RAISE EXCEPTION USING errcode = 'P0001',
        message = 'pickup_location_required';
    END IF;
    IF NOT public.regional_services_enabled(NEW.governorate_key) THEN
      RAISE EXCEPTION USING errcode = 'P0001',
        message = 'regional_services_disabled';
    END IF;
    RETURN NEW;
  END IF;

  IF public.is_platform_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF NEW.pickup_lat IS NULL OR NEW.pickup_lng IS NULL THEN
    RAISE EXCEPTION USING errcode = 'P0001',
      message = 'موقع الانطلاق مطلوب حتى نتحقق من توفر الخدمة في محافظتك.';
  END IF;

  v_detected_governorate := public.infer_governorate_key(NEW.pickup_lat, NEW.pickup_lng);
  IF v_detected_governorate IS NULL THEN
    RAISE EXCEPTION USING errcode = 'P0001',
      message = 'تعذّر تحديد المحافظة من موقع الانطلاق. حدّد الموقع من جديد ثم أرسل الطلب.';
  END IF;

  NEW.governorate_key := v_detected_governorate;
  IF NOT public.regional_services_enabled(NEW.governorate_key) THEN
    RAISE EXCEPTION USING errcode = 'P0001',
      message = 'الخدمات متوقفة مؤقتاً في محافظتك بقرار من إدارة ممنون.';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_regional_service_request() FROM PUBLIC, anon, authenticated;
