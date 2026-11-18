-- Self-service verification submissions must never be able to approve themselves.
-- The AFTER trigger mirrors approved metadata into provider_vehicle_public, so
-- status must be controlled by the trusted review workflow, not the client.
CREATE OR REPLACE FUNCTION public.guard_provider_verification_owner_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF NEW.user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'verification_owner_must_match_auth_user';
    END IF;

    IF TG_OP = 'INSERT' THEN
      NEW.status := 'pending';
      NEW.rejection_reason := NULL;
      NEW.reviewed_at := NULL;
      NEW.submitted_at := now();
      NEW.updated_at := now();
    ELSIF TG_OP = 'UPDATE' THEN
      IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF OLD.status = 'rejected' AND NEW.status = 'pending' THEN
          -- Permit a rejected applicant to resubmit, but clear review metadata.
          NEW.rejection_reason := NULL;
          NEW.reviewed_at := NULL;
          NEW.submitted_at := now();
        ELSE
          RAISE EXCEPTION 'verification_status_requires_admin_review';
        END IF;
      ELSE
        -- Client edits while pending cannot alter review/audit timestamps.
        NEW.status := OLD.status;
        NEW.rejection_reason := OLD.rejection_reason;
        NEW.reviewed_at := OLD.reviewed_at;
        NEW.submitted_at := OLD.submitted_at;
      END IF;
      NEW.updated_at := now();
    END IF;
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS guard_provider_verification_owner_write
  ON public.provider_verifications;

CREATE TRIGGER guard_provider_verification_owner_write
BEFORE INSERT OR UPDATE ON public.provider_verifications
FOR EACH ROW
EXECUTE FUNCTION public.guard_provider_verification_owner_write();

REVOKE EXECUTE ON FUNCTION public.guard_provider_verification_owner_write()
  FROM PUBLIC, anon, authenticated;
