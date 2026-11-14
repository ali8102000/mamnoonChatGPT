REVOKE ALL ON FUNCTION public.apply_coupon_to_new_request() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.close_terminal_request_dispatch() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_coupon_subsidy_payable() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.prevent_request_coupon_tampering() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_new_request_coupon() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.restore_coupon_after_request_cancel() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.apply_coupon_to_new_request() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.close_terminal_request_dispatch() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_coupon_subsidy_payable() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prevent_request_coupon_tampering() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_new_request_coupon() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.restore_coupon_after_request_cancel() TO authenticated, service_role;
