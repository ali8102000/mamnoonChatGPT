import { Redirect } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { useAuth } from "@/lib/auth-context";
import { useCompanyBranding } from "@/lib/company-branding";
import { useEffect, useRef, useState } from "react";
import { View, ActivityIndicator, Image, Text, StyleSheet, Animated, Easing } from "react-native";

export default function Index() {
  const { loading, session, roles } = useAuth();
  const { companyName, logoUrl, welcomeMessage, welcomeVisualUrl, welcomeVisualAnimated, isLoaded: brandingLoaded } = useCompanyBranding();
  const [splashFinished, setSplashFinished] = useState(false);
  const visualScale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!welcomeVisualAnimated || !welcomeVisualUrl) { visualScale.stopAnimation(); visualScale.setValue(1); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(visualScale, { toValue: 1.035, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(visualScale, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [welcomeVisualAnimated, welcomeVisualUrl, visualScale]);
  const [nextRoute, setNextRoute] = useState<"/select-governorate" | "/auth" | "/home" | "/admin/bootstrap" | null>(null);

  // Do not add an artificial splash delay; route as soon as auth is ready.
  useEffect(() => {
    if (!loading) setSplashFinished(true);
  }, [loading]);

  useEffect(() => {
    if (loading || !brandingLoaded || !splashFinished || nextRoute) return;
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
  }, [loading, brandingLoaded, splashFinished, nextRoute, session?.user.id, roles]);

  if (loading || !brandingLoaded || !splashFinished || !nextRoute) {
    return (
      <View style={styles.center}>
        {logoUrl ? <Image source={{uri:logoUrl}} style={styles.logo} resizeMode="contain" /> : <View style={styles.logoFallback}><Text style={styles.logoLetter}>م</Text></View>}
        <Text style={styles.brand}>أهلاً بك في {companyName}</Text>
        {welcomeVisualUrl ? <Animated.View style={{ transform: [{ scale: visualScale }] }}><Image source={{ uri: welcomeVisualUrl }} style={styles.welcomeVisual} resizeMode="cover" /></Animated.View> : null}
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
  welcomeVisual: { width: "100%", maxWidth: 340, height: 150, borderRadius: 22, marginTop: 14, backgroundColor: "#050B13" },
  tagline: { color: "#526477", fontSize: 15, fontWeight: "700", marginTop: 12, width: "100%", maxWidth: 340, textAlign: "center", lineHeight: 27, flexWrap: "wrap", includeFontPadding: false },
  loader: { marginTop: 26 },
  loaderSpace: { height: 42 },
});
