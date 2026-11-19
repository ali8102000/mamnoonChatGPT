-- Allow unauthenticated app startup to read only the public branding fields.
-- Row-level security remains enabled and the existing anon SELECT policy limits rows.
GRANT SELECT (id, company_name, company_logo_url, welcome_message)
ON TABLE public.company_settings TO anon;
