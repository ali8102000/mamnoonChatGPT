import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Stack } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { palette } from "@/styles/theme";
import { getAdminStaffRoles } from "@/lib/admin-access";
import { IRAQ_GOVERNORATES } from "@/lib/governorates";

type Row = { governorate_key: string; services_enabled: boolean; message_enabled: boolean; message_title: string; message_text: string; message_animate: boolean; updated_at?: string };
const EMPTY = { services_enabled: true, message_enabled: false, message_title: "تنويه رسمي من إدارة ممنون", message_text: "", message_animate: true };

export default function AdminRegionalControlsScreen() {
  const { user, loading: authLoading } = useAuth();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [mode, setMode] = useState<"all" | "selected">("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [settings, setSettings] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await (supabase as any).from("regional_service_controls").select("*").order("governorate_key");
    if (error) { Alert.alert("تعذّر التحميل", error.message); setRows([]); }
    else {
      setRows((data ?? []) as Row[]);
      const global = (data ?? []).find((row: Row) => row.governorate_key === "all");
      if (global) setSettings({ services_enabled: global.services_enabled, message_enabled: global.message_enabled, message_title: global.message_title, message_text: global.message_text, message_animate: global.message_animate });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let active = true;
    if (authLoading || !user) return;
    (async () => {
      try {
        const roles = await getAdminStaffRoles(user.id);
        const ok = roles.includes("super_admin");
        if (active) setAllowed(ok);
        if (ok) await load();
      } catch { if (active) setAllowed(false); }
    })();
    return () => { active = false; };
  }, [authLoading, user, load]);

  const targetKeys = useMemo(() => mode === "all" ? ["all"] : selected, [mode, selected]);
  const update = (patch: Partial<typeof EMPTY>) => setSettings((current) => ({ ...current, ...patch }));
  const choose = (key: string) => {
    setSelected((current) => current.includes(key) ? current.filter((value) => value !== key) : [...current, key]);
    const row = rows.find((item) => item.governorate_key === key);
    setSettings(row
      ? { services_enabled: row.services_enabled, message_enabled: row.message_enabled, message_title: row.message_title, message_text: row.message_text, message_animate: row.message_animate }
      : { ...EMPTY });

  };

  async function save() {
    if (!targetKeys.length) { Alert.alert("اختيار ناقص", "اختَر محافظة واحدة على الأقل."); return; }
    if (settings.message_enabled && settings.message_text.trim().length < 2) { Alert.alert("الرسالة فارغة", "اكتب نص الرسالة قبل تفعيلها."); return; }
    setSaving(true);
    const { error } = await (supabase as any).from("regional_service_controls").upsert(
      targetKeys.map((governorate_key) => ({ governorate_key, ...settings, message_title: settings.message_title.trim() || EMPTY.message_title, message_text: settings.message_text.trim(), updated_at: new Date().toISOString() })),
      { onConflict: "governorate_key" },
    );
    setSaving(false);
    if (error) Alert.alert("تعذّر الحفظ", error.message);
    else { Alert.alert("تم التطبيق", "تم حفظ الإعدادات وهي مشتركة بين الويب والأندرويد."); await load(); }
  }

  async function removeOverrides() {
    if (!selected.length) { Alert.alert("اختيار ناقص", "اختَر المحافظات أولاً."); return; }
    setSaving(true);
    const { error } = await (supabase as any).from("regional_service_controls").delete().in("governorate_key", selected);
    setSaving(false);
    if (error) Alert.alert("تعذّر الإزالة", error.message);
    else { setSelected([]); Alert.alert("تم", "رجعت المحافظات المحددة إلى إعداد كل العراق."); await load(); }
  }

  if (authLoading || allowed === null || loading) return <View style={styles.center}><ActivityIndicator color={palette.gold} /><Text style={styles.muted}>جاري تحميل التحكم بالمحافظات...</Text></View>;
  if (!allowed) return <View style={styles.center}><Text style={styles.title}>غير مصرّح</Text><Text style={styles.muted}>هذه الصفحة للرئيس المؤسس الأعلى فقط.</Text></View>;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: "التحكم بالمحافظات", headerBackTitle: "رجوع" }} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={styles.title}>التحكم بالخدمات حسب المحافظات</Text>
        <Text style={styles.muted}>إيقاف كل العراق يوقف جميع المحافظات. وعند تشغيله تگدر توقف محافظات منفردة.</Text>
        <View style={styles.row}>
          <TouchableOpacity onPress={() => setMode("all")} style={[styles.mode, mode === "all" && styles.modeActive]}><Text style={[styles.modeText, mode === "all" && styles.modeTextActive]}>كل العراق</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => { setMode("selected"); setSelected([]); setSettings({ ...EMPTY }); }} style={[styles.mode, mode === "selected" && styles.modeActive]}><Text style={[styles.modeText, mode === "selected" && styles.modeTextActive]}>محافظات محددة</Text></TouchableOpacity>
        </View>
        {mode === "selected" && <View style={styles.govGrid}>{IRAQ_GOVERNORATES.map((gov) => <TouchableOpacity key={gov.key} onPress={() => choose(gov.key)} style={[styles.govChip, selected.includes(gov.key) && styles.govChipActive]}><Text style={[styles.govText, selected.includes(gov.key) && styles.govTextActive]}>{selected.includes(gov.key) ? "✓ " : ""}{gov.name}</Text></TouchableOpacity>)}</View>}
        <View style={styles.card}>
          <Text style={styles.section}>حالة الخدمات</Text>
          <Text style={styles.muted}>{settings.services_enabled ? "الخدمات تعمل في النطاق المحدد." : "الخدمات متوقفة ولن تُقبل طلبات جديدة."}</Text>
          <TouchableOpacity onPress={() => update({ services_enabled: !settings.services_enabled })} style={[styles.action, { backgroundColor: settings.services_enabled ? "#7f1d1d" : "#14532d" }]}><Text style={styles.actionText}>{settings.services_enabled ? "إيقاف الخدمات" : "تشغيل الخدمات"}</Text></TouchableOpacity>
          <Text style={[styles.section, { marginTop: 18 }]}>الرسالة الرسمية المستقلة</Text>
          <Text style={styles.muted}>{settings.message_enabled ? "الرسالة ظاهرة للمستخدمين." : "الرسالة متوقفة ولا تؤثر على حالة الخدمات."}</Text>
          <TouchableOpacity onPress={() => update({ message_enabled: !settings.message_enabled })} style={[styles.action, { backgroundColor: settings.message_enabled ? "#7f1d1d" : "#854d0e" }]}><Text style={styles.actionText}>{settings.message_enabled ? "إيقاف الرسالة فقط" : "تشغيل الرسالة فقط"}</Text></TouchableOpacity>
          <Text style={styles.label}>عنوان الرسالة</Text>
          <TextInput value={settings.message_title} onChangeText={(value) => update({ message_title: value })} style={styles.input} textAlign="right" maxLength={100} />
          <Text style={styles.label}>نص الرسالة المتحركة</Text>
          <TextInput value={settings.message_text} onChangeText={(value) => update({ message_text: value })} style={[styles.input, { minHeight: 100, textAlignVertical: "top" }]} multiline textAlign="right" maxLength={1200} />
          <TouchableOpacity onPress={() => update({ message_animate: !settings.message_animate })} style={styles.switchRow}><Text style={styles.label}>تحريك الرسالة</Text><Text style={styles.gold}>{settings.message_animate ? "مفعّل ✓" : "متوقف"}</Text></TouchableOpacity>
        </View>
        <View style={styles.preview}>
          <View style={styles.previewHead}><Text style={styles.stamp}>✦ الإدارة الرسمية · موثّق ✦</Text><Text style={styles.stamp}>✓</Text></View>
          <Text style={styles.previewTitle}>{settings.message_title}</Text>
          <Text style={styles.previewText}>{settings.message_text || "معاينة الرسالة تظهر هنا بعد الكتابة."}</Text>
          <Text style={styles.watermark}>MAMNOON · OFFICIAL ADMIN NOTICE</Text>
        </View>
        <TouchableOpacity onPress={save} disabled={saving || !targetKeys.length} style={[styles.save, (saving || !targetKeys.length) && { opacity: 0.5 }]}><LinearGradient colors={["#F7DF91", "#D6A63B", "#8A5B12"]} style={styles.saveGradient}><Text style={styles.saveText}>{saving ? "جاري الحفظ..." : "حفظ وتطبيق الإعدادات"}</Text></LinearGradient></TouchableOpacity>
        {mode === "selected" && <TouchableOpacity onPress={removeOverrides} disabled={saving || !selected.length} style={styles.reset}><Text style={styles.resetText}>إزالة الاستثناءات المحددة</Text></TouchableOpacity>}
        <Text style={styles.section}>الإعدادات المحفوظة</Text>
        {rows.map((row) => <View key={row.governorate_key} style={styles.savedRow}><Text style={styles.savedName}>{row.governorate_key === "all" ? "كل العراق" : IRAQ_GOVERNORATES.find((gov) => gov.key === row.governorate_key)?.name || row.governorate_key}</Text><Text style={{ color: row.services_enabled ? "#16a34a" : "#ef4444", fontWeight: "800" }}>{row.services_enabled ? "الخدمات تعمل" : "الخدمات متوقفة"}</Text><Text style={{ color: row.message_enabled ? "#d4a33c" : palette.muted, fontWeight: "700" }}>{row.message_enabled ? "الرسالة مفعّلة" : "الرسالة متوقفة"}</Text></View>)}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.canvas },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: palette.canvas, padding: 24 },
  title: { color: palette.ink, fontSize: 20, fontWeight: "900", textAlign: "right", marginBottom: 8 },
  muted: { color: palette.muted, fontSize: 12, textAlign: "right", lineHeight: 20, marginBottom: 12 },
  row: { flexDirection: "row", gap: 8, marginVertical: 12 },
  mode: { flex: 1, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: palette.line, alignItems: "center" },
  modeActive: { borderColor: palette.gold, backgroundColor: "#D6A63B22" },
  modeText: { color: palette.ink, fontWeight: "800", fontSize: 12 },
  modeTextActive: { color: palette.gold },
  govGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  govChip: { borderWidth: 1, borderColor: palette.line, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 12 },
  govChipActive: { borderColor: palette.gold, backgroundColor: "#D6A63B22" },
  govText: { color: palette.ink, fontWeight: "700", fontSize: 12 },
  govTextActive: { color: palette.gold },
  card: { backgroundColor: palette.surface, borderRadius: 18, padding: 14, borderWidth: 1, borderColor: palette.line, marginTop: 10 },
  section: { color: palette.ink, fontWeight: "900", fontSize: 14, textAlign: "right", marginBottom: 8 },
  action: { borderRadius: 12, padding: 12, alignItems: "center", marginTop: 8 },
  actionText: { color: "#fff", fontWeight: "900", fontSize: 12 },
  label: { color: palette.ink, fontSize: 12, fontWeight: "800", textAlign: "right", marginTop: 12, marginBottom: 6 },
  input: { backgroundColor: palette.canvas, color: palette.ink, borderWidth: 1, borderColor: palette.line, borderRadius: 12, padding: 12, fontSize: 13 },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 },
  gold: { color: palette.gold, fontWeight: "900", fontSize: 12 },
  preview: { backgroundColor: "#080808", borderRadius: 18, borderWidth: 1, borderColor: "#C99A35", padding: 15, marginTop: 14 },
  previewHead: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: "#6B4B17", paddingBottom: 9 },
  stamp: { color: "#E9C76A", fontWeight: "900", fontSize: 10 },
  previewTitle: { color: "#F4D98C", fontSize: 15, fontWeight: "900", textAlign: "right", marginTop: 12 },
  previewText: { color: "#F4E7C1", fontSize: 13, lineHeight: 24, textAlign: "right", marginTop: 8 },
  watermark: { color: "#9A742D", fontSize: 8, textAlign: "left", marginTop: 12, letterSpacing: 1 },
  save: { marginTop: 14, borderRadius: 14, overflow: "hidden" },
  saveGradient: { padding: 15, alignItems: "center" },
  saveText: { color: "#2B1D08", fontWeight: "900", fontSize: 14 },
  reset: { borderWidth: 1, borderColor: palette.line, borderRadius: 12, padding: 12, marginTop: 8, alignItems: "center" },
  resetText: { color: palette.ink, fontSize: 12, fontWeight: "800" },
  savedRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line, gap: 8 },
  savedName: { color: palette.ink, fontSize: 12, fontWeight: "900", flex: 1, textAlign: "right" },
});
