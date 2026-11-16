import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Stack, router } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { palette, radius, space } from "@/styles/theme";

const ITEMS = [
  { label: "إدارة المستخدمين", route: "/admin/users", roles: ["super_admin", "admin", "support", "moderator"] },
  { label: "إدارة مقدمي الخدمة", route: "/admin/providers", roles: ["super_admin", "admin", "support"] },
  { label: "إدارة الطلبات", route: "/admin/requests", roles: ["super_admin", "admin", "support"] },
  { label: "الاشتراكات والباقات", route: "/admin/subscriptions", roles: ["super_admin", "admin", "finance"] },
  { label: "المحفظة والكوبونات", route: "/admin/finance", roles: ["super_admin", "admin", "finance"] },
  { label: "المراقبة والبلاغات", route: "/admin/monitoring", roles: ["super_admin", "admin", "support", "moderator"] },
  { label: "الخريطة المباشرة", route: "/admin/live-map", roles: ["super_admin", "admin", "support"] },
  { label: "إدارة الأصدقاء", route: "/admin/friends", roles: ["super_admin", "admin", "moderator"] },
  { label: "إرسال الإشعارات", route: "/admin/notifications", roles: ["super_admin", "admin", "support", "finance", "moderator"] },
  { label: "الصلاحيات وسجل العمليات", route: "/admin/governance", roles: ["super_admin", "admin"] },
  { label: "محادثات الدعم", route: "/support-chat", roles: ["super_admin", "admin", "support", "moderator", "customer_service"] },
] as const;

const ROLE_LABELS: Record<string, string> = {
  super_admin: "المدير الأعلى", admin: "مدير", support: "الدعم",
  finance: "المالية", moderator: "مراقب", customer_service: "موظف خدمة العملاء",
};

export default function AdminStaffScreen() {
  const { user, loading: authLoading } = useAuth();
  const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [displayTitle, setDisplayTitle] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user?.id) { setAllowed(false); setLoading(false); return; }
    void (async () => {
      try {
        const { data, error } = await supabase.rpc("get_staff_roles", { p_user_id: user.id });
        const names = (data ?? []).map((entry: any) => typeof entry === "string" ? entry : entry.role);
        setRoles(names);
        const { data: assignment } = await supabase.from("staff_assignments").select("display_title,rank,department").eq("user_id", user.id).eq("active", true).maybeSingle();
        setDisplayTitle(assignment?.display_title ?? null);
        setAllowed(!error && names.some((role: string) => Object.prototype.hasOwnProperty.call(ROLE_LABELS, role)));
      } catch {
        setAllowed(false);
      } finally {
        setLoading(false);
      }
    })();
  }, [authLoading, user?.id]);

  if (authLoading || loading || allowed === null) {
    return <View style={s.center}><ActivityIndicator size="large" color={palette.brand}/><Text style={s.muted}>جاري التحقق من صلاحيات الإدارة...</Text></View>;
  }
  if (allowed === false) {
    return <View style={s.center}><Text style={s.title}>غير مصرّح</Text><Text style={s.muted}>هذه الصفحة مخصصة لموظفي ممنون المخوّلين.</Text></View>;
  }

  const customerServiceOnly = roles.includes("customer_service") && !roles.some((role) => ["super_admin", "admin", "support", "finance", "moderator"].includes(role));
  const visible = ITEMS.filter((item) => item.roles.some((role) => roles.includes(role)) && (!customerServiceOnly || item.route === "/support-chat"));

  return (
    <View style={s.page}>
      <Stack.Screen options={{ title: "مركز إدارة ممنون" }} />
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.title}>{displayTitle ?? "مركز إدارة ممنون"}</Text>
        <Text style={s.muted}>الأدوات المتاحة حسب صلاحيات حسابك.</Text>
        <View style={s.roles}>
          {roles.filter((role) => ROLE_LABELS[role]).map((role) => <View key={role} style={s.role}><Text style={s.roleText}>{ROLE_LABELS[role]}</Text></View>)}
        </View>
        {roles.includes("super_admin") && <TouchableOpacity onPress={() => router.push("/admin")} style={s.superButton}><Text style={s.superText}>لوحة التحكم العليا</Text></TouchableOpacity>}
        {visible.map((item) => (
          <TouchableOpacity key={item.route} onPress={() => router.push(item.route as any)} style={s.item}>
            <Text style={s.itemText}>{item.label}</Text>
            <Text style={s.arrow}>←</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: palette.canvas },
  content: { padding: space.lg, paddingBottom: 48, gap: 10 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: palette.canvas, padding: 24, gap: 10 },
  title: { color: palette.ink, fontSize: 22, fontWeight: "900", textAlign: "right" },
  muted: { color: palette.muted, fontSize: 12, textAlign: "right", lineHeight: 20 },
  roles: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginVertical: 4 },
  role: { backgroundColor: palette.brandSoft, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 6 },
  roleText: { color: palette.brand, fontSize: 10, fontWeight: "900" },
  superButton: { backgroundColor: palette.brand, borderRadius: radius.lg, padding: 14, alignItems: "center", marginBottom: 4 },
  superText: { color: palette.white, fontSize: 12, fontWeight: "900" },
  item: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.lg, padding: 15, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  itemText: { color: palette.ink, fontSize: 13, fontWeight: "900" },
  arrow: { color: palette.brand, fontSize: 16, fontWeight: "900" },
});
