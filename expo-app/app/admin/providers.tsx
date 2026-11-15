import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Linking, RefreshControl, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { Stack } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { palette, radius, space } from "@/styles/theme";

type ProviderType = "driver" | "large_driver" | "worker";
type ProviderStatus = "all" | "approved" | "pending" | "suspended" | "rejected";
type Provider = {
  user_id: string;
  status?: string;
  available?: boolean;
  created_at?: string;
  vehicle_make?: string;
  vehicle_model?: string;
  vehicle_year?: number;
  vehicle_color?: string;
  vehicle_category?: string;
  vehicle_type?: string;
  level?: string;
  profiles?: { full_name?: string | null; phone?: string | null; email?: string | null };
  verification?: {
    status?: string;
    rejection_reason?: string | null;
    face_photo_url?: string | null;
    id_card_photo_url?: string | null;
    id_card_back_photo_url?: string | null;
    vehicle_document_url?: string | null;
  } | null;
};

const TYPES: { value: ProviderType; label: string }[] = [
  { value: "driver", label: "سائقو التكسي" },
  { value: "large_driver", label: "السيارات الكبيرة" },
  { value: "worker", label: "الفنيون" },
];
const STATUSES: { value: ProviderStatus; label: string }[] = [
  { value: "all", label: "الكل" }, { value: "pending", label: "معلّق" },
  { value: "approved", label: "مقبول" }, { value: "suspended", label: "موقوف" },
  { value: "rejected", label: "مرفوض" },
];

export default function AdminProvidersScreen() {
  const { user, loading: authLoading } = useAuth();
  const [canView, setCanView] = useState<boolean | null>(null);
  const [type, setType] = useState<ProviderType>("driver");
  const [status, setStatus] = useState<ProviderStatus>("all");
  const [providers, setProviders] = useState<Provider[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    if (!user?.id) return;
    setError("");
    try {
      const { data: staff, error: permissionError } = await supabase.rpc("has_staff_role", { p_user_id: user.id });
      if (permissionError || staff !== true) {
        setCanView(false); setProviders([]); setTotal(0); return;
      }
      setCanView(true);
      const { data, error: invokeError } = await supabase.functions.invoke("admin-users", {
        body: { action: "providers", type, status, category: "all" },
      });
      if (invokeError) throw new Error(invokeError.message || "تعذر الاتصال بخدمة الإدارة");
      if (data?.error) throw new Error(data.error);
      setProviders(data?.providers ?? []);
      setTotal(data?.total ?? data?.providers?.length ?? 0);
    } catch (e: any) {
      setError(String(e?.message || "تعذر تحميل مقدمي الخدمة"));
      setProviders([]);
    } finally {
      setLoading(false);
    }
  }, [user?.id, type, status]);

  useEffect(() => {
    if (!authLoading) {
      if (!user) { setCanView(false); setLoading(false); }
      else void load();
    }
  }, [authLoading, user, load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const filteredProviders = providers.filter((provider) => {
    const q = search.trim().toLocaleLowerCase();
    if (!q) return true;
    return [provider.profiles?.full_name, provider.profiles?.phone, provider.profiles?.email]
      .some((value) => String(value ?? "").toLocaleLowerCase().includes(q));
  });

  const openDocument = async (label: string, url?: string | null) => {
    if (!url) { Alert.alert("المستند غير متوفر", "ماكو رابط صالح لهذا المستند حالياً."); return; }
    try { await Linking.openURL(url); }
    catch { Alert.alert("تعذر فتح المستند", "حاول مرة ثانية."); }
  };

  if (authLoading || loading) return <View style={s.center}><ActivityIndicator size="large" color={palette.brand}/><Text style={s.muted}>جاري تحميل مقدمي الخدمة...</Text></View>;
  if (canView === false) return <View style={s.center}><Text style={s.title}>غير مصرّح</Text><Text style={s.muted}>هذه الصفحة متاحة لموظفي الإدارة المخوّلين.</Text></View>;

  return (
    <View style={s.page}>
      <Stack.Screen options={{ title: "إدارة مقدمي الخدمة" }} />
      <ScrollView contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh}/>}>
        <Text style={s.title}>إدارة مقدمي الخدمة</Text>
        <Text style={s.muted}>عدد النتائج: {total.toLocaleString("ar-IQ")} · يتم عرض أحدث 200 حساب كحد أقصى</Text>
        <TextInput value={search} onChangeText={setSearch} placeholder="بحث بالاسم أو الهاتف أو البريد" placeholderTextColor={palette.muted} style={s.search} textAlign="right" />
        <View style={s.filters}>
          {TYPES.map(item => <TouchableOpacity key={item.value} onPress={() => setType(item.value)} style={[s.chip, type === item.value && s.chipActive]}><Text style={[s.chipText, type === item.value && s.chipTextActive]}>{item.label}</Text></TouchableOpacity>)}
        </View>
        <View style={s.filters}>
          {STATUSES.map(item => <TouchableOpacity key={item.value} onPress={() => setStatus(item.value)} style={[s.chip, status === item.value && s.chipActive]}><Text style={[s.chipText, status === item.value && s.chipTextActive]}>{item.label}</Text></TouchableOpacity>)}
        </View>
        {!!error && <View style={s.error}><Text style={s.errorText}>{error}</Text></View>}
        {filteredProviders.length === 0 ? <Text style={s.empty}>ماكو حسابات مطابقة</Text> : filteredProviders.map(provider => (
          <View key={provider.user_id} style={s.card}>
            <Text style={s.name}>{provider.profiles?.full_name || "بدون اسم"}</Text>
            <Text style={s.muted}>{provider.profiles?.phone || provider.profiles?.email || "لا توجد معلومات اتصال"}</Text>
            <View style={s.metaRow}>
              <Text style={s.status}>{provider.status || "غير محدد"}</Text>
              <Text style={s.meta}>{provider.available ? "متاح حالياً" : "غير متاح"}</Text>
            </View>
            {type !== "worker" ? (
              <>
                <Info label="المركبة" value={[`${provider.vehicle_make || ""} ${provider.vehicle_model || ""}`.trim(), provider.vehicle_year, provider.vehicle_color].filter(Boolean).join(" · ")}/>
                <Info label="الفئة" value={provider.vehicle_category || provider.vehicle_type}/>
              </>
            ) : <Info label="المستوى" value={provider.level}/>}
            <Info label="حالة المستمسكات" value={provider.verification?.status || "لم تُرفع مستمسكات"}/>
            {!!provider.verification?.rejection_reason && <Text style={s.errorText}>سبب الرفض: {provider.verification.rejection_reason}</Text>}
            <View style={s.docs}>
              <Doc label="صورة الوجه" url={provider.verification?.face_photo_url} onPress={openDocument}/>
              <Doc label="الهوية الأمامية" url={provider.verification?.id_card_photo_url} onPress={openDocument}/>
              <Doc label="الهوية الخلفية" url={provider.verification?.id_card_back_photo_url} onPress={openDocument}/>
              <Doc label="مستند المركبة" url={provider.verification?.vehicle_document_url} onPress={openDocument}/>
            </View>
          </View>
        ))}
        <Text style={s.footnote}>هذه الشاشة للعرض ومراجعة المستندات فقط. تغيير حالة السائق أو الفني يحتاج ربط إجراء إداري آمن ومراجعة سبب القرار قبل تفعيله.</Text>
      </ScrollView>
    </View>
  );
}

