import { Redirect } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { Image as ExpoImage } from "expo-image";
import { useAuth } from "@/lib/auth-context";
import mamnoonLogo from "../assets/mamnoon-logo.png";
import { useCompanyBranding } from "@/lib/company-branding";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, View, ActivityIndicator, Image, Text, StyleSheet, Animated, Easing } from "react-native";

export default function Index() {
  const { loading, session, roles } = useAuth();
  const { companyName, logoUrl, welcomeMessage, welcomeVisualUrl, welcomeVisualAnimated, welcomeVisualSizePx, isLoaded: brandingLoaded } = useCompanyBranding();
  const [splashFinished, setSplashFinished] = useState(false);
  const [reduceMotionEnabled, setReduceMotionEnabled] = useState<boolean | null>(null);
  const shouldAnimateBranding = welcomeVisualAnimated && reduceMotionEnabled === false;
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) setReduceMotionEnabled(enabled);
    }).catch(() => {
      // Prefer a static startup visual if the device accessibility setting cannot be read.
      if (active) setReduceMotionEnabled(true);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotionEnabled);
    return () => { active = false; subscription.remove(); };
  }, []);
  const visualScale = useRef(new Animated.Value(1)).current;
  const logoScale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!shouldAnimateBranding) { logoScale.stopAnimation(); logoScale.setValue(1); return; }
    const logoLoop = Animated.loop(Animated.sequence([
      Animated.timing(logoScale, { toValue: 1.045, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(logoScale, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    logoLoop.start();
    return () => logoLoop.stop();
  }, [shouldAnimateBranding, logoScale]);
  useEffect(() => {
    if (!shouldAnimateBranding || !welcomeVisualUrl) { visualScale.stopAnimation(); visualScale.setValue(1); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(visualScale, { toValue: 1.035, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(visualScale, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [shouldAnimateBranding, welcomeVisualUrl, visualScale]);
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
        <Animated.View style={{ transform: [{ scale: logoScale }] }}>
          <Image source={logoUrl ? { uri: logoUrl } : mamnoonLogo} style={styles.logo} resizeMode="contain" />
        </Animated.View>
        <Text style={styles.brand}>أهلاً بك في {companyName}</Text>
        {welcomeVisualUrl ? <Animated.View style={{ transform: [{ scale: visualScale }] }}><ExpoImage source={{ uri: welcomeVisualUrl }} style={[styles.welcomeVisual,{width:welcomeVisualSizePx,height:welcomeVisualSizePx}]} contentFit="cover" autoplay={reduceMotionEnabled === false} /></Animated.View> : null}
        <Text style={styles.tagline}>{welcomeMessage}</Text>
        {loading ? <ActivityIndicator size="small" color="#C99A35" style={styles.loader} /> : <View style={styles.loaderSpace} />}
      </View>
    );
  }

  return <Redirect href={nextRoute} />;
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "transparent", padding: 24 },
  logo: { width: 164, height: 164, marginBottom: 14, borderRadius: 24, backgroundColor: "#FFFFFF" },
  brand: { color: "#17324D", fontSize: 27, fontWeight: "900", letterSpacing: 0.1, textAlign: "center", width: "100%", maxWidth: 340, lineHeight: 38, flexShrink: 1 },
  welcomeVisual: { maxWidth: "100%", borderRadius: 24, marginTop: 14, backgroundColor: "#050B13", overflow: "hidden" },
  tagline: { color: "#526477", fontSize: 15, fontWeight: "700", marginTop: 12, width: "100%", maxWidth: 340, textAlign: "center", lineHeight: 27, flexWrap: "wrap", includeFontPadding: false },
  loader: { marginTop: 26 },
  loaderSpace: { height: 42 },
});
