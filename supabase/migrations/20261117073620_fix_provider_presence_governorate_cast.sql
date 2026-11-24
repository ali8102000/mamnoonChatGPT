-- Fix numeric type mismatch in provider presence regional guard.
-- infer_governorate_key is defined for numeric,numeric while GPS columns are double precision.
CREATE OR REPLACE FUNCTION public.guard_provider_regional_presence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_governorate_key text;
BEGIN
  SELECT nullif(lower(trim(p.governorate_key)), '')
    INTO v_governorate_key
    FROM public.profiles p
   WHERE p.id = NEW.user_id;

  IF v_governorate_key IS NULL AND NEW.lat IS NOT NULL AND NEW.lng IS NOT NULL THEN
    v_governorate_key := public.infer_governorate_key(NEW.lat::numeric, NEW.lng::numeric);
  END IF;

  IF v_governorate_key IS NOT NULL
     AND NOT public.regional_services_enabled(v_governorate_key) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'محافظتك متوقفة حالياً. يمكنك إكمال التسجيل وإرفاق المستمسكات، لكن استقبال الأعمال متاح بعد رفع الحظر من الإدارة.';
  END IF;

  RETURN NEW;
END;
$function$;