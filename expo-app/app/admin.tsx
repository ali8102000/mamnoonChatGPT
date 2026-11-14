import { useState, useEffect, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl, Alert, TouchableOpacity, TextInput } from "react-native";
import { router } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { palette, radius } from "@/styles/theme";

type AdminStats = { totalRequests: number; totalUsers: number; totalDrivers: number };
type PricingRule = {
  id: string;
  vehicle_category: string;
  base_fare: number | null;
  per_km: number | null;
};
type RecentRequest = {
  id: string;
  type: string;
  customer?: { full_name: string | null } | null;
  created_at: string;
  status: string;
};

export default function AdminScreen() {
  const { user } = useAuth();
  const [stats, setStats] = useState<AdminStats>({
    totalRequests: 0,
    totalUsers: 0,
    totalDrivers: 0,
  });
  const [pricing, setPricing] = useState<PricingRule[]>([]);
  const [recent, setRecent] = useState<RecentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [companyName, setCompanyName] = useState("شركة ممنون");
  const [savingCompanyName, setSavingCompanyName] = useState(false);
  const [supportInbox, setSupportInbox] = useState<any[]>([]);
  const [unreadSupport, setUnreadSupport] = useState(0);
  const [reports, setReports] = useState<any[]>([]);
  const isOwnerAccount = user?.email?.toLowerCase() === "a7md0555666@gmail.com";

  const load = useCallback(async () => {
    const { data: superAdminCheck, error: permissionError } = await supabase.rpc("is_super_admin", {
      p_user_id: user?.id,
    });
    if (permissionError || superAdminCheck !== true) {
      Alert.alert("غير مصرّح", "هذه الإدارة العليا مخصصة لصاحب الحساب فقط");
      router.replace("/home");
      setLoading(false);
      return;
    }
    if (isOwnerAccount) {
      const { data: company } = await (supabase as any).from("company_settings").select("company_name").eq("id", 1).maybeSingle();
      if (company?.company_name) setCompanyName(company.company_name);
    }
    const [reqs, users, drivers, pricingRules, recentReqs] = await Promise.all([
      supabase.from("service_requests").select("id", { count: "exact", head: true }),
      supabase.from("profiles").select("id", { count: "exact", head: true }),
      supabase.from("driver_profiles").select("id", { count: "exact", head: true }),
      supabase.from("pricing_rules").select("*").order("vehicle_category"),
      supabase
        .from("service_requests")
        .select("*, customer:profiles!service_requests_customer_id_fkey(full_name)")
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    setStats({
      totalRequests: reqs.count || 0,
      totalUsers: users.count || 0,
      totalDrivers: drivers.count || 0,
    });
    setPricing(pricingRules.data || []);
    setRecent(recentReqs.data || []);
    const { data: conversations } = await (supabase as any).from("support_conversations").select("id,user_id,status,updated_at").order("updated_at", { ascending: false }).limit(12);
    const conversationRows = conversations ?? [];
    const conversationIds = conversationRows.map((row: any) => row.id);
    const userIds = [...new Set(conversationRows.map((row: any) => row.user_id))];
    const [{ data: supportProfiles }, { data: supportMessages }, { data: reportRows }] = await Promise.all([
      userIds.length ? supabase.from("profiles").select("id,full_name,phone").in("id", userIds) : Promise.resolve({ data: [] as any[] }),
      conversationIds.length ? (supabase as any).from("support_messages").select("id,conversation_id,sender_id,body,read_at,created_at").in("conversation_id", conversationIds).order("created_at", { ascending: false }) : Promise.resolve({ data: [] as any[] }),
      (supabase as any).from("user_reports").select("id,reporter_id,reported_id,request_id,reason,details,status,created_at").order("created_at", { ascending: false }).limit(8),
    ]);
    const profileById = new Map((supportProfiles ?? []).map((profile: any) => [profile.id, profile]));
    const latestByConversation = new Map<string, any>();
    let unread = 0;
    for (const message of supportMessages ?? []) {
      if (!latestByConversation.has(message.conversation_id)) latestByConversation.set(message.conversation_id, message);
      if (message.sender_id !== user?.id && !message.read_at) unread += 1;
    }
    setUnreadSupport(unread);
    setSupportInbox(conversationRows.map((row: any) => ({ ...row, profile: profileById.get(row.user_id), latest: latestByConversation.get(row.id) })));
    setReports(reportRows ?? []);
    setLoading(false);
  }, [user?.id, isOwnerAccount]);

  useEffect(() => {
    load();
  }, [load]);
  const saveCompanyName = async () => {
    const value = companyName.trim();
    if (value.length < 2 || value.length > 80) { Alert.alert("تنبيه", "اكتب اسماً من حرفين إلى 80 حرفاً"); return; }
    setSavingCompanyName(true);
    const { data: allowed, error: permissionError } = await supabase.rpc("is_super_admin", { p_user_id: user?.id });
    if (permissionError || allowed !== true || !isOwnerAccount) {
      Alert.alert("غير مصرّح", "تغيير الاسم متاح لصاحب الحساب فقط");
      setSavingCompanyName(false);
      return;
    }
    const { error } = await (supabase as any).from("company_settings").upsert({ id: 1, company_name: value, updated_by: user?.id, updated_at: new Date().toISOString() }, { onConflict: "id" });
    Alert.alert(error ? "تعذر الحفظ" : "تم الحفظ", error ? error.message : "تم تحديث اسم الشركة");
    setSavingCompanyName(false);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (loading)
    return (
      <View style={styles.center}>
        <Text style={{ color: "#64748b" }}>جاري التحميل...</Text>
      </View>
    );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={styles.title}>لوحة التحكم</Text>
      {isOwnerAccount && <View style={styles.companyCard}>
        <Text style={styles.sectionTitle}>إعدادات شركة ممنون</Text>
        <Text style={styles.companyHint}>تغيير الاسم الظاهر للمنصة</Text>
        <TextInput value={companyName} onChangeText={setCompanyName} maxLength={80} placeholder="اسم الشركة" style={styles.companyInput} textAlign="right" />
        <TouchableOpacity onPress={saveCompanyName} disabled={savingCompanyName} style={styles.companySave}>
          <Text style={styles.companySaveText}>{savingCompanyName ? "جاري الحفظ..." : "حفظ اسم الشركة"}</Text>
        </TouchableOpacity>
      </View>}
      <TouchableOpacity onPress={() => router.push("/support-chat")} style={styles.supportButton}><Text style={styles.supportButtonText}>محادثات الدعم مع الفنيين والسائقين</Text></TouchableOpacity>
      <View style={styles.inboxHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionTitle}>رسائل المستخدمين إلى الإدارة</Text>
          <Text style={styles.inboxHint}>{unreadSupport} رسالة غير مقروءة</Text>
        </View>
        <TouchableOpacity onPress={() => router.push("/support-chat")} style={styles.inboxOpen}><Text style={styles.inboxOpenText}>فتح الصندوق</Text></TouchableOpacity>
      </View>
      {supportInbox.length === 0 ? <Text style={styles.emptyHint}>ماكو رسائل دعم واردة حالياً</Text> : supportInbox.slice(0, 5).map((conversation) => (
        <TouchableOpacity key={conversation.id} onPress={() => router.push("/support-chat")} style={styles.inboxCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.inboxName}>{conversation.profile?.full_name || "مستخدم ممنون"}</Text>
            <Text style={styles.inboxPreview} numberOfLines={1}>{conversation.latest?.body || "بدأ محادثة دعم جديدة"}</Text>
          </View>
          {!conversation.latest?.read_at && conversation.latest?.sender_id !== user?.id ? <Text style={styles.unreadMark}>جديد</Text> : null}
        </TouchableOpacity>
      ))}
      <View style={styles.inboxHeader}>
        <Text style={styles.sectionTitle}>بلاغات المستخدمين</Text>
        <TouchableOpacity onPress={() => onRefresh()}><Text style={styles.inboxOpenText}>تحديث</Text></TouchableOpacity>
      </View>
      {reports.length === 0 ? <Text style={styles.emptyHint}>ماكو بلاغات واردة حالياً</Text> : reports.map((report) => (
        <View key={report.id} style={styles.reportCard}>
          <Text style={styles.inboxName}>{report.reason || "بلاغ بدون عنوان"}</Text>
          {!!report.details && <Text style={styles.reportDetails}>{report.details}</Text>}
          <Text style={styles.reportMeta}>الحالة: {report.status} · {new Date(report.created_at).toLocaleString("ar-IQ")}</Text>
          {!!report.request_id && <Text style={styles.reportMeta}>رقم الطلب: {report.request_id}</Text>}
        </View>
      ))}
      <View style={styles.statsGrid}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{stats.totalRequests}</Text>
          <Text style={styles.statLabel}>إجمالي الطلبات</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{stats.totalUsers}</Text>
          <Text style={styles.statLabel}>المستخدمين</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{stats.totalDrivers}</Text>
          <Text style={styles.statLabel}>السائقين</Text>
        </View>
      </View>
      <Text style={styles.sectionTitle}>قواعد التسعير</Text>
      {pricing.map((p) => (
        <View key={p.id} style={styles.pricingCard}>
          <Text style={styles.pricingCategory}>{p.vehicle_category}</Text>
          <Text style={styles.pricingValues}>
            {p.base_fare?.toLocaleString("en")} + {p.per_km?.toLocaleString("en")}/كم
          </Text>
        </View>
      ))}
      <Text style={styles.sectionTitle}>أحدث الطلبات</Text>
      {recent.map((req) => (
        <View key={req.id} style={styles.reqCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.reqType}>{req.type === "taxi" ? "🚕" : `🔧 ${req.type}`}</Text>
            <Text style={styles.reqCustomer}>{req.customer?.full_name || "زبون"}</Text>
            <Text style={styles.reqDate}>{new Date(req.created_at).toLocaleDateString("ar")}</Text>
          </View>
          <Text style={styles.reqStatus}>{req.status}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.canvas, paddingHorizontal: 18, paddingTop: 52 },
  companyCard: { backgroundColor: palette.surface, borderRadius: radius.lg, padding: 16, marginBottom: 18, borderWidth: 1, borderColor: palette.line },
  companyHint: { color: palette.muted, fontSize: 11, marginBottom: 10, lineHeight: 18 },
  companyInput: { minHeight: 52, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: palette.ink, marginBottom: 10, backgroundColor: palette.canvas },
  companySave: { backgroundColor: palette.brand, borderRadius: radius.md, padding: 14, alignItems: "center" },
  companySaveText: { color: palette.white, fontWeight: "900" },
  supportButton: { backgroundColor: palette.brand, borderRadius: radius.md, padding: 14, marginBottom: 18 },
  supportButtonText: { color: palette.white, fontWeight: "900", textAlign: "center" },
  inboxHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12, marginBottom: 8 },
  inboxHint: { color: palette.muted, fontSize: 11, marginTop: -5, marginBottom: 8 },
  inboxOpen: { backgroundColor: palette.brandSoft, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 9 },
  inboxOpenText: { color: palette.brand, fontSize: 11, fontWeight: "900" },
  inboxCard: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, padding: 13, marginBottom: 7 },
  inboxName: { color: palette.ink, fontSize: 13, fontWeight: "900", textAlign: "right" },
  inboxPreview: { color: palette.muted, fontSize: 11, textAlign: "right", marginTop: 4 },
  unreadMark: { color: palette.white, backgroundColor: palette.brand, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 5, fontSize: 10, fontWeight: "900" },
  emptyHint: { color: palette.muted, fontSize: 12, textAlign: "center", padding: 12 },
  reportCard: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, padding: 13, marginBottom: 8 },
  reportDetails: { color: palette.ink, fontSize: 12, lineHeight: 20, textAlign: "right", marginTop: 5 },
  reportMeta: { color: palette.muted, fontSize: 10, textAlign: "right", marginTop: 5 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  title: { fontSize: 27, fontWeight: "900", color: palette.ink, marginBottom: 18 },
  statsGrid: { flexDirection: "row", gap: 10, marginBottom: 22 },
  statCard: { flex: 1, backgroundColor: palette.surface, borderRadius: radius.lg, padding: 15, alignItems: "center", borderWidth: 1, borderColor: palette.line },
  statValue: { fontSize: 26, fontWeight: "900", color: palette.brand },
  statLabel: { fontSize: 11, color: palette.muted, marginTop: 5, textAlign: "center" },
  sectionTitle: { fontSize: 16, fontWeight: "900", color: palette.ink, marginBottom: 12 },
  pricingCard: { flexDirection: "row", justifyContent: "space-between", backgroundColor: palette.surface, borderRadius: radius.md, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: palette.line },
  pricingCategory: { fontSize: 13, fontWeight: "900", color: palette.ink },
  pricingValues: { fontSize: 12, color: palette.muted },
  reqCard: { flexDirection: "row", alignItems: "center", backgroundColor: palette.surface, borderRadius: radius.md, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: palette.line },
  reqType: { fontSize: 17 },
  reqCustomer: { fontSize: 13, fontWeight: "900", color: palette.ink, marginTop: 3 },
  reqDate: { fontSize: 11, color: palette.muted, marginTop: 3 },
  reqStatus: { fontSize: 11, fontWeight: "900", color: palette.muted },
});
