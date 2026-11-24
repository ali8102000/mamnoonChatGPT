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
  v_target_governorate text;
  v_scope_type text;
BEGIN
  IF auth.uid() IS NULL OR public.is_platform_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  SELECT governorate_key INTO v_target_governorate
  FROM public.profiles
  WHERE id = NEW.user_id;
  v_scope_type := CASE WHEN v_target_governorate IS NULL THEN 'global' ELSE 'governorate' END;

  -- Delegated reviewers may update verification records only when their
  -- explicit providers.verify permission covers the provider's governorate.
  IF public.admin_has_permission('providers.verify', v_scope_type, v_target_governorate) THEN
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
  -- New pending driver applications must include a video. Existing approved
  -- legacy records without a video remain editable without retroactive lockout.
  IF NEW.provider_type IN ('driver', 'large_driver')
     AND (NEW.status = 'pending' OR v_video_path IS NOT NULL) THEN
    v_expected_prefix := NEW.user_id::text || '/' || NEW.provider_type || '/vehicle-video-';
    IF v_video_path IS NULL
       OR length(v_video_path) > 512
       OR position('..' in v_video_path) > 0
       OR left(v_video_path, length(v_expected_prefix)) <> v_expected_prefix
       OR v_video_path !~ ('^' || NEW.user_id::text || '/' || NEW.provider_type || '/vehicle-video-[0-9]+(-[a-z0-9]{6})?[.](mp4|mov|webm)$') THEN
      RAISE EXCEPTION 'vehicle_video_path_must_belong_to_provider';
    END IF;

    -- Validate the uploaded object when the video is submitted, changed, or
    -- the application moves into a reviewable state. Existing pending rows
    -- with a missing legacy upload remain editable until the provider resubmits.
    IF TG_OP = 'INSERT' THEN
      IF NOT EXISTS (
        SELECT 1 FROM storage.objects o
        WHERE o.bucket_id = 'provider-verification'
          AND o.name = v_video_path
          AND (storage.foldername(o.name))[1] = NEW.user_id::text
          AND lower(coalesce(o.metadata->>'mimetype','')) IN ('video/mp4','video/quicktime','video/webm')
      ) THEN
        RAISE EXCEPTION 'vehicle_video_upload_missing_or_invalid';
      END IF;
    ELSIF (
      (NEW.status IN ('pending','approved') AND OLD.status IS DISTINCT FROM NEW.status)
      OR OLD.metadata->>'vehicleVideoPath' IS DISTINCT FROM v_video_path
    ) THEN
      IF NOT EXISTS (
        SELECT 1 FROM storage.objects o
        WHERE o.bucket_id = 'provider-verification'
          AND o.name = v_video_path
          AND (storage.foldername(o.name))[1] = NEW.user_id::text
          AND lower(coalesce(o.metadata->>'mimetype','')) IN ('video/mp4','video/quicktime','video/webm')
      ) THEN
        RAISE EXCEPTION 'vehicle_video_upload_missing_or_invalid';
      END IF;
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
