INSERT INTO public.vehicle_models (make, model, category, base_fare, per_km, min_year)
VALUES
  ('Kia', 'كيا حمل', 'large', 2500, 500, 2000),
  ('Kia', 'كيا ركاب', 'large', 2500, 500, 2000)
ON CONFLICT (make, model) DO UPDATE SET
  category = EXCLUDED.category,
  base_fare = EXCLUDED.base_fare,
  per_km = EXCLUDED.per_km,
  min_year = EXCLUDED.min_year;
