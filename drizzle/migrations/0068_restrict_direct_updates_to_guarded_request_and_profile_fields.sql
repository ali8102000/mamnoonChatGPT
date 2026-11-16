-- Force service-request mutations through guarded RPCs and keep profile writes to owner-editable fields.
REVOKE UPDATE ON TABLE public.service_requests FROM authenticated;
--> statement-breakpoint
REVOKE UPDATE ON TABLE public.driver_profiles FROM authenticated;
GRANT UPDATE (user_id, vehicle_make, vehicle_model, vehicle_year, vehicle_category, vehicle_type, vehicle_plate, vehicle_color, available, status)
ON TABLE public.driver_profiles TO authenticated;
--> statement-breakpoint
REVOKE UPDATE ON TABLE public.worker_profiles FROM authenticated;
GRANT UPDATE (user_id, level, bio, available, status)
ON TABLE public.worker_profiles TO authenticated;
--> statement-breakpoint
REVOKE UPDATE ON TABLE public.profiles FROM authenticated;
GRANT UPDATE (full_name, avatar_url, email, phone)
ON TABLE public.profiles TO authenticated;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_notification_read_receipt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF auth.uid() IS NULL OR OLD.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'notification_owner_required';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.type IS DISTINCT FROM OLD.type
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.body IS DISTINCT FROM OLD.body
     OR NEW.link IS DISTINCT FROM OLD.link
     OR NEW.data IS DISTINCT FROM OLD.data
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'notification_content_is_immutable';
  END IF;

  IF OLD.read_at IS NOT NULL THEN
    IF NEW.read_at IS DISTINCT FROM OLD.read_at THEN
      RAISE EXCEPTION 'notification_already_read';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.read_at IS NULL THEN
    RAISE EXCEPTION 'notification_read_at_required';
  END IF;

  NEW.read_at := now();
  RETURN NEW;
END
$fn$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_guard_notification_read_receipt ON public.notifications;
CREATE TRIGGER trg_guard_notification_read_receipt
BEFORE UPDATE ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.guard_notification_read_receipt();
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.guard_notification_read_receipt() FROM PUBLIC, anon, authenticated;
REVOKE UPDATE ON TABLE public.notifications FROM authenticated;
GRANT UPDATE (read_at) ON TABLE public.notifications TO authenticated;
