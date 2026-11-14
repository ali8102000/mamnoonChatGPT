import { useState, useEffect, useCallback } from "react";
import * as SecureStore from "expo-secure-store";
import { router } from "expo-router";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  ScrollView,
  RefreshControl,
  Alert,
} from "react-native";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import * as Location from "expo-location";
import { ActiveCustomerRequestBanner } from "@/components/active-customer-request-banner";
import { palette, radius, space } from "@/styles/theme";
import { NotificationsBell } from "@/components/notifications-bell";

type IncomingRequest = {
  id: string;
  type: string;
  price_estimate: number | null;
  customer_price?: number | null;
  vehicle_category?: string | null;
  vehicle_type?: string | null;
};

export default function HomeScreen() {
  const { user, profile, roles } = useAuth();
  const [activeRole, setActiveRole] = useState<string>(roles.includes("customer") ? "customer" : roles[0] || "customer");
  const [companyName, setCompanyName] = useState("شركة ممنون");

  useEffect(() => {
    (supabase as any).from("company_settings").select("company_name").eq("id", 1).maybeSingle()
      .then(({ data }: any) => { if (data?.company_name) setCompanyName(data.company_name); });
  }, []);

  useEffect(() => {
    let mounted = true;
    SecureStore.getItemAsync("mamnoon_active_role").then((savedRole) => {
      if (mounted && savedRole && roles.includes(savedRole as (typeof roles)[number])) {
        setActiveRole(savedRole);
      }
    });
    return () => { mounted = false; };
  }, [roles]);
  const [available, setAvailable] = useState(false);
  const [verified, setVerified] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState("pending");
  const [incoming, setIncoming] = useState<IncomingRequest[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const isWorker = activeRole === "worker" || activeRole === "driver" || activeRole === "large_driver";
  const switchableRoles = ["customer", "driver", "large_driver", "worker"].filter((role) => roles.includes(role as (typeof roles)[number]));
  const roleNames: Record<string, string> = { customer: "زبون", driver: "كابتن", large_driver: "سيارات كبيرة", worker: "فني" };

  async function changeActiveRole(role: string) {
    if (!switchableRoles.includes(role) || role === activeRole) return;
    setActiveRole(role);
    await SecureStore.setItemAsync("mamnoon_active_role", role);
  }

  const loadIncoming = useCallback(async () => {
    if (!user || (activeRole !== "driver" && activeRole !== "large_driver" && activeRole !== "worker")) {
      setIncoming([]);
      return;
    }
    const isDriver = activeRole === "driver" || activeRole === "large_driver";
    const { data: offerRows, error: offersError } = await (supabase as any)
      .from("request_offers")
      .select("request_id")
      .eq("provider_id", user.id)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString());
    if (offersError) {
      console.warn("[incoming-requests] Offer lookup failed:", offersError.message);
      setIncoming([]);
      return;
    }
    const requestIds = [...new Set((offerRows ?? []).map((row: { request_id: string }) => row.request_id))];
    if (requestIds.length === 0) {
      setIncoming([]);
      return;
    }
    const { data, error } = await supabase
      .from("service_requests")
      .select("id, type, price_estimate, customer_price, vehicle_category, vehicle_type")
      .in("id", requestIds)
      .eq("type", isDriver ? "taxi" : "service")
      .in("status", ["pending", "searching"])
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) {
      console.warn("[incoming-requests] Request lookup failed:", error.message);
      setIncoming([]);
      return;
    }
    setIncoming((data ?? []) as IncomingRequest[]);
  }, [activeRole, user]);

  useEffect(() => {
    loadIncoming();
    const sub = supabase
      .channel("incoming-requests")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "service_requests" },
        () => loadIncoming(),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "service_requests" },
        () => loadIncoming(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(sub);
    };
  }, [loadIncoming]);

  useEffect(() => {
    if (!user || (activeRole !== "driver" && activeRole !== "large_driver" && activeRole !== "worker")) {
      setAvailable(false);
      setVerified(false);
      setVerificationStatus("pending");
      return;
    }
    const table = (activeRole === "driver" || activeRole === "large_driver") ? "driver_profiles" : "worker_profiles";
    supabase
      .from(table)
      .select("available, status")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          Alert.alert("تعذر تحميل الحالة", "حاول تحديث الصفحة");
          return;
        }
        const status = String(data?.status ?? "pending");
        setAvailable(Boolean(data?.available));
        setVerified(status === "approved");
        setVerificationStatus(status);
      });
  }, [activeRole, user]);

  useEffect(() => {
    if (!user || !verified || !available || (activeRole !== "driver" && activeRole !== "large_driver" && activeRole !== "worker"))
      return;
    const userId = user.id;
    let mounted = true;
    let loadedIncoming = false;
    let subscription: Location.LocationSubscription | null = null;

    async function publishPresence(location: Location.LocationObject) {
      if (!mounted || !user) return;
      const { error } = await supabase.from("provider_presence").upsert(
        {
          user_id: userId,
          lat: location.coords.latitude,
          lng: location.coords.longitude,
          heading:
            location.coords.heading != null &&
            location.coords.heading >= 0 &&
            location.coords.heading <= 360
              ? location.coords.heading
              : null,
        },
        { onConflict: "user_id" },
      );
      if (error && mounted) {
        Alert.alert("تعذر مشاركة الموقع", "تم إيقاف التوفر حتى لا تستقبل طلبات دون موقع صحيح.");
        const table = (activeRole === "driver" || activeRole === "large_driver") ? "driver_profiles" : "worker_profiles";
        await supabase.from(table).update({ available: false }).eq("user_id", userId);
        setAvailable(false);
      } else if (mounted && !loadedIncoming) {
        loadedIncoming = true;
        void loadIncoming();
      }
    }

    async function startPresence() {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        if (mounted) {
          Alert.alert("إذن الموقع مطلوب", "فعّل الموقع حتى تظهر للسائقين والزبائن القريبين.");
          setAvailable(false);
          const table = (activeRole === "driver" || activeRole === "large_driver") ? "driver_profiles" : "worker_profiles";
          await supabase.from(table).update({ available: false }).eq("user_id", userId);
        }
        return;
      }
      const first = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      await publishPresence(first);
      if (!mounted) return;
      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: 15000, distanceInterval: 20 },
        (location) => {
          void publishPresence(location);
        },
      );
    }

    void startPresence().catch(async () => {
      if (!mounted || !user) return;
      Alert.alert("تعذر تحديد الموقع", "تم إيقاف التوفر؛ تحقق من GPS وحاول مرة أخرى.");
      const table = (activeRole === "driver" || activeRole === "large_driver") ? "driver_profiles" : "worker_profiles";
      await supabase.from(table).update({ available: false }).eq("user_id", userId);
      setAvailable(false);
    });

    return () => {
      mounted = false;
      subscription?.remove();
    };
  }, [activeRole, available, verified, user, loadIncoming]);

  async function toggleAvailable() {
    if (!user || (activeRole !== "driver" && activeRole !== "large_driver" && activeRole !== "worker")) return;
    if (!verified) {
      Alert.alert(
        "الحساب بانتظار التوثيق",
        "لن تستقبل طلبات حتى تراجع الإدارة بياناتك وتفعّل حسابك.",
      );
      return;
    }
    const next = !available;
    if (next) {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        Alert.alert("إذن الموقع مطلوب", "اسمح بمشاركة موقعك قبل استقبال الطلبات.");
        return;
      }
    }
    const table = (activeRole === "driver" || activeRole === "large_driver") ? "driver_profiles" : "worker_profiles";
    const { error } = await supabase.from(table).update({ available: next }).eq("user_id", user.id);
    if (error) {
      Alert.alert("تعذر تحديث التوفر", error.message);
      return;
    }
    setAvailable(next);
  }

  const onRefresh = async () => {
    setRefreshing(true);
    await loadIncoming();
    setRefreshing(false);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerEyebrow}>MAMNOON · ممنون</Text>
          <Text style={styles.greeting}>هلا {profile?.full_name?.split(" ")[0] || "بيك"}</Text>
          <Text style={styles.roleText}>مساحة العمل الخاصة بك</Text>
        </View>
        <View style={styles.headerActions}>
          <NotificationsBell />
          <TouchableOpacity onPress={() => router.push("/profile")} accessibilityRole="button" accessibilityLabel="الملف الشخصي">
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{(profile?.full_name || "؟")[0]}</Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>
      {switchableRoles.length > 1 && (
        <View style={styles.roleSwitcherWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.roleSwitcher}>
            {switchableRoles.map((role) => (
              <Pressable
                key={role}
                accessibilityRole="button"
                accessibilityState={{ selected: activeRole === role }}
                onPress={() => changeActiveRole(role)}
                style={({ pressed }) => [styles.roleChip, activeRole === role && styles.roleChipActive, pressed && { opacity: 0.8 }]}
              >
                <Text style={[styles.roleChipText, activeRole === role && styles.roleChipTextActive]}>{roleNames[role]}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
      <ActiveCustomerRequestBanner />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {activeRole === "customer" ? (
          <CustomerHome />
        ) : (
          <ProviderHome
            available={available}
            verified={verified}
            verificationStatus={verificationStatus}
            companyName={companyName}
            toggleAvailable={toggleAvailable}
            incoming={incoming}
          />
        )}
      </ScrollView>
      <View style={styles.bottomTabs}>
        <TabBtn label="الرئيسية" icon="⌂" active onPress={() => {}} />
        <TabBtn label="الرسائل" icon="◌" onPress={() => router.push("/messages")} />
        {isWorker && <TabBtn label="الأصدقاء" icon="◎" onPress={() => router.push("/friends")} />}
        <TabBtn label="السجل" icon="▤" onPress={() => router.push("/history")} />
        <TabBtn label="حسابي" icon="●" onPress={() => router.push("/profile")} />
      </View>
    </View>
  );
}

function CustomerHome() {
  const tiles = [
    { key: "taxi", label: "سيارة", emoji: "🚕", color: "#2563eb" },
    { key: "large_vehicle", label: "سيارة كبيرة", emoji: "🚚", color: "#ea580c" },
    { key: "build", label: "بناء", emoji: "🧱", color: "#ea580c" },
    { key: "plaster", label: "لبخ", emoji: "🪣", color: "#d97706" },
    { key: "carpentry_form", label: "نجارة وقالب", emoji: "📐", color: "#a16207" },
    { key: "flooring", label: "أرضيات", emoji: "🟫", color: "#78716c" },
    { key: "chef", label: "طباخ", emoji: "👨‍🍳", color: "#e11d48" },
    { key: "plumbing", label: "تأسيس ماء", emoji: "🚰", color: "#0891b2" },
    { key: "electric_setup", label: "تأسيس كهرباء", emoji: "💡", color: "#ca8a04" },
    { key: "electric_street", label: "تصليح كهرباء", emoji: "⚡", color: "#d97706" },
    { key: "washer_repair", label: "تصليح غسالة", emoji: "🧺", color: "#0284c7" },
    { key: "stove_repair", label: "تصليح طباخ", emoji: "🔥", color: "#dc2626" },
    { key: "fridge_repair", label: "تصليح ثلاجة", emoji: "🧊", color: "#0ea5e9" },
    { key: "ac_repair", label: "مكيفات", emoji: "❄️", color: "#0284c7" },
    { key: "cleaning", label: "تنظيف بيوت", emoji: "🧹", color: "#16a34a" },
    { key: "wood_carpentry", label: "نجارة أخشاب", emoji: "🪵", color: "#a16207" },
    { key: "blacksmith", label: "حدادة", emoji: "⚒️", color: "#475569" },
    { key: "general", label: "خدمات عامة", emoji: "🏠", color: "#7c3aed" },
  ];
  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 20 }}>
      <Text style={styles.sectionTitle}>شنو تحتاج اليوم؟</Text>
      <Text style={styles.sectionSubTitle}>اختَر الخدمة ونرتّب لك الباقي</Text>
      <View style={styles.tilesGrid}>
        {tiles.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={styles.tile}
            onPress={() => router.push({ pathname: "/request/new", params: t.key === "large_vehicle" ? { type: "taxi", vehicle: "large" } : { type: t.key } })}
            activeOpacity={0.85}
          >
            <View style={[styles.tileIconWrap, { backgroundColor: t.color + "16" }]}><Text style={[styles.tileEmoji, { color: t.color }]}>{t.emoji}</Text></View>
            <Text style={styles.tileLabel}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

function ProviderHome({
  available,
  verified,
  verificationStatus,
  companyName,
  toggleAvailable,
  incoming,
}: {
  available: boolean;
  verified: boolean;
  verificationStatus: string;
  companyName: string;
  toggleAvailable: () => void;
  incoming: IncomingRequest[];
}) {
  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 20 }}>
      <TouchableOpacity
        style={[
          styles.availCard,
          available && styles.availCardActive,
          !verified && { opacity: 0.65 },
        ]}
        onPress={toggleAvailable}
        activeOpacity={0.85}
        disabled={!verified}
      >
        <View style={{ flex: 1 }}>
          <Text style={[styles.availTitle, available && { color: "#fff" }]}>
            {available ? "متاح للعمل" : "غير متاح"}
          </Text>
          <Text style={[styles.availDesc, available && { color: "rgba(255,255,255,0.8)" }]}>
            {!verified
              ? verificationStatus === "rejected"
                ? "تم رفض التوثيق — راجع الإدارة"
                : verificationStatus === "suspended"
                  ? "تم تعليق الحساب — راجع الإدارة"
                  : "بانتظار موافقة " + companyName
              : available
                ? "ستصلك الطلبات الجديدة"
                : "اضغط لتفعيل الاستقبال"}
          </Text>
        </View>
        <View style={[styles.availDot, available && styles.availDotActive]} />
      </TouchableOpacity>
      <Text style={styles.sectionTitle}>الطلبات الواردة</Text>
      <Text style={styles.sectionSubTitle}>العروض الجديدة تظهر هنا أول ما توصلك</Text>
      {incoming.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>لا توجد طلبات حالياً</Text>
          <Text style={styles.emptySubtext}>سيظهر هنا عند وصول طلب جديد</Text>
        </View>
      ) : (
        incoming.map((req) => (
          <TouchableOpacity
            key={req.id}
            style={styles.requestCard}
            onPress={() => router.push({ pathname: "/request/[id]", params: { id: req.id } })}
            activeOpacity={0.85}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.requestCustomer}>طلب جديد</Text>
              <Text style={styles.requestType}>
                {req.vehicle_category === "large" ? `🚚 سيارة كبيرة — ${req.vehicle_type === "kia_passenger" ? "كيا ركاب" : req.vehicle_type === "bus" ? "باص" : "كيا حمل"}` : req.type === "taxi" ? "🚕 طلب سيارة" : `🔧 ${req.type}`}
              </Text>
              <Text style={styles.requestPrice}>
                {(req.customer_price ?? req.price_estimate) != null ? `${Number(req.customer_price ?? req.price_estimate).toLocaleString("en")} د.ع` : req.vehicle_category === "large" ? "بانتظار عروض الأسعار" : "السعر قيد التحديد"}
              </Text>
            </View>
            <Text style={styles.requestArrow}>←</Text>
          </TouchableOpacity>
        ))
      )}
    </View>
  );
}

