import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/select-role")({
  ssr: false,
  component: SelectRoleRedirect,
});

function SelectRoleRedirect() {
  const { session, loading } = useAuth();
  if (loading) return null;
  return <Navigate to={session ? "/account-settings" : "/auth"} />;
}
