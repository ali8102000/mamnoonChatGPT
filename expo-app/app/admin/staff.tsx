import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Stack, router } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { palette, radius, space } from "@/styles/theme";

const ITEMS = [
  { label: "إدارة المستخدمين", route: "/admin/users", roles: ["super_admin", "admin", "users_access"] },
  { label: "إدارة مقدمي الخدمة", route: "/admin/providers", roles: ["super_admin", "admin", "providers_access"] },
  { label: "إدارة الطلبات", route: "/admin/requests", roles: ["super_admin", "admin", "orders_access"] },
  { label: "الاشتراكات والباقات", route: "/admin/subscriptions", roles: ["super_admin", "admin", "finance", "department_finance", "rank:general_manager", "subscriptions_access"] },
  { label: "المحفظة والكوبونات", route: "/admin/finance", roles: ["super_admin", "admin", "finance", "department_finance", "rank:general_manager", "finance_access"] },
  { label: "المراقبة والبلاغات", route: "/admin/monitoring", roles: ["super_admin", "admin", "support", "moderator", "department_monitoring", "rank:general_manager", "reports_access"] },
  { label: "الخريطة المباشرة", route: "/admin/live-map", roles: ["super_admin", "admin", "support", "department_operations", "department_monitoring", "rank:general_manager", "live_map_access"] },
  { label: "إدارة الأصدقاء", route: "/admin/friends", roles: ["super_admin", "admin", "moderator", "department_monitoring", "rank:general_manager", "friends_access"] },
  { label: "إرسال الإشعارات", route: "/admin/notifications", roles: ["super_admin", "admin", "support", "finance", "moderator", "rank:general_manager", "notifications_access"] },
  { label: "الإدارة الهرمية والصلاحيات", route: "/admin/governance", roles: ["super_admin", "admin", "rank:general_manager", "rank:department_manager", "rank:supervisor", "governance_access"] },
  { label: "التحكم بالمحافظات", route: "/admin/regions", roles: ["super_admin"] },
  { label: "مساعد استيراد البيانات", route: "/admin/import", roles: ["super_admin", "admin"] },
  { label: "محادثات الدعم", route: "/support-chat", roles: ["super_admin", "admin", "support", "moderator", "customer_service", "rank:general_manager"] },
  { label: "إدارة الدردشة الخاصة", route: "/admin/chats", roles: ["super_admin", "admin", "support", "moderator", "rank:general_manager", "chats_access"] },
  { label: "موظفو القسم والترقيات", route: "/admin/staff-hierarchy", roles: ["super_admin", "rank:general_manager", "rank:department_manager", "rank:supervisor"] },
] as const;

const ROLE_LABELS: Record<string, string> = {
  super_admin: "الرئيس المؤسس الأعلى", admin: "مدير", support: "الدعم",
  finance: "المالية", moderator: "مراقب", customer_service: "موظف خدمة العملاء", department_finance: "قسم المالية", department_operations: "قسم التشغيل", department_monitoring: "قسم المراقبة", department_executive: "الإدارة التنفيذية",
  reports_access: "صلاحية البلاغات", live_map_access: "صلاحية الخريطة المباشرة", friends_access: "صلاحية إدارة الأصدقاء", chats_access: "صلاحية إدارة الدردشة",
  "rank:owner": "الرئيس المؤسس الأعلى", "rank:general_manager": "مدير عام", "rank:department_manager": "مدير قسم", "rank:supervisor": "مشرف", "rank:employee": "موظف",
};

