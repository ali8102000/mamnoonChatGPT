import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Stack } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { palette, radius, space } from "@/styles/theme";
import { getAdminStaffRoles } from "@/lib/admin-access";

type RequestRow = {
  id: string; type?: string; status?: string; price_estimate?: number | null;
  created_at?: string; pickup_text?: string | null; dest_text?: string | null;
  customer_id?: string | null; provider_id?: string | null;
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
      const result = await invoke({ action: "requests", status: filter, limit: 100 });
      setRows(result.requests ?? []);
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
      <ScrollView contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh}/>}>
        <Text style={s.title}>إدارة الطلبات</Text>
        <Text style={s.muted}>آخر 100 طلب · {rows.length.toLocaleString("ar-IQ")} نتيجة</Text>
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
            <Text style={s.id}>#{row.id.slice(0, 8)}</Text>
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
  page: { flex: 1, backgroundColor: palette.canvas }, content: { padding: space.lg, paddingBottom: 48, gap: 10 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: palette.canvas, padding: 24, gap: 10 },
  title: { color: palette.ink, fontSize: 21, fontWeight: "900", textAlign: "right" },
  name: { color: palette.ink, fontSize: 13, fontWeight: "900", textAlign: "right" },
  muted: { color: palette.muted, fontSize: 11, textAlign: "right", lineHeight: 19 },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 8 },
  chipActive: { backgroundColor: palette.brand, borderColor: palette.brand },
  chipText: { color: palette.ink, fontSize: 10, fontWeight: "800" }, chipTextActive: { color: palette.white },
  card: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.lg, padding: 13, gap: 6 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  status: { color: palette.brand, fontSize: 10, fontWeight: "900" }, id: { color: palette.muted, fontSize: 9, textAlign: "right" },
  info: { flexDirection: "row", justifyContent: "space-between", gap: 10, borderBottomWidth: 1, borderBottomColor: palette.line, paddingVertical: 5 },
  infoLabel: { color: palette.muted, fontSize: 10 }, infoValue: { color: palette.ink, fontSize: 10, fontWeight: "700", textAlign: "right", flexShrink: 1, maxWidth: "72%" },
  actions: { flexDirection: "row", justifyContent: "flex-start", gap: 8, marginTop: 8 },
  danger: { backgroundColor: palette.danger, borderRadius: radius.md, paddingHorizontal: 13, paddingVertical: 10 },
  primary: { backgroundColor: palette.brand, borderRadius: radius.md, paddingHorizontal: 13, paddingVertical: 10 },
  secondary: { backgroundColor: palette.brandSoft, borderRadius: radius.md, paddingHorizontal: 13, paddingVertical: 10 },
  buttonText: { color: palette.white, fontSize: 11, fontWeight: "900" }, secondaryText: { color: palette.brand, fontSize: 11, fontWeight: "900" },
  empty: { color: palette.muted, textAlign: "center", padding: 24 },
  error: { backgroundColor: palette.dangerSoft, borderRadius: radius.md, padding: 10 }, errorText: { color: palette.danger, fontSize: 11, textAlign: "right" },
  footnote: { color: palette.muted, fontSize: 10, textAlign: "right", lineHeight: 18 },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: 18 },
  modal: { backgroundColor: palette.canvas, borderRadius: radius.lg, padding: 17, gap: 10 },
  input: { minHeight: 82, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, padding: 12, color: palette.ink, backgroundColor: palette.surface },
});
