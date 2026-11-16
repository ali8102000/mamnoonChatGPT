import { useState, useEffect, useCallback } from "react";
import { router } from "expo-router";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Alert } from "react-native";
import * as SecureStore from "expo-secure-store";
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
  const [showAllRequests, setShowAllRequests] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [usingCachedData, setUsingCachedData] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) {
      setRequests([]);
      setUsingCachedData(false);
      return;
    }
    const cacheKey = `mamnoon-history-v1:${user.id}`;
    try {
      const { data, error } = await supabase
        .from("service_requests")
        .select("id,type,status,created_at,price_estimate")
        .or(`customer_id.eq.${user.id},provider_id.eq.${user.id}`)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      const rows = (data || []) as HistoryRequest[];
      setRequests(rows);
      setUsingCachedData(false);
      try {
        await SecureStore.setItemAsync(cacheKey, JSON.stringify(rows));
      } catch (cacheError) {
        console.warn("[offline] Could not save request history:", cacheError);
      }
    } catch (error) {
      console.warn("[offline] Request history unavailable; restoring saved entries.", error);
      try {
        const raw = await SecureStore.getItemAsync(cacheKey);
        const saved = raw ? JSON.parse(raw) : [];
        setRequests(Array.isArray(saved) ? saved as HistoryRequest[] : []);
      } catch {
        setRequests([]);
      }
      setUsingCachedData(true);
    }
  }, [user?.id]);

  useEffect(() => {
    load();
  }, [load]);
  const tabRequests = tab === "active"
    ? requests.filter((request) => ["searching", "pending", "accepted", "in_progress"].includes(request.status))
    : tab === "done"
      ? requests.filter((request) => ["completed", "cancelled"].includes(request.status))
      : requests;
  const visibleRequests = showAllRequests
    ? tabRequests
    : tabRequests.filter((request) => new Date(request.created_at).getTime() >= Date.now() - 60 * 60 * 1000);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>السجل</Text>
      {usingCachedData && (
        <View style={styles.offlineNotice}>
          <Text style={styles.offlineNoticeText}>تعرض بيانات محفوظة من آخر اتصال، وقد لا تكون محدثة.</Text>
        </View>
      )}
      <View style={styles.tabs}>
        <TouchableOpacity style={[styles.tab, !showAllRequests && styles.tabActive]} onPress={() => setShowAllRequests(false)}>
          <Text style={[styles.tabText, !showAllRequests && styles.tabTextActive]}>آخر ساعة</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, showAllRequests && styles.tabActive]} onPress={() => setShowAllRequests(true)}>
          <Text style={[styles.tabText, showAllRequests && styles.tabTextActive]}>كل الطلبات</Text>
        </TouchableOpacity>
      </View>
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
        {visibleRequests.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>لا توجد طلبات</Text>
            <Text style={styles.emptySub}>ستظهر طلباتك هنا</Text>
          </View>
        ) : (
          visibleRequests.map((req) => (
            <TouchableOpacity
              key={req.id}
              style={styles.card}
              onPress={() => {
                if (usingCachedData) {
                  Alert.alert("أنت دون اتصال", "تفاصيل الطلب الكاملة تحتاج إلى اتصال بالإنترنت.");
                  return;
                }
                router.push({ pathname: "/request/[id]", params: { id: req.id } });
              }}
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
  container: { flex: 1, backgroundColor: palette.pageCanvas, paddingHorizontal: 20, paddingTop: 52 },
  title: { fontSize: 27, fontWeight: "900", color: palette.ink, marginBottom: 20 },
  offlineNotice: { padding: 11, borderRadius: radius.md, backgroundColor: palette.goldSoft, borderWidth: 1, borderColor: palette.line, marginBottom: 14 },
  offlineNoticeText: { color: palette.ink, fontSize: 11, fontWeight: "700", textAlign: "right" },
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
