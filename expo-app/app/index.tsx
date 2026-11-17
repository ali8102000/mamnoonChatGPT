import { Redirect } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { useAuth } from "@/lib/auth-context";
import brandIcon from "../assets/favicon.png";
import { useEffect, useState } from "react";
import { View, ActivityIndicator, Image, Text, StyleSheet } from "react-native";

export default function Index() {
  const { loading, session, roles } = useAuth();
  const [splashFinished, setSplashFinished] = useState(false);
  const [nextRoute, setNextRoute] = useState<"/select-governorate" | "/auth" | "/home" | "/admin/bootstrap" | null>(null);

  // Show a brief branded greeting, then open the signed-in account directly.
  useEffect(() => {
    if (loading) return;
    const timer = setTimeout(() => setSplashFinished(true), 1200);
    return () => clearTimeout(timer);
  }, [loading]);

  useEffect(() => {
    if (loading || !splashFinished || nextRoute) return;
    let active = true;
    void (async () => {
      try {
        const saved = Platform.OS === "web" && typeof localStorage !== "undefined"
          ? localStorage.getItem("mamnoon_governorate")
          : await SecureStore.getItemAsync("mamnoon_governorate");
        if (active) setNextRoute(saved ? (session ? (roles.includes("super_admin") ? "/admin/bootstrap" : "/home") : "/auth") : "/select-governorate");
      } catch {
        if (active) setNextRoute("/select-governorate");
      }
    })();
    return () => { active = false; };
  }, [loading, splashFinished, nextRoute, session?.user.id, roles]);

  if (loading || !splashFinished || !nextRoute) {
    return (
      <View style={styles.center}>
        <Image source={brandIcon} style={styles.logo} resizeMode="contain" />
        <Text style={styles.brand}>أهلاً بك في ممنون</Text>
        <Text style={styles.tagline}>مشوارك وخدماتك… بمكان واحد</Text>
        {loading ? <ActivityIndicator size="small" color="#C99A35" style={styles.loader} /> : <View style={styles.loaderSpace} />}
      </View>
    );
  }

  return <Redirect href={nextRoute} />;
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "transparent", padding: 24 },
  logo: { width: 112, height: 112, marginBottom: 14 },
  brand: { color: "#17324D", fontSize: 27, fontWeight: "900", letterSpacing: 0.1, textAlign: "center" },
  tagline: { color: "#758394", fontSize: 13, fontWeight: "600", marginTop: 8 },
  loader: { marginTop: 26 },
  loaderSpace: { height: 42 },
});
