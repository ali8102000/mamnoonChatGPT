import { useState, useEffect, useCallback } from "react";
import { useRef } from "react";
import { Animated, Easing, PanResponder } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import {
  View,
  Text,
  Dimensions,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  Alert,
  Image,
} from "react-native";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import * as Location from "expo-location";
import { startProviderPresenceBackgroundLocation, stopProviderPresenceBackgroundLocation } from "@/lib/background-location";
import { ActiveCustomerRequestBanner } from "@/components/active-customer-request-banner";
import { palette, radius, space } from "@/styles/theme";
import { NotificationsBell } from "@/components/notifications-bell";
import { useThemePreference } from "@/lib/theme-preference";
import Svg, { Circle, Path } from "react-native-svg";
import { HomeCategoryCarousel } from "@/components/home-category-carousel";
import { ServiceIconPanorama } from "@/components/service-icon-panorama";
import { HomeCampaignPopups } from "@/components/home-campaign-popups";

const HOME_GRID_GAP = 12;

type IncomingRequest = {
  id: string;
  type: string;
  price_estimate: number | null;
  customer_price?: number | null;
  customer_payable?: number | null;
  vehicle_category?: string | null;
  vehicle_type?: string | null;
  pickup_text?: string | null;
  dest_text?: string | null;
  distance_km?: number | null;
  urgency_multiplier?: number | null;
  service_urgency_enabled?: boolean;
  large_vehicle_urgency_enabled?: boolean;
  taxi_urgency_enabled?: boolean;
  taxi_urgency_percent?: number;
  my_offer?: { expires_at: string; sent_at: string; distance_km: number | null };
};

