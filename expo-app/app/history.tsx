import { useState, useEffect, useCallback } from "react";
import { router } from "expo-router";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from "react-native";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { palette, radius } from "@/styles/theme";

type HistoryRequest = {
  id: string;
  type: string;
  status: string;
  created_at: string;
  price_estimate: number | null;
};

const STATUS_LABELS: Record<string, string> = {
  searching: "بحث",
  pending: "بانتظار",
  accepted: "مقبول",
  in_progress: "قيد التنفيذ",
  completed: "مكتمل",
  cancelled: "ملغي",
};
const STATUS_COLORS: Record<string, string> = {
  searching: "#f59e0b",
  pending: "#f59e0b",
  accepted: "#2563eb",
  in_progress: "#2563eb",
  completed: "#16a34a",
  cancelled: "#dc2626",
};

export default function HistoryScreen() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<HistoryRequest[]>([]);
  const [tab, setTab] = useState<"all" | "active" | "done">("all");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    let query = supabase
      .from("service_requests")
      .select(
        "*, customer:profiles!service_requests_customer_id_fkey(full_name), provider:profiles!service_requests_provider_id_fkey(full_name)",
      )
      .or(`customer_id.eq.${user?.id},provider_id.eq.${user?.id}`)
      .order("created_at", { ascending: false })
      .limit(50);
    if (tab === "active")
      query = query.in("status", ["searching", "pending", "accepted", "in_progress"]);
    if (tab === "done") query = query.in("status", ["completed", "cancelled"]);
    const { data } = await query;
    setRequests(data || []);
  }, [user?.id, tab]);

  useEffect(() => {
    load();
  }, [load]);
  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>السجل</Text>
      <View style={styles.tabs}>
        {(["all", "active", "done"] as const).map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, tab === t && styles.tabActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === "all" ? "الكل" : t === "active" ? "نشط" : "منتهي"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {requests.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>لا توجد طلبات</Text>
            <Text style={styles.emptySub}>ستظهر طلباتك هنا</Text>
          </View>
        ) : (
          requests.map((req) => (
            <TouchableOpacity
              key={req.id}
              style={styles.card}
              onPress={() => router.push({ pathname: "/request/[id]", params: { id: req.id } })}
              activeOpacity={0.85}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.cardType}>
                  {req.type === "taxi" ? "🚕 سيارة" : `🔧 ${req.type}`}
                </Text>
                <Text style={styles.cardDate}>
                  {new Date(req.created_at).toLocaleDateString("ar")}
                </Text>
                {req.price_estimate && (
                  <Text style={styles.cardPrice}>
                    {req.price_estimate.toLocaleString("en")} د.ع
                  </Text>
                )}
              </View>
              <View
                style={[
                  styles.statusBadge,
                  { backgroundColor: (STATUS_COLORS[req.status] || "#64748b") + "20" },
                ]}
              >
                <Text
                  style={[styles.statusText, { color: STATUS_COLORS[req.status] || "#64748b" }]}
                >
                  {STATUS_LABELS[req.status] || req.status}
                </Text>
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.canvas, paddingHorizontal: 20, paddingTop: 52 },
  title: { fontSize: 27, fontWeight: "900", color: palette.ink, marginBottom: 20 },
  tabs: { flexDirection: "row", gap: 8, marginBottom: 16 },
  tab: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.pill, backgroundColor: palette.surfaceSoft, borderWidth: 1, borderColor: palette.line },
  tabActive: { backgroundColor: palette.brand, borderColor: palette.brand },
  tabText: { fontSize: 12, fontWeight: "800", color: palette.muted },
  tabTextActive: { color: palette.white },
  card: { flexDirection: "row", alignItems: "center", backgroundColor: palette.surface, borderRadius: radius.lg, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: palette.line },
  cardType: { fontSize: 15, fontWeight: "900", color: palette.ink },
  cardDate: { fontSize: 11, color: palette.muted, marginTop: 5 },
  cardPrice: { fontSize: 14, fontWeight: "900", color: palette.brand, marginTop: 5 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: radius.pill },
  statusText: { fontSize: 11, fontWeight: "900" },
  emptyBox: { alignItems: "center", paddingTop: 60 },
  emptyTitle: { fontSize: 17, fontWeight: "900", color: palette.ink },
  emptySub: { fontSize: 12, color: palette.muted, marginTop: 5 },
});
