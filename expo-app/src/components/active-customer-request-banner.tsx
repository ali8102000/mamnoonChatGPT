import { useCallback, useEffect, useState } from "react";
import { Text, TouchableOpacity, View, StyleSheet } from "react-native";
import { router } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";

type ActiveRequest = {
  id: string;
  type: string;
  status: string;
  pickup_text: string;
  price_estimate: number | null;
  customer_price: number | null;
};

export function ActiveCustomerRequestBanner() {
  const { user, roles } = useAuth();
  const [request, setRequest] = useState<ActiveRequest | null>(null);

  const load = useCallback(async () => {
    if (!user || !roles.includes("customer")) {
      setRequest(null);
      return;
    }
    const { data, error } = await supabase
      .from("service_requests")
      .select("id, type, status, pickup_text, price_estimate, customer_price")
      .eq("customer_id", user.id)
      .in("status", ["pending", "searching", "accepted", "in_progress"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!error) setRequest(data as ActiveRequest | null);
  }, [user, roles]);

  useEffect(() => {
    void load();
    if (!user) return;
    const channel = supabase
      .channel(`customer-active-request-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "service_requests",
          filter: `customer_id=eq.${user.id}`,
        },
        () => void load(),
      )
      .subscribe();
    const timer = setInterval(() => void load(), 10000);
    return () => {
      clearInterval(timer);
      supabase.removeChannel(channel);
    };
  }, [user, load]);

  if (!request) return null;
  const status = request.status === "accepted"
    ? "تم قبول طلبك"
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
  banner: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 8,
    padding: 13,
    borderRadius: 16,
    backgroundColor: "#ecfdf5",
    borderWidth: 1,
    borderColor: "#86efac",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#16a34a" },
  title: { color: "#065f46", fontSize: 13, fontWeight: "900" },
  subtitle: { color: "#475569", fontSize: 11, marginTop: 3 },
  action: { color: "#047857", fontSize: 12, fontWeight: "900" },
});
