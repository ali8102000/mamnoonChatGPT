import { useState, useEffect, useCallback } from "react";
import * as SecureStore from "expo-secure-store";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
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
import { RegionalServiceBanner } from "@/components/regional-service-banner";
import { useThemePreference } from "@/lib/theme-preference";
import Svg, { Circle, Path } from "react-native-svg";

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
  const { resolved: resolvedTheme, setMode } = useThemePreference();
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

  const greeting = (() => {
    const hour = new Date().getHours();
    if (hour < 5 || hour >= 18) return "مساء الخير";
    if (hour < 12) return "صباح الخير";
    return "نهارك سعيد";
  })();
  const roleTitle = activeRole === "large_driver"
    ? "سائق سيارات كبيرة 🚚"
    : activeRole === "driver"
      ? "كابتن تكسي 🚗"
      : activeRole === "worker"
        ? "فني خدمات 🛠️"
        : "زبون 👤";

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
    void loadIncoming();
    const channel = supabase.channel("incoming-requests")
      .on("postgres_changes", { event: "*", schema: "public", table: "service_requests" }, () => {
        void loadIncoming();
      });
    if (user?.id) {
      channel.on("postgres_changes", {
        event: "*", schema: "public", table: "request_offers", filter: `provider_id=eq.${user.id}`,
      }, () => {
        void loadIncoming();
      });
    }
    channel.subscribe();
    // Dispatch expands its search radius in 60-second waves. Polling keeps
    // later waves visible if Realtime is temporarily disconnected.
    const refreshTimer = setInterval(() => { void loadIncoming(); }, 3000);
    return () => {
      clearInterval(refreshTimer);
      supabase.removeChannel(channel);
    };
  }, [loadIncoming, user?.id]);

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
      <RegionalServiceBanner />
      {roles.includes("super_admin") && (
        <TouchableOpacity onPress={() => router.push("/admin")} activeOpacity={0.88} accessibilityRole="button" accessibilityLabel="لوحة الإدارة">
          <LinearGradient
            colors={["#F4C95D", "#E9AB2B", "#C58B18"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{ marginHorizontal: 18, marginBottom: 10, borderRadius: 18, padding: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: "#392707", fontSize: 12, fontWeight: "900", textAlign: "right" }}>إدارة {companyName}</Text>
              <Text style={{ color: "#513B13", fontSize: 10, fontWeight: "700", marginTop: 3, textAlign: "right" }}>اعتماد السائقين والفنيين · حظر الحسابات · توزيع الخصومات · الدعم</Text>
            </View>
            <View style={{ backgroundColor: "rgba(57,39,7,0.12)", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, marginLeft: 12 }}>
              <Text style={{ color: "#392707", fontSize: 11, fontWeight: "900" }}>لوحة الإدارة ←</Text>
            </View>
          </LinearGradient>
        </TouchableOpacity>
      )}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <View style={styles.headerGreetingRow}>
            <Text style={styles.headerEyebrow}>{greeting}</Text>
            <View style={styles.roleBadge}>
              <Text style={styles.roleBadgeText}>{roleTitle}</Text>
            </View>
          </View>
          <Text style={styles.greeting}>{profile?.full_name?.split(" ")[0] || "صديقنا"} 👋</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => void setMode(resolvedTheme === "dark" ? "light" : "dark")} accessibilityRole="button" accessibilityLabel="تبديل الوضع" style={styles.themeToggle}>
            <HomeGlyph name={resolvedTheme === "dark" ? "sun" : "moon"} color={palette.ink} size={20} />
          </TouchableOpacity>
          <NotificationsBell />
        </View>
      </View>
      <TouchableOpacity onPress={() => router.push("/account-settings")} accessibilityRole="button" accessibilityLabel="تبديل الدور" style={styles.roleSettingsLink}>
        <Text style={styles.roleSettingsText}>⇄  تبديل الدور</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => router.push("/coupons")}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="كوبوناتي والقسائم"
        style={{ marginHorizontal: 18, marginBottom: 12, borderRadius: 17, padding: 13, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.gold + "55" }}
      >
        <Text style={{ color: palette.brand, fontSize: 12, fontWeight: "900" }}>عرض الكل ←</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View>
            <Text style={{ color: palette.ink, fontSize: 13, fontWeight: "900", textAlign: "right" }}>كوبوناتي والقسائم</Text>
            <Text style={{ color: palette.muted, fontSize: 10, marginTop: 2, textAlign: "right" }}>العروض والخصومات المرسلة إلى حسابك</Text>
          </View>
          <Text style={{ fontSize: 23 }}>🎁</Text>
        </View>
      </TouchableOpacity>
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
    </View>
  );
}

type HomeGlyphName = "car" | "wrench" | "clock" | "shield" | "zap" | "arrow" | "sun" | "moon";

