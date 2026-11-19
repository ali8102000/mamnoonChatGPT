import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, Image } from "react-native";
import { router, Stack } from "expo-router";
import { useAuth } from "@/lib/auth-context";
import { palette } from "@/styles/theme";
import { useCompanyBranding } from "@/lib/company-branding";

export default function WelcomeScreen() {
  const { session, loading, roles } = useAuth();
  const { companyName, logoUrl, welcomeMessage } = useCompanyBranding();

  useEffect(() => {
    if (loading) return;
    if (session) {
      if (roles.includes("super_admin")) router.replace("/admin/bootstrap");
      else router.replace("/home");
    } else {
      router.replace("/auth");
    }
  }, [loading, session?.user.id, roles]);

  return (
    <View style={styles.page}>
      <Stack.Screen options={{ headerShown: false }} />
      {logoUrl ? <Image source={{ uri: logoUrl }} style={styles.logo} resizeMode="contain" /> : <View style={styles.mark}><Text style={styles.markText}>م</Text></View>}
      <Text style={styles.brand}>{companyName}</Text>
      <Text style={styles.title}>أهلاً بك في ممنون</Text>
      <Text style={styles.desc}>{welcomeMessage}</Text>
      <ActivityIndicator size="small" color={palette.gold} style={styles.loader} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "transparent", alignItems: "center", justifyContent: "center", padding: 24 },
  logo: { width: 104, height: 104, borderRadius: 24, backgroundColor: "#FFFFFF", marginBottom: 6 },
  mark: { width: 88, height: 88, borderRadius: 28, backgroundColor: palette.brand, alignItems: "center", justifyContent: "center", shadowColor: palette.brand, shadowOpacity: 0.22, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
  markText: { color: "#FFFFFF", fontSize: 48, fontWeight: "900", includeFontPadding: false },
  brand: { color: palette.ink, fontSize: 32, fontWeight: "900", marginTop: 14 },
  title: { color: palette.brand, fontSize: 25, fontWeight: "900", marginTop: 18, textAlign: "center" },
  desc: { color: palette.muted, fontSize: 14, fontWeight: "700", marginTop: 8 },
  loader: { marginTop: 28 },
});
