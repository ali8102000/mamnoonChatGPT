import { useCallback, useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Switch, Text, TextInput, View, ActivityIndicator } from "react-native";
import { supabase } from "@/lib/supabase";
import { palette, radius } from "@/styles/theme";
import { ActionButton } from "@/components/ui";

type Rule = { tier: "economy" | "premium" | "luxury"; label_ar: string; min_completed_rides: string; min_ratings_count: string; min_avg_rating: string; is_active: boolean };
const TITLES = { economy: "اقتصادي", premium: "متميز", luxury: "فاخر" };

export default function DriverTiersAdminScreen() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await (supabase as any).rpc("admin_list_driver_performance_tier_rules");
    if (error) Alert.alert("تعذر تحميل المعايير", error.message);
    else setRules((data ?? []).map((r: any) => ({ ...r, min_completed_rides: String(r.min_completed_rides), min_ratings_count: String(r.min_ratings_count), min_avg_rating: String(r.min_avg_rating) })));
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const change = (tier: string, key: keyof Rule, value: any) => setRules((all) => all.map((r) => r.tier === tier ? { ...r, [key]: value } : r));
  const save = async (rule: Rule) => {
    const rides = Number(rule.min_completed_rides), ratings = Number(rule.min_ratings_count), avg = Number(rule.min_avg_rating);
    if (!Number.isInteger(rides) || rides < 0 || !Number.isInteger(ratings) || ratings < 0 || !Number.isFinite(avg) || avg < 0 || avg > 5) {
      Alert.alert("تحقق من القيم", "أدخل أعداداً صحيحة للرحلات والتقييمات ومتوسطاً بين 0 و5.");
      return;
    }
    setSaving(rule.tier);
    const { error } = await (supabase as any).rpc("admin_update_driver_performance_tier_rule", {
      p_tier: rule.tier, p_min_completed_rides: rides, p_min_ratings_count: ratings,
      p_min_avg_rating: avg, p_is_active: rule.is_active,
    });
    setSaving(null);
    if (error) Alert.alert("تعذر الحفظ", error.message);
    else { Alert.alert("تم الحفظ", "تم تحديث المعيار وإعادة احتساب رتب السائقين من البيانات الفعلية."); await load(); }
  };
  return <ScrollView style={styles.page} contentContainerStyle={{ paddingBottom: 40 }}>
    <Text style={styles.title}>رتب أداء السائقين</Text>
    <Text style={styles.note}>الرتبة مستقلة عن فئة المركبة والتسعير. الاحتساب من الرحلات المكتملة والتقييمات الفعلية في Supabase.</Text>
    {loading ? <ActivityIndicator color={palette.brand} /> : rules.map((rule) => <View key={rule.tier} style={styles.card}>
      <View style={styles.row}><Text style={styles.cardTitle}>{TITLES[rule.tier]}</Text><Switch value={rule.is_active} onValueChange={(v) => change(rule.tier, "is_active", v)} /></View>
      <Text style={styles.label}>الحد الأدنى للرحلات المكتملة</Text>
      <TextInput value={rule.min_completed_rides} onChangeText={(v) => change(rule.tier, "min_completed_rides", v)} keyboardType="number-pad" style={styles.input} />
      <Text style={styles.label}>الحد الأدنى لعدد التقييمات</Text>
      <TextInput value={rule.min_ratings_count} onChangeText={(v) => change(rule.tier, "min_ratings_count", v)} keyboardType="number-pad" style={styles.input} />
      <Text style={styles.label}>أقل متوسط تقييم من 5</Text>
      <TextInput value={rule.min_avg_rating} onChangeText={(v) => change(rule.tier, "min_avg_rating", v)} keyboardType="decimal-pad" style={styles.input} />
      <ActionButton size="default" disabled={saving === rule.tier} onPress={() => void save(rule)}><Text style={styles.saveText}>{saving === rule.tier ? "جارٍ الحفظ..." : "حفظ المعيار وإعادة الاحتساب"}</Text></ActionButton>
    </View>)}
    <ActionButton size="default" onPress={() => void load()}><Text style={styles.saveText}>تحديث المعايير</Text></ActionButton>
    <Text style={styles.foot}>تعديل المعايير يعيد احتساب الرتب، ولا يغيّر سجلات الرحلات أو التقييمات أو فئة المركبة.</Text>
  </ScrollView>;
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: palette.pageCanvas, paddingHorizontal: 18, paddingTop: 48 },
  title: { fontSize: 24, fontWeight: "900", color: palette.ink, textAlign: "right", marginBottom: 10 },
  note: { fontSize: 12, lineHeight: 21, color: palette.muted, textAlign: "right", marginBottom: 18 },
  card: { backgroundColor: palette.surface, borderColor: palette.line, borderWidth: 1, borderRadius: radius.lg, padding: 15, marginBottom: 12 },
  row: { flexDirection: "row-reverse", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  cardTitle: { fontSize: 17, fontWeight: "900", color: palette.ink },
  label: { fontSize: 12, color: palette.ink, textAlign: "right", fontWeight: "800", marginBottom: 6, marginTop: 8 },
  input: { minHeight: 46, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, paddingHorizontal: 12, color: palette.ink, backgroundColor: palette.canvas, textAlign: "right" },
  saveText: { color: palette.white, fontWeight: "900" },
  foot: { fontSize: 11, color: palette.muted, textAlign: "right", lineHeight: 20, marginTop: 12 },
});