function HomeGlyph({ name, color, size = 22 }: { name: HomeGlyphName; color: string; size?: number }) {
  const common = { stroke: color, strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" as const };
  if (name === "car") return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path {...common} d="M5 17h14l1.3-5.3a2 2 0 0 0-1.9-2.5H5.6a2 2 0 0 0-1.9 2.5L5 17Z" />
      <Path {...common} d="M5 12h14M7 17v2m10-2v2M7 9l1-3h8l1 3" />
      <Circle {...common} cx="7.5" cy="16.5" r="1.2" />
      <Circle {...common} cx="16.5" cy="16.5" r="1.2" />
    </Svg>
  );
  if (name === "wrench") return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path {...common} d="M14.7 6.3a5 5 0 0 0-6.6 6.6l-5.2 5.2a2 2 0 0 0 2.8 2.8l5.2-5.2a5 5 0 0 0 6.6-6.6l-3 3-3-3 3.2-2.8Z" />
    </Svg>
  );
  if (name === "sun") return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle {...common} cx="12" cy="12" r="4" />
      <Path {...common} d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
    </Svg>
  );
  if (name === "moon") return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path {...common} d="M20.985 12.486A9 9 0 1 1 11.514 3.015a7 7 0 0 0 9.471 9.471Z" />
    </Svg>
  );
  if (name === "clock") return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle {...common} cx="12" cy="12" r="9" />
      <Path {...common} d="M12 7v5l3.5 2" />
    </Svg>
  );
  if (name === "shield") return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path {...common} d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" />
      <Path {...common} d="m9 12 2 2 4-4" />
    </Svg>
  );
  if (name === "zap") return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path {...common} d="m13 2-3 8h7l-6 12 2-9H6l7-11Z" />
    </Svg>
  );
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path {...common} d="M17 17 7 7M7 7v10h10" />
    </Svg>
  );
}

