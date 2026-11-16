import { Redirect } from "expo-router";
import { useAuth } from "@/lib/auth-context";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import * as SecureStore from "expo-secure-store";
import { useEffect, useState } from "react";

export default function Index() {
  const { session, loading, roles, profile } = useAuth();
  const [welcomeReady, setWelcomeReady] = useState(false);
  const [welcomeCompleted, setWelcomeCompleted] = useState(false);
  useEffect(() => {
    let active = true;
    SecureStore.getItemAsync("mumnun-welcome-v1").then((raw) => {
      if (!active) return;
      try { setWelcomeCompleted(JSON.parse(raw || "null")?.completed === true); }
      catch { setWelcomeCompleted(false); }
    }).finally(() => { if (active) setWelcomeReady(true); });
    return () => { active = false; };
  }, []);
  if (loading || !welcomeReady) return <View style={styles.center}><ActivityIndicator size="large" color="#2563eb" /></View>;
  if (!session) return <Redirect href={welcomeCompleted ? "/auth" : "/welcome"} />;
  if (!profile || roles.length === 0) return <Redirect href="/select-role" />;
  return <Redirect href="/home" />;
}
const styles = StyleSheet.create({ center: { flex: 1, justifyContent: "center", alignItems: "center" } });
