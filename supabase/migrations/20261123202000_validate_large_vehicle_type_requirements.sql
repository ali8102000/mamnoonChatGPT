-- Existing production rows have been checked for missing large-vehicle subtypes.
-- Validate both constraints so the complete dataset and all future writes are protected.
ALTER TABLE public.driver_profiles
  VALIDATE CONSTRAINT driver_profiles_large_vehicle_type_required;
ALTER TABLE public.service_requests
  VALIDATE CONSTRAINT service_requests_large_vehicle_type_required;
