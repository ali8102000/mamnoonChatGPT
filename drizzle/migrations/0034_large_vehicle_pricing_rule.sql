INSERT INTO public.pricing_rules
  (vehicle_category, base_fare, per_km, per_min, minimum_fare, commission_pct, currency, active)
VALUES
  ('large', 1500, 400, 40, 2000, 0, 'IQD', true)
ON CONFLICT (vehicle_category) DO UPDATE SET
  base_fare = EXCLUDED.base_fare,
  per_km = EXCLUDED.per_km,
  per_min = EXCLUDED.per_min,
  minimum_fare = EXCLUDED.minimum_fare,
  commission_pct = EXCLUDED.commission_pct,
  currency = EXCLUDED.currency,
  active = EXCLUDED.active,
  updated_at = now();
