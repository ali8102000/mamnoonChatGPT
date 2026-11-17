import { Redirect } from "expo-router";
import { useAuth } from "@/lib/auth-context";

export default function SelectRole() {
  const { user, loading } = useAuth();
  if (loading) return null;
  return <Redirect href={user ? "/home" : "/auth"} />;
}
