import { Redirect } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { useAuth } from "@/lib/auth-context";
import { useCompanyBranding } from "@/lib/company-branding";
import { useEffect, useState } from "react";
import { View, ActivityIndicator, Image, Text, StyleSheet } from "react-native";

export default function Index() {
  const { loading, session, roles } = useAuth();
  const { companyName, logoUrl, welcomeMessage } = useCompanyBranding();
  const [splashFinished, setSplashFinished] = useState(false);
  const [nextRoute, setNextRoute] = useState<"/select-governorate" | "/auth" | "/home" | "/admin/bootstrap" | null>(null);

  // Do not add an artificial splash delay; route as soon as auth is ready.
  useEffect(() => {
    if (!loading) setSplashFinished(true);
  }, [loading]);

  useEffect(() => {
    if (loading || !splashFinished || nextRoute) return;
    let active = true;
    void (async () => {
      try {
        const saved = Platform.OS === "web" && typeof localStorage !== "undefined"
          ? localStorage.getItem("mamnoon_governorate")
          : await Promise.race([
              SecureStore.getItemAsync("mamnoon_governorate"),
              new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
            ]);
        if (active) setNextRoute(saved ? (session ? (roles.includes("super_admin") ? "/admin/bootstrap" : "/home") : "/auth") : "/select-governorate");
      } catch (error) {
        console.warn("[startup] Saved governorate unavailable; opening safe selection:", error);
        if (active) setNextRoute("/select-governorate");
      }
    })();
    return () => { active = false; };
  }, [loading, splashFinished, nextRoute, session?.user.id, roles]);

  if (loading || !splashFinished || !nextRoute) {
    return (
      <View style={styles.center}>
        {logoUrl ? <Image source={{uri:logoUrl}} style={styles.logo} resizeMode="contain" /> : <View style={styles.logoFallback}><Text style={styles.logoLetter}>م</Text></View>}
        <Text style={styles.brand}>أهلاً بك في {companyName}</Text>
        <Text style={styles.tagline}>{welcomeMessage}</Text>
        {loading ? <ActivityIndicator size="small" color="#C99A35" style={styles.loader} /> : <View style={styles.loaderSpace} />}
      </View>
    );
  }

  return <Redirect href={nextRoute} />;
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "transparent", padding: 24 },
  logo: { width: 112, height: 112, marginBottom: 14, borderRadius: 24, backgroundColor: "#FFFFFF" },
  logoFallback: { width: 112, height: 112, marginBottom: 14, borderRadius: 28, backgroundColor: "#17324D", alignItems: "center", justifyContent: "center" },
  logoLetter: { color: "#FFFFFF", fontSize: 58, fontWeight: "900" },
  brand: { color: "#17324D", fontSize: 27, fontWeight: "900", letterSpacing: 0.1, textAlign: "center" },
  tagline: { color: "#758394", fontSize: 13, fontWeight: "600", marginTop: 8 },
  loader: { marginTop: 26 },
  loaderSpace: { height: 42 },
});
