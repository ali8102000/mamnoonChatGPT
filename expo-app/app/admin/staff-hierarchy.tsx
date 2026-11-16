import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Stack } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { palette, radius, space } from "@/styles/theme";

const RANKS: Record<string,string> = { owner: "الرئيس المؤسس الأعلى", general_manager: "مدير عام", department_manager: "مدير قسم", supervisor: "مشرف", employee: "موظف" };
const DEPARTMENTS: Record<string,string> = { executive: "الإدارة التنفيذية", customer_service: "خدمة العملاء", finance: "المالية", operations: "التشغيل", monitoring: "المراقبة" };
const RANK_OPTIONS = ["employee","supervisor","department_manager","general_manager"];
const DEPARTMENT_OPTIONS = ["customer_service","finance","operations","monitoring","executive"];

export default function StaffHierarchyScreen() {
  const { user } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [superAdmin, setSuperAdmin] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [rank, setRank] = useState("employee");
  const [department, setDepartment] = useState("customer_service");
  const [displayTitle, setDisplayTitle] = useState("موظف خدمة العملاء");

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await (supabase as any).rpc("staff_list_department");
    if (error) Alert.alert("ممنون", error.message);
    setRows(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    void (async () => {
      const { data } = await (supabase as any).rpc("get_staff_roles", { p_user_id: user.id });
      setSuperAdmin((data ?? []).includes("super_admin"));
    })();
  }, [user?.id]);

  useEffect(() => { void load(); }, [load]);

  async function searchUsers() {
    if (query.trim().length < 2) { Alert.alert("تنبيه", "اكتب حرفين على الأقل للبحث"); return; }
    setSearching(true);
    const { data, error } = await (supabase as any).rpc("staff_search_users", { p_query: query.trim() });
    setSearching(false);
    if (error) Alert.alert("تعذر البحث", error.message);
    else setResults(data ?? []);
  }

  async function assign(person: any) {
    setBusy(person.user_id);
    const { error } = await (supabase as any).rpc("staff_set_rank", {
      p_target_user: person.user_id,
      p_new_rank: rank,
      p_department: department,
      p_display_title: displayTitle.trim() || null,
    });
    setBusy(null);
    if (error) Alert.alert("تعذر تعيين الموظف", error.message);
    else { Alert.alert("تم", "تم تعيين الموظف وحفظ رتبته وقسمه"); setResults((old) => old.filter((p) => p.user_id !== person.user_id)); await load(); }
  }

  async function promote(userId: string) {
    setBusy(userId);
    const { data, error } = await (supabase as any).rpc("staff_promote_one_level", { p_target_user: userId });
    setBusy(null);
    if (error) Alert.alert("تعذرت الترقية", error.message);
    else { Alert.alert("تمت الترقية", "الرتبة الجديدة: " + (RANKS[data] ?? data)); await load(); }
  }

  function deactivate(userId: string) {
    Alert.alert("إزالة الموظف", "راح تنلغي صلاحياته الوظيفية ويبقى حسابه الشخصي موجود. متأكد؟", [
      { text: "تراجع", style: "cancel" },
      { text: "إزالة", style: "destructive", onPress: async () => {
        setBusy(userId);
        const { error } = await (supabase as any).rpc("staff_deactivate", { p_target_user: userId });
        setBusy(null);
        if (error) Alert.alert("تعذرت الإزالة", error.message);
        else await load();
      } },
    ]);
  }

  return <View style={s.page}>
    <Stack.Screen options={{ title: "موظفو القسم والترقيات" }} />
    <ScrollView contentContainerStyle={s.content}>
      <Text style={s.title}>موظفو القسم والترقيات</Text>
      <Text style={s.note}>الترقية درجة واحدة فقط، ولا يمكن ترقية الموظف إلى رتبتك أو أعلى منك. كل عملية تُسجّل.</Text>

      {superAdmin && <View style={s.panel}>
        <Text style={s.sectionTitle}>إضافة موظف أو تعيين قسم</Text>
        <TextInput value={query} onChangeText={setQuery} placeholder="ابحث بالاسم أو الهاتف أو البريد" placeholderTextColor={palette.muted} style={s.input} />
        <TouchableOpacity onPress={() => void searchUsers()} disabled={searching} style={s.primaryButton}><Text style={s.primaryText}>{searching ? "جاري البحث..." : "بحث عن حساب"}</Text></TouchableOpacity>
        <Text style={s.label}>الرتبة</Text>
        <View style={s.chips}>{RANK_OPTIONS.map((value) => <TouchableOpacity key={value} onPress={() => setRank(value)} style={[s.chip, rank === value && s.chipActive]}><Text style={[s.chipText, rank === value && s.chipTextActive]}>{RANKS[value]}</Text></TouchableOpacity>)}</View>
        <Text style={s.label}>القسم الوظيفي</Text>
        <View style={s.chips}>{DEPARTMENT_OPTIONS.map((value) => <TouchableOpacity key={value} onPress={() => { setDepartment(value); setDisplayTitle(value === "customer_service" ? "موظف خدمة العملاء" : DEPARTMENTS[value]); }} style={[s.chip, department === value && s.chipActive]}><Text style={[s.chipText, department === value && s.chipTextActive]}>{DEPARTMENTS[value]}</Text></TouchableOpacity>)}</View>
        <TextInput value={displayTitle} onChangeText={setDisplayTitle} placeholder="المسمى الوظيفي الظاهر" placeholderTextColor={palette.muted} style={s.input} />
        {results.map((person) => <View key={person.user_id} style={s.result}>
          <View style={{ flex: 1 }}><Text style={s.name}>{person.full_name || "حساب مستخدم"}</Text><Text style={s.note}>{person.phone || person.email || person.user_id}</Text></View>
          <TouchableOpacity disabled={!!busy} onPress={() => void assign(person)} style={s.button}><Text style={s.buttonText}>{busy === person.user_id ? "..." : "تعيين"}</Text></TouchableOpacity>
        </View>)}
      </View>}

      {loading ? <ActivityIndicator color={palette.brand} /> : rows.length === 0 ? <Text style={s.note}>ماكو موظفين أدنى من رتبتك بهذا القسم حالياً.</Text> : rows.map((person) => <View key={person.user_id} style={s.card}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={s.name}>{person.full_name || person.email || "موظف"}</Text>
          <Text style={s.note}>{DEPARTMENTS[person.department] ?? person.department} · {RANKS[person.rank] ?? person.rank}</Text>
          {!!person.phone && <Text style={s.note}>{person.phone}</Text>}
        </View>
        {person.rank !== "owner" && <View style={s.actions}>
          <TouchableOpacity disabled={!!busy} onPress={() => void promote(person.user_id)} style={s.button}><Text style={s.buttonText}>{busy === person.user_id ? "..." : "ترقية"}</Text></TouchableOpacity>
          {superAdmin && <TouchableOpacity disabled={!!busy} onPress={() => deactivate(person.user_id)} style={s.removeButton}><Text style={s.removeText}>إزالة</Text></TouchableOpacity>}
        </View>}
      </View>)}
    </ScrollView>
  </View>;
}
const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: palette.canvas },
  content: { padding: space.lg, paddingBottom: 48, gap: 12 },
  title: { color: palette.ink, fontSize: 21, fontWeight: "900", textAlign: "right" },
  sectionTitle: { color: palette.ink, fontSize: 15, fontWeight: "900", textAlign: "right" },
  label: { color: palette.ink, fontSize: 12, fontWeight: "900", textAlign: "right" },
  note: { color: palette.muted, fontSize: 12, textAlign: "right", lineHeight: 20 },
  panel: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.lg, padding: 14, gap: 10 },
  input: { backgroundColor: palette.canvas, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, padding: 11, color: palette.ink, textAlign: "right", fontSize: 12 },
  primaryButton: { backgroundColor: palette.brand, borderRadius: radius.md, padding: 12, alignItems: "center" },
  primaryText: { color: palette.white, fontWeight: "900", fontSize: 12 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "flex-end" },
  chip: { backgroundColor: palette.canvas, borderWidth: 1, borderColor: palette.line, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 7 },
  chipActive: { backgroundColor: palette.brandSoft, borderColor: palette.brand },
  chipText: { color: palette.muted, fontSize: 10, fontWeight: "800" },
  chipTextActive: { color: palette.brand },
  result: { flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, borderColor: palette.line, paddingTop: 10 },
  card: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.lg, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  actions: { alignItems: "center", gap: 6 },
  name: { color: palette.ink, fontSize: 14, fontWeight: "900", textAlign: "right" },
  button: { backgroundColor: palette.brandSoft, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 10 },
  buttonText: { color: palette.brand, fontWeight: "900", fontSize: 12 },
  removeButton: { backgroundColor: "#FEE2E2", borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 10 },
  removeText: { color: "#B91C1C", fontWeight: "900", fontSize: 12 },
});
