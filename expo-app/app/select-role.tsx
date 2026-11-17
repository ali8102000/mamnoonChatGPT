import { Redirect } from "expo-router";
import { useAuth } from "@/lib/auth-context";

export default function SelectRoleRedirect() {
  const { user, loading } = useAuth();
  if (loading) return null;
  return <Redirect href={user ? "/account-settings" : "/auth"} />;
}
