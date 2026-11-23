import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Stack, router } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { palette, radius, space } from "@/styles/theme";
import { getAdminStaffRoles } from "@/lib/admin-access";

type CancellationStat = { cancellation_reason: string; cancelled_by_role: string; cancellation_count: number; percentage: number };
type RequestRow = {
  id: string; type?: string; status?: string; price_estimate?: number | null;
  created_at?: string; pickup_text?: string | null; dest_text?: string | null;
  customer_id?: string | null; provider_id?: string | null; request_code?: string | null;
};
const FILTERS = [
  ["all", "الكل"], ["pending", "معلّق"], ["searching", "بحث عن مقدم"], ["accepted", "مقبول"],
  ["in_progress", "قيد التنفيذ"], ["completed", "مكتمل"], ["cancelled", "ملغي"],
] as const;

export default function AdminRequestsScreen() {
  const { user, loading: authLoading } = useAuth();
  const [canView, setCanView] = useState<boolean | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [filter, setFilter] = useState("all");
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [cancelTarget, setCancelTarget] = useState<RequestRow | null>(null);
  const [error, setError] = useState("");
  const [lookupCode, setLookupCode] = useState("");
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [cancellationStats, setCancellationStats] = useState<CancellationStat[]>([]);

  const invoke = useCallback(async (body: Record<string, unknown>) => {
    const { data, error: invokeError } = await supabase.functions.invoke("admin-users", { body });
    if (invokeError) throw new Error(invokeError.message || "تعذر الاتصال بخدمة الإدارة");
    if (data?.error) throw new Error(data.error);
    return data;
  }, []);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setError("");
    try {
      const roleNames = await getAdminStaffRoles(user.id);
      if (!roleNames.some((role: string) => ["super_admin", "admin", "support", "department_operations"].includes(role))) {
        setCanView(false); setRows([]); return;
      }
      setCanManage(roleNames.includes("super_admin") || roleNames.includes("admin"));
      setCanView(true);
      const [result, statsResult] = await Promise.all([
        invoke({ action: "requests", status: filter, limit: 100 }),
        (supabase as any).rpc("admin_cancellation_analytics"),
      ]);
      setRows(result.requests ?? []);
      if (!statsResult.error) setCancellationStats(statsResult.data ?? []);
    } catch (e: any) {
      setError(String(e?.message || "تعذر تحميل الطلبات"));
      setRows([]);
    } finally { setLoading(false); }
  }, [user?.id, filter, invoke]);

  useEffect(() => {
    if (!authLoading) {
      if (!user) { setCanView(false); setLoading(false); }
      else void load();
    }
  }, [authLoading, user, load]);

  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const lookupTrip = async () => {
    const code = lookupCode.trim();
    if (!code) { Alert.alert("رقم الرحلة مطلوب", "اكتب رقم الرحلة للبحث عنها."); return; }
    setDetailLoading(true);
    setDetail(null);
    try {
      const result = await invoke({ action: "request_detail", request_code: code });
      setDetail(result);
    } catch (e: any) {
      Alert.alert("لم نعثر على الرحلة", String(e?.message || "تأكد من رقم الرحلة وصلاحيات حسابك."));
    } finally { setDetailLoading(false); }
  };

  const cancelRequest = async () => {
    if (!cancelTarget) return;
    setBusyId(cancelTarget.id);
    try {
      await invoke({ action: "cancel_request", request_id: cancelTarget.id, reason });
      setCancelTarget(null); setReason("");
      await load();
      Alert.alert("تم", "تم إلغاء الطلب وتسجيل الإجراء.");
    } catch (e: any) { Alert.alert("تعذر إلغاء الطلب", String(e?.message || "حاول مرة ثانية")); }
    finally { setBusyId(null); }
  };

  const reopenRequest = (row: RequestRow) => {
    Alert.alert("إعادة فتح الطلب", "تأكد من أن إعادة فتح هذا الطلب مناسبة قبل المتابعة.", [
      { text: "رجوع", style: "cancel" },
      { text: "إعادة فتح", onPress: async () => {
        setBusyId(row.id);
        try { await invoke({ action: "reopen_request", request_id: row.id }); await load(); Alert.alert("تم", "تمت إعادة فتح الطلب."); }
        catch (e: any) { Alert.alert("تعذر إعادة الفتح", String(e?.message || "حاول مرة ثانية")); }
        finally { setBusyId(null); }
      } },
    ]);
  };

  if (authLoading || loading) return <View style={s.center}><ActivityIndicator size="large" color={palette.brand}/><Text style={s.muted}>جاري تحميل الطلبات...</Text></View>;
  if (canView === false) return <View style={s.center}><Text style={s.title}>غير مصرّح</Text><Text style={s.muted}>هذه الصفحة متاحة للمدير أو الدعم المخوّل فقط.</Text></View>;

  return (
    <View style={s.page}>
      <Stack.Screen options={{ title: "إدارة الطلبات" }} />
      <TouchableOpacity onPress={() => router.push("/admin/partner-applications")} style={{marginHorizontal:16,marginTop:10,backgroundColor:palette.brand,borderRadius:12,padding:12}}><Text style={{color:"#fff",fontWeight:"900",textAlign:"center"}}>طلبات الشراكة واعتماد المنشآت</Text></TouchableOpacity>
      <ScrollView contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh}/>}>
        <Text style={s.title}>إدارة الطلبات</Text>
        <Text style={s.muted}>آخر 100 طلب · {rows.length.toLocaleString("ar-IQ")} نتيجة</Text>
        {cancellationStats.length > 0 && <View style={s.detailCard}>
          <Text style={s.name}>إحصائيات أسباب الإلغاء</Text>
          <Text style={s.muted}>إجمالي الإلغاءات المسجلة: {cancellationStats.reduce((sum, item) => sum + Number(item.cancellation_count || 0), 0).toLocaleString("ar-IQ")}</Text>
          {cancellationStats.map((item, index) => <View key={item.cancelled_by_role + ":" + item.cancellation_reason + ":" + index} style={{ gap: 4 }}>
            <View style={s.row}><Text style={s.muted}>{Number(item.cancellation_count).toLocaleString("ar-IQ")} · {Number(item.percentage).toLocaleString("ar-IQ")}%</Text><Text style={s.personName}>{item.cancellation_reason} · {item.cancelled_by_role === "customer" ? "الزبون" : item.cancelled_by_role === "provider" ? "مقدم الخدمة" : "النظام"}</Text></View>
            <View style={{ height: 6, borderRadius: 8, backgroundColor: palette.line, overflow: "hidden" }}><View style={{ width: (Math.max(0, Math.min(100, Number(item.percentage))) + "%") as `${number}%`, height: 6, backgroundColor: palette.brand }}/></View>
          </View>)}
        </View>}
        <View style={s.lookupCard}>
          <Text style={s.name}>متابعة رحلة برقمها</Text>
          <TextInput value={lookupCode} onChangeText={setLookupCode} autoCapitalize="characters" placeholder="مثال MN-2026-00000124" placeholderTextColor={palette.muted} style={s.lookupInput}/>
          <TouchableOpacity disabled={detailLoading} onPress={() => void lookupTrip()} style={s.primary}>
            <Text style={s.buttonText}>{detailLoading ? "جارٍ البحث..." : "عرض تفاصيل الرحلة كاملة"}</Text>
          </TouchableOpacity>
        </View>
        {detail && <View style={s.detailCard}>
          <View style={s.row}><Text style={s.status}>{detail.request?.status || "—"}</Text><Text style={s.name}>الرحلة {detail.request?.request_code || detail.request?.id}</Text></View>
          <Info label="النوع" value={detail.request?.type}/>
          <Info label="رقم الرحلة" value={detail.request?.request_code}/>
          <Info label="تاريخ الإنشاء" value={detail.request?.created_at ? new Date(detail.request.created_at).toLocaleString("ar-IQ") : "—"}/>
          <Info label="بدء التنفيذ" value={detail.request?.started_at ? new Date(detail.request.started_at).toLocaleString("ar-IQ") : "—"}/>
          <Info label="الاكتمال" value={detail.request?.completed_at ? new Date(detail.request.completed_at).toLocaleString("ar-IQ") : "—"}/>
          {(detail.request?.status === "cancelled" || detail.request?.cancelled_by) && <>
            <Info label={detail.request?.status === "cancelled" ? "ألغى الرحلة" : "آخر اعتذار عن الرحلة"} value={!detail.request?.cancelled_by ? "النظام" : detail.request?.cancelled_by === detail.request?.customer_id ? "الزبون" : "السائق / مقدم الخدمة"}/>
            <Info label="سبب الإلغاء" value={detail.request?.cancellation_reason || "غير مسجل"}/>
          </>}
          <Info label="الانطلاق" value={detail.request?.pickup_text}/>
          <Info label="الوجهة" value={detail.request?.dest_text}/>
          <Info label="وصف العمل" value={detail.request?.work_description || detail.request?.notes}/>
          <Info label="السعر" value={detail.request?.price_estimate == null ? "—" : Number(detail.request.price_estimate).toLocaleString("ar-IQ") + " د.ع"}/>
          <Info label="الدفع" value={detail.request?.payment_method}/>
          <View style={s.participants}>
            {detail.customer && <View style={s.person}>
              {detail.customer.avatar_url ? <Image source={{uri:detail.customer.avatar_url}} style={s.avatar}/> : <View style={s.avatarFallback}><Text>👤</Text></View>}
              <Text style={s.personName}>{detail.customer.full_name || "الزبون"}</Text>
              <Text style={s.muted}>{detail.customer.phone || "—"}</Text>
            </View>}
            {detail.provider && <View style={s.person}>
              {detail.provider.avatar_url ? <Image source={{uri:detail.provider.avatar_url}} style={s.avatar}/> : <View style={s.avatarFallback}><Text>🧑‍🔧</Text></View>}
              <Text style={s.personName}>{detail.provider.full_name || "مقدم الخدمة"}</Text>
              <Text style={s.muted}>{detail.provider.phone || "—"}</Text>
            </View>}
          </View>
          {!!detail.team_members?.length && <View style={s.detailSection}>
            <Text style={s.name}>فريق تنفيذ الخدمة</Text>
            {detail.team_members.map((member:any) => <Info key={member.provider_id} label={member.profile?.full_name || member.provider_id} value={"عدد الأفراد: " + Number(member.team_size || 1)}/>)}
          </View>}
          {detail.request?.attachment_url && <View style={s.detailSection}>
            <Text style={s.name}>صورة العمل المرفقة</Text>
            <Image source={{uri:detail.request.attachment_url}} style={s.workImage} resizeMode="contain"/>
          </View>}
          <View style={s.detailSection}>
            <Text style={s.name}>سجل مسار الرحلة ({detail.route_points?.length || 0} نقطة)</Text>
            {(detail.route_points || []).slice(-20).map((point:any,index:number)=><Info key={point.id || index} label={new Date(point.recorded_at).toLocaleString("ar-IQ")} value={point.lat + ", " + point.lng}/>)}
          </View>
          <View style={s.detailSection}>
            <Text style={s.name}>التقييمات المرتبطة ({detail.ratings?.length || 0})</Text>
            {(detail.ratings || []).map((rating:any) => <View key={rating.id} style={s.reportRow}>
              <Text style={s.personName}>التقييم العام: {Number(rating.stars || 0)}/5 ★</Text>
              <Text style={s.muted}>الاحترافية: {rating.professionalism ?? "—"}/5 · الالتزام: {rating.punctuality ?? "—"}/5 · الجودة: {rating.quality ?? "—"}/5</Text>
              {!!rating.reasons?.length && <Text style={s.muted}>الاختيارات: {rating.reasons.join("، ")}</Text>}
              {!!rating.comment && <Text style={s.muted}>{rating.comment}</Text>}
            </View>)}
          </View>
          <View style={s.detailSection}>
            <Text style={s.name}>البلاغات المرتبطة ({detail.reports?.length || 0})</Text>
            {(detail.reports || []).map((report:any)=><View key={report.id} style={s.reportRow}>
              <Text style={s.personName}>{report.reason} · {report.status}</Text>
              <Text style={s.muted}>{report.details || "بدون تفاصيل"}</Text>
              <Text style={s.muted}>المبلّغ: {report.reporter?.full_name || "—"} · {new Date(report.created_at).toLocaleString("ar-IQ")}</Text>
            </View>)}
          </View>
          <TouchableOpacity onPress={()=>setDetail(null)} style={s.secondary}><Text style={s.secondaryText}>إغلاق التفاصيل</Text></TouchableOpacity>
        </View>}
        <View style={s.filters}>
          {FILTERS.map(([value, label]) => <TouchableOpacity key={value} onPress={() => setFilter(value)} style={[s.chip, filter === value && s.chipActive]}><Text style={[s.chipText, filter === value && s.chipTextActive]}>{label}</Text></TouchableOpacity>)}
        </View>
        {!!error && <View style={s.error}><Text style={s.errorText}>{error}</Text></View>}
        {rows.length === 0 ? <Text style={s.empty}>ماكو طلبات بهذا التصنيف</Text> : rows.map(row => (
          <View key={row.id} style={s.card}>
            <View style={s.row}>
              <Text style={s.status}>{row.status || "—"}</Text>
              <Text style={s.name}>{row.type === "taxi" ? "طلب تكسي" : row.type === "large_vehicle" ? "مركبة كبيرة" : row.type || "طلب خدمة"}</Text>
            </View>
            <Text style={s.id}>رقم الرحلة: {row.request_code || row.id.slice(0, 8).toUpperCase()}</Text>
            {!!row.pickup_text && <Info label="موقع الانطلاق" value={row.pickup_text}/>}
            {!!row.dest_text && <Info label="الوجهة" value={row.dest_text}/>}
            <Info label="السعر التقديري" value={row.price_estimate == null ? "—" : `${Number(row.price_estimate).toLocaleString("ar-IQ")} د.ع`}/>
            <Info label="تاريخ الطلب" value={row.created_at ? new Date(row.created_at).toLocaleString("ar-IQ") : "—"}/>
            <Info label="معرّف الزبون" value={row.customer_id ? row.customer_id.slice(0, 8) : "—"}/>
            <Info label="معرّف مقدم الخدمة" value={row.provider_id ? row.provider_id.slice(0, 8) : "لم يُعيّن بعد"}/>
            {canManage && <View style={s.actions}>
              {row.status !== "cancelled" && row.status !== "completed" && <TouchableOpacity disabled={!!busyId} style={s.danger} onPress={() => { setCancelTarget(row); setReason(""); }}><Text style={s.buttonText}>{busyId === row.id ? "..." : "إلغاء الطلب"}</Text></TouchableOpacity>}
              {row.status === "cancelled" && <TouchableOpacity disabled={!!busyId} style={s.primary} onPress={() => reopenRequest(row)}><Text style={s.buttonText}>{busyId === row.id ? "..." : "إعادة فتح"}</Text></TouchableOpacity>}
            </View>}
          </View>
        ))}
        <Text style={s.footnote}>الإلغاء وإعادة الفتح محصوران بصلاحية المدير، وينفذهما الخادم عبر إجراءات قاعدة البيانات المعتمدة.</Text>
      </ScrollView>
      {cancelTarget && <View style={s.overlay}><View style={s.modal}>
        <Text style={s.name}>تأكيد إلغاء الطلب #{cancelTarget.id.slice(0, 8)}</Text>
        <Text style={s.muted}>اكتب سبب الإلغاء ليُسجّل مع الإجراء.</Text>
        <TextInput value={reason} onChangeText={setReason} placeholder="سبب الإلغاء" placeholderTextColor={palette.muted} multiline textAlign="right" style={s.input}/>
        <View style={s.actions}>
          <TouchableOpacity style={s.secondary} onPress={() => setCancelTarget(null)}><Text style={s.secondaryText}>رجوع</Text></TouchableOpacity>
          <TouchableOpacity style={s.danger} disabled={!!busyId} onPress={() => void cancelRequest()}><Text style={s.buttonText}>تأكيد الإلغاء</Text></TouchableOpacity>
        </View>
      </View></View>}
    </View>
  );
}

