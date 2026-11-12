-- Restrict catalog tables that were intentionally readable by anonymous users.
-- Signed-in customers, workers and drivers retain read access.
-- No write permissions are granted by this migration.

BEGIN;

-- Service categories / catalog
DROP POLICY IF EXISTS "Services are public" ON public.services;
REVOKE SELECT ON TABLE public.services FROM anon, PUBLIC;
GRANT SELECT ON TABLE public.services TO authenticated;
CREATE POLICY "Services readable by signed-in users"
  ON public.services
  FOR SELECT
  TO authenticated
  USING (true);

-- Vehicle reference data
DROP POLICY IF EXISTS "vehicle_models readable" ON public.vehicle_models;
REVOKE SELECT ON TABLE public.vehicle_models FROM anon, PUBLIC;
GRANT SELECT ON TABLE public.vehicle_models TO authenticated;
CREATE POLICY "Vehicle models readable by signed-in users"
  ON public.vehicle_models
  FOR SELECT
  TO authenticated
  USING (true);

-- Pricing reference data
DROP POLICY IF EXISTS "Pricing readable by all" ON public.pricing_rules;
REVOKE SELECT ON TABLE public.pricing_rules FROM anon, PUBLIC;
GRANT SELECT ON TABLE public.pricing_rules TO authenticated;
CREATE POLICY "Pricing readable by signed-in users"
  ON public.pricing_rules
  FOR SELECT
  TO authenticated
  USING (true);

COMMIT;
