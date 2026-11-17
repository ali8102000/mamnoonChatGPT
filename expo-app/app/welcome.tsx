import { useEffect } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { router, Stack } from "expo-router";
import { useAuth } from "@/lib/auth-context";
import { palette } from "@/styles/theme";

export default function WelcomeScreen() {
  const { session, loading, roles } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (session) {
      router.replace(roles.includes("super_admin") ? "/admin/bootstrap" : "/home");
    } else {
      router.replace("/auth");
    }
  }, [loading, session?.user.id, roles]);

  return (
    <View style={styles.page}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.mark}><Text style={styles.markText}>م</Text></View>
      <Text style={styles.brand}>ممنون</Text>
      <Text style={styles.title}>أهلاً بك في ممنون</Text>
      <Text style={styles.desc}>مشوارك وخدماتك… بمكان واحد</Text>
      <ActivityIndicator size="small" color={palette.gold} style={styles.loader} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "transparent", alignItems: "center", justifyContent: "center", padding: 24 },
  mark: { width: 88, height: 88, borderRadius: 28, backgroundColor: palette.brand, alignItems: "center", justifyContent: "center", shadowColor: palette.brand, shadowOpacity: 0.22, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
  markText: { color: "#FFFFFF", fontSize: 48, fontWeight: "900", includeFontPadding: false },
  brand: { color: palette.ink, fontSize: 32, fontWeight: "900", marginTop: 14 },
  title: { color: palette.brand, fontSize: 25, fontWeight: "900", marginTop: 18, textAlign: "center" },
  desc: { color: palette.muted, fontSize: 14, fontWeight: "700", marginTop: 8 },
  loader: { marginTop: 28 },
});