function CustomerHome() {
  const tiles = [
    {
      key: "taxi",
      title: "طلب سيارة",
      subtitle: "خلال دقائق",
      emoji: "🚕",
      colors: ["#E9AB2B", "#F97316"] as const,
      width: "65%" as const,
      type: "taxi" as const,
    },
    {
      key: "service",
      title: "طلب فني",
      subtitle: "١٦ خدمة",
      emoji: "🛠️",
      colors: ["#10B981", "#14B8A6"] as const,
      width: "31.5%" as const,
      type: "service" as const,
    },
    {
      key: "large",
      title: "طلب سيارة كبيرة",
      subtitle: "كيا حمل أو كيا ركاب",
      emoji: "🚚",
      colors: ["#F97316", "#D97706"] as const,
      width: "31.5%" as const,
      type: "taxi" as const,
      vehicle: "large" as const,
    },
  ];

  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 20, gap: 16 }}>
      <LinearGradient
        colors={[palette.brand, palette.brandGlow, palette.gold]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          borderRadius: 24,
          padding: 24,
          overflow: "hidden",
          elevation: 5,
        }}
      >
        <LinearGradient
          pointerEvents="none"
          colors={["rgba(255,255,255,0.24)", "rgba(255,255,255,0.02)", "rgba(255,255,255,0.10)"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        />
        <View
          pointerEvents="none"
          style={{ position: "absolute", width: 150, height: 150, borderRadius: 75, backgroundColor: "rgba(255,255,255,0.12)", top: -55, left: -35 }}
        />
        <View
          style={{
            alignSelf: "flex-start",
            borderRadius: 999,
            paddingHorizontal: 10,
            paddingVertical: 4,
            backgroundColor: "rgba(255,255,255,0.20)",
            marginBottom: 8,
          }}
        >
          <Text style={{ color: "#FFFFFF", fontSize: 10, fontWeight: "800" }}>✨ مجاناً بلا عمولة</Text>
        </View>
        <Text style={{ color: "#FFFFFF", fontSize: 24, lineHeight: 29, fontWeight: "900", textAlign: "right" }}>
          اطلب الآن، ادفع للمزوّد مباشرة
        </Text>
        <Text style={{ color: "rgba(255,255,255,0.92)", fontSize: 12, lineHeight: 16, marginTop: 4, textAlign: "right" }}>
          ممنون منصّة مجانية وسريعة — بدون أي نسبة على طلبك
        </Text>
      </LinearGradient>

      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 10 }}>
        {tiles.map((tile) => (
          <TouchableOpacity
            key={tile.key}
            accessibilityRole="button"
            accessibilityLabel={tile.title}
            activeOpacity={0.86}
            onPress={() => {
              if (tile.key === "taxi") {
                router.push("/request/taxi");
                return;
              }
              router.push({
                pathname: "/request/new",
                params: tile.vehicle ? { type: tile.type, vehicle: tile.vehicle } : { type: tile.type },
              });
            }}
            style={{
              width: tile.width,
              minHeight: 132,
              borderRadius: 24,
              padding: 16,
              justifyContent: "space-between",
              backgroundColor: palette.surface,
              borderWidth: 1,
              borderColor: palette.line,
              elevation: 2,
            }}
          >
            <LinearGradient
              colors={tile.colors}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                width: 48,
                height: 48,
                borderRadius: 16,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <HomeGlyph name={tile.key === "service" ? "wrench" : "car"} color="#FFFFFF" size={26} />
            </LinearGradient>
            <View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                <Text style={{ color: palette.ink, fontSize: 16, fontWeight: "900", textAlign: "right" }}>{tile.title}</Text>
                <HomeGlyph name="arrow" color={palette.muted} size={14} />
              </View>
              <Text style={{ color: palette.muted, fontSize: 11, fontWeight: "700", marginTop: 3, textAlign: "right" }}>{tile.subtitle}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>

      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1, borderRadius: 16, padding: 12, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, justifyContent: "center", alignItems: "center" }}>
          <HomeGlyph name="clock" color={palette.brand} size={18} />
          <Text style={{ color: palette.ink, fontSize: 14, fontWeight: "900", textAlign: "center", marginTop: 2 }}>٣ د</Text>
          <Text style={{ color: palette.muted, fontSize: 10, fontWeight: "700", textAlign: "center" }}>أقل من</Text>
        </View>
        <View style={{ flex: 1, borderRadius: 16, padding: 12, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, justifyContent: "center", alignItems: "center" }}>
          <HomeGlyph name="shield" color={palette.brand} size={18} />
          <Text style={{ color: palette.ink, fontSize: 14, fontWeight: "900", textAlign: "center", marginTop: 2 }}>موثق</Text>
          <Text style={{ color: palette.muted, fontSize: 10, fontWeight: "700", textAlign: "center" }}>مزودون</Text>
        </View>
      </View>

      <View style={{ paddingTop: 2, paddingBottom: 20, marginTop: 8 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <Text style={{ color: palette.ink, fontSize: 15, fontWeight: "900" }}>لماذا ممنون؟</Text>
          <Text style={{ color: palette.muted, fontSize: 11, fontWeight: "700" }}>مميّزاتنا</Text>
        </View>
        <View style={{ gap: 9 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, padding: 14, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line }}>
            <LinearGradient colors={["#E9AB2B", "#F97316"]} style={{ width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" }}>
              <HomeGlyph name="zap" color="#FFFFFF" size={22} />
            </LinearGradient>
            <View style={{ flex: 1 }}>
              <Text style={{ color: palette.ink, fontSize: 14, fontWeight: "900", textAlign: "right" }}>سرعة في الاستجابة</Text>
              <Text style={{ color: palette.muted, fontSize: 11, lineHeight: 14, marginTop: 2, textAlign: "right" }}>نوصلك بأقرب سيارة أو فني في منطقتك</Text>
            </View>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, padding: 14, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line }}>
            <LinearGradient colors={["#10B981", "#14B8A6"]} style={{ width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" }}>
              <HomeGlyph name="shield" color="#FFFFFF" size={22} />
            </LinearGradient>
            <View style={{ flex: 1 }}>
              <Text style={{ color: palette.ink, fontSize: 14, fontWeight: "900", textAlign: "right" }}>أمان مضمون</Text>
              <Text style={{ color: palette.muted, fontSize: 11, lineHeight: 18, marginTop: 2, textAlign: "right" }}>جميع الكباتن والفنيين موثّقون رسمياً</Text>
            </View>
          </View>
        </View>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.pageCanvas },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: space.xl, paddingTop: 52, paddingBottom: 14, zIndex: 30, elevation: 12 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8, zIndex: 40 },
  headerGreetingRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 },
  roleBadge: { borderRadius: 999, backgroundColor: palette.brand + "1A", paddingHorizontal: 10, paddingVertical: 2 },
  roleBadgeText: { color: palette.brand, fontSize: 10, fontWeight: "700" },
  themeToggle: { width: 44, height: 44, borderRadius: 16, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, alignItems: "center", justifyContent: "center" },
  themeToggleText: { color: palette.ink, fontSize: 22, fontWeight: "700" },
  roleSettingsLink: { alignSelf: "flex-start", marginHorizontal: space.xl, marginBottom: 12, borderRadius: 12, borderWidth: 1, borderColor: palette.brand + "33", backgroundColor: palette.brand + "0D", paddingHorizontal: 12, paddingVertical: 8 },
  roleSettingsText: { color: palette.brand, fontSize: 12, fontWeight: "800" },
  headerEyebrow: { color: palette.brand, fontSize: 11, fontWeight: "700", letterSpacing: 0.5 },
  greeting: { fontSize: 24, lineHeight: 29, fontWeight: "900", color: palette.ink },
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
