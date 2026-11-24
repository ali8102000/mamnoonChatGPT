-- Expose the app editor settings through Supabase Data API; RLS policies still scope writes to super admins.
grant select on table public.app_editor_settings to anon, authenticated;
grant insert, update, delete on table public.app_editor_settings to authenticated;
