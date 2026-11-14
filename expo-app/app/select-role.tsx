import { useState } from "react";
import { router } from "expo-router";
import { View, Text, StyleSheet, Pressable, Alert, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { palette, radius, space } from "@/styles/theme";

const ROLES = [
  { key: "customer", label: "الزبون", desc: "اطلب سيارة أو فني وخدمات للبيت", mark: "ز", detail: "حجز ومتابعة" },
  { key: "driver", label: "كابتن تكسي", desc: "استقبل رحلات التكسي القريبة", mark: "س", detail: "رحلات" },
  { key: "large_driver", label: "سائق سيارات كبيرة", desc: "طلبات كيا حمل وكيا ركاب", mark: "ك", detail: "نقل وحمولات" },
  { key: "worker", label: "الفني", desc: "استقبل طلبات الصيانة والخدمات", mark: "ف", detail: "خدمات منزلية" },
] as const;

export default function SelectRole() {
  const { user, refresh } = useAuth();
  const [busy, setBusy] = useState(false);

  async function pickRole(role: string) {
    if (!user) {
      Alert.alert("يلزم تسجيل الدخول", "سجّل الدخول أولاً حتى تختار طريقة استخدام ممنون.");
      return;
    }
    setBusy(true);
    try {
      if (role === "driver") {
        router.push("/onboarding/driver");
        return;
      }
      if (role === "large_driver") {
        router.push({ pathname: "/onboarding/driver", params: { providerType: "large_driver" } });
        return;
      }
      if (role === "worker") {
        router.push("/onboarding/worker");
        return;
      }

      const { data: existingRole, error: lookupError } = await supabase
        .from("user_roles").select("role").eq("user_id", user.id).eq("role", "customer").maybeSingle();
      if (lookupError) throw lookupError;
      if (!existingRole) {
        const { error: insertError } = await supabase.from("user_roles").insert({ user_id: user.id, role: "customer" });
        if (insertError && insertError.code !== "23505") throw insertError;
      }
      await refresh();
      router.replace("/home");
    } catch (err: unknown) {
      Alert.alert("تعذر اختيار الحساب", err instanceof Error ? err.message : "حدث خطأ غير متوقع");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.brandRow}>
          <View style={styles.brandMark}><Text style={styles.brandLetter}>م</Text></View>
          <Text style={styles.brandName}>ممنون</Text>
        </View>
        <Text style={styles.eyebrow}>تجربة واحدة لكل احتياجاتك</Text>
        <Text style={styles.title}>شلون تحب تستخدم ممنون؟</Text>
        <Text style={styles.subtitle}>اختَر حسابك هسه، وتكدر تضيف أدوار ثانية وتبدّل بينها بأي وقت.</Text>

        <View style={styles.roleList}>
          {ROLES.map((role, index) => (
            <Pressable
              key={role.key}
              accessibilityRole="button"
              accessibilityState={{ disabled: busy }}
              onPress={() => pickRole(role.key)}
              disabled={busy}
              style={({ pressed }) => [styles.roleCard, pressed && styles.rolePressed, busy && styles.disabled]}
            >
              <View style={[styles.roleMark, index === 0 && styles.customerMark]}>
                <Text style={styles.roleMarkText}>{role.mark}</Text>
              </View>
              <View style={styles.roleCopy}>
                <Text style={styles.roleTitle}>{role.label}</Text>
                <Text style={styles.roleDesc}>{role.desc}</Text>
                <Text style={styles.roleDetail}>{role.detail}</Text>
              </View>
              <View style={styles.arrowCircle}><Text style={styles.arrow}>‹</Text></View>
            </Pressable>
          ))}
        </View>

        <View style={styles.footnote}>
          <View style={styles.goldLine} />
          <Text style={styles.footnoteText}>كل أدوارك تبقى مرتبطة بحساب واحد</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.canvas },
  container: { flexGrow: 1, paddingHorizontal: space.xl, paddingTop: space.xl, paddingBottom: space.huge },
  brandRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: space.xxl },
  brandMark: { width: 36, height: 36, borderRadius: 12, backgroundColor: palette.brand, borderWidth: 1, borderColor: palette.gold, alignItems: "center", justifyContent: "center" },
  brandLetter: { color: palette.white, fontWeight: "900", fontSize: 20 },
  brandName: { color: palette.ink, fontSize: 20, fontWeight: "900" },
  eyebrow: { color: palette.gold, fontSize: 11, fontWeight: "900", textAlign: "center", marginBottom: 9 },
  title: { color: palette.ink, fontSize: 27, fontWeight: "900", textAlign: "center" },
  subtitle: { color: palette.muted, fontSize: 13, lineHeight: 22, textAlign: "center", marginTop: 9, marginBottom: space.xxl, paddingHorizontal: 4 },
  roleList: { gap: 12 },
  roleCard: { flexDirection: "row", alignItems: "center", backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.xl, padding: space.lg, minHeight: 112 },
  rolePressed: { borderColor: palette.gold, backgroundColor: "#FBFAF6", transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.6 },
  roleMark: { width: 54, height: 54, borderRadius: 18, backgroundColor: palette.brandSoft, alignItems: "center", justifyContent: "center" },
  customerMark: { backgroundColor: palette.goldSoft },
  roleMarkText: { color: palette.brand, fontSize: 25, fontWeight: "900" },
  roleCopy: { flex: 1, paddingHorizontal: 14 },
  roleTitle: { color: palette.ink, fontSize: 16, fontWeight: "900" },
  roleDesc: { color: palette.muted, fontSize: 11, lineHeight: 18, marginTop: 4 },
  roleDetail: { color: palette.brand, fontSize: 10, fontWeight: "800", marginTop: 6 },
  arrowCircle: { width: 30, height: 30, borderRadius: 15, backgroundColor: palette.surfaceSoft, alignItems: "center", justifyContent: "center" },
  arrow: { color: palette.brand, fontSize: 24, lineHeight: 26, fontWeight: "700" },
  footnote: { alignItems: "center", marginTop: space.xxl, gap: 9 },
  goldLine: { width: 34, height: 2, borderRadius: 2, backgroundColor: palette.gold },
  footnoteText: { color: palette.muted, fontSize: 11, fontWeight: "700" },
});
