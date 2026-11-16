import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Stack } from "expo-router";
import { supabase } from "@/lib/supabase";
import { palette, radius, space } from "@/styles/theme";

const RANKS: Record<string,string> = { owner: "الرئيس المؤسس الأعلى", general_manager: "مدير عام", department_manager: "مدير قسم", supervisor: "مشرف", employee: "موظف" };
const DEPARTMENTS: Record<string,string> = { executive: "الإدارة التنفيذية", customer_service: "خدمة العملاء", finance: "المالية", operations: "التشغيل", monitoring: "المراقبة" };

export default function StaffHierarchyScreen() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await (supabase as any).rpc("staff_list_department");
    if (error) Alert.alert("ممنون", error.message);
    setRows(data ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function promote(userId: string) {
    setBusy(userId);
    const { data, error } = await (supabase as any).rpc("staff_promote_one_level", { p_target_user: userId });
    setBusy(null);
    if (error) Alert.alert("تعذرت الترقية", error.message);
    else { Alert.alert("تمت الترقية", "الرتبة الجديدة: " + (RANKS[data] ?? data)); await load(); }
  }
  return <View style={s.page}>
    <Stack.Screen options={{ title: "موظفو القسم والترقيات" }} />
    <ScrollView contentContainerStyle={s.content}>
      <Text style={s.title}>موظفو القسم والترقيات</Text>
      <Text style={s.note}>الترقية درجة واحدة فقط، ولا يمكن ترقية الموظف إلى رتبتك أو أعلى منك. كل عملية تُسجّل.</Text>
      {loading ? <ActivityIndicator color={palette.brand} /> : rows.length === 0 ? <Text style={s.note}>ماكو موظفين أدنى من رتبتك بهذا القسم حالياً.</Text> : rows.map((person) => <View key={person.user_id} style={s.card}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={s.name}>{person.full_name || person.email || "موظف"}</Text>
          <Text style={s.note}>{DEPARTMENTS[person.department] ?? person.department} · {RANKS[person.rank] ?? person.rank}</Text>
          {!!person.phone && <Text style={s.note}>{person.phone}</Text>}
        </View>
        <TouchableOpacity disabled={!!busy} onPress={() => void promote(person.user_id)} style={s.button}>
          <Text style={s.buttonText}>{busy === person.user_id ? "..." : "ترقية"}</Text>
        </TouchableOpacity>
      </View>)}
    </ScrollView>
  </View>;
}
const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: palette.canvas },
  content: { padding: space.lg, paddingBottom: 48, gap: 12 },
  title: { color: palette.ink, fontSize: 21, fontWeight: "900", textAlign: "right" },
  note: { color: palette.muted, fontSize: 12, textAlign: "right", lineHeight: 20 },
  card: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.lg, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  name: { color: palette.ink, fontSize: 14, fontWeight: "900", textAlign: "right" },
  button: { backgroundColor: palette.brandSoft, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 10 },
  buttonText: { color: palette.brand, fontWeight: "900", fontSize: 12 },
});
