-- Email and phone are changed only through Supabase Auth verification flows.
REVOKE UPDATE (email, phone) ON TABLE public.profiles FROM authenticated;