export default function AdminStaffScreen() {
  const { user, loading: authLoading } = useAuth();
  const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [displayTitle, setDisplayTitle] = useState<string | null>(null);
  const [staffScopeType, setStaffScopeType] = useState<"global" | "governorate">("global");

  useEffect(() => {
    if (authLoading) return;
    if (!user?.id) { setAllowed(false); setLoading(false); return; }
    void (async () => {
      try {
        const { data, error } = await supabase.rpc("get_staff_roles", { p_user_id: user.id });
        const names: string[] = (data ?? []).map((entry: any) => typeof entry === "string" ? entry : String(entry.role ?? ""));
        setRoles(names);
        const { data: assignment, error: assignmentError } = await (supabase as any).from("staff_assignments").select("display_title,rank,department,scope_type,scope_governorate").eq("user_id", user.id).eq("active", true).maybeSingle();
        if (assignmentError) throw assignmentError;
        setDisplayTitle(assignment?.display_title ?? (names.includes("super_admin") ? "الرئيس المؤسس الأعلى" : null));
        if (assignment?.rank) names.push(`rank:${assignment.rank}`);
        if (assignment?.department) names.push(`department_${assignment.department}`);
        setRoles(names);
        setAllowed(!error && names.some((role: string) => Object.prototype.hasOwnProperty.call(ROLE_LABELS, role)));
        if (assignment?.department === "finance") setDisplayTitle(assignment.display_title ?? "قسم المالية");
        if (assignment?.department === "operations") setDisplayTitle(assignment.display_title ?? "قسم التشغيل");
        if (assignment?.department === "monitoring") setDisplayTitle(assignment.display_title ?? "قسم المراقبة");
        const scopeType = names.some((role: string) => ["super_admin", "admin"].includes(role)) ? "global" : assignment?.scope_type === "governorate" ? "governorate" : "global";
        setStaffScopeType(scopeType);
        const scopeGovernorate = scopeType === "governorate" ? assignment?.scope_governorate : null;
        const permissionKeys = [
          "staff.read","staff.assign","staff.manage_created","staff.delegate","staff.approve",
          "users.read","users.profile.edit","users.block","users.unblock",
          "providers.read","providers.profile.edit","providers.verify","providers.suspend",
          "orders.read","orders.assign","orders.override","orders.cancel","orders.reopen",
          "pricing.taxi.edit","pricing.peak.edit","finance.read","finance.wallet.adjust",
          "promotions.read","promotions.manage","notifications.send",
          "live_map.read","reports.read","reports.resolve","chats.moderate","friends.manage",
        ];
        const permissionChecks = await Promise.all(permissionKeys.map(async (permission_key) => {
          const { data } = await (supabase as any).rpc("admin_has_permission", {
            p_permission_key: permission_key, p_scope_type: scopeType, p_scope_governorate: scopeGovernorate,
          });
          return data === true;
        }));
        if (permissionKeys.slice(0, 5).some((_, index) => permissionChecks[index])) names.push("governance_access");
        const hasPermission = (key: string) => permissionChecks[permissionKeys.indexOf(key)] === true;
        if (scopeType === "global" && ["support","moderator","department_monitoring"].some((role) => names.includes(role))) names.push("users_access");
        if (scopeType === "global" && ["support","department_operations"].some((role) => names.includes(role))) names.push("providers_access","orders_access");
        if (["users.read","users.profile.edit","users.block","users.unblock"].some(hasPermission)) names.push("users_access");
        if (["providers.read","providers.profile.edit","providers.verify","providers.suspend"].some(hasPermission)) names.push("providers_access");
        if (["orders.read","orders.assign","orders.override","orders.cancel","orders.reopen"].some(hasPermission)) names.push("orders_access");
        if (scopeType === "global" && hasPermission("finance.read") && hasPermission("promotions.read")) names.push("finance_access");
        if (hasPermission("notifications.send")) names.push("notifications_access");
        if (hasPermission("reports.read")) names.push("reports_access");
        if (hasPermission("live_map.read")) names.push("live_map_access");
        if (scopeType === "global" && hasPermission("friends.manage")) names.push("friends_access");
        if (scopeType === "global" && hasPermission("chats.moderate")) names.push("chats_access");
        const { data: canManageSubscriptions } = await (supabase as any).rpc("admin_has_permission", {
          p_permission_key: "subscriptions.manage", p_scope_type: "global", p_scope_governorate: null,
        });
        if (canManageSubscriptions === true) names.push("subscriptions_access");
        setRoles([...new Set(names)]);

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

  const customerServiceOnly = roles.includes("customer_service") && !roles.some((role) => ["super_admin", "admin", "support", "finance", "moderator", "rank:general_manager", "rank:department_manager", "rank:supervisor", "users_access", "providers_access", "orders_access", "finance_access", "subscriptions_access", "notifications_access", "governance_access", "reports_access", "live_map_access", "friends_access", "chats_access"].includes(role));
  const visible = ITEMS.filter((item) =>
    item.roles.some((role) => roles.includes(role)) &&
    (staffScopeType === "global" ||
      (item.route === "/admin/monitoring" ? roles.includes("reports_access") :
        item.route === "/admin/live-map" ? roles.includes("live_map_access") :
          !["/admin/friends", "/admin/chats"].includes(item.route))) &&
    (!customerServiceOnly || item.route === "/support-chat")
  );

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
  page: { flex: 1, backgroundColor: palette.pageCanvas },
  content: { padding: space.lg, paddingBottom: 48, gap: 10 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: palette.pageCanvas, padding: 24, gap: 10 },
  title: { color: palette.ink, fontSize: 22, fontWeight: "900", textAlign: "right" },
  muted: { color: palette.muted, fontSize: 12, textAlign: "right", lineHeight: 20 },
  roles: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginVertical: 4 },
  role: { backgroundColor: palette.brandSoft, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 6 },
  roleText: { color: palette.brand, fontSize: 10, fontWeight: "900" },
  superButton: { minHeight: 40, backgroundColor: palette.brand, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 8, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  superText: { color: palette.white, fontSize: 12, fontWeight: "900" },
  item: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.lg, padding: 15, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  itemText: { color: palette.ink, fontSize: 13, fontWeight: "900" },
  arrow: { color: palette.brand, fontSize: 16, fontWeight: "900" },
});
