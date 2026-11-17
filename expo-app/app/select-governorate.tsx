import { useState } from "react";
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router, Stack } from "expo-router";
import * as SecureStore from "expo-secure-store";
import * as Location from "expo-location";
import { IRAQ_GOVERNORATES, nearestGovernorateKey } from "@/lib/governorates";
import { palette, radius } from "@/styles/theme";

async function saveGovernorate(key: string) {
  if (Platform.OS === "web" && typeof localStorage !== "undefined") localStorage.setItem("mamnoon_governorate", key);
  else await SecureStore.setItemAsync("mamnoon_governorate", key);
}

export default function SelectGovernorateScreen() {
  const [busy, setBusy] = useState(false);

  async function choose(key: string) {
    try {
      await saveGovernorate(key);
      router.replace("/welcome");
    } catch {
      Alert.alert("تعذر حفظ المحافظة", "حاول مرة ثانية.");
    }
  }

  async function detectAutomatically() {
    setBusy(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        Alert.alert("إذن الموقع", "اسمح لممنون باستخدام الموقع حتى يحدد محافظتك تلقائياً، أو اختَرها من القائمة.");
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      await choose(nearestGovernorateKey({ latitude: position.coords.latitude, longitude: position.coords.longitude }));
    } catch {
      Alert.alert("تعذر تحديد المحافظة", "تأكد من تشغيل GPS واختَر محافظتك يدوياً.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.page}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.logo}><Text style={styles.logoText}>م</Text></View>
        <Text style={styles.brand}>ممنون</Text>
        <Text style={styles.title}>بأي محافظة أنت؟</Text>
        <Text style={styles.subtitle}>اختَر محافظتك حتى نعرض لك السائقين والفنيين والخدمات الأقرب إلك.</Text>
        <TouchableOpacity style={styles.gpsButton} onPress={detectAutomatically} disabled={busy} activeOpacity={0.85}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.gpsIcon}>◎</Text>}
          <Text style={styles.gpsText}>{busy ? "جارٍ تحديد موقعك..." : "تحديد محافظتي تلقائياً"}</Text>
        </TouchableOpacity>
        <Text style={styles.sectionTitle}>أو اختَر المحافظة يدوياً</Text>
        <View style={styles.grid}>
          {IRAQ_GOVERNORATES.map((item) => (
            <TouchableOpacity key={item.key} style={styles.city} onPress={() => void choose(item.key)} activeOpacity={0.82}>
              <Text style={styles.cityDot}>●</Text>
              <Text style={styles.cityName}>{item.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.note}>تگدر تغيّر المحافظة لاحقاً من شاشة تحديد موقع الطلب.</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: palette.pageCanvas },
  content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 54, paddingBottom: 34, alignItems: "stretch" },
  logo: { width: 70, height: 70, borderRadius: 23, backgroundColor: palette.brand, alignSelf: "center", alignItems: "center", justifyContent: "center", elevation: 7, shadowColor: palette.brand, shadowOpacity: 0.22, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
  logoText: { color: "#fff", fontSize: 39, fontWeight: "900" },
  brand: { color: palette.ink, fontSize: 26, fontWeight: "900", textAlign: "center", marginTop: 9 },
  title: { color: palette.ink, fontSize: 25, fontWeight: "900", textAlign: "center", marginTop: 28 },
  subtitle: { color: palette.muted, fontSize: 14, lineHeight: 24, textAlign: "center", marginTop: 8, marginBottom: 20 },
  gpsButton: { minHeight: 54, borderRadius: radius.lg, backgroundColor: palette.brand, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderWidth: 1, borderColor: palette.gold, marginBottom: 22 },
  gpsIcon: { color: "#fff", fontSize: 25, fontWeight: "900" },
  gpsText: { color: "#fff", fontSize: 15, fontWeight: "900" },
  sectionTitle: { color: palette.ink, fontSize: 14, fontWeight: "900", textAlign: "right", marginBottom: 11 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  city: { width: "31.5%", minHeight: 50, flexGrow: 1, borderRadius: 14, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.surface, paddingHorizontal: 9, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  cityDot: { color: palette.gold, fontSize: 8 },
  cityName: { color: palette.ink, fontSize: 13, fontWeight: "800" },
  note: { color: palette.muted, fontSize: 11, textAlign: "center", marginTop: 19 },
});
