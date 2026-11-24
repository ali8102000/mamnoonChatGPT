-- The weather-monitor Edge Function uses the service_role key to read governorate
-- settings, upsert observations, and update monitor readiness.
-- These tables intentionally expose SELECT to authorized admins only; keep that
-- restriction unchanged and grant the backend role only the operations it needs.
grant select, insert, update
on table public.taxi_peak_weather_settings, public.taxi_peak_weather_observations
to service_role;
