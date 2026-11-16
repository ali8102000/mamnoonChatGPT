import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { router, Stack } from "expo-router";
import { Button } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { palette, radius } from "@/styles/theme";

export default function WelcomeScreen() {
  const { session, loading, profile, roles } = useAuth();

  function continueToApp() {
    if (loading) return;
    if (!session) {
      router.replace("/auth");
      return;
    }
    if (!profile || roles.length === 0) {
      router.replace("/select-role");
      return;
    }
    router.replace("/home");
  }

  return (
    <View style={s.page}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.topLine}>
          <Text style={s.topLineText}>منصة عراقية تجمع خدماتك بمكان واحد</Text>
        </View>
        <View style={s.hero}>
          <View style={s.mark}>
            <Text style={s.markText}>م</Text>
          </View>
          <Text style={s.brand}>ممنون</Text>
          <Text style={s.title}>خدماتك ومشاويرك بمكان واحد</Text>
          <Text style={s.desc}>
            مشوارك وتكسيك وخدمات بيتك… اطلبها بسهولة وتابع كل التفاصيل من تطبيق واحد.
          </Text>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>شنو تكدر تسوي بممنون؟</Text>
          <View style={s.feature}>
            <View style={s.featureIcon}><Text style={s.featureEmoji}>🚕</Text></View>
            <View style={s.featureCopy}>
              <Text style={s.featureTitle}>تكسي ونقل</Text>
              <Text style={s.featureText}>اطلب مشوار أو سيارة لنقل الأغراض والحمولات.</Text>
            </View>
          </View>
          <View style={s.feature}>
            <View style={s.featureIcon}><Text style={s.featureEmoji}>🛠️</Text></View>
            <View style={s.featureCopy}>
              <Text style={s.featureTitle}>فنيون وخدمات منزلية</Text>
              <Text style={s.featureText}>وصل لأصحاب المهن والخبراء حتى ينجزون شغلك.</Text>
            </View>
          </View>
          <View style={[s.feature, s.lastFeature]}>
            <View style={s.featureIcon}><Text style={s.featureEmoji}>💬</Text></View>
            <View style={s.featureCopy}>
              <Text style={s.featureTitle}>متابعة وتواصل</Text>
              <Text style={s.featureText}>تابع طلباتك وتواصل مع مقدم الخدمة من مكان واحد.</Text>
            </View>
          </View>
        </View>

        <Button
          title={loading ? "لحظة… جاري تجهيز التطبيق" : "دخول إلى ممنون"}
          onPress={continueToApp}
          disabled={loading}
          loading={loading}
          style={s.cta}
        />
        <Text style={s.note}>أهلاً بيك… نورت ممنون</Text>
        <View style={s.legal}>
          <Text style={s.links} onPress={() => router.push("/privacy")}>سياسة الخصوصية</Text>
          <Text style={s.dot}>•</Text>
          <Text style={s.links} onPress={() => router.push("/terms")}>الشروط والأحكام</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: palette.canvas },
  content: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 22, paddingTop: 30, paddingBottom: 24 },
  topLine: { alignSelf: "center", backgroundColor: palette.surfaceSoft, borderRadius: 30, paddingHorizontal: 14, paddingVertical: 8, marginBottom: 24 },
  topLineText: { color: palette.brand, fontSize: 12, fontFamily: "Tajawal_800ExtraBold", fontWeight: "800", textAlign: "center" },
  hero: { alignItems: "center" },
  mark: { width: 84, height: 84, borderRadius: 27, backgroundColor: palette.brand, alignItems: "center", justifyContent: "center", shadowColor: palette.brand, shadowOpacity: 0.2, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 5 },
  markText: { fontSize: 44, fontFamily: "Tajawal_800ExtraBold", fontWeight: "900", color: "#fff", includeFontPadding: false },
  brand: { fontSize: 34, fontFamily: "Tajawal_800ExtraBold", fontWeight: "900", color: palette.ink, textAlign: "center", marginTop: 10 },
  title: { fontSize: 23, fontFamily: "Tajawal_800ExtraBold", fontWeight: "900", color: palette.ink, textAlign: "center", marginTop: 18 },
  desc: { fontSize: 15, fontFamily: "Tajawal_500Medium", color: palette.muted, textAlign: "center", lineHeight: 26, marginTop: 8, maxWidth: 340 },
  card: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.xl, padding: 17, marginTop: 25, marginBottom: 20 },
  cardTitle: { fontSize: 17, fontFamily: "Tajawal_800ExtraBold", fontWeight: "900", color: palette.ink, textAlign: "right", marginBottom: 13 },
  feature: { flexDirection: "row-reverse", alignItems: "center", paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: palette.line, gap: 12 },
  lastFeature: { borderBottomWidth: 0, paddingBottom: 2 },
  featureIcon: { width: 46, height: 46, borderRadius: 15, backgroundColor: palette.surfaceSoft, alignItems: "center", justifyContent: "center" },
  featureEmoji: { fontSize: 22 },
  featureCopy: { flex: 1, alignItems: "flex-end" },
  featureTitle: { color: palette.ink, fontSize: 15, fontFamily: "Tajawal_800ExtraBold", fontWeight: "800", textAlign: "right" },
  featureText: { color: palette.muted, fontSize: 12, fontFamily: "Tajawal_500Medium", lineHeight: 21, textAlign: "right", marginTop: 3 },
  cta: { minHeight: 58 },
  note: { color: palette.muted, fontSize: 12, fontFamily: "Tajawal_500Medium", textAlign: "center", marginTop: 12 },
  legal: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 10, marginTop: 18 },
  links: { color: palette.brand, fontSize: 12, fontFamily: "Tajawal_700Bold", fontWeight: "700" },
  dot: { color: palette.muted, fontSize: 12 },
});