function Info({ label, value }: { label: string; value?: unknown }) {
  return <View style={s.info}><Text style={s.infoLabel}>{label}</Text><Text style={s.infoValue}>{value == null || value === "" ? "—" : String(value)}</Text></View>;
}

function Doc({ label, url, onPress }: { label: string; url?: string | null; onPress: (label: string, url?: string | null) => void }) {
  return <TouchableOpacity disabled={!url} onPress={() => void onPress(label, url)} style={[s.doc, !url && s.docDisabled]}><Text style={s.docText}>{url ? `عرض ${label}` : `${label} غير متوفر`}</Text></TouchableOpacity>;
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: palette.canvas },
  content: { padding: space.lg, paddingBottom: 48, gap: 10 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: palette.canvas, padding: 24, gap: 10 },
  title: { color: palette.ink, fontSize: 21, fontWeight: "900", textAlign: "right" },
  muted: { color: palette.muted, fontSize: 11, textAlign: "right", lineHeight: 19 },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  chip: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, paddingHorizontal: 11, paddingVertical: 9 },
  chipActive: { backgroundColor: palette.brand, borderColor: palette.brand },
  chipText: { color: palette.ink, fontSize: 10, fontWeight: "800" },
  chipTextActive: { color: palette.white },
  search: { backgroundColor: palette.surface, color: palette.ink, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, padding: 12 },
  card: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.lg, padding: 14, gap: 7 },
  name: { color: palette.ink, fontSize: 14, fontWeight: "900", textAlign: "right" },
  metaRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  status: { color: palette.brand, fontSize: 11, fontWeight: "900" },
  meta: { color: palette.muted, fontSize: 10 },
  info: { flexDirection: "row", justifyContent: "space-between", gap: 10, borderBottomWidth: 1, borderBottomColor: palette.line, paddingVertical: 5 },
  infoLabel: { color: palette.muted, fontSize: 10 },
  infoValue: { color: palette.ink, fontSize: 11, fontWeight: "800", textAlign: "right", flexShrink: 1 },
  docs: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 5 },
  doc: { backgroundColor: palette.brandSoft, paddingHorizontal: 10, paddingVertical: 8, borderRadius: radius.md },
  docDisabled: { opacity: 0.45 },
  docText: { color: palette.brand, fontSize: 10, fontWeight: "900" },
  error: { backgroundColor: palette.dangerSoft, borderRadius: radius.md, padding: 11 },
  errorText: { color: palette.danger, fontSize: 11, textAlign: "right", fontWeight: "800" },
  empty: { color: palette.muted, textAlign: "center", padding: 24 },
  footnote: { color: palette.muted, fontSize: 10, textAlign: "right", lineHeight: 18, marginTop: 6 },
});