function TabBtn({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: string;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} style={styles.tabBtn} onPress={onPress} activeOpacity={0.7}>
      <Text style={[styles.tabIcon, active && styles.tabIconActive]}>{icon}</Text>
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.canvas },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: space.xl, paddingTop: 52, paddingBottom: 14, zIndex: 30, elevation: 12 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 10, zIndex: 40 },
  headerEyebrow: { color: palette.gold, fontSize: 9, fontWeight: "900", letterSpacing: 1.5, marginBottom: 5 },
  greeting: { fontSize: 25, fontWeight: "900", color: palette.ink },
  roleText: { fontSize: 12, color: palette.muted, marginTop: 3, fontWeight: "600" },
  avatar: { width: 48, height: 48, borderRadius: 17, backgroundColor: palette.brand, borderWidth: 1, borderColor: palette.gold, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 19, fontWeight: "900", color: palette.white },
  roleSwitcherWrap: { paddingBottom: 12 },
  roleSwitcher: { paddingHorizontal: space.xl, gap: 8, flexDirection: "row" },
  roleChip: { paddingHorizontal: 17, paddingVertical: 10, borderRadius: radius.pill, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line },
  roleChipActive: { backgroundColor: palette.brand, borderColor: palette.brand },
  roleChipText: { color: palette.muted, fontSize: 12, fontWeight: "800" },
  roleChipTextActive: { color: palette.white },
  sectionTitle: { fontSize: 19, fontWeight: "900", color: palette.ink, marginBottom: 4 },
  sectionSubTitle: { fontSize: 12, color: palette.muted, marginBottom: 16, lineHeight: 19 },
  tilesGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: { width: "48%", minHeight: 126, borderRadius: radius.lg, alignItems: "flex-start", justifyContent: "center", padding: 15, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line },
  tileIconWrap: { width: 46, height: 46, borderRadius: 15, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  tileEmoji: { fontSize: 24, fontWeight: "700" },
  tileLabel: { fontSize: 13, fontWeight: "900", color: palette.ink },
  availCard: { flexDirection: "row", alignItems: "center", backgroundColor: palette.surface, borderRadius: radius.xl, padding: 20, marginBottom: 24, borderWidth: 1, borderColor: palette.line },
  availCardActive: { backgroundColor: palette.brand, borderColor: palette.brand },
  availTitle: { fontSize: 18, fontWeight: "900", color: palette.ink },
  availDesc: { fontSize: 12, color: palette.muted, marginTop: 5, lineHeight: 19 },
  availDot: { width: 13, height: 13, borderRadius: 7, backgroundColor: palette.line },
  availDotActive: { backgroundColor: palette.gold },
  emptyBox: { alignItems: "center", paddingVertical: 36, backgroundColor: palette.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: palette.line },
  emptyText: { fontSize: 15, fontWeight: "800", color: palette.ink },
  emptySubtext: { fontSize: 12, color: palette.muted, marginTop: 6 },
  requestCard: { flexDirection: "row", alignItems: "center", backgroundColor: palette.surface, borderRadius: radius.lg, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: palette.line },
  requestCustomer: { fontSize: 15, fontWeight: "900", color: palette.ink },
  requestType: { fontSize: 12, color: palette.muted, marginTop: 5 },
  requestPrice: { fontSize: 14, fontWeight: "900", color: palette.brand, marginTop: 7 },
  requestArrow: { fontSize: 23, color: palette.gold },
  bottomTabs: { flexDirection: "row", backgroundColor: palette.surface, paddingTop: 10, paddingBottom: 24, borderTopWidth: 1, borderTopColor: palette.line },
  tabBtn: { flex: 1, alignItems: "center", paddingVertical: 4 },
  tabIcon: { fontSize: 22, color: palette.muted, fontWeight: "700" },
  tabIconActive: { color: palette.brand },
  tabLabel: { fontSize: 10, color: palette.muted, marginTop: 4, fontWeight: "700" },
  tabLabelActive: { color: palette.brand, fontWeight: "900" },
});
