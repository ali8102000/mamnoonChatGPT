-- A provider may submit or resubmit documents, but only the trusted review
-- workflow may approve, reject, or alter review metadata.
CREATE OR REPLACE FUNCTION public.guard_provider_verification_owner_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_video_path text;
  v_expected_prefix text;
BEGIN
  IF auth.uid() IS NULL OR public.has_admin_access(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF NEW.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'verification_owner_must_match_auth_user';
  END IF;

  IF NEW.provider_type NOT IN ('driver', 'large_driver', 'worker') THEN
    RAISE EXCEPTION 'invalid_provider_verification_type';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.status := 'pending';
    NEW.rejection_reason := NULL;
    NEW.reviewed_at := NULL;
    NEW.submitted_at := now();
    NEW.updated_at := now();
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.provider_type IS DISTINCT FROM OLD.provider_type THEN
      RAISE EXCEPTION 'verification_identity_readonly';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF OLD.status = 'rejected' AND NEW.status = 'pending' THEN
        NEW.rejection_reason := NULL;
        NEW.reviewed_at := NULL;
        NEW.submitted_at := now();
      ELSE
        RAISE EXCEPTION 'verification_status_requires_admin_review';
      END IF;
    ELSE
      NEW.status := OLD.status;
      NEW.rejection_reason := OLD.rejection_reason;
      NEW.reviewed_at := OLD.reviewed_at;
      NEW.submitted_at := OLD.submitted_at;
    END IF;
    NEW.updated_at := now();
  END IF;

  v_video_path := NEW.metadata->>'vehicleVideoPath';
  IF NEW.provider_type IN ('driver', 'large_driver') THEN
    v_expected_prefix := NEW.user_id::text || '/' || NEW.provider_type || '/vehicle-video-';
    IF v_video_path IS NULL
       OR length(v_video_path) > 512
       OR position('..' in v_video_path) > 0
       OR left(v_video_path, length(v_expected_prefix)) <> v_expected_prefix
       OR v_video_path !~ '^' || NEW.user_id::text || '/' || NEW.provider_type || '/vehicle-video-[0-9]+-[a-z0-9]{6}\.(mp4|mov|webm)$' THEN
      RAISE EXCEPTION 'vehicle_video_path_must_belong_to_provider';
    END IF;
  ELSIF v_video_path IS NOT NULL THEN
    RAISE EXCEPTION 'vehicle_video_not_allowed_for_worker_verification';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS guard_provider_verification_owner_write
  ON public.provider_verifications;

CREATE TRIGGER guard_provider_verification_owner_write
BEFORE INSERT OR UPDATE ON public.provider_verifications
FOR EACH ROW
EXECUTE FUNCTION public.guard_provider_verification_owner_write();

REVOKE ALL ON FUNCTION public.guard_provider_verification_owner_write() FROM PUBLIC, anon, authenticated;
