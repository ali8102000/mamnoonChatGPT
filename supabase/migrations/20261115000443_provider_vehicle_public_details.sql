-- Expose only approved vehicle identification details to the driver and the customer assigned to an active ride.
CREATE TABLE IF NOT EXISTS public.provider_vehicle_public (
  provider_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  vehicle_make text,
  vehicle_model text,
  vehicle_year text,
  vehicle_color text,
  vehicle_plate text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.provider_vehicle_public ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.provider_vehicle_public FROM anon, authenticated;
GRANT SELECT ON public.provider_vehicle_public TO authenticated;

DROP POLICY IF EXISTS "Ride participants can read approved vehicle details" ON public.provider_vehicle_public;
CREATE POLICY "Ride participants can read approved vehicle details"
  ON public.provider_vehicle_public
  FOR SELECT
  TO authenticated
  USING (
    provider_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.service_requests AS request
      WHERE request.provider_id = provider_vehicle_public.provider_id
        AND request.customer_id = (SELECT auth.uid())
        AND request.status IN ('accepted', 'in_progress')
    )
  );

CREATE OR REPLACE FUNCTION public.sync_provider_vehicle_public_details()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.provider_vehicle_public WHERE provider_id = OLD.user_id;
    RETURN OLD;
  END IF;

  IF NEW.status = 'approved' THEN
    INSERT INTO public.provider_vehicle_public (
      provider_id, vehicle_make, vehicle_model, vehicle_year, vehicle_color, vehicle_plate, updated_at
    )
    VALUES (
      NEW.user_id,
      NULLIF(BTRIM(NEW.metadata ->> 'vehicleMake'), ''),
      NULLIF(BTRIM(NEW.metadata ->> 'vehicleModel'), ''),
      NULLIF(BTRIM(NEW.metadata ->> 'vehicleYear'), ''),
      NULLIF(BTRIM(NEW.metadata ->> 'vehicleColor'), ''),
      NULLIF(BTRIM(NEW.metadata ->> 'vehiclePlate'), ''),
      now()
    )
    ON CONFLICT (provider_id) DO UPDATE SET
      vehicle_make = EXCLUDED.vehicle_make,
      vehicle_model = EXCLUDED.vehicle_model,
      vehicle_year = EXCLUDED.vehicle_year,
      vehicle_color = EXCLUDED.vehicle_color,
      vehicle_plate = EXCLUDED.vehicle_plate,
      updated_at = now();
  ELSE
    DELETE FROM public.provider_vehicle_public WHERE provider_id = NEW.user_id;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_provider_vehicle_public_details() FROM PUBLIC;

DROP TRIGGER IF EXISTS sync_provider_vehicle_public_details_trigger ON public.provider_verifications;
CREATE TRIGGER sync_provider_vehicle_public_details_trigger
  AFTER INSERT OR UPDATE OF status, metadata OR DELETE
  ON public.provider_verifications
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_provider_vehicle_public_details();

INSERT INTO public.provider_vehicle_public (
  provider_id, vehicle_make, vehicle_model, vehicle_year, vehicle_color, vehicle_plate, updated_at
)
SELECT DISTINCT ON (user_id)
  user_id,
  NULLIF(BTRIM(metadata ->> 'vehicleMake'), ''),
  NULLIF(BTRIM(metadata ->> 'vehicleModel'), ''),
  NULLIF(BTRIM(metadata ->> 'vehicleYear'), ''),
  NULLIF(BTRIM(metadata ->> 'vehicleColor'), ''),
  NULLIF(BTRIM(metadata ->> 'vehiclePlate'), ''),
  now()
FROM public.provider_verifications
WHERE status = 'approved'
ORDER BY user_id, reviewed_at DESC NULLS LAST, updated_at DESC
ON CONFLICT (provider_id) DO UPDATE SET
  vehicle_make = EXCLUDED.vehicle_make,
  vehicle_model = EXCLUDED.vehicle_model,
  vehicle_year = EXCLUDED.vehicle_year,
  vehicle_color = EXCLUDED.vehicle_color,
  vehicle_plate = EXCLUDED.vehicle_plate,
  updated_at = now();
