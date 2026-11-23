import { useState, useEffect, useCallback } from "react";
import { router } from "expo-router";
import { View, Text, Image, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Alert } from "react-native";
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
  request_code?: string | null;
  pickup_text?: string | null;
  dest_text?: string | null;
  attachment_url?: string | null;
  person_avatar_url?: string | null;
  cancelled_by?: string | null;
  cancellation_reason?: string | null;
  customer_id?: string | null;
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
  const [showAllRequests, setShowAllRequests] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [usingCachedData, setUsingCachedData] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) {
      setRequests([]);
      setUsingCachedData(false);
      return;
    }
    const cacheKey = `mamnoon-history-v1_${user.id}`;
    try {
      const { data, error } = await supabase
        .from("service_requests")
        .select("id,type,status,created_at,price_estimate,request_code,pickup_text,dest_text,attachment_path,customer_id,provider_id,cancelled_by,cancellation_reason")
        .or(`customer_id.eq.${user.id},provider_id.eq.${user.id}`)
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      const { data: memberships, error: membershipError } = await (supabase as any)
        .from("service_request_providers")
        .select("request_id")
        .eq("provider_id", user.id);
      let teamRows: any[] = [];
      if (!membershipError && memberships?.length) {
        const teamIds = [...new Set<string>(memberships.map((row: any) => String(row.request_id)))];
        const { data: rows, error: teamError } = await supabase
          .from("service_requests")
          .select("id,type,status,created_at,price_estimate,request_code,pickup_text,dest_text,attachment_path,customer_id,provider_id,cancelled_by,cancellation_reason")
          .in("id", teamIds);
        if (!teamError) teamRows = rows ?? [];
        else console.warn("[history] Team request history failed:", teamError.message);
      }
      if (membershipError) console.warn("[history] Team membership history unavailable:", membershipError.message);
      const merged = new Map<string, any>();
      [...(data ?? []), ...teamRows].forEach((row) => merged.set(row.id, row));
      const baseRows = [...merged.values()]
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
        .slice(0, 500);
      const otherIds = [...new Set<string>(baseRows.map((row: any) =>
        String(row.customer_id === user.id ? row.provider_id : row.customer_id || ""),
      ).filter(Boolean))];
      const { data: profiles } = otherIds.length
        ? await supabase.from("profiles").select("id,avatar_url").in("id", otherIds)
        : { data: [] };
      const avatarById = new Map((profiles ?? []).map((profile: any) => [profile.id, profile.avatar_url]));
      const rows = await Promise.all(baseRows.map(async (row: any) => {
        let attachment_url: string | null = null;
        if (row.attachment_path) {
          const { data: signed } = await supabase.storage.from("request-attachments")
            .createSignedUrl(row.attachment_path, 60 * 30);
          attachment_url = signed?.signedUrl ?? null;
        }
        const otherId = row.customer_id === user.id ? row.provider_id : row.customer_id;
        return { ...row, attachment_url, person_avatar_url: otherId ? avatarById.get(otherId) ?? null : null };
      })) as HistoryRequest[];
      setRequests(rows);
      setUsingCachedData(false);
      try {
        await SecureStore.setItemAsync(cacheKey, JSON.stringify(rows.map(({ attachment_url, ...row }) => row)));
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
  const visibleRequests = tabRequests;

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>سجل الرحلات والخدمات</Text>
      <Text style={styles.subtitle}>كل طلباتك السابقة والمنتهية محفوظة هنا</Text>
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
        contentContainerStyle={{ paddingBottom: 104 }}
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
              <View style={styles.cardMedia}>
                {req.person_avatar_url
                  ? <Image source={{ uri: req.person_avatar_url }} style={styles.personAvatar} />
                  : <View style={styles.personAvatarFallback}><Text style={{ color: palette.brand, fontWeight: "900" }}>👤</Text></View>}
                {req.attachment_url
                  ? <Image source={{ uri: req.attachment_url }} style={styles.workPhoto} />
                  : <View style={styles.workPhotoFallback}><Text style={{ color: palette.muted, fontSize: 10 }}>صورة العمل</Text></View>}
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={styles.cardType}>{req.type === "taxi" ? "🚕 رحلة تكسي" : `🔧 ${req.type}`}</Text>
                <Text style={styles.tripCode}>رقم الرحلة: {req.request_code || req.id.slice(0, 8).toUpperCase()}</Text>
                {!!req.pickup_text && <Text style={styles.cardDate} numberOfLines={1}>من: {req.pickup_text}</Text>}
                {!!req.dest_text && <Text style={styles.cardDate} numberOfLines={1}>إلى: {req.dest_text}</Text>}
                <Text style={styles.cardDate}>{new Date(req.created_at).toLocaleDateString("ar-IQ")}</Text>
                {(req.status === "cancelled" || req.cancelled_by) && <Text style={styles.cardDate}>{req.status === "cancelled" ? "ألغى الرحلة" : "آخر اعتذار عن الرحلة"}: {!req.cancelled_by ? "النظام" : req.cancelled_by === req.customer_id ? "الزبون" : "السائق / مقدم الخدمة"} · السبب: {req.cancellation_reason || "غير مسجل"}</Text>}
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
  subtitle: { color: palette.muted, fontSize: 11, textAlign: "right", marginTop: -12, marginBottom: 14 },
  title: { fontSize: 27, fontWeight: "900", color: palette.ink, marginBottom: 20 },
  offlineNotice: { padding: 11, borderRadius: radius.md, backgroundColor: palette.goldSoft, borderWidth: 1, borderColor: palette.line, marginBottom: 14 },
  offlineNoticeText: { color: palette.ink, fontSize: 11, fontWeight: "700", textAlign: "right" },
  tabs: { flexDirection: "row", gap: 8, marginBottom: 16 },
  tab: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.pill, backgroundColor: palette.surfaceSoft, borderWidth: 1, borderColor: palette.line },
  tabActive: { backgroundColor: palette.brand, borderColor: palette.brand },
  tabText: { fontSize: 12, fontWeight: "800", color: palette.muted },
  tabTextActive: { color: palette.white },
  card: { flexDirection: "row", alignItems: "center", backgroundColor: palette.surface, borderRadius: radius.lg, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: palette.line, gap: 10 },
  cardMedia: { width: 58, gap: 5, alignItems: "center" },
  personAvatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: palette.surfaceSoft },
  personAvatarFallback: { width: 42, height: 42, borderRadius: 21, backgroundColor: palette.surfaceSoft, alignItems: "center", justifyContent: "center" },
  workPhoto: { width: 58, height: 48, borderRadius: 8, backgroundColor: palette.surfaceSoft },
  workPhotoFallback: { width: 58, height: 48, borderRadius: 8, backgroundColor: palette.surfaceSoft, alignItems: "center", justifyContent: "center" },
  tripCode: { fontSize: 10, color: palette.brand, fontWeight: "900" },
  cardType: { fontSize: 15, fontWeight: "900", color: palette.ink },
  cardDate: { fontSize: 11, color: palette.muted, marginTop: 5 },
  cardPrice: { fontSize: 14, fontWeight: "900", color: palette.brand, marginTop: 5 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: radius.pill },
  statusText: { fontSize: 11, fontWeight: "900" },
  emptyBox: { alignItems: "center", paddingTop: 60 },
  emptyTitle: { fontSize: 17, fontWeight: "900", color: palette.ink },
  emptySub: { fontSize: 12, color: palette.muted, marginTop: 5 },
});
