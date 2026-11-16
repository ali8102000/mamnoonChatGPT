-- Keep the shared provider-status trigger safe across the driver and worker table shapes.
CREATE OR REPLACE FUNCTION public.guard_provider_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_new jsonb := to_jsonb(NEW);
  v_old jsonb := to_jsonb(OLD);
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_admin_access(auth.uid()) THEN
    IF TG_OP = 'INSERT' THEN
      IF TG_TABLE_NAME = 'driver_profiles' THEN NEW.status := 'pending';
      ELSE NEW.status := 'approved';
      END IF;
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NOT (TG_TABLE_NAME = 'driver_profiles' AND auth.uid() = OLD.user_id AND OLD.status = 'rejected' AND NEW.status = 'pending') THEN
        RAISE EXCEPTION 'status_readonly';
      END IF;
    END IF;

    IF TG_OP = 'UPDATE' AND v_new->'rating_avg' IS DISTINCT FROM v_old->'rating_avg' THEN
      RAISE EXCEPTION 'rating_readonly';
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.status = 'approved' THEN
      IF TG_TABLE_NAME = 'driver_profiles' AND (
        v_new->'vehicle_make' IS DISTINCT FROM v_old->'vehicle_make'
        OR v_new->'vehicle_model' IS DISTINCT FROM v_old->'vehicle_model'
        OR v_new->'vehicle_year' IS DISTINCT FROM v_old->'vehicle_year'
        OR v_new->'vehicle_category' IS DISTINCT FROM v_old->'vehicle_category'
        OR v_new->'vehicle_type' IS DISTINCT FROM v_old->'vehicle_type'
        OR v_new->'vehicle_plate' IS DISTINCT FROM v_old->'vehicle_plate'
        OR v_new->'vehicle_color' IS DISTINCT FROM v_old->'vehicle_color'
      ) THEN
        RAISE EXCEPTION 'approved_vehicle_changes_require_admin_review';
      END IF;
      IF TG_TABLE_NAME = 'worker_profiles' AND v_new->'level' IS DISTINCT FROM v_old->'level' THEN
        RAISE EXCEPTION 'approved_worker_level_change_requires_admin_review';
      END IF;
    END IF;

    IF NEW.status <> 'approved' AND NEW.available THEN NEW.available := false; END IF;
  END IF;
  RETURN NEW;
END
$fn$;
