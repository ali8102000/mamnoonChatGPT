import { useEffect, useState } from "react";
import { Animated, Easing, Image, Text, View, StyleSheet } from "react-native";
import * as SecureStore from "expo-secure-store";
import * as Location from "expo-location";
import { callMamnoonMapsApi } from "@/lib/maps-api";
import { LinearGradient } from "expo-linear-gradient";
import { supabase } from "@/lib/supabase";

type Row = { governorate_key: string; services_enabled: boolean; message_enabled: boolean; message_title: string; message_text: string; message_animate: boolean; message_image_url?: string; rejection_message?: string };

export function RegionalServiceBanner() {
  const [row, setRow] = useState<Row | null>(null);
  const translate = useState(() => new Animated.Value(0))[0];
  const [marqueeWidth, setMarqueeWidth] = useState(0);
  const [textWidth, setTextWidth] = useState(0);
  useEffect(() => {
    let active = true;
    const load = async () => {
      let key = await SecureStore.getItemAsync("mamnoon_governorate").catch(() => null);
      const permission = await Location.getForegroundPermissionsAsync().catch(() => null);
      if (permission?.granted) {
        let position = await Location.getLastKnownPositionAsync().catch(() => null);
        if (!position) position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null);
        if (position) {
          const detected = await callMamnoonMapsApi<{ key: string }>({
            action: "detectGovernorate",
            center: { lat: position.coords.latitude, lng: position.coords.longitude },
          }).catch(() => null);
          if (detected?.key) {
            key = detected.key;
            await SecureStore.setItemAsync("mamnoon_governorate", key).catch(() => {});
          }
        }
      }
      if (!active || !key) return;
      const { data, error } = await (supabase as any)
        .from("regional_service_controls")
        .select("governorate_key,services_enabled,message_enabled,message_title,message_text,message_animate,message_image_url,rejection_message")
        .in("governorate_key", [key, "all"]);
      if (!active) return;
      if (error) { console.warn("[regional controls] load failed", error); return; }
      const exact = (data ?? []).find((item: Row) => item.governorate_key === key);
      const global = (data ?? []).find((item: Row) => item.governorate_key === "all");
      const base = exact || global;
      if (!base) { setRow(null); return; }
      const services_enabled = global?.services_enabled === false
        ? false
        : exact?.services_enabled ?? global?.services_enabled ?? true;
      setRow({ ...base, services_enabled });
    };
    void load();
    const channel = supabase.channel("regional-service-controls-mobile")
      .on("postgres_changes", { event: "*", schema: "public", table: "regional_service_controls" }, () => { void load(); })
      .subscribe();
    const timer = setInterval(() => void load(), 30000);
    return () => { active = false; clearInterval(timer); void supabase.removeChannel(channel); };
  }, []);
  useEffect(() => {
    if (!row?.message_animate || (!row.message_enabled && row.services_enabled) || marqueeWidth <= 0 || textWidth <= 0) return;
    translate.setValue(0);
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(translate, { toValue: 1, duration: 14000, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
        Animated.timing(translate, { toValue: 0, duration: 14000, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [row?.message_animate, row?.message_enabled, row?.services_enabled, row?.message_text, marqueeWidth, textWidth, translate]);
  if (!row || (row.services_enabled && !row.message_enabled)) return null;
  const text = row.message_text || (row.services_enabled ? "" : "الخدمات متوقفة مؤقتاً في محافظتك بقرار من إدارة ممنون.");
  if (!text) return null;
  return (
    <View style={styles.wrap}>
      <LinearGradient colors={["#050505", "#17120A", "#050505"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.card}>
        <View style={styles.head}><Text style={styles.title}>{row.message_title || "تنويه رسمي من إدارة ممنون"}</Text><View style={styles.stamp}><Text style={styles.stampText}>✓ إدارة ممنون · الحساب الرسمي الموثّق</Text></View></View>
        {!!row.message_enabled && !!row.message_image_url && <Image source={{ uri: row.message_image_url }} style={styles.noticeImage} resizeMode="contain" />}
        <View style={styles.marquee} onLayout={(event) => setMarqueeWidth(event.nativeEvent.layout.width)}>
          {row.message_animate ? <>
            <Animated.Text numberOfLines={1} onLayout={(event) => setTextWidth(event.nativeEvent.layout.width)} style={[styles.message, { transform: [{ translateX: translate.interpolate({ inputRange: [0, 1], outputRange: [marqueeWidth, -textWidth] }) }] }]}>{text}</Animated.Text>
          </> : <Text style={[styles.message, { textAlign: "right" }]}>{text}</Text>}
        </View>
        {!row.services_enabled && <View style={styles.rejectionCard}><View style={styles.rejectionHead}><Text style={styles.rejectionLabel}>رسالة رفض الطلب</Text><Text style={styles.stampText}>✓ إدارة ممنون الموثّقة</Text></View><Text style={styles.rejectionText}>{row.rejection_message || "الخدمة متوقفة حالياً في منطقتك بقرار من إدارة ممنون."}</Text><Text style={styles.closed}>إنشاء الطلبات متوقف حالياً في هذه المحافظة.</Text></View>}
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginHorizontal: 18, marginBottom: 12 },
  card: { borderRadius: 16, borderWidth: 1, borderColor: "#B8872D", padding: 12, overflow: "hidden" },
  head: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: "#6B4B17", paddingBottom: 8, gap: 8 },
  title: { color: "#F2D58A", fontSize: 12, fontWeight: "900", flex: 1, textAlign: "right" },
  stamp: { flexDirection: "row-reverse", alignItems: "center", gap: 4 },
  stampText: { color: "#E9C76A", fontSize: 9, fontWeight: "800" },
  marquee: { height: 34, justifyContent: "center", overflow: "hidden", marginTop: 5 },
  message: { color: "#F4E7C1", fontSize: 12, fontWeight: "800", textAlign: "right", alignSelf: "flex-start", flexShrink: 0 },
  rejectionCard: { marginTop: 10, padding: 10, borderRadius: 12, backgroundColor: "#211706", borderWidth: 1, borderColor: "#8A6426" },
  rejectionHead: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between" },
  rejectionLabel: { color: "#F2D58A", fontSize: 10, fontWeight: "900" },
  rejectionText: { color: "#FFF0C7", fontSize: 14, lineHeight: 25, fontWeight: "900", textAlign: "right", marginTop: 8 },
  noticeImage: { width: "100%", height: 150, marginTop: 8, borderRadius: 10 },
  closed: { color: "#FCA5A5", fontSize: 10, fontWeight: "800", textAlign: "right", marginTop: 6 },
});