export default function HomeScreen() {
  const { user, profile, roles, activeRole } = useAuth();
  const selectedRole = activeRole && roles.includes(activeRole)
    ? activeRole
    : roles.includes("customer") ? "customer" : roles[0] || "customer";
  const { resolved: resolvedTheme, setMode } = useThemePreference();
  const [companyName, setCompanyName] = useState("شركة ممنون");
  const [companyLogoUrl, setCompanyLogoUrl] = useState<string | null>(null);
  const [welcomeMessage, setWelcomeMessage] = useState("مشوارك وخدمات بيتك، بمكان واحد.");

  useEffect(() => {
    (supabase as any).from("company_settings").select("company_name,company_logo_url,welcome_message").eq("id", 1).maybeSingle()
      .then(({ data }: any) => { if (data?.company_name) setCompanyName(data.company_name); setCompanyLogoUrl(data?.company_logo_url ?? null); if (data?.welcome_message) setWelcomeMessage(data.welcome_message); });
  }, []);

  const [available, setAvailable] = useState(false);
  const [verified, setVerified] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState("pending");
  const [incoming, setIncoming] = useState<IncomingRequest[]>([]);
  const [dispatchClock, setDispatchClock] = useState(Date.now());
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setDispatchClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const greeting = (() => {
    const hour = new Date().getHours();
    if (hour < 5 || hour >= 18) return "مساء الخير";
    if (hour < 12) return "صباح الخير";
    return "نهارك سعيد";
  })();
  const roleTitle = selectedRole === "large_driver"
    ? "سائق سيارات كبيرة 🚚"
    : selectedRole === "driver"
      ? "كابتن تكسي 🚗"
      : selectedRole === "worker"
        ? "فني خدمات 🛠️"
        : "زبون 👤";

  const loadIncoming = useCallback(async () => {
    if (!user || (selectedRole !== "driver" && selectedRole !== "large_driver" && selectedRole !== "worker")) {
      setIncoming([]);
      return;
    }
    const isDriver = selectedRole === "driver" || selectedRole === "large_driver";
    const { data: offerRows, error: offersError } = await (supabase as any)
      .from("request_offers")
      .select("request_id, expires_at, sent_at, distance_km")
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
      .select("id, type, pickup_text, dest_text, distance_km, price_estimate, customer_payable, customer_price, vehicle_category, vehicle_type, urgency_multiplier, service_urgency_enabled, large_vehicle_urgency_enabled, taxi_urgency_enabled, taxi_urgency_percent")
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
    const offerByRequest = new Map((offerRows ?? []).map((offer: any) => [offer.request_id, offer]));
    setIncoming((data ?? []).map((request: any) => ({
      ...request,
      my_offer: offerByRequest.get(request.id) ?? null,
    })) as IncomingRequest[]);
  }, [selectedRole, user]);

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
    if (!user || (selectedRole !== "driver" && selectedRole !== "large_driver" && selectedRole !== "worker")) {
      setAvailable(false);
      setVerified(false);
      setVerificationStatus("pending");
      return;
    }
    const table = (selectedRole === "driver" || selectedRole === "large_driver") ? "driver_profiles" : "worker_profiles";
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
  }, [selectedRole, user]);

  useEffect(() => {
    if (!user || !verified || !available || (selectedRole !== "driver" && selectedRole !== "large_driver" && selectedRole !== "worker")) {
      void stopProviderPresenceBackgroundLocation().catch((stopError) => {
        console.warn("[Mamnoon] could not stop inactive provider background location:", stopError);
      });
      return;
    }
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
        const table = (selectedRole === "driver" || selectedRole === "large_driver") ? "driver_profiles" : "worker_profiles";
        await supabase.from(table).update({ available: false }).eq("user_id", userId);
        setAvailable(false);
      } else if (mounted && !loadedIncoming) {
        loadedIncoming = true;
        void loadIncoming();
      }
    }

    async function startPresence() {
      const backgroundTrackingEnabled = await startProviderPresenceBackgroundLocation({
        userId,
        role: selectedRole as "driver" | "large_driver" | "worker",
      });
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
      if (!backgroundTrackingEnabled && mounted) {
        Alert.alert(
          "الاستقبال يعمل والتطبيق مفتوح",
          "حتى تستمر باستقبال الطلبات عند تصغير ممنون، فعّل إذن الموقع في الخلفية من إعدادات التطبيق. تگدر حالياً تستقبل الطلبات ما دام التطبيق مفتوحاً.",
        );
      }
    }

    void startPresence().catch(async (presenceError) => {
      if (!user) return;
      await stopProviderPresenceBackgroundLocation().catch(() => undefined);
      const table = (selectedRole === "driver" || selectedRole === "large_driver") ? "driver_profiles" : "worker_profiles";
      await supabase.from(table).update({ available: false }).eq("user_id", userId);
      if (mounted) {
        const message = presenceError instanceof Error && presenceError.message === "background_location_denied"
          ? "اسمح لممنون بالوصول إلى الموقع دائماً حتى تستقبل الطلبات عند تصغير التطبيق."
          : "تعذر تشغيل مشاركة الموقع؛ تحقق من GPS وأذونات الموقع وحاول مرة أخرى.";
        Alert.alert("مشاركة الموقع مطلوبة", message);
        setAvailable(false);
      }
    });

    return () => {
      mounted = false;
      subscription?.remove();
    };
  }, [selectedRole, available, verified, user, loadIncoming]);

  async function toggleAvailable() {
    if (!user || (selectedRole !== "driver" && selectedRole !== "large_driver" && selectedRole !== "worker")) return;
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
    const table = (selectedRole === "driver" || selectedRole === "large_driver") ? "driver_profiles" : "worker_profiles";
    const { error } = await supabase.from(table).update({ available: next }).eq("user_id", user.id);
    if (error) {
      Alert.alert("تعذر تحديث التوفر", error.message);
      return;
    }
    if (!next) {
      await stopProviderPresenceBackgroundLocation().catch((stopError) => {
        console.warn("[Mamnoon] could not stop provider background location:", stopError);
      });
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
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {companyLogoUrl ? <Image source={{ uri: companyLogoUrl }} style={{ width: 34, height: 34, borderRadius: 9, backgroundColor: "#FFFFFF" }} resizeMode="contain" /> : null}
            <Text style={styles.greeting}>{profile?.full_name?.split(" ")[0] || "صديقنا"} 👋</Text>
          </View>
          <Text style={{ color: palette.muted, fontSize: 11, textAlign: "right", marginTop: 4 }}>{welcomeMessage}</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => void setMode(resolvedTheme === "dark" ? "light" : "dark")} accessibilityRole="button" accessibilityLabel="تبديل الوضع" style={styles.themeToggle}>
            <HomeGlyph name={resolvedTheme === "dark" ? "sun" : "moon"} color={palette.ink} size={20} />
          </TouchableOpacity>
          <NotificationsBell />
        </View>
      </View>

      <ActiveCustomerRequestBanner />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {selectedRole === "customer" ? (
          <>
            <HomeCampaignPopups userId={user?.id ?? null} />
            <CustomerHome userId={user?.id ?? null} />
          </>
        ) : (
          <ProviderHome
            available={available}
            verified={verified}
            verificationStatus={verificationStatus}
            companyName={companyName}
            toggleAvailable={toggleAvailable}
            incoming={incoming}
            dispatchClock={dispatchClock}
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

function CustomerHome({ userId }: { userId: string | null }) {
  const [visuals, setVisuals] = useState<Record<string, any>>({});
  const [topBanners, setTopBanners] = useState<any[]>([]);
  const [topBannerIndex, setTopBannerIndex] = useState(0);
  const [activeBannerCampaignId, setActiveBannerCampaignId] = useState<string | null>(null);
  const topBanner = topBanners[topBannerIndex] ?? null;
  const suppressTopBannerPress = useRef(false);
  const topBannerCount = useRef(0);
  topBannerCount.current = topBanners.length;
  const topBannerSwipeResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 24 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2,
    onPanResponderRelease: (_, gesture) => {
      if (topBannerCount.current < 2 || Math.abs(gesture.dx) < 38) return;
      suppressTopBannerPress.current = true;
      setTopBannerIndex((value) => (value + (gesture.dx < 0 ? 1 : -1) + topBannerCount.current) % topBannerCount.current);
      setTimeout(() => { suppressTopBannerPress.current = false; }, 350);
    },
  })).current;
  const gridLayout = visuals.home_customer_grid_layout || {};
  const gridGap = Math.max(4, Math.min(28, Number(gridLayout.grid_gap_px) || HOME_GRID_GAP));
  const firstRowHeight = Math.max(100, Math.min(260, Number(gridLayout.first_row_height_px) || 145));
  const secondRowHeight = Math.max(120, Math.min(300, Number(gridLayout.second_row_height_px) || 188));
  const carouselHeight = Math.max(120, Math.min(300, Number(gridLayout.carousel_height_px) || secondRowHeight));
  const wideRatio = Math.max(1.4, Math.min(2.8, Number(gridLayout.wide_column_ratio) || 2));
  const gridRadius = Math.max(8, Math.min(32, Number(gridLayout.card_radius_px) || 20));
  const availableGridWidth = Dimensions.get("window").width - 24;
  const wideCardWidth = (availableGridWidth - gridGap) * wideRatio / (wideRatio + 1);
  const narrowCardWidth = availableGridWidth - gridGap - wideCardWidth;
  const bannerMotion = useRef(new Animated.Value(0)).current;
  const [largeVehicleCardHeight, setLargeVehicleCardHeight] = useState(188);
  useEffect(() => {
    bannerMotion.setValue(0);
    const seconds = Math.max(1, Math.min(60, Number(topBanner?.scroll_speed) || 5));
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(bannerMotion, { toValue: 1, duration: seconds * 1000, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
      Animated.timing(bannerMotion, { toValue: 0, duration: seconds * 1000, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [bannerMotion, topBanner?.id, topBanner?.scroll_speed, topBanner?.motion_style, topBanner?.motion_direction]);
  useEffect(() => {
    let active = true;
    (supabase as any).from("app_ui_elements_public")
      .select("element_key,published_config,title,subtitle,sort_order")
      .then(({ data, error }: any) => {
        if (!active || error) return;
        const next: Record<string, any> = {};
        for (const item of data ?? []) next[item.element_key] = { ...(item.published_config ?? {}), title: item.title, subtitle: item.subtitle, sort_order: item.sort_order };
        setVisuals(next);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data, error } = await (supabase as any).from("home_carousel_banners")
        .select("id,image_url,banner_type,target_campaign_id,scroll_speed,motion_direction,motion_style,badge_text,banner_title,banner_description,display_config,is_active")
        .eq("is_active", true).in("banner_type", ["ad", "poll", "contest"]).order("display_order").order("created_at");
      if (active && !error) { setTopBanners(data ?? []); setTopBannerIndex(0); }
    };
    void load();
    const channel = supabase.channel("home-top-banner-native")
      .on("postgres_changes", { event: "*", schema: "public", table: "home_carousel_banners" }, () => void load())
      .subscribe();
    return () => { active = false; void supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    if (topBanners.length < 2) return;
    const seconds = Math.max(1, Math.min(60, Number(topBanner?.scroll_speed) || 5));
    const timer = setInterval(() => {
      const reverse = topBanner?.motion_direction === "right" || topBanner?.motion_direction === "down";
      setTopBannerIndex((value) => (value + (reverse ? -1 : 1) + topBanners.length) % topBanners.length);
    }, seconds * 1000);
    return () => clearInterval(timer);
  }, [topBanners, topBanner?.scroll_speed, topBanner?.motion_direction]);

  const tiles = [
    {
      key: "taxi",
      title: "طلب تكسي",
      subtitle: "خلال دقائق",
      emoji: "🚕",
      colors: ["#E9AB2B", "#F97316"] as const,
      width: wideCardWidth,
      type: "taxi" as const,
    },
    {
      key: "service",
      title: "طلب فني",
      subtitle: "١٦ خدمة",
      emoji: "🛠️",
      colors: ["#10B981", "#14B8A6"] as const,
      width: narrowCardWidth,
      type: "service" as const,
    },
    {
      key: "large",
      title: "طلب سيارة كبيرة",
      subtitle: "كيا حمل أو كيا ركاب أو باص",
      emoji: "🚚",
      colors: ["#F97316", "#D97706"] as const,
      width: narrowCardWidth,
      type: "taxi" as const,
      vehicle: "large" as const,
    },
  ];

  return (
    <View style={{ paddingHorizontal: 12, paddingTop: 16, gap: gridGap }}>
      <View {...topBannerSwipeResponder.panHandlers} style={{ width: "100%" }}>
      <TouchableOpacity activeOpacity={0.94} onPress={() => { if (suppressTopBannerPress.current) { suppressTopBannerPress.current = false; return; } if (topBanner?.target_campaign_id) setActiveBannerCampaignId(topBanner.target_campaign_id); else router.push("/request/new"); }}>
      <LinearGradient
        colors={topBanner?.display_config?.background_color ? [topBanner.display_config.background_color, topBanner.display_config.background_color] : [palette.brand, palette.brandGlow, palette.gold]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          height: Math.max(100,Math.min(300,Number(topBanner?.display_config?.height_px)||Number(gridLayout.top_banner_height_px)||130)),
          borderRadius: Math.max(8,Math.min(40,Number(topBanner?.display_config?.border_radius_px)||20)),
          padding: Math.max(8,Math.min(32,Number(topBanner?.display_config?.padding_px)||12)),
          backgroundColor: topBanner?.display_config?.background_color || undefined,
          overflow: "hidden",
          elevation: 5,
        }}
      >
        {topBanner?.image_url ? (() => {
          const direction = topBanner.motion_direction || "left";
          const distance = 18;
          const translateX = direction === "left" || direction === "right"
            ? bannerMotion.interpolate({ inputRange: [0, 1], outputRange: [0, direction === "left" ? -distance : distance] })
            : 0;
          const translateY = direction === "up" || direction === "down"
            ? bannerMotion.interpolate({ inputRange: [0, 1], outputRange: [0, direction === "up" ? -distance : distance] })
            : 0;
          const scale = topBanner.motion_style === "drop"
            ? bannerMotion.interpolate({ inputRange: [0, 1], outputRange: [1.18, 1.24] })
            : 1.22;
          const opacity = topBanner.motion_style === "fade"
            ? bannerMotion.interpolate({ inputRange: [0, 1], outputRange: [0.28, 0.4] })
            : 0.4;
          return <Animated.Image source={{ uri: topBanner.image_url }} style={{ position: "absolute", top: "-10%", left: "-10%", width: "120%", height: "120%", opacity: Math.max(0.05,Math.min(1,Number(topBanner.display_config?.image_opacity)||0.4)), transform: [{ translateX }, { translateY }, { scale }] }} resizeMode="cover" />;
        })() : null}
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
            paddingHorizontal: 8,
            paddingVertical: 2,
            backgroundColor: "rgba(255,255,255,0.20)",
            marginBottom: 4,
          }}
        >
          <Text style={{ color: "#FFFFFF", fontSize: 10, fontWeight: "800" }}>✨ {topBanner?.badge_text || "مجاناً بلا عمولة"}</Text>
        </View>
        <Text style={{ fontSize: Math.max(12,Math.min(30,Number(topBanner?.display_config?.title_size_px)||20)), lineHeight: 25, fontWeight: "900", textAlign: topBanner?.display_config?.text_alignment || "right", color: topBanner?.display_config?.title_color || "#FFFFFF" }}>
          {topBanner?.banner_title || "اطلب الآن، ادفع للمزوّد مباشرة"}
        </Text>
        <Text style={{ fontSize: Math.max(8,Math.min(20,Number(topBanner?.display_config?.subtitle_size_px)||11)), lineHeight: 14, marginTop: 2, textAlign: topBanner?.display_config?.text_alignment || "right", color: topBanner?.display_config?.description_color || "rgba(255,255,255,0.92)" }}>
          {topBanner?.banner_description || topBanner?.badge_text || "ممنون منصّة مجانية وسريعة — بدون أي نسبة على طلبك"}
        </Text>
        {topBanner?.display_config?.cta_visible !== false ? <View pointerEvents="none" style={{ alignSelf: "flex-end", marginTop: 4, marginBottom: 2, borderRadius: 20, backgroundColor: topBanner?.display_config?.cta_background_color || "#FFFFFF", paddingHorizontal: 13, paddingVertical: 6 }}><Text style={{ color: topBanner?.display_config?.cta_text_color || palette.brand, fontSize: 11, fontWeight: "900" }}>{topBanner?.display_config?.cta_text || "اطلب الآن"} ←</Text></View> : null}
      </LinearGradient>
      </TouchableOpacity>
      </View>
      {activeBannerCampaignId ? <HomeCampaignPopups userId={userId} campaignId={activeBannerCampaignId} onClose={() => setActiveBannerCampaignId(null)} /> : null}

      <HomeCustomContent userId={userId} placementKey="home.customer.top" />

      <View style={{ flexDirection: "row", direction: "ltr", flexWrap: "wrap", justifyContent: "space-between", rowGap: gridGap, columnGap: gridGap }}>
        {[...tiles].sort((a,b) => {
          const keyA = a.key === "taxi" ? "home_customer_taxi" : a.key === "service" ? "home_customer_service" : "home_customer_large_vehicle";
          const keyB = b.key === "taxi" ? "home_customer_taxi" : b.key === "service" ? "home_customer_service" : "home_customer_large_vehicle";
          return (Number(visuals[keyA]?.sort_order) || 0) - (Number(visuals[keyB]?.sort_order) || 0);
        }).map((tile) => {
          const visualKey = tile.key === "taxi" ? "home_customer_taxi" : tile.key === "service" ? "home_customer_service" : "home_customer_large_vehicle";
          const visual = visuals[visualKey] || {};
          if (visual.is_hidden === true) return null;
          const tileHeight = Math.max(96, Math.min(360, Number(visual.card_height_px) || (tile.key === "large" ? secondRowHeight : firstRowHeight)));
          const tilePadding = Math.max(4, Math.min(32, Number(visual.card_padding_px) || 10));
          const tileRadius = Math.max(8, Math.min(40, Number(visual.border_radius_px) || gridRadius));
          const iconWidth = Math.max(24, Math.min(180, Number(visual.width_px) || (tile.key === "service" ? Number(gridLayout.service_icon_size_px) || 64 : tile.key === "taxi" ? Number(gridLayout.taxi_icon_size_px) || 56 : Number(gridLayout.large_icon_size_px) || 56)));
          const iconHeight = Math.max(24, Math.min(180, Number(visual.height_px) || (tile.key === "service" ? Number(gridLayout.service_icon_size_px) || 64 : tile.key === "taxi" ? Number(gridLayout.taxi_icon_size_px) || 56 : Number(gridLayout.large_icon_size_px) || 56)));
          const iconScale = Math.max(0.5, Math.min(2, Number(visual.icon_scale) || 1));
          const titleSize = Math.max(10, Math.min(28, Number(visual.title_size_px) || 16));
          const subtitleSize = Math.max(8, Math.min(20, Number(visual.subtitle_size_px) || 11));
          const alignment = visual.content_alignment || "right";
          return (
          <TouchableOpacity
            key={tile.key}
            accessibilityRole="button"
            accessibilityLabel={tile.title}
            activeOpacity={0.86}
            onLayout={tile.key === "large" ? (event) => {
              const nextHeight = Math.round(event.nativeEvent.layout.height);
              setLargeVehicleCardHeight((current) => current === nextHeight ? current : nextHeight);
            } : undefined}
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
              direction: "rtl",
              width: tile.width,
              height: tileHeight,
              minHeight: tileHeight,
              borderRadius: tileRadius,
              padding: tilePadding,
              justifyContent: "space-between",
              backgroundColor: visual.background_color || palette.surface,
              borderWidth: 1,
              borderColor: palette.line,
              elevation: 2,
              transform: [
                { scale: Math.max(0.6, Math.min(1.6, Number(visual.element_scale) || 1)) },
                { translateX: Math.max(-140, Math.min(140, Number(visual.position_x_px) || 0)) },
                { translateY: Math.max(-180, Math.min(180, Number(visual.position_y_px) || 0)) },
              ],
            }}
          >
            <LinearGradient
              colors={tile.colors}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                width: iconWidth,
                height: iconHeight,
                transform: [{ scale: iconScale }],
                borderRadius: tile.key === "service" ? 18 : 14,
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
              }}
            >
              <View style={{ transform: [{ translateX: Math.max(-100, Math.min(100, Number(visual.content_position_x_px) || 0)) }, { translateY: Math.max(-100, Math.min(100, Number(visual.content_position_y_px) || 0)) }, { scale: Math.max(0.5, Math.min(2.5, Number(visual.content_scale) || 1)) }], alignItems: "center", justifyContent: "center", width: "100%", height: "100%" }}>
              {tile.key === "service" ? (
                <ServiceIconPanorama
                  imageUrl={visual.image_url || visual.panorama_image_url || null}
                  imageScale={Number(visual.image_scale) || 1}
                  imageFit={visual.image_fit}
                  imageShape={visual.image_shape}
                  imageRadius={Number(visual.image_border_radius_px ?? 18)}
                />
              ) : (
                visual.icon_name ? <Text style={{ fontSize: 30 }}>{visual.icon_name}</Text> : <Image source={visual.image_url ? { uri: visual.image_url } : { uri: tile.key === "taxi" ? "https://raw.githubusercontent.com/ali8102000/mamnoonChatGPT/main/src/assets/car-luxury.png" : "https://raw.githubusercontent.com/ali8102000/mamnoonChatGPT/main/src/assets/service-kia-driver.png" }} style={{ width: iconWidth, height: iconHeight, borderRadius: Math.max(0, Math.min(60, Number(visual.image_border_radius_px) || 0)), aspectRatio: visual.image_shape === "landscape" ? 4/3 : visual.image_shape === "portrait" ? 3/4 : 1 }} resizeMode={visual.image_fit === "cover" ? "cover" : "contain"} />
              )}
              </View>
            </LinearGradient>
            <View style={{ alignItems: alignment === "center" ? "center" : alignment === "left" ? "flex-start" : "flex-end", flexDirection: visual.content_direction === "row" ? "row" : "column", justifyContent: "space-between", flex: visual.content_direction === "row" ? 1 : undefined }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5, justifyContent: alignment === "center" ? "center" : alignment === "left" ? "flex-start" : "flex-end" }}>
                <Text style={{ color: visual.title_color || palette.ink, fontSize: titleSize, fontWeight: "900", textAlign: alignment }}>{(tile.key === "taxi" && visual.title === "طلب سيارة") ? "طلب تكسي" : (visual.title || tile.title)}</Text>
                <HomeGlyph name="arrow" color={palette.muted} size={14} />
              </View>
              <Text style={{ color: visual.subtitle_color || palette.muted, fontSize: subtitleSize, fontWeight: "700", marginTop: 3, textAlign: alignment }}>{visual.subtitle || tile.subtitle}</Text>
              <View style={{ alignSelf: alignment === "center" ? "center" : alignment === "left" ? "flex-start" : "flex-end", marginTop: 8, borderWidth: 1.5, borderColor: palette.brand, borderRadius: 999, backgroundColor: palette.brandSoft, paddingHorizontal: 12, paddingVertical: 5 }}>
                <Text style={{ color: palette.brand, fontSize: 11, fontWeight: "900" }}>اطلب الآن ←</Text>
              </View>
            </View>
          </TouchableOpacity>
          );
        })}
        <View style={{ width: wideCardWidth, height: carouselHeight, direction: "rtl", borderRadius: gridRadius, overflow: "hidden" }}>
          <HomeCategoryCarousel height={carouselHeight} width={wideCardWidth} />
        </View>
      </View>

      <HomeCustomContent userId={userId} placementKey="home.customer.content" />

      <View style={{ marginTop: 18, gap: 10 }}>
        <Text style={{ color: palette.ink, fontSize: 14, fontWeight: "900", textAlign: "right" }}>قسم المطاعم</Text>
        <HomeCategoryCarousel height={180} width={Dimensions.get("window").width - 40} placement="restaurant_section" />
        <HomeCustomContent userId={userId} placementKey="home.restaurant.content" />
      </View>

      <View style={{ borderRadius: 18, borderWidth: 1, borderColor: palette.brand + "33", backgroundColor: palette.brand + "0D", padding: 12 }}>
        <TouchableOpacity onPress={() => router.push("/ask-mamnoon")} activeOpacity={0.86} style={{ padding: 3, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View style={{ flex: 1 }}><Text style={{ color: palette.ink, fontSize: 14, fontWeight: "900", textAlign: "right" }}>🤖 اسأل ممنون</Text><Text style={{ color: palette.muted, fontSize: 11, marginTop: 4, textAlign: "right" }}>مساعد ذكي يجاوبك عن خدمات التطبيق</Text></View>
          <Text style={{ color: palette.brand, fontSize: 11, fontWeight: "900" }}>ابدأ المحادثة ←</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.push("/coupons")} activeOpacity={0.86} style={{ marginTop: 8, borderTopWidth: 1, borderTopColor: palette.line, paddingTop: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ color: palette.brand, fontSize: 11, fontWeight: "900" }}>عرض قسائمي ←</Text><Text style={{ color: palette.ink, fontSize: 13, fontWeight: "900", textAlign: "right" }}>🎁 القسائم والكوبونات</Text>
        </TouchableOpacity>
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

      <HomeCustomContent userId={userId} placementKey="home.customer.after_stats" />

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


function HomeCustomContent({ userId, placementKey }: { userId: string | null; placementKey: string }) {
  const [sections, setSections] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, any[]>>({});
  const [voting, setVoting] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [sectionResult, campaignResult] = await Promise.all([
      (supabase as any).from("app_content_sections_public").select("id,title,section_type,placement_key,sort_order,published_config").eq("placement_key", placementKey).order("sort_order"),
      (supabase as any).from("app_campaigns").select("id,campaign_type,title,description,starts_at,ends_at,result_visibility,app_campaign_options(id,label,sort_order)").eq("status", "published").eq("placement_key", placementKey).order("sort_order").order("created_at", { ascending: false }),
    ]);
    if (!sectionResult.error) setSections(sectionResult.data ?? []);
    if (!campaignResult.error) {
      const now = Date.now();
      const active = (campaignResult.data ?? []).filter((item: any) =>
        (!item.starts_at || new Date(item.starts_at).getTime() <= now) &&
        (!item.ends_at || new Date(item.ends_at).getTime() > now || item.result_visibility === "public" || item.result_visibility === "after_end")
      );
      setCampaigns(active);
      if (userId && active.length) {
        const ids = active.map((item: any) => item.id);
        const { data: own } = await (supabase as any).from("app_campaign_responses").select("campaign_id,option_id").in("campaign_id", ids);
        const ownMap: Record<string, string> = {};
        for (const row of own ?? []) ownMap[row.campaign_id] = row.option_id;
        setResponses(ownMap);
        const resultPairs = await Promise.all(active.map(async (item: any) => {
          const { data } = await (supabase as any).from("app_campaign_option_results").select("option_id,vote_count").eq("campaign_id", item.id);
          return [item.id, data ?? []] as const;
        }));
        setResults(Object.fromEntries(resultPairs));
      }
    }
  }, [userId, placementKey]);

  useEffect(() => { void refresh(); }, [refresh]);

  const vote = async (campaign: any, optionId: string) => {
    const now = Date.now();
    const votingOpen = (!campaign.starts_at || new Date(campaign.starts_at).getTime() <= now) && (!campaign.ends_at || new Date(campaign.ends_at).getTime() > now);
    if (!votingOpen) return;
    if (!userId || responses[campaign.id] || voting) return;
    setVoting(campaign.id);
    const { error } = await (supabase as any).from("app_campaign_responses").insert({
      campaign_id: campaign.id, option_id: optionId, user_id: userId,
    });
    if (error) {
      Alert.alert("تعذر تسجيل المشاركة", error.code === "23505" ? "سبق وشاركت بهذا الاستطلاع." : error.message);
    } else {
      setResponses((current) => ({ ...current, [campaign.id]: optionId }));
      const { data } = await (supabase as any).from("app_campaign_option_results").select("option_id,vote_count").eq("campaign_id", campaign.id);
      setResults((current) => ({ ...current, [campaign.id]: data ?? [] }));
    }
    setVoting(null);
  };

  if (!sections.length && !campaigns.length) return null;
  return (
    <View style={{ gap: 12 }}>
      {sections.map((section) => {
        const config = section.published_config ?? {};
        if (section.section_type === "table") {
          const columns = Array.isArray(config.columns) ? config.columns : [];
          const rows = Array.isArray(config.rows) ? config.rows : [];
          return (
            <View key={section.id} style={{ borderRadius: 18, padding: 12, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line }}>
              <Text style={{ color: palette.ink, fontSize: 14, fontWeight: "900", textAlign: "right", marginBottom: 8 }}>{section.title}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator>
                <View>
                  {columns.length > 0 && <View style={{ flexDirection: "row", backgroundColor: palette.brand + "18", borderRadius: 8 }}>{columns.map((column: any, index: number) => <Text key={index} style={{ minWidth: 110, padding: 9, color: palette.ink, fontSize: 11, fontWeight: "900", textAlign: "center" }}>{String(column)}</Text>)}</View>}
                  {rows.map((row: any, rowIndex: number) => <View key={rowIndex} style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: palette.line }}>{(Array.isArray(row) ? row : []).map((cell: any, cellIndex: number) => <Text key={cellIndex} style={{ minWidth: 110, padding: 9, color: palette.ink, fontSize: 11, textAlign: "center" }}>{String(cell ?? "")}</Text>)}</View>)}
                </View>
              </ScrollView>
            </View>
          );
        }
        return (
          <View key={section.id} style={{ borderRadius: 18, padding: 14, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line }}>
            <Text style={{ color: palette.ink, fontSize: 14, fontWeight: "900", textAlign: "right" }}>{config.title || section.title}</Text>
            {!!config.description && <Text style={{ color: palette.muted, fontSize: 12, textAlign: "right", marginTop: 4 }}>{config.description}</Text>}
            {!!config.image_url && <Image source={{ uri: config.image_url }} style={{ width: "100%", height: 130, marginTop: 8, borderRadius: 12 }} resizeMode="cover" />}
          </View>
        );
      })}
      {campaigns.map((campaign) => {
        const options = [...(campaign.app_campaign_options ?? [])].sort((a: any, b: any) => a.sort_order - b.sort_order);
        const selected = responses[campaign.id];
        const counts = results[campaign.id] ?? [];
        const votingOpen = (!campaign.starts_at || new Date(campaign.starts_at).getTime() <= Date.now()) && (!campaign.ends_at || new Date(campaign.ends_at).getTime() > Date.now());
        const showResults = campaign.result_visibility === "public" || (campaign.result_visibility === "after_end" && !!campaign.ends_at && new Date(campaign.ends_at).getTime() <= Date.now());
        const total = counts.reduce((sum: number, row: any) => sum + Number(row.vote_count ?? 0), 0);
        return (
          <View key={campaign.id} style={{ borderRadius: 18, padding: 14, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ color: palette.brand, fontSize: 10, fontWeight: "900" }}>{campaign.campaign_type === "contest" ? "مسابقة" : "استطلاع رأي"}</Text>
              <Text style={{ color: palette.muted, fontSize: 10 }}>{total} مشاركة</Text>
            </View>
            <Text style={{ color: palette.ink, fontSize: 15, fontWeight: "900", textAlign: "right", marginTop: 5 }}>{campaign.title}</Text>
            {!!campaign.description && <Text style={{ color: palette.muted, fontSize: 12, textAlign: "right", marginTop: 3 }}>{campaign.description}</Text>}
            <View style={{ gap: 7, marginTop: 10 }}>
              {options.map((option: any) => {
                const count = Number(counts.find((row: any) => row.option_id === option.id)?.vote_count ?? 0);
                const percent = total > 0 ? Math.round((count / total) * 100) : 0;
                return (
                  <TouchableOpacity key={option.id} disabled={!userId || !!selected || voting === campaign.id || !votingOpen} onPress={() => void vote(campaign, option.id)} style={{ borderWidth: 1, borderColor: selected === option.id ? palette.brand : palette.line, borderRadius: 12, padding: 10 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={{ color: palette.ink, fontSize: 12, fontWeight: "800" }}>{option.label}</Text>
                      {showResults && <Text style={{ color: palette.brand, fontSize: 11, fontWeight: "900" }}>{percent}% · {count}</Text>}
                    </View>
                    {showResults && <View style={{ height: 5, backgroundColor: palette.line, borderRadius: 9, marginTop: 7, overflow: "hidden" }}><View style={{ height: 5, width: `${percent}%` as `${number}%`, backgroundColor: palette.brand, borderRadius: 9 }} /></View>}
                  </TouchableOpacity>
                );
              })}
            </View>
            {!userId && <Text style={{ color: palette.muted, fontSize: 10, textAlign: "right", marginTop: 8 }}>سجّل الدخول حتى تشارك.</Text>}
            {selected && <Text style={{ color: palette.brand, fontSize: 11, fontWeight: "800", textAlign: "right", marginTop: 8 }}>تم تسجيل مشاركتك.</Text>}
          </View>
        );
      })}
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
  dispatchClock,
}: {
  available: boolean;
  verified: boolean;
  verificationStatus: string;
  companyName: string;
  toggleAvailable: () => void;
  incoming: IncomingRequest[];
  dispatchClock: number;
}) {
  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 20 }}>
      <View
        style={[
          styles.availCard,
          available && styles.availCardActive,
          !verified && { opacity: 0.65 },
        ]}
      >
        {available && (
          <LinearGradient
            pointerEvents="none"
            colors={["#10B981", "#2DD4BF"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
        )}
        {available && <View pointerEvents="none" style={styles.availShine} />}
        <View style={styles.availContent}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.availEyebrow, available && { color: "rgba(255,255,255,0.82)" }]}>
              حالة التوفر
            </Text>
            <Text style={[styles.availTitle, available && { color: "#fff" }]}>
              {available ? "متاح للعمل" : "غير متاح"}
            </Text>
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={available ? "إيقاف استقبال الطلبات" : "تفعيل استقبال الطلبات"}
            accessibilityState={{ disabled: !verified }}
            disabled={!verified}
            onPress={toggleAvailable}
            activeOpacity={0.82}
            style={[styles.availPowerButton, available && styles.availPowerButtonActive]}
          >
            <Svg width={24} height={24} viewBox="0 0 24 24">
              <Path
                d="M12 2v10"
                stroke={available ? "#FFFFFF" : palette.muted}
                strokeWidth={2.2}
                strokeLinecap="round"
              />
              <Path
                d="M18.4 6.6a8 8 0 1 1-12.8 0"
                stroke={available ? "#FFFFFF" : palette.muted}
                strokeWidth={2.2}
                strokeLinecap="round"
                fill="none"
              />
            </Svg>
          </TouchableOpacity>
        </View>
      </View>
      <Text style={styles.sectionTitle}>الطلبات الواردة</Text>
      <Text style={styles.sectionSubTitle}>العروض الجديدة تظهر هنا أول ما توصلك</Text>
      {incoming.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>لا توجد طلبات حالياً</Text>
          <Text style={styles.emptySubtext}>سيظهر هنا عند وصول طلب جديد</Text>
        </View>
      ) : (
        incoming.map((req) => {
          const remaining = req.my_offer?.expires_at
            ? Math.max(0, Math.ceil((Date.parse(req.my_offer.expires_at) - dispatchClock) / 1000))
            : 0;
          const timeLabel = `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;
          const urgent = remaining <= 10;
          const urgentFlash = urgent && Math.floor(dispatchClock / 1000) % 2 === 0;
          return (
            <TouchableOpacity
              key={req.id}
              style={styles.requestCard}
              onPress={() => router.push({ pathname: "/request/[id]", params: { id: req.id } })}
              activeOpacity={0.85}
            >
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.requestCustomer}>طلب جديد · {req.type === "taxi" ? "سائق" : "فني"}</Text>
                {(req.service_urgency_enabled || req.large_vehicle_urgency_enabled || req.taxi_urgency_enabled || Number(req.urgency_multiplier ?? 1) > 1) && <Text style={{ color: "#B45309", fontSize: 11, fontWeight: "900", textAlign: "right" }}>⚡ طلب عاجل{Number(req.urgency_multiplier ?? 1) > 1 ? ` ×${req.urgency_multiplier}` : ""}</Text>}
                <Text style={styles.requestType}>
                  {req.vehicle_category === "large" ? `🚚 سيارة كبيرة — ${req.vehicle_type === "kia_passenger" ? "كيا ركاب" : req.vehicle_type === "bus" ? "باص" : "كيا حمل"}` : req.type === "taxi" ? "🚕 طلب سيارة" : "🔧 طلب خدمة"}
                </Text>
                {(req.service_urgency_enabled || req.large_vehicle_urgency_enabled || req.taxi_urgency_enabled) && <Text style={{ color: "#D97706", fontSize: 11, fontWeight: "900", textAlign: "right" }}>⚡ طلب مستعجل</Text>}
                {!!req.pickup_text && <Text style={{ color: palette.ink, fontSize: 11, textAlign: "right" }}>من: {req.pickup_text}</Text>}
                {!!req.dest_text && <Text style={{ color: palette.muted, fontSize: 11, textAlign: "right" }}>إلى: {req.dest_text}</Text>}
                {req.my_offer?.distance_km != null && <Text style={{ color: palette.muted, fontSize: 11, textAlign: "right" }}>تبعد عنك {Number(req.my_offer.distance_km).toFixed(1)} كم</Text>}
                <Text style={styles.requestPrice}>
                  {(req.customer_price ?? req.customer_payable ?? req.price_estimate) != null ? `${Number(req.customer_price ?? req.customer_payable ?? req.price_estimate).toLocaleString("en")} د.ع` : req.vehicle_category === "large" ? "بانتظار عروض الأسعار" : "السعر قيد التحديد"}
                </Text>
                <Text style={{ color: urgentFlash ? "#dc2626" : palette.muted, fontSize: 10, fontWeight: "900", textAlign: "right" }}>
                  {urgent ? "انتبه، ينتهي العرض الآن" : "ينتهي العرض خلال"}
                </Text>
              </View>
              <View style={{ width: 62, height: 62, borderRadius: 31, borderWidth: 5, borderColor: urgentFlash ? "#dc2626" : palette.gold, alignItems: "center", justifyContent: "center", backgroundColor: palette.surface }}>
                <Text style={{ color: urgentFlash ? "#dc2626" : palette.ink, fontSize: 14, fontWeight: "900", fontVariant: ["tabular-nums"] }}>{timeLabel}</Text>
                <Text style={{ color: palette.muted, fontSize: 8, fontWeight: "800" }}>قبول</Text>
              </View>
              <Text style={styles.requestArrow}>←</Text>
            </TouchableOpacity>
          );
        })
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
  availCard: { minHeight: 104, borderRadius: 24, padding: 20, marginBottom: 24, overflow: "hidden", backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, shadowColor: "#08101A", shadowOpacity: 0.10, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  availCardActive: { backgroundColor: "transparent", borderColor: "transparent" },
  availShine: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(255,255,255,0.08)" },
  availContent: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 },
  availEyebrow: { color: palette.muted, fontSize: 12, lineHeight: 17, fontWeight: "700", textAlign: "right" },
  availTitle: { fontSize: 18, lineHeight: 25, fontWeight: "900", color: palette.ink, marginTop: 2, textAlign: "right" },
  availPowerButton: { width: 56, height: 56, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: palette.surfaceSoft },
  availPowerButtonActive: { backgroundColor: "rgba(255,255,255,0.25)" },
  emptyBox: { alignItems: "center", paddingVertical: 36, backgroundColor: palette.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: palette.line },
  emptyText: { fontSize: 15, fontWeight: "800", color: palette.ink },
  emptySubtext: { fontSize: 12, color: palette.muted, marginTop: 6 },
  requestCard: { flexDirection: "row", alignItems: "center", backgroundColor: palette.surface, borderRadius: radius.lg, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: palette.line },
  requestCustomer: { fontSize: 15, fontWeight: "900", color: palette.ink },
  requestType: { fontSize: 12, color: palette.muted, marginTop: 5 },
  requestPrice: { fontSize: 14, fontWeight: "900", color: palette.brand, marginTop: 7 },
  requestArrow: { fontSize: 23, color: palette.gold },
});
