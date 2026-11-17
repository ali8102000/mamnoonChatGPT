import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { supabase } from "@/lib/supabase";
import { palette, radius } from "@/styles/theme";
import { ActionButton } from "@/components/ui";

type ProviderType = "taxi" | "large_vehicle" | "technician";
type Ring = { zone_no: number; min_km: string; max_km: string };
type Group = { provider_type: ProviderType; rings: Ring[] };
const GROUPS: Array<{ key: ProviderType; title: string; subtitle: string }> = [
  { key: "taxi", title: "سائقو التكسي", subtitle: "السيارات الاعتيادية" },
  { key: "large_vehicle", title: "سائقو الكيا والباص", subtitle: "كيا حمل وكيا ركاب وباص" },
  { key: "technician", title: "الفنيون", subtitle: "طلبات الخدمات المنزلية" },
];
const EMPTY = (provider_type: ProviderType): Group => ({
  provider_type,
  rings: [1, 2, 3].map((zone_no) => ({ zone_no, min_km: "0", max_km: "0" })),
});
const DEFAULTS: Record<ProviderType, number[][]> = {
  taxi: [[0, 1], [1, 3], [3, 5]],
  large_vehicle: [[0, 5], [5, 25], [25, 55]],
  technician: [[0, 5], [5, 25], [25, 55]],
};
export default function DispatchRangesAdminScreen() {
  const [groups, setGroups] = useState<Group[]>(GROUPS.map((g) => ({
    ...EMPTY(g.key),
    rings: DEFAULTS[g.key].map(([min_km, max_km], i) => ({ zone_no: i + 1, min_km: String(min_km), max_km: String(max_km) })),
  })));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<ProviderType | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await (supabase as any).rpc("admin_get_dispatch_radius_settings");
    if (error) {
      Alert.alert("تعذر تحميل نطاقات البحث", error.message);
    } else if (Array.isArray(data)) {
      setGroups(GROUPS.map(({ key }) => ({
        provider_type: key,
        rings: data.filter((row: any) => row.provider_type === key)
          .sort((a: any, b: any) => a.zone_no - b.zone_no)
          .map((row: any) => ({ zone_no: row.zone_no, min_km: String(row.min_km), max_km: String(row.max_km) })),
      })));
    }
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const change = (type: ProviderType, zone: number, key: "min_km" | "max_km", value: string) => {
    setGroups((all) => all.map((group) => group.provider_type !== type ? group : ({
      ...group, rings: group.rings.map((ring) => ring.zone_no === zone ? { ...ring, [key]: value } : ring),
    })));
  };
  const save = async (group: Group) => {
    const rings = group.rings.map((ring) => ({
      zone_no: ring.zone_no, min_km: Number(ring.min_km), max_km: Number(ring.max_km),
    }));
    if (rings.length !== 3 || rings.some((r) => !Number.isFinite(r.min_km) || !Number.isFinite(r.max_km) || r.min_km < 0 || r.max_km <= r.min_km || r.max_km > 100)
      || rings.some((r, i) => i > 0 && r.min_km !== rings[i - 1].max_km)
      || rings[0].min_km !== 0) {
      Alert.alert("النطاقات غير صحيحة", "لازم تبدأ من صفر، وتكون متصلة بدون تداخل أو فراغ، والنطاق الثالث لا يتجاوز 100 كم.");
      return;
    }
    setSaving(group.provider_type);
    const { error } = await (supabase as any).rpc("admin_update_dispatch_radius_group", {
      p_provider_type: group.provider_type,
      p_rings: rings,
    });
    setSaving(null);
    if (error) Alert.alert("تعذر الحفظ", error.message);
    else {
      Alert.alert("تم الحفظ", "تم تحديث نطاقات البحث في Supabase، وستستخدمها جولات الطلبات الجديدة والقائمة عند انتقالها للنطاق التالي.");
      await load();
    }
  };
  return <ScrollView style={styles.page} contentContainerStyle={{ paddingBottom: 42 }}>
    <Text style={styles.title}>التحكم بنطاقات البحث</Text>
    <Text style={styles.note}>كل نطاق يستمر 60 ثانية. بعد النطاق الثالث يعاد البحث من النطاق الأول ثم الثاني ثم الثالث مرة ثانية. إذا لم يقبل أحد بعد الجولة الثانية يُلغى الطلب تلقائياً.</Text>
    {loading ? <ActivityIndicator color={palette.brand} size="large" /> : GROUPS.map((meta) => {
      const group = groups.find((g) => g.provider_type === meta.key) ?? EMPTY(meta.key);
      return <View key={meta.key} style={styles.card}>
        <Text style={styles.groupTitle}>{meta.title}</Text>
        <Text style={styles.subtitle}>{meta.subtitle}</Text>
        {group.rings.map((ring) => <View key={ring.zone_no} style={styles.zone}>
          <Text style={styles.zoneTitle}>النطاق {ring.zone_no}</Text>
          <View style={styles.fields}>
            <View style={styles.field}>
              <Text style={styles.label}>من (كم)</Text>
              <TextInput value={ring.min_km} onChangeText={(v) => change(meta.key, ring.zone_no, "min_km", v)} keyboardType="decimal-pad" style={styles.input} />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>إلى (كم)</Text>
              <TextInput value={ring.max_km} onChangeText={(v) => change(meta.key, ring.zone_no, "max_km", v)} keyboardType="decimal-pad" style={styles.input} />
            </View>
          </View>
          <Text style={styles.duration}>مدة إرسال الطلب لهذا النطاق: دقيقة واحدة</Text>
        </View>)}
        <ActionButton size="default" disabled={saving === meta.key} onPress={() => void save(group)}>
          <Text style={styles.saveText}>{saving === meta.key ? "جارٍ الحفظ..." : "حفظ نطاقات " + meta.title}</Text>
        </ActionButton>
      </View>;
    })}
    <ActionButton size="default" onPress={() => void load()}><Text style={styles.saveText}>تحديث من قاعدة البيانات</Text></ActionButton>
  </ScrollView>;
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: palette.pageCanvas, paddingHorizontal: 16, paddingTop: 42 },
  title: { fontSize: 23, fontWeight: "900", color: palette.ink, textAlign: "right", marginBottom: 8 },
  note: { color: palette.muted, fontSize: 12, lineHeight: 21, textAlign: "right", marginBottom: 16 },
  card: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.lg, padding: 14, marginBottom: 14 },
  groupTitle: { fontSize: 18, color: palette.ink, fontWeight: "900", textAlign: "right" },
  subtitle: { color: palette.muted, fontSize: 11, textAlign: "right", marginTop: 4, marginBottom: 12 },
  zone: { borderTopWidth: 1, borderTopColor: palette.line, paddingTop: 12, marginTop: 8 },
  zoneTitle: { fontSize: 14, fontWeight: "900", color: palette.ink, textAlign: "right", marginBottom: 8 },
  fields: { flexDirection: "row", gap: 10 },
  field: { flex: 1 },
  label: { fontSize: 11, color: palette.muted, textAlign: "right", marginBottom: 5 },
  input: { borderWidth: 1, borderColor: palette.line, backgroundColor: palette.canvas, color: palette.ink, borderRadius: radius.md, minHeight: 44, paddingHorizontal: 10, textAlign: "center", fontWeight: "800" },
  duration: { color: palette.brand, fontSize: 11, textAlign: "right", marginTop: 7 },
  saveText: { color: palette.white, fontWeight: "900" },
});