function Info({ label, value }: { label: string; value: unknown }) {
  return <View style={s.info}><Text style={s.infoLabel}>{label}</Text><Text style={s.infoValue}>{String(value ?? "—")}</Text></View>;
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: palette.pageCanvas }, content: { padding: space.lg, paddingBottom: 48, gap: 10 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: palette.pageCanvas, padding: 24, gap: 10 },
  title: { color: palette.ink, fontSize: 21, fontWeight: "900", textAlign: "right" },
  name: { color: palette.ink, fontSize: 13, fontWeight: "900", textAlign: "right" },
  muted: { color: palette.muted, fontSize: 11, textAlign: "right", lineHeight: 19 },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 8 },
  chipActive: { backgroundColor: palette.brand, borderColor: palette.brand },
  chipText: { color: palette.ink, fontSize: 10, fontWeight: "800" }, chipTextActive: { color: palette.white },
  lookupCard: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.lg, padding: 13, gap: 8 },
  lookupInput: { minHeight: 44, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, paddingHorizontal: 12, color: palette.ink, textAlign: "right" },
  detailCard: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.brand, borderRadius: radius.lg, padding: 14, gap: 8 },
  participants: { flexDirection: "row", gap: 12, justifyContent: "space-around", paddingVertical: 10 },
  person: { alignItems: "center", flex: 1, gap: 4 },
  avatar: { width: 54, height: 54, borderRadius: 27 },
  avatarFallback: { width: 54, height: 54, borderRadius: 27, backgroundColor: palette.surfaceSoft, alignItems: "center", justifyContent: "center" },
  personName: { color: palette.ink, fontSize: 11, fontWeight: "900", textAlign: "center" },
  detailSection: { borderTopWidth: 1, borderTopColor: palette.line, paddingTop: 10, gap: 7 },
  workImage: { width: "100%", height: 180, backgroundColor: palette.surfaceSoft, borderRadius: radius.md },
  reportRow: { padding: 9, borderRadius: radius.md, backgroundColor: palette.surfaceSoft, gap: 4 },
  card: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.lg, padding: 13, gap: 6 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  status: { color: palette.brand, fontSize: 10, fontWeight: "900" }, id: { color: palette.muted, fontSize: 9, textAlign: "right" },
  info: { flexDirection: "row", justifyContent: "space-between", gap: 10, borderBottomWidth: 1, borderBottomColor: palette.line, paddingVertical: 5 },
  infoLabel: { color: palette.muted, fontSize: 10 }, infoValue: { color: palette.ink, fontSize: 10, fontWeight: "700", textAlign: "right", flexShrink: 1, maxWidth: "72%" },
  actions: { flexDirection: "row", justifyContent: "flex-start", gap: 8, marginTop: 8 },
  danger: { minHeight: 40, backgroundColor: palette.danger, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 8, alignItems: "center", justifyContent: "center" },
  primary: { minHeight: 40, backgroundColor: palette.brand, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 8, alignItems: "center", justifyContent: "center" },
  secondary: { backgroundColor: palette.brandSoft, borderRadius: radius.md, paddingHorizontal: 13, paddingVertical: 10 },
  buttonText: { color: palette.white, fontSize: 11, fontWeight: "900" }, secondaryText: { color: palette.brand, fontSize: 11, fontWeight: "900" },
  empty: { color: palette.muted, textAlign: "center", padding: 24 },
  error: { backgroundColor: palette.dangerSoft, borderRadius: radius.md, padding: 10 }, errorText: { color: palette.danger, fontSize: 11, textAlign: "right" },
  footnote: { color: palette.muted, fontSize: 10, textAlign: "right", lineHeight: 18 },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: 18 },
  modal: { backgroundColor: palette.canvas, borderRadius: radius.lg, padding: 17, gap: 10 },
  input: { minHeight: 82, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, padding: 12, color: palette.ink, backgroundColor: palette.surface },
});
