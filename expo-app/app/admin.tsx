import { useState, useEffect, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl, Alert, TouchableOpacity, TextInput } from "react-native";
import { router } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";

type AdminStats = { totalRequests: number; totalUsers: number; totalDrivers: number };
type PricingRule = {
  id: string;
  vehicle_category: string;
  base_fare: number | null;
  per_km: number | null;
};
type RecentRequest = {
  id: string;
  type: string;
  customer?: { full_name: string | null } | null;
  created_at: string;
  status: string;
};

export default function AdminScreen() {
  const { user } = useAuth();
  const [stats, setStats] = useState<AdminStats>({
    totalRequests: 0,
    totalUsers: 0,
    totalDrivers: 0,
  });
  const [pricing, setPricing] = useState<PricingRule[]>([]);
  const [recent, setRecent] = useState<RecentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [companyName, setCompanyName] = useState("شركة ممنون");
  const [savingCompanyName, setSavingCompanyName] = useState(false);
  const isOwnerAccount = user?.email?.toLowerCase() === "a7md0555666@gmail.com";

  const load = useCallback(async () => {
    const { data: superAdminCheck, error: permissionError } = await supabase.rpc("is_super_admin", {
      p_user_id: user?.id,
    });
    if (permissionError || superAdminCheck !== true) {
      Alert.alert("غير مصرّح", "هذه الإدارة العليا مخصصة لصاحب الحساب فقط");
      router.replace("/home");
      setLoading(false);
      return;
    }
    if (isOwnerAccount) {
      const { data: company } = await (supabase as any).from("company_settings").select("company_name").eq("id", 1).maybeSingle();
      if (company?.company_name) setCompanyName(company.company_name);
    }
    const [reqs, users, drivers, pricingRules, recentReqs] = await Promise.all([
      supabase.from("service_requests").select("id", { count: "exact", head: true }),
      supabase.from("profiles").select("id", { count: "exact", head: true }),
      supabase.from("driver_profiles").select("id", { count: "exact", head: true }),
      supabase.from("pricing_rules").select("*").order("vehicle_category"),
      supabase
        .from("service_requests")
        .select("*, customer:profiles!service_requests_customer_id_fkey(full_name)")
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    setStats({
      totalRequests: reqs.count || 0,
      totalUsers: users.count || 0,
      totalDrivers: drivers.count || 0,
    });
    setPricing(pricingRules.data || []);
    setRecent(recentReqs.data || []);
    setLoading(false);
  }, [user?.id, isOwnerAccount]);

  useEffect(() => {
    load();
  }, [load]);
  const saveCompanyName = async () => {
    const value = companyName.trim();
    if (value.length < 2 || value.length > 80) { Alert.alert("تنبيه", "اكتب اسماً من حرفين إلى 80 حرفاً"); return; }
    setSavingCompanyName(true);
    const { data: allowed, error: permissionError } = await supabase.rpc("is_super_admin", { p_user_id: user?.id });
    if (permissionError || allowed !== true || !isOwnerAccount) {
      Alert.alert("غير مصرّح", "تغيير الاسم متاح لصاحب الحساب فقط");
      setSavingCompanyName(false);
      return;
    }
    const { error } = await (supabase as any).from("company_settings").upsert({ id: 1, company_name: value, updated_by: user?.id, updated_at: new Date().toISOString() }, { onConflict: "id" });
    Alert.alert(error ? "تعذر الحفظ" : "تم الحفظ", error ? error.message : "تم تحديث اسم الشركة");
    setSavingCompanyName(false);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (loading)
    return (
      <View style={styles.center}>
        <Text style={{ color: "#64748b" }}>جاري التحميل...</Text>
      </View>
    );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={styles.title}>لوحة التحكم</Text>
      {isOwnerAccount && <View style={styles.companyCard}>
        <Text style={styles.sectionTitle}>إعدادات شركة ممنون</Text>
        <Text style={styles.companyHint}>تغيير الاسم الظاهر للمنصة</Text>
        <TextInput value={companyName} onChangeText={setCompanyName} maxLength={80} placeholder="اسم الشركة" style={styles.companyInput} textAlign="right" />
        <TouchableOpacity onPress={saveCompanyName} disabled={savingCompanyName} style={styles.companySave}>
          <Text style={styles.companySaveText}>{savingCompanyName ? "جاري الحفظ..." : "حفظ اسم الشركة"}</Text>
        </TouchableOpacity>
      </View>}
      <TouchableOpacity onPress={() => router.push("/support-chat")} style={styles.supportButton}><Text style={styles.supportButtonText}>محادثات الدعم مع الفنيين والسائقين</Text></TouchableOpacity>
      <View style={styles.statsGrid}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{stats.totalRequests}</Text>
          <Text style={styles.statLabel}>إجمالي الطلبات</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{stats.totalUsers}</Text>
          <Text style={styles.statLabel}>المستخدمين</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{stats.totalDrivers}</Text>
          <Text style={styles.statLabel}>السائقين</Text>
        </View>
      </View>
      <Text style={styles.sectionTitle}>قواعد التسعير</Text>
      {pricing.map((p) => (
        <View key={p.id} style={styles.pricingCard}>
          <Text style={styles.pricingCategory}>{p.vehicle_category}</Text>
          <Text style={styles.pricingValues}>
            {p.base_fare?.toLocaleString("en")} + {p.per_km?.toLocaleString("en")}/كم
          </Text>
        </View>
      ))}
      <Text style={styles.sectionTitle}>أحدث الطلبات</Text>
      {recent.map((req) => (
        <View key={req.id} style={styles.reqCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.reqType}>{req.type === "taxi" ? "🚕" : `🔧 ${req.type}`}</Text>
            <Text style={styles.reqCustomer}>{req.customer?.full_name || "زبون"}</Text>
            <Text style={styles.reqDate}>{new Date(req.created_at).toLocaleDateString("ar")}</Text>
          </View>
          <Text style={styles.reqStatus}>{req.status}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f9fafb", paddingHorizontal: 20, paddingTop: 50 },
  companyCard: { backgroundColor: "#fff", borderRadius: 16, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: "#e2e8f0" },
  companyHint: { color: "#64748b", fontSize: 12, marginBottom: 10 },
  companyInput: { borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: "#0f172a", marginBottom: 10 },
  companySave: { backgroundColor: "#2563eb", borderRadius: 12, padding: 13, alignItems: "center" },
  companySaveText: { color: "#fff", fontWeight: "800" },
  supportButton: { backgroundColor: "#2563eb", borderRadius: 14, padding: 14, marginBottom: 20 },
  supportButtonText: { color: "#fff", fontWeight: "800", textAlign: "center" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  title: { fontSize: 28, fontWeight: "900", color: "#1e293b", marginBottom: 20 },
  statsGrid: { flexDirection: "row", gap: 10, marginBottom: 24 },
  statCard: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    alignItems: "center",
  },
  statValue: { fontSize: 28, fontWeight: "900", color: "#2563eb" },
  statLabel: { fontSize: 12, color: "#64748b", marginTop: 4, textAlign: "center" },
  sectionTitle: { fontSize: 16, fontWeight: "800", color: "#1e293b", marginBottom: 12 },
  pricingCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
  },
  pricingCategory: { fontSize: 14, fontWeight: "700", color: "#1e293b" },
  pricingValues: { fontSize: 14, color: "#64748b" },
  reqCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
  },
  reqType: { fontSize: 18 },
  reqCustomer: { fontSize: 14, fontWeight: "700", color: "#1e293b", marginTop: 2 },
  reqDate: { fontSize: 12, color: "#94a3b8", marginTop: 2 },
  reqStatus: { fontSize: 12, fontWeight: "700", color: "#64748b" },
});
