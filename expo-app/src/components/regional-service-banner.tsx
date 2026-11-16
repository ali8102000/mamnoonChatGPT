import { useEffect, useState } from "react";
import { Animated, Easing, Text, View, StyleSheet } from "react-native";
import * as SecureStore from "expo-secure-store";
import * as Location from "expo-location";
import { callMamnoonMapsApi } from "@/lib/maps-api";
import { LinearGradient } from "expo-linear-gradient";
import { supabase } from "@/lib/supabase";

type Row = { governorate_key: string; services_enabled: boolean; message_enabled: boolean; message_title: string; message_text: string; message_animate: boolean };

export function RegionalServiceBanner() {
  const [row, setRow] = useState<Row | null>(null);
  const translate = useState(() => new Animated.Value(0))[0];
  useEffect(() => {
    let active = true;
    const load = async () => {
      let key = await SecureStore.getItemAsync("mamnoon_governorate").catch(() => null);
      if (!key) {
        const permission = await Location.getForegroundPermissionsAsync().catch(() => null);
        if (permission?.granted) {
          const position = await Location.getLastKnownPositionAsync().catch(() => null);
          if (position) {
            const detected = await callMamnoonMapsApi<{ key: string }>({
              action: "detectGovernorate",
              center: { lat: position.coords.latitude, lng: position.coords.longitude },
            }).catch(() => null);
            key = detected?.key ?? null;
            if (key) await SecureStore.setItemAsync("mamnoon_governorate", key).catch(() => {});
          }
        }
      }
      if (!active || !key) return;
      const { data } = await (supabase as any).from("regional_service_controls").select("*").in("governorate_key", [key, "all"]);
      if (!active) return;
      const exact = (data ?? []).find((item: Row) => item.governorate_key === key);
      const global = (data ?? []).find((item: Row) => item.governorate_key === "all");
      const notice = exact || global;
      const services_enabled = global?.services_enabled === false
        ? false
        : exact?.services_enabled ?? global?.services_enabled ?? true;
      setRow(notice ? { ...notice, services_enabled } as Row : null);
    };
    void load();
    const channel = supabase.channel("regional-service-controls")
      .on("postgres_changes", { event: "*", schema: "public", table: "regional_service_controls" }, () => { void load(); })
      .subscribe();
    const timer = setInterval(() => void load(), 60000);
    return () => { active = false; clearInterval(timer); void supabase.removeChannel(channel); };
  }, []);
  useEffect(() => {
    if (!row?.message_animate || (!row.message_enabled && row.services_enabled)) return;
    translate.setValue(0);
    const animation = Animated.loop(Animated.timing(translate, { toValue: 1, duration: 18000, easing: Easing.linear, useNativeDriver: true }));
    animation.start();
    return () => animation.stop();
  }, [row?.message_animate, row?.message_enabled, row?.services_enabled, row?.message_text, translate]);
  if (!row || (row.services_enabled && !row.message_enabled)) return null;
  const text = row.message_text || (row.services_enabled ? "" : "الخدمات متوقفة مؤقتاً في محافظتك بقرار من إدارة ممنون.");
  if (!text) return null;
  return (
    <View style={styles.wrap}>
      <LinearGradient colors={["#050505", "#17120A", "#050505"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.card}>
        <View style={styles.head}><Text style={styles.title}>{row.message_title || "تنويه رسمي من إدارة ممنون"}</Text><View style={styles.stamp}><Text style={styles.stampText}>✓ الإدارة الرسمية · موثّق</Text></View></View>
        <View style={styles.marquee}>
          {row.message_animate ? <Animated.Text numberOfLines={1} style={[styles.message, { transform: [{ translateX: translate.interpolate({ inputRange: [0, 1], outputRange: [260, -520] }) }] }]}>{text}</Animated.Text> : <Text style={[styles.message, { textAlign: "right" }]}>{text}</Text>}
        </View>
        {!row.services_enabled && <Text style={styles.closed}>الخدمات متوقفة حالياً في هذه المحافظة.</Text>}
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
  message: { color: "#F4E7C1", fontSize: 12, fontWeight: "800", textAlign: "left", width: 520 },
  closed: { color: "#FCA5A5", fontSize: 10, fontWeight: "800", textAlign: "right", marginTop: 6 },
});
