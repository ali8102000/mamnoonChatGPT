import { useCallback, useEffect, useState } from "react";
import { Text, TouchableOpacity, View, StyleSheet } from "react-native";
import { router } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { palette, radius } from "@/styles/theme";

type ActiveRequest = {
  id: string;
  provider_id: string | null;
  provider_arrived_at: string | null;
  type: string;
  status: string;
  pickup_text: string;
  price_estimate: number | null;
  customer_price: number | null;
};

export function ActiveCustomerRequestBanner() {
  const { user, activeRole } = useAuth();
  const [request, setRequest] = useState<ActiveRequest | null>(null);
  const [providerMoving, setProviderMoving] = useState(false);

  const load = useCallback(async () => {
    if (!user || activeRole !== "customer") {
      setRequest(null);
      return;
    }
    const { data, error } = await supabase
      .from("service_requests")
      .select("id, provider_id, provider_arrived_at, type, status, pickup_text, price_estimate, customer_price")
      .eq("customer_id", user.id)
      .in("status", ["pending", "searching", "accepted", "in_progress"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!error) {
      setRequest(data as ActiveRequest | null);
      if (data?.provider_id && ["accepted", "in_progress"].includes(data.status)) {
        const { data: points } = await supabase
          .from("trip_location_points")
          .select("lat,lng,recorded_at")
          .eq("request_id", data.id)
          .eq("role", "provider")
          .order("recorded_at", { ascending: false })
          .limit(2);
        if (points && points.length >= 2) {
          const [latest, previous] = points;
          const ageMs = Date.now() - Date.parse(latest.recorded_at);
          const latMeters = (latest.lat - previous.lat) * 111320;
          const lngMeters = (latest.lng - previous.lng) * 111320 * Math.cos(latest.lat * Math.PI / 180);
          setProviderMoving(ageMs >= 0 && ageMs < 45000 && Math.hypot(latMeters, lngMeters) >= 12);
        } else {
          setProviderMoving(false);
        }
      } else {
        setProviderMoving(false);
      }
    }
  }, [user, activeRole]);

  useEffect(() => {
    let active = true;
    const refresh = () => { if (active) void load(); };
    refresh();
    if (!user?.id) return () => { active = false; };
    // Android-safe refresh: avoid screen-owned Realtime channels during tab
    // remounts and role changes; the banner remains current through polling.
    const timer = setInterval(refresh, 10_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [user?.id, load]);

  if (!request) return null;
  const status = request.status === "accepted"
    ? request.provider_arrived_at ? "الفني وصل إلى موقع العمل" : providerMoving ? "الفني بالطريق إليك" : "تم قبول طلبك"
    : request.status === "in_progress"
      ? "طلبك قيد التنفيذ"
      : "طلبك نشط ونبحث عن مقدم خدمة";

  return (
    <TouchableOpacity
      activeOpacity={0.88}
      style={styles.banner}
      onPress={() => router.push({ pathname: "/request/[id]", params: { id: request.id } })}
    >
      <View style={styles.dot} />
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{request.type === "taxi" ? "🚕 " : "🛠️ "}{status}</Text>
        <Text style={styles.subtitle} numberOfLines={1}>{request.pickup_text || "افتح لمتابعة التفاصيل"}</Text>
      </View>
      <Text style={styles.action}>متابعة ←</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  banner: { marginHorizontal: 16, marginTop: 8, marginBottom: 8, padding: 14, borderRadius: radius.lg, backgroundColor: palette.brandSoft, borderWidth: 1, borderColor: "#C8DCCF", flexDirection: "row", alignItems: "center", gap: 10 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: palette.success },
  title: { color: palette.brandDeep, fontSize: 13, fontWeight: "900" },
  subtitle: { color: palette.muted, fontSize: 11, marginTop: 3 },
  action: { color: palette.brand, fontSize: 12, fontWeight: "900" },
});
