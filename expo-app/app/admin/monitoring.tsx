import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text,
  TouchableOpacity, View,
} from "react-native";
import { Stack } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { palette, radius, space } from "@/styles/theme";

type Tab = "live" | "reports" | "blocks" | "support";
type Report = { id: string; reason?: string; details?: string | null; reported_id?: string | null; created_at: string; status?: string };
type Block = { id: string; user_id: string; reason?: string | null; blocked_at?: string; expires_at?: string | null; profiles?: { full_name?: string | null } | null };
type Ticket = { id: string; subject?: string; description?: string; category?: string; created_at?: string; status?: string };

export default function MonitoringScreen() {
  const { user, loading: authLoading } = useAuth();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [tab, setTab] = useState<Tab>("live");
  const [stats, setStats] = useState({ totalUsers: 0, activeRequests: 0, activeDrivers: 0, activeWorkers: 0 });
  const [reports, setReports] = useState<Report[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const invoke = useCallback(async (body: Record<string, unknown>) => {
    const { data, error: callError } = await supabase.functions.invoke("admin-users", { body });
    if (callError) throw new Error(callError.message || "تعذر الاتصال بخدمة المراقبة");
    if (data?.error) throw new Error(data.error);
    return data;
  }, []);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setError("");
    try {
      const [rolesResult, admin] = await Promise.all([
        supabase.rpc("get_staff_roles", { p_user_id: user.id }),
        supabase.rpc("has_admin_access", { p_user_id: user.id }),
      ]);
      const roleNames = (rolesResult.data ?? []).map((entry: any) => typeof entry === "string" ? entry : entry.role);
      const canMonitor = roleNames.some((role: string) => ["super_admin", "admin", "support"].includes(role));
      const canReviewReports = roleNames.some((role: string) => ["super_admin", "admin", "support", "moderator"].includes(role));
      if (rolesResult.error || (!canMonitor && !canReviewReports)) {
        setAllowed(false); return;
      }
      setAllowed(true);
      setCanManage(admin.data === true);
      if (!canMonitor) {
        setTab("reports");
        const result = await invoke({ action: "reports" });
        setReports(result.reports ?? []);
        setBlocks([]);
        setTickets([]);
        return;
      }
      const result = await invoke({ action: "monitoring" });
      setStats(result.stats ?? { totalUsers: 0, activeRequests: 0, activeDrivers: 0, activeWorkers: 0 });
      setReports(result.reports ?? []);
      setBlocks(result.blocks ?? []);
      setTickets(result.tickets ?? []);
    } catch (e: any) {
      setError(String(e?.message || "تعذر تحميل بيانات المراقبة"));
    } finally {
      setDataLoading(false);
    }
  }, [user?.id, invoke]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { setAllowed(false); setDataLoading(false); }
    else void load();
  }, [authLoading, user, load]);

  useEffect(() => {
    if (allowed !== true) return;
    const interval = setInterval(() => { void load(); }, 15000);
    return () => clearInterval(interval);
  }, [allowed, load]);

  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const resolveReport = (report: Report) => Alert.alert(
    "حل البلاغ",
    "تأكيد إغلاق البلاغ وتسجيله كبلاغ محلول؟",
    [
      { text: "رجوع", style: "cancel" },
      { text: "حل البلاغ", onPress: async () => {
        setBusyId(report.id);
        try { await invoke({ action: "resolve_report", report_id: report.id, status: "resolved" }); await load(); Alert.alert("تم", "تم حل البلاغ."); }
        catch (e: any) { Alert.alert("تعذر حل البلاغ", String(e?.message || "حاول مرة ثانية")); }
        finally { setBusyId(null); }
      } },
    ],
  );

  const blockReportedUser = (report: Report) => {
    if (!report.reported_id) { Alert.alert("لا يمكن الحظر", "هذا البلاغ لا يحتوي على مستخدم محدد."); return; }
    Alert.alert("حظر المستخدم", "سيتم حظر المستخدم بشكل دائم ثم إغلاق البلاغ. هل تريد المتابعة؟", [
      { text: "رجوع", style: "cancel" },
      { text: "حظر وإغلاق البلاغ", style: "destructive", onPress: async () => {
        setBusyId(report.id);
        try {
          await invoke({ action: "block", user_id: report.reported_id, reason: report.reason || "بلاغ إداري", duration: "permanent" });
          await invoke({ action: "resolve_report", report_id: report.id, status: "resolved" });
          await load();
          Alert.alert("تم", "تم حظر المستخدم وإغلاق البلاغ.");
        } catch (e: any) { Alert.alert("تعذر تنفيذ العملية", String(e?.message || "حاول مرة ثانية")); }
        finally { setBusyId(null); }
      } },
    ]);
  };

  const unblock = (block: Block) => Alert.alert("رفع الحظر", "تأكيد رفع الحظر عن هذا المستخدم؟", [
    { text: "رجوع", style: "cancel" },
    { text: "رفع الحظر", onPress: async () => {
      setBusyId(block.id);
      try { await invoke({ action: "unblock", user_id: block.user_id }); await load(); Alert.alert("تم", "تم رفع الحظر."); }
      catch (e: any) { Alert.alert("تعذر رفع الحظر", String(e?.message || "حاول مرة ثانية")); }
      finally { setBusyId(null); }
    } },
  ]);

  if (authLoading || dataLoading || allowed === null) return <View style={s.center}><ActivityIndicator color={palette.brand}/><Text style={s.muted}>جاري تحميل المراقبة المباشرة...</Text></View>;
  if (!allowed) return <View style={s.center}><Text style={s.title}>غير مصرّح</Text><Text style={s.muted}>هذه الصفحة لموظفي ممنون المخوّلين فقط.</Text></View>;

  const reportsOnly = tab === "reports" && stats.totalUsers === 0 && blocks.length === 0 && tickets.length === 0;
  const tabs: { value: Tab; label: string }[] = reportsOnly
    ? [{ value: "reports", label: "البلاغات" }]
    : [
        { value: "live", label: "مباشر" }, { value: "reports", label: "البلاغات" },
        { value: "blocks", label: "الحظر" }, { value: "support", label: "الدعم" },
      ];

  return (
    <View style={s.page}>
      <Stack.Screen options={{ title: "المراقبة المباشرة" }} />
      <View style={s.tabs}>{tabs.map((item) => <TouchableOpacity key={item.value} onPress={() => setTab(item.value)} style={[s.tab, tab === item.value && s.tabActive]}><Text style={[s.tabText, tab === item.value && s.tabTextActive]}>{item.label}</Text></TouchableOpacity>)}</View>
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh}/>} contentContainerStyle={s.content}>
        {!!error && <View style={s.error}><Text style={s.errorText}>{error}</Text></View>}
        {tab === "live" && <>
          <Text style={s.title}>المراقبة المباشرة</Text>
          <View style={s.grid}>
            <Stat label="إجمالي المستخدمين" value={stats.totalUsers}/>
            <Stat label="سائقون نشطون" value={stats.activeDrivers}/>
            <Stat label="فنيون نشطون" value={stats.activeWorkers}/>
            <Stat label="طلبات نشطة" value={stats.activeRequests}/>
          </View>
          <Text style={s.muted}>يتم تحديث البيانات تلقائياً كل 15 ثانية.</Text>
        </>}
        {tab === "reports" && <>
          <Text style={s.title}>البلاغات المعلقة ({reports.length})</Text>
          {!reports.length ? <Text style={s.empty}>لا توجد بلاغات معلقة.</Text> : reports.map((report) => <View key={report.id} style={s.card}>
            <View style={s.row}><Text style={s.cardTitle}>{report.reason || "بلاغ بدون تصنيف"}</Text><Text style={s.date}>{new Date(report.created_at).toLocaleDateString("ar-IQ")}</Text></View>
            {!!report.details && <Text style={s.muted}>{report.details}</Text>}
            <Text style={s.muted}>رقم البلاغ: {report.id.slice(0, 8)}</Text>
            <View style={s.actions}>
              <TouchableOpacity disabled={busyId === report.id} onPress={() => resolveReport(report)} style={s.success}><Text style={s.actionText}>حل البلاغ</Text></TouchableOpacity>
              {canManage && <TouchableOpacity disabled={busyId === report.id} onPress={() => blockReportedUser(report)} style={s.danger}><Text style={s.actionText}>حظر المستخدم</Text></TouchableOpacity>}
            </View>
          </View>)}
        </>}
        {tab === "blocks" && <>
          <Text style={s.title}>المستخدمون المحظورون ({blocks.length})</Text>
          {!blocks.length ? <Text style={s.empty}>لا يوجد مستخدمون محظورون.</Text> : blocks.map((block) => <View key={block.id} style={s.card}>
            <Text style={s.cardTitle}>{block.profiles?.full_name || block.user_id.slice(0, 8)}</Text>
            {!!block.reason && <Text style={s.muted}>{block.reason}</Text>}
            <Text style={s.muted}>{block.expires_at ? `ينتهي ${new Date(block.expires_at).toLocaleString("ar-IQ")}` : "حظر دائم"}</Text>
            {canManage && <TouchableOpacity disabled={busyId === block.id} onPress={() => unblock(block)} style={s.success}><Text style={s.actionText}>رفع الحظر</Text></TouchableOpacity>}
          </View>)}
        </>}
        {tab === "support" && <>
          <Text style={s.title}>تذاكر الدعم المفتوحة ({tickets.length})</Text>
          {!tickets.length ? <Text style={s.empty}>لا توجد تذاكر دعم مفتوحة.</Text> : tickets.map((ticket) => <View key={ticket.id} style={s.card}>
            <Text style={s.cardTitle}>{ticket.subject || "تذكرة دعم"}</Text>
            {!!ticket.category && <Text style={s.muted}>التصنيف: {ticket.category}</Text>}
            {!!ticket.description && <Text style={s.muted}>{ticket.description}</Text>}
            {!!ticket.created_at && <Text style={s.date}>{new Date(ticket.created_at).toLocaleString("ar-IQ")}</Text>}
          </View>)}
        </>}
      </ScrollView>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return <View style={s.stat}><Text style={s.statValue}>{value.toLocaleString("ar-IQ")}</Text><Text style={s.statLabel}>{label}</Text></View>;
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: palette.canvas },
  tabs: { flexDirection: "row", gap: 5, padding: 9, backgroundColor: palette.surface, borderBottomWidth: 1, borderBottomColor: palette.line },
  tab: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: radius.md },
  tabActive: { backgroundColor: palette.brand },
  tabText: { color: palette.muted, fontSize: 10, fontWeight: "800" },
  tabTextActive: { color: palette.white },
  content: { padding: space.lg, gap: 10, paddingBottom: 48 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: palette.canvas, padding: 20, gap: 10 },
  title: { fontSize: 21, fontWeight: "900", color: palette.ink, textAlign: "right" },
  muted: { fontSize: 11, color: palette.muted, textAlign: "right", lineHeight: 19 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  stat: { width: "48%", flexGrow: 1, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.lg, padding: 15, gap: 5 },
  statValue: { fontSize: 24, fontWeight: "900", color: palette.brand, textAlign: "right" },
  statLabel: { fontSize: 10, color: palette.muted, textAlign: "right", fontWeight: "800" },
  card: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.lg, padding: 13, gap: 7 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  cardTitle: { fontSize: 12, fontWeight: "900", color: palette.ink, textAlign: "right", flexShrink: 1 },
  date: { color: palette.muted, fontSize: 9 },
  actions: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 5 },
  success: { backgroundColor: "#15803d", borderRadius: radius.md, paddingHorizontal: 13, paddingVertical: 9 },
  danger: { backgroundColor: palette.danger, borderRadius: radius.md, paddingHorizontal: 13, paddingVertical: 9 },
  actionText: { color: palette.white, fontSize: 10, fontWeight: "900" },
  empty: { color: palette.muted, textAlign: "center", padding: 24 },
  error: { backgroundColor: palette.dangerSoft, borderRadius: radius.md, padding: 11 },
  errorText: { color: palette.danger, fontSize: 11, textAlign: "right", fontWeight: "800" },
});
