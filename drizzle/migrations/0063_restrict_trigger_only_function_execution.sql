-- Trigger-only functions are invoked by PostgreSQL triggers, not through client RPC.
REVOKE EXECUTE ON FUNCTION public.guard_message_read_receipt() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_live_location_ownership() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.apply_coupon_to_new_request() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.close_terminal_request_dispatch() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_coupon_subsidy_payable() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_request_coupon_tampering() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.record_new_request_coupon() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.restore_coupon_after_request_cancel() FROM authenticated;
