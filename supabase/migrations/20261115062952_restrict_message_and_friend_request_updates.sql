REVOKE UPDATE ON TABLE public.messages FROM authenticated;
GRANT UPDATE (read_at) ON TABLE public.messages TO authenticated;

-- Friend responses are already performed by the authenticated, SECURITY DEFINER RPC.
-- Do not allow clients to rewrite sender/receiver/status fields directly.
REVOKE UPDATE ON TABLE public.friend_requests FROM authenticated;
