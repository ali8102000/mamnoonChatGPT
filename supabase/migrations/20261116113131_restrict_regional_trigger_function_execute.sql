-- Regional trigger and helper functions are internal only.
revoke all on function public.regional_services_enabled(text) from public, anon, authenticated;
revoke all on function public.infer_governorate_key(numeric,numeric) from public, anon, authenticated;
revoke all on function public.touch_regional_service_control() from public, anon, authenticated;
revoke all on function public.guard_regional_service_request() from public, anon, authenticated;
revoke all on function public.guard_regional_request_acceptance() from public, anon, authenticated;
revoke all on function public.guard_regional_request_offer() from public, anon, authenticated;
revoke all on function public.cleanup_disabled_regional_dispatch() from public, anon, authenticated;
