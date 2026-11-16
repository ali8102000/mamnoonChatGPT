import { Redirect } from "expo-router";
import { useAuth } from "@/lib/auth-context";
import brandIcon from "../assets/favicon.png";
import { useEffect, useState } from "react";
import { View, ActivityIndicator, Image, Text, StyleSheet } from "react-native";

export default function Index() {
  const { loading } = useAuth();
  const [splashFinished, setSplashFinished] = useState(false);

  // Show the Mamnoon brand screen on every cold app launch, then continue
  // through the existing welcome/auth flow without changing the session.
  useEffect(() => {
    if (loading) return;
    const timer = setTimeout(() => setSplashFinished(true), 1200);
    return () => clearTimeout(timer);
  }, [loading]);

  if (loading || !splashFinished) {
    return (
      <View style={styles.center}>
        <Image source={brandIcon} style={styles.logo} resizeMode="contain" />
        <Text style={styles.brand}>ممنون</Text>
        <Text style={styles.tagline}>مشوارك وخدماتك… بمكان واحد</Text>
        {loading ? <ActivityIndicator size="small" color="#C99A35" style={styles.loader} /> : <View style={styles.loaderSpace} />}
      </View>
    );
  }

  return <Redirect href="/welcome" />;
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#F7F8F5", padding: 24 },
  logo: { width: 112, height: 112, marginBottom: 14 },
  brand: { color: "#17324D", fontSize: 34, fontWeight: "900", letterSpacing: 0.3 },
  tagline: { color: "#758394", fontSize: 13, fontWeight: "600", marginTop: 8 },
  loader: { marginTop: 26 },
  loaderSpace: { height: 42 },
});
