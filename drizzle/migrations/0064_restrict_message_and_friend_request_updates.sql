-- Message edits are not a client capability; allow only the read receipt column.
REVOKE UPDATE ON TABLE public.messages FROM authenticated;
GRANT UPDATE (read_at) ON TABLE public.messages TO authenticated;

-- Friend acceptance/rejection is handled by respond_friend_request() only.
REVOKE UPDATE ON TABLE public.friend_requests FROM authenticated;
