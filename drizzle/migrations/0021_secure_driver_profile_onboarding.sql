-- Secure driver onboarding: drivers can create/read/update only their own profile,
-- while staff can review profiles. A new driver must always start as pending.
BEGIN;

ALTER TABLE public.driver_profiles ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'driver_profiles'
      AND policyname = 'Drivers read own profile or staff'
  ) THEN
    CREATE POLICY "Drivers read own profile or staff"
      ON public.driver_profiles
      FOR SELECT TO authenticated
      USING (auth.uid() = user_id OR public.has_admin_access(auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'driver_profiles'
      AND policyname = 'Drivers insert own profile'
  ) THEN
    CREATE POLICY "Drivers insert own profile"
      ON public.driver_profiles
      FOR INSERT TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'driver_profiles'
      AND policyname = 'Drivers update own profile or staff'
  ) THEN
    CREATE POLICY "Drivers update own profile or staff"
      ON public.driver_profiles
      FOR UPDATE TO authenticated
      USING (auth.uid() = user_id OR public.has_admin_access(auth.uid()))
      WITH CHECK (auth.uid() = user_id OR public.has_admin_access(auth.uid()));
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.guard_provider_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_admin_access(auth.uid()) THEN
    IF TG_OP = 'INSERT' THEN
      -- Driver registrations must wait for administrator approval.
      -- Preserve the existing technician behavior to avoid changing that workflow.
      IF TG_TABLE_NAME = 'driver_profiles' THEN
        NEW.status := 'pending';
      ELSE
        NEW.status := 'approved';
      END IF;
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'status_readonly';
    END IF;

    IF TG_OP = 'UPDATE' AND NEW.rating_avg IS DISTINCT FROM OLD.rating_avg THEN
      RAISE EXCEPTION 'rating_readonly';
    END IF;

    IF NEW.status <> 'approved' AND NEW.available THEN
      NEW.available := false;
    END IF;
  END IF;

  RETURN NEW;
END
$$;

COMMIT;
