-- Approved provider vehicle/qualification details require the reviewed admin workflow.
CREATE OR REPLACE FUNCTION public.guard_provider_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_admin_access(auth.uid()) THEN
    IF TG_OP = 'INSERT' THEN
      IF TG_TABLE_NAME = 'driver_profiles' THEN
        NEW.status := 'pending';
      ELSE
        NEW.status := 'approved';
      END IF;
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NOT (
        TG_TABLE_NAME = 'driver_profiles'
        AND auth.uid() = OLD.user_id
        AND OLD.status = 'rejected'
        AND NEW.status = 'pending'
      ) THEN
        RAISE EXCEPTION 'status_readonly';
      END IF;
    END IF;

    IF TG_OP = 'UPDATE' AND NEW.rating_avg IS DISTINCT FROM OLD.rating_avg THEN
      RAISE EXCEPTION 'rating_readonly';
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.status = 'approved' THEN
      IF TG_TABLE_NAME = 'driver_profiles' AND (
        NEW.vehicle_make IS DISTINCT FROM OLD.vehicle_make
        OR NEW.vehicle_model IS DISTINCT FROM OLD.vehicle_model
        OR NEW.vehicle_year IS DISTINCT FROM OLD.vehicle_year
        OR NEW.vehicle_category IS DISTINCT FROM OLD.vehicle_category
        OR NEW.vehicle_type IS DISTINCT FROM OLD.vehicle_type
        OR NEW.vehicle_plate IS DISTINCT FROM OLD.vehicle_plate
        OR NEW.vehicle_color IS DISTINCT FROM OLD.vehicle_color
      ) THEN
        RAISE EXCEPTION 'approved_vehicle_changes_require_admin_review';
      END IF;

      IF TG_TABLE_NAME = 'worker_profiles' AND NEW.level IS DISTINCT FROM OLD.level THEN
        RAISE EXCEPTION 'approved_worker_level_change_requires_admin_review';
      END IF;
    END IF;

    IF NEW.status <> 'approved' AND NEW.available THEN
      NEW.available := false;
    END IF;
  END IF;

  RETURN NEW;
END
$fn$;
