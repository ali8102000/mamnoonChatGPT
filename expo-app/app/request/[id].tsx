import { useState, useEffect, useCallback, useRef } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Linking } from "react-native";
import {
  View,
  Text,
  Image,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import MapView, { AnimatedRegion, Marker, Polyline } from "react-native-maps";
import { LinearGradient } from "expo-linear-gradient";
import { SvgUri } from "react-native-svg";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import { getNotificationChannelId, loadNotificationPreferences } from "@/lib/notification-sound";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import service_build from "../../assets/services/build.jpg";
import service_plaster from "../../assets/services/plaster.jpg";
import service_carpentry_form from "../../assets/services/carpentry_form.jpg";
import service_flooring from "../../assets/services/flooring.jpg";
import service_chef from "../../assets/services/chef.jpg";
import service_plumbing from "../../assets/services/plumbing.jpg";
import service_electric_setup from "../../assets/services/electric_setup.jpg";
import service_electric_street from "../../assets/services/electric_street.jpg";
import service_washer_repair from "../../assets/services/washer_repair.jpg";
import service_stove_repair from "../../assets/services/stove_repair.jpg";
import service_fridge_repair from "../../assets/services/fridge_repair.jpg";
import service_ac_repair from "../../assets/services/ac_repair.jpg";
import service_cleaning from "../../assets/services/cleaning.jpg";
import service_wood_carpentry from "../../assets/services/wood_carpentry.jpg";
import service_blacksmith from "../../assets/services/blacksmith.jpg";
import service_general from "../../assets/services/general.jpg";
import service_goods_transport from "../../assets/services/goods_transport.jpg";
import service_cargo_handling from "../../assets/services/cargo_handling.jpg";
import service_computer_repair from "../../assets/services/computer_repair.jpg";
import service_electronics_repair from "../../assets/services/electronics_repair.jpg";
import service_furniture_moving from "../../assets/services/furniture_moving.jpg";
import service_gardener from "../../assets/services/gardener.jpg";
import service_internet_install from "../../assets/services/internet_install.jpg";
import service_phone_repair from "../../assets/services/phone_repair.jpg";
import service_security_cameras from "../../assets/services/security_cameras.jpg";
import { palette, radius } from "@/styles/theme";
import { callMamnoonMapsApi } from "@/lib/maps-api";
import { showContactOptions } from "@/lib/contact-actions";

const QUICK_REPLIES_CUSTOMER = ["وصلت!", "كم دقيقة؟", "أين أنت؟", "شكراً جزيلاً", "هل أنت قريب؟"];
function normalizeCashDigits(value: string) {
  return value
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[^0-9]/g, "");
}

const QUICK_REPLIES_PROVIDER = [
  "قادم إليك",
  "وصلت للموقع",
  "بانتظارك",
  "تم الإنجاز",
  "دقيقة واحدة",
];
const SERVICE_IMAGES: Record<string, number> = {
  build: service_build,
  plaster: service_plaster,
  carpentry_form: service_carpentry_form,
  flooring: service_flooring,
  chef: service_chef,
  plumbing: service_plumbing,
  electric_setup: service_electric_setup,
  electric_street: service_electric_street,
  washer_repair: service_washer_repair,
  stove_repair: service_stove_repair,
  fridge_repair: service_fridge_repair,
  ac_repair: service_ac_repair,
  cleaning: service_cleaning,
  wood_carpentry: service_wood_carpentry,
  blacksmith: service_blacksmith,
  general: service_general,
}

type Coordinates = { latitude: number; longitude: number; heading?: number | null; updatedAt?: string };
type RequestRecord = {
  id: string;
  request_code?: string | null;
  urgency_multiplier?: number | null;
  urgency_percent?: number | null;
  provider_id: string | null;
  customer_id: string;
  status: string;
  type: string;
  pickup_text: string;
  dest_text: string | null;
  price_estimate: number | null;
  customer_payable?: number | null;
  payment_method?: string | null;
  customer_price: number | null;
  cash_change_iqd?: number | null;
  pricing_mode: string | null;
  work_hours: number | null;
  work_description: string | null;
  workers_count: number | null;
  services: { name_ar: string; slug: string } | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dest_lat: number | null;
  dest_lng: number | null;
  vehicle_category?: string | null;
  vehicle_type?: string | null;
  notes?: string | null;
  attachment_path?: string | null;
  created_at?: string;
  searching_started_at?: string | null;
  provider_arrived_at?: string | null;
  cancellation_reason?: string | null;
  distance_km?: number | null;
  taxi_urgency_enabled?: boolean;
  taxi_urgency_percent?: number | null;
};
type ChatMessage = {
  id: string;
  chat_id: string;
  sender_id: string;
  content: string;
  created_at: string;
};


function TaxiCarMarker({ coordinate, heading, imageSource, imageUri }: { coordinate: Coordinates; heading?: number | null; imageSource?: any; imageUri?: string }) {
  const animatedCoordinate = useRef(new AnimatedRegion(coordinate)).current;
  const lastCoordinateRef = useRef(coordinate);
  const rotation = useSharedValue(Number.isFinite(heading) ? Number(heading) : 0);

  useEffect(() => {
    // Interpolate every real GPS update on both Android and iOS instead of jumping.
    animatedCoordinate.timing({
      latitude: coordinate.latitude,
      longitude: coordinate.longitude,
      duration: 1200,
      useNativeDriver: false,
    } as any).start();
  }, [coordinate.latitude, coordinate.longitude, animatedCoordinate]);

  useEffect(() => {
    const previous = lastCoordinateRef.current;
    const movedMeters = Math.hypot(
      (coordinate.latitude - previous.latitude) * 111320,
      (coordinate.longitude - previous.longitude) * 111320 * Math.cos(coordinate.latitude * Math.PI / 180),
    );
    let nextHeading = heading != null && Number.isFinite(heading) ? Number(heading) : null;
    if (nextHeading == null && movedMeters > 1.5) {
      const p1 = previous.latitude * Math.PI / 180;
      const p2 = coordinate.latitude * Math.PI / 180;
      const dl = (coordinate.longitude - previous.longitude) * Math.PI / 180;
      const y = Math.sin(dl) * Math.cos(p2);
      const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
      nextHeading = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    }
    lastCoordinateRef.current = coordinate;
    if (nextHeading == null) return;
    const current = rotation.value;
    const delta = ((nextHeading - current + 540) % 360) - 180;
    rotation.value = withTiming(current + delta, {
      duration: 700,
      easing: Easing.out(Easing.cubic),
    });
  }, [coordinate.latitude, coordinate.longitude, heading, rotation]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <Marker.Animated
      coordinate={animatedCoordinate as any}
      flat
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges
    >
      <Animated.View style={[styles.luxuryCarMarker, animatedStyle]}>
        {imageUri ? <SvgUri uri={imageUri} width={32} height={24} /> : <Image source={imageSource ?? { uri: "https://raw.githubusercontent.com/ali8102000/mamnoonChatGPT/main/src/assets/car-luxury.png" }} style={styles.luxuryCarPhoto} resizeMode="contain" />}
      </Animated.View>
    </Marker.Animated>
  );
}


function LocationTargetMarker({ coordinate, title }: { coordinate: Coordinates; title: string }) {
  return (
    <Marker coordinate={coordinate} title={title} anchor={{ x: 0.5, y: 1 }}>
      <View style={styles.endpointPin}>
        <View style={styles.endpointPinCore}><View style={styles.endpointPinDot} /></View>
      </View>
    </Marker>
  );
}

function ServicePhotoMarker({ coordinate, imageSource, title }: { coordinate: Coordinates; imageSource: any; title: string }) {
  return (
    <Marker coordinate={coordinate} title={title} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
      <View style={styles.requestPhotoMarker}>
        <Image source={imageSource} style={styles.requestPhotoMarkerImage} resizeMode="cover" />
      </View>
    </Marker>
  );
}

function DestinationMarker({ coordinate }: { coordinate: Coordinates }) {
  return (
    <Marker coordinate={coordinate} title="وجهة الوصول" anchor={{ x: 0.5, y: 1 }}>
      <LinearGradient
        colors={["#F04444", "#C62828", "#671818"]}
        locations={[0, 0.55, 1]}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.85, y: 1 }}
        style={styles.destinationPin}
      >
        <View style={styles.destinationPinCore}>
          <View style={styles.destinationPinDot} />
        </View>
      </LinearGradient>
    </Marker>
  );
}

export default function RequestDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, roles } = useAuth();
  const [request, setRequest] = useState<RequestRecord | null>(null);
  const [attachmentUrl, setAttachmentUrl] = useState<string | null>(null);
  const [otherProfile, setOtherProfile] = useState<{ full_name: string | null; avatar_url: string | null; phone: string | null } | null>(null);
  const [vehicleDetails, setVehicleDetails] = useState<any>(null);
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [vibrationEnabled, setVibrationEnabled] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [largeOffers, setLargeOffers] = useState<any[]>([]);
  const [myLargeOffer, setMyLargeOffer] = useState<any>(null);
  const [largeOfferPrice, setLargeOfferPrice] = useState("");
  const [largeOfferMessage, setLargeOfferMessage] = useState("");
  const [largeOfferBusy, setLargeOfferBusy] = useState(false);
  const [acceptingLargeOffer, setAcceptingLargeOffer] = useState<string | null>(null);
  const [acceptingLargeRequest, setAcceptingLargeRequest] = useState(false);
  const [retryingLargeOffers, setRetryingLargeOffers] = useState(false);
  const [chatId, setChatId] = useState<string | null>(null);
  const [myLocation, setMyLocation] = useState<Coordinates | null>(null);
  const [otherLocation, setOtherLocation] = useState<Coordinates | null>(null);
  const [providerRoutePoints, setProviderRoutePoints] = useState<Coordinates[]>([]);
  const [roadRoutePoints, setRoadRoutePoints] = useState<Coordinates[]>([]);
  const [roadTrafficSegments, setRoadTrafficSegments] = useState<{ startIndex: number; endIndex: number; speed: string }[]>([]);
  const [nextRouteInstruction, setNextRouteInstruction] = useState<string | null>(null);
  const [liveRouteSource, setLiveRouteSource] = useState<string | null>(null);
  const acceptedMapRef = useRef<MapView | null>(null);
  const acceptedMapFitKeyRef = useRef<string | null>(null);
  const roadRouteSequenceRef = useRef(0);
  const hasValidRoadRouteRef = useRef(false);
  const lastRoadRouteRequestRef = useRef<{ routeKey: string; latitude: number; longitude: number; requestedAt: number } | null>(null);
  const lastRoutePointRef = useRef<{ latitude: number; longitude: number; timestamp: number } | null>(null);
  const [driverEtaMinutes, setDriverEtaMinutes] = useState<number | null>(null);
  const [freshnessClock, setFreshnessClock] = useState(Date.now());
  const lastEtaRequestRef = useRef<{ latitude: number; longitude: number; requestedAt: number } | null>(null);
  const etaSequenceRef = useRef(0);
  const [newMsg, setNewMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [rating, setRating] = useState(0);
  const [ratingCriteria, setRatingCriteria] = useState({ professionalism: 0, punctuality: 0, quality: 0 });
  const [ratingReasons, setRatingReasons] = useState<string[]>([]);
  const [ratingComment, setRatingComment] = useState("");
  const [showRating, setShowRating] = useState(false);
  const [ratingBusy, setRatingBusy] = useState(false);
  const [showCancelSheet, setShowCancelSheet] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelOtherReason, setCancelOtherReason] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const [showReportForm, setShowReportForm] = useState(false);
  const [reportReason, setReportReason] = useState("مشكلة أثناء الرحلة أو الخدمة");
  const [reportDetails, setReportDetails] = useState("");
  const [reportBusy, setReportBusy] = useState(false);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [transitionBusy, setTransitionBusy] = useState(false);
  const [cashSettlementOpen, setCashSettlementOpen] = useState(false);
  const [cashReceivedInput, setCashReceivedInput] = useState("");
  const [paymentGatewayEnabled, setPaymentGatewayEnabled] = useState(false);
  const [dispatchClock, setDispatchClock] = useState(Date.now());
  const [urgencyAllowed, setUrgencyAllowed] = useState(false);
  const [urgencyAdminPercent, setUrgencyAdminPercent] = useState(0);
  const [urgencyBusy, setUrgencyBusy] = useState(false);
  const countdownNotificationIdRef = useRef<string | null>(null);
  const [retryPriceIncrease, setRetryPriceIncrease] = useState("0");
  const [retryingDispatch, setRetryingDispatch] = useState(false);
  const [taxiUrgencyBusy, setTaxiUrgencyBusy] = useState(false);
  const [activeOffer, setActiveOffer] = useState<any>(null);
  const [serviceProviders, setServiceProviders] = useState<any[]>([]);
  const scrollRef = useRef<ScrollView>(null);
  const weeklyRatingNoticeRef = useRef<string | null>(null);
  const isProvider = request?.provider_id === user?.id || serviceProviders.some((member) => member.provider_id === user?.id);
  const isCustomer = request?.customer_id === user?.id;
  const canAccept = Boolean(
    request &&
    (request.type === "service" ? Boolean(activeOffer) : !request.provider_id) &&
    request.customer_id !== user?.id &&
    ((request.type === "taxi" && (request.vehicle_category === "large" ? roles.includes("large_driver") : roles.includes("driver")) ) ||
      (request.type === "service" && roles.includes("worker"))),
  );
  const isActive = request?.status === "in_progress" || request?.status === "accepted";
  const acceptedMapMode = Boolean(
    request && (isProvider || isCustomer) && isActive &&
    (request.type === "taxi" || request.type === "service")
  );
  const providerLiveLocation = isCustomer ? otherLocation : myLocation;
  const driverLocationFresh = Boolean(providerLiveLocation?.updatedAt && Number.isFinite(Date.parse(providerLiveLocation.updatedAt)) && freshnessClock - Date.parse(providerLiveLocation.updatedAt) < 25000);
  const currentUserId = user?.id;
  useEffect(() => {
    lastRoutePointRef.current = null;
    lastRoadRouteRequestRef.current = null;
    hasValidRoadRouteRef.current = false;
    setRoadRoutePoints([]);
    setRoadTrafficSegments([]);
    setNextRouteInstruction(null);
    setLiveRouteSource(null);
  }, [id, currentUserId]);
  const currentRequestType = request?.type;
  const currentProviderId = request?.provider_id;
  const currentCustomerId = request?.customer_id;
  const activeOfferSeconds = activeOffer?.expires_at
    ? Math.max(0, Math.ceil((Date.parse(activeOffer.expires_at) - dispatchClock) / 1000))
    : null;
  const urgentOfferFlash = activeOfferSeconds !== null && activeOfferSeconds <= 10 && activeOfferSeconds % 2 === 0;

  const openTaxiNavigation = useCallback((app: "google" | "waze" | "darbuna") => {
    if (!request) return;
    const customerTaxiDestination = request.type === "taxi" && isCustomer &&
      request.dest_lat != null && request.dest_lng != null;
    const targetLat = customerTaxiDestination ? request.dest_lat : request.pickup_lat;
    const targetLng = customerTaxiDestination ? request.dest_lng : request.pickup_lng;
    if (targetLat == null || targetLng == null) {
      Alert.alert("تحديد المسار", customerTaxiDestination ? "إحداثيات الوجهة غير متوفرة لهذا الطلب." : "إحداثيات موقع الزبون أو موقع العمل غير متوفرة لهذا الطلب.");
      return;
    }
    const latitude = Number(targetLat);
    const longitude = Number(targetLng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      Alert.alert("تحديد المسار", "إحداثيات الموقع غير صحيحة.");
      return;
    }

    const destination = `${latitude},${longitude}`;
    const url = app === "google"
      ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving&dir_action=navigate`
      : app === "waze"
        ? `https://waze.com/ul?ll=${encodeURIComponent(destination)}&navigate=yes`
        : `https://map.darbuna.app/pin/${latitude},${longitude},17z`;

    void Linking.openURL(url).catch((error) => {
      console.warn("[taxi navigation] unable to open navigation app:", error);
      Alert.alert("تعذر فتح المسار", "تعذر فتح التطبيق المحدد. تأكد من تثبيته واتصال الإنترنت ثم حاول مرة ثانية.");
    });
  }, [request?.type, request?.pickup_lat, request?.pickup_lng, request?.dest_lat, request?.dest_lng, isCustomer]);

  const showTaxiNavigationOptions = useCallback(() => {
    Alert.alert("تحديد المسار", request?.type === "service" ? "اختَر التطبيق لفتح مسار موقع العمل." : "اختَر التطبيق لفتح مسار الزبون أو الوجهة.", [
      { text: "خرائط Google", onPress: () => openTaxiNavigation("google") },
      { text: "Waze", onPress: () => openTaxiNavigation("waze") },
      { text: "دربونة", onPress: () => openTaxiNavigation("darbuna") },
      { text: "إلغاء", style: "cancel" },
    ]);
  }, [openTaxiNavigation, request?.type]);

  useEffect(() => { void loadNotificationPreferences().then((preferences) => { setSoundEnabled(preferences.soundEnabled); setVibrationEnabled(preferences.vibrationEnabled); }); }, []);
  useEffect(() => {
    let active = true;
    void (async () => {
      const { data, error } = await (supabase as any).from("taxi_pricing_controls")
        .select("urgency_enabled,urgency_max_percent").eq("governorate_key","all").maybeSingle();
      if (!active || error) return;
      setUrgencyAllowed(Boolean(data?.urgency_enabled) && Number(data?.urgency_max_percent) > 0);
      setUrgencyAdminPercent(Number(data?.urgency_max_percent) || 0);
    })();
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!request || !isCustomer || !["pending","searching"].includes(request.status)) return;
    let active = true;
    void (async () => {
      const start = Date.parse(request.searching_started_at || request.created_at || new Date().toISOString());
      const totalSeconds = 360 * (request.type === "service" ? Math.max(1, Number(request.workers_count) || 1) : 1);
      const remaining = Math.max(0, totalSeconds - Math.floor((Date.now() - start) / 1000));
      if (remaining <= 0) return;
      const preferences = await loadNotificationPreferences();
      if (!active || !preferences.soundEnabled) return;
      const seconds = Math.max(1, remaining - 10);
      const notificationId = await Notifications.scheduleNotificationAsync({
        content: {
          title: "تنبيه انتهاء البحث",
          body: "باقي ١٠ ثوانٍ على انتهاء وقت البحث عن مزوّد لطلبك.",
          sound: "default",
          data: { request_id: request.id, type: "request_countdown" },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds,
          channelId: getNotificationChannelId(preferences.soundEnabled, preferences.vibrationEnabled),
        },
      });
      if (active) countdownNotificationIdRef.current = notificationId;
      else await Notifications.cancelScheduledNotificationAsync(notificationId).catch(() => {});
    })().catch((error) => console.warn("[request-countdown] notification scheduling failed:", error));
    return () => {
      active = false;
      const notificationId = countdownNotificationIdRef.current;
      countdownNotificationIdRef.current = null;
      if (notificationId) void Notifications.cancelScheduledNotificationAsync(notificationId).catch(() => {});
    };
  }, [request?.id, request?.status, request?.searching_started_at, request?.created_at, request?.type, request?.workers_count, isCustomer]);


  useEffect(() => {
    const timer = setInterval(() => setFreshnessClock(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const timer = setInterval(() => setDispatchClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const loadRequest = useCallback(async () => {
    const { data, error } = await supabase
      .from("service_requests")
      .select(
        "id, provider_id, customer_id, status, type, pickup_text, dest_text, price_estimate, customer_payable, payment_method, customer_price, pricing_mode, work_hours, work_description, workers_count, taxi_urgency_enabled, taxi_urgency_percent, services(name_ar, slug), pickup_lat, pickup_lng, dest_lat, dest_lng, vehicle_category, vehicle_type, notes, attachment_path, created_at, searching_started_at, provider_arrived_at, cancellation_reason, distance_km, urgency_base_price, urgency_multiplier, urgency_percent, urgency_amount, staffing_search_paused_at, cash_change_iqd",
      )
      .eq("id", id)
      .maybeSingle();
    if (error) {
      setRequest(null);
      setLoading(false);
      return;
    }
    let requestCode: string | null = null;
    if (data?.id) {
      const { data: codeRow } = await (supabase as any).from("service_requests").select("request_code").eq("id", id).maybeSingle();
      requestCode = (codeRow as any)?.request_code ?? null;
    }
    setRequest(data ? ({ ...data, request_code: requestCode } as unknown as RequestRecord) : null);
    // Render the core request before optional offers, attachments and payment status finish loading.
    setLoading(false);
    if (data?.type === "service") {
      setServiceProviders([]);
      const { data: members, error: membersError } = await (supabase as any)
        .from("service_request_providers")
        .select("provider_id,team_size,accepted_at")
        .eq("request_id", id)
        .order("accepted_at", { ascending: true });
      if (!membersError) setServiceProviders(members ?? []);
    } else {
      setServiceProviders([]);
    }
    if (data && user?.id && data.customer_id !== user.id) {
      const { data: ownOffer } = await (supabase as any)
        .from("request_offers")
        .select("id, expires_at, sent_at, distance_km, proposed_price, status")
        .eq("request_id", id)
        .eq("provider_id", user.id)
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
      setActiveOffer(ownOffer ?? null);
    } else {
      setActiveOffer(null);
    }
    if (data?.attachment_path) {
      const { data: signedAttachment, error: attachmentError } = await supabase.storage
        .from("request-attachments")
        .createSignedUrl(data.attachment_path, 60 * 60);
      if (attachmentError) {
        console.warn("[request attachment] signed URL unavailable:", attachmentError.message);
        setAttachmentUrl(null);
      } else {
        setAttachmentUrl(signedAttachment?.signedUrl ?? null);
      }
    } else {
      setAttachmentUrl(null);
    }
    if (data?.type === "taxi" && data.provider_id) {
      const { data: vehicle } = await (supabase as any).from("provider_vehicle_public").select("vehicle_make, vehicle_model, vehicle_year, vehicle_color, vehicle_plate").eq("provider_id", data.provider_id).maybeSingle();
      setVehicleDetails(vehicle ?? null);
    } else { setVehicleDetails(null); }
    if (data?.status === "completed" && user?.id && data.provider_id && data.customer_id) {
      const { data: existingRating } = await supabase.from("ratings").select("id").eq("request_id", id).eq("rater_id", user.id).maybeSingle();
      if (existingRating) {
        setShowRating(false);
      } else {
        const rateeId = data.provider_id === user.id ? data.customer_id : data.provider_id;
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const { data: weeklyRating } = await (supabase as any).from("ratings").select("id").eq("rater_id", user.id).eq("ratee_id", rateeId).gte("created_at", weekAgo).limit(1).maybeSingle();
        setShowRating(!weeklyRating);
        if (weeklyRating && weeklyRatingNoticeRef.current !== rateeId) {
          weeklyRatingNoticeRef.current = rateeId;
          Alert.alert("التقييم", "لقد تم تقييم هذا الشخص من قبلك خلال آخر 7 أيام.");
        }
      }
    } else {
      setShowRating(false);
    }
    const {data:gatewayStatus,error:gatewayStatusError}=await supabase.functions.invoke("zaincash-config-status",{body:{}});
    setPaymentGatewayEnabled(!gatewayStatusError&&gatewayStatus?.ready===true);
    if (data?.vehicle_category === "large") {
      if (data.customer_id === user?.id && ["pending", "searching"].includes(data.status)) {
        const { data: bids } = await (supabase as any)
          .from("request_offers")
          .select("id, provider_id, proposed_price, offer_message, sent_at")
          .eq("request_id", id)
          .eq("status", "pending")
          .gt("expires_at", new Date().toISOString())
          .not("proposed_price", "is", null)
          .order("sent_at", { ascending: false });
        const providerIds: string[] = [...new Set<string>((bids ?? []).map((bid: any) => String(bid.provider_id)))];
        const { data: profiles } = providerIds.length
          ? await supabase.from("profiles").select("id, full_name, phone, avatar_url").in("id", providerIds)
          : { data: [] };
        const byId = new Map((profiles ?? []).map((profile: any) => [profile.id, profile]));
        setLargeOffers((bids ?? []).map((bid: any) => ({ ...bid, profile: byId.get(bid.provider_id) ?? null })));
      } else {
        setLargeOffers([]);
      }
      if ((data.vehicle_category === "large" ? roles.includes("large_driver") : roles.includes("driver")) && data.customer_id !== user?.id) {
        const { data: ownOffer } = await (supabase as any)
          .from("request_offers")
          .select("id, proposed_price, offer_message, status")
          .eq("request_id", id)
          .eq("provider_id", user?.id)
          .maybeSingle();
        setMyLargeOffer(ownOffer ?? null);
        if (ownOffer?.proposed_price) setLargeOfferPrice(String(ownOffer.proposed_price));
        if (ownOffer?.offer_message) setLargeOfferMessage(ownOffer.offer_message);
      }
    } else {
      setLargeOffers([]);
      setMyLargeOffer(null);
    }
    setLoading(false);
  }, [id, user?.id, roles]);

  useEffect(() => {
    const otherId = request && ["accepted", "in_progress", "completed"].includes(request.status)
      ? request.customer_id === user?.id
        ? request.provider_id
        : request.customer_id
      : null;
    if (!otherId) {
      setOtherProfile(null);
      return;
    }
    let active = true;
    supabase
      .from("profiles")
      .select("full_name, avatar_url, phone")
      .eq("id", otherId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (active) setOtherProfile(error ? null : data);
      });
    return () => { active = false; };
  }, [request?.customer_id, request?.provider_id, request?.status, user?.id]);

  const loadChat = useCallback(async () => {
    if (!request || ["completed", "cancelled"].includes(request.status)) { setChatId(null); setMessages([]); return; }
    const { data, error } = await supabase
      .from("chats")
      .select("id")
      .eq("request_id", id)
      .maybeSingle();
    if (error) {
      setChatId(null);
      return;
    }
    setChatId(data?.id ?? null);
  }, [id, request?.status]);

  const loadMessages = useCallback(async () => {
    if (!chatId) {
      setMessages([]);
      return;
    }
    const { data, error } = await supabase
      .from("messages")
      .select("id, chat_id, sender_id, content, created_at, sender:profiles(full_name)")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: true });
    if (!error) setMessages((data ?? []) as ChatMessage[]);
  }, [chatId]);

  useEffect(() => { setAvatarLoadFailed(false); }, [otherProfile?.avatar_url]);

  useEffect(() => {
    loadRequest();
    loadChat();
    const sub = supabase
      .channel(`request-${id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "service_requests", filter: `id=eq.${id}` },
        (payload) => {
          const nextStatus = (payload.new as { status?: string }).status;
          void loadRequest();
          if (nextStatus === "accepted") loadChat();
          if (nextStatus === "completed" || nextStatus === "cancelled") { setChatId(null); setMessages([]); setOtherProfile(null); setOtherLocation(null); }
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "request_offers", filter: `request_id=eq.${id}` },
        () => { void loadRequest(); },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "service_request_providers", filter: `request_id=eq.${id}` },
        () => { void loadRequest(); },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(sub);
    };
  }, [id, loadRequest, loadChat]);

  useEffect(() => {
    if (!chatId) return;
    const sub = supabase
      .channel(`chat-${chatId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `chat_id=eq.${chatId}` },
        (payload) => {
          const incoming = payload.new as ChatMessage;
          if (incoming.sender_id !== user?.id) {
            void Notifications.scheduleNotificationAsync({
              content: {
                title: "رسالة جديدة في ممنون",
                body: "وصلتك رسالة جديدة من الطرف الآخر",
                sound: soundEnabled ? "default" : false,
                data: { request_id: id },
              },
              trigger: Platform.OS === "android" ? {
                type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
                seconds: 1,
                channelId: getNotificationChannelId(soundEnabled, vibrationEnabled),
              } : null,
            }).catch((error) => console.warn("[messages] local notification failed:", error));
          }
          void loadMessages();
        },
      )
      .subscribe();
    loadMessages();
    return () => {
      supabase.removeChannel(sub);
    };
  }, [chatId, loadMessages, user?.id, id, soundEnabled, vibrationEnabled]);

  useEffect(() => {
    if (!isActive || !currentUserId) return;
    let mounted = true;
    let subscription: Location.LocationSubscription | null = null;
    const role = isCustomer ? "customer" : "provider";

    const publishLocation = async (location: Location.LocationObject) => {
      if (!mounted) return;
      const latitude = location.coords.latitude;
      const longitude = location.coords.longitude;
      const timestamp = new Date(location.timestamp || Date.now()).toISOString();
      const coords: Coordinates = {
        latitude,
        longitude,
        heading: location.coords.heading,
        updatedAt: timestamp,
      };
      setMyLocation(coords);

      const { error } = await supabase.from("live_locations").upsert({
        request_id: id,
        user_id: currentUserId,
        role,
        lat: latitude,
        lng: longitude,
        heading: location.coords.heading,
        updated_at: timestamp,
      }, { onConflict: "request_id,user_id" });
      if (error) {
        console.warn("[Mamnoon] live location update failed:", error.message);
        return;
      }

      // Keep a useful provider breadcrumb without writing every noisy GPS sample.
      if (role === "provider" && Number.isFinite(location.coords.accuracy) && Number(location.coords.accuracy) <= 100) {
        const previous = lastRoutePointRef.current;
        const elapsed = previous ? Date.now() - previous.timestamp : Number.POSITIVE_INFINITY;
        const distance = previous
          ? Math.hypot(
              (latitude - previous.latitude) * 111320,
              (longitude - previous.longitude) * 111320 * Math.cos(latitude * Math.PI / 180),
            )
          : Number.POSITIVE_INFINITY;
        if (!previous || distance >= 8 || elapsed >= 10000) {
          lastRoutePointRef.current = { latitude, longitude, timestamp: Date.now() };
          const { error: pointError } = await supabase.from("trip_location_points").insert({
            request_id: id,
            user_id: currentUserId,
            role: "provider",
            lat: latitude,
            lng: longitude,
            heading: location.coords.heading,
            accuracy_m: location.coords.accuracy,
            recorded_at: timestamp,
          });
          if (pointError) console.warn("[Mamnoon] route point insert failed:", pointError.message);
        }
      }
    };

    void (async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== "granted") throw new Error("foreground_location_denied");

        const first = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        if (!mounted) return;
        await publishLocation(first);

        // Foreground GPS tracking must work even when Android's optional
        // background permission is denied.
        subscription = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, timeInterval: 4000, distanceInterval: 5 },
          (location) => { void publishLocation(location); },
        );

        const { startMamnoonBackgroundLocation } = await import("@/lib/background-location");
        try {
          await startMamnoonBackgroundLocation({ requestId: id, userId: currentUserId, role });
        } catch (backgroundError: any) {
          console.warn("[Mamnoon] background tracking unavailable; foreground tracking remains active:", backgroundError);
          if (mounted && backgroundError?.message === "background_location_denied") {
            Alert.alert(
              "استمرار مشاركة الموقع",
              "الموقع المباشر يعمل والتطبيق مفتوح. حتى يستمر إذا صغّرت ممنون، فعّل إذن الموقع طوال الوقت من إعدادات التطبيق.",
            );
          }
        }
      } catch (error: any) {
        if (!mounted) return;
        const message = error?.message === "foreground_location_denied"
          ? "اسمح لممنون بالوصول إلى الموقع حتى نعرض موقعك للطرف الآخر."
          : "تعذر تشغيل تحديد الموقع. تحقق من أذونات الموقع وGPS وحاول مرة أخرى.";
        Alert.alert("مشاركة الموقع", message);
      }
    })();

    return () => {
      mounted = false;
      subscription?.remove();
    };
  }, [id, isActive, isCustomer, currentUserId]);

  useEffect(() => {
    if (isActive) return;
    void import("@/lib/background-location")
      .then(({ stopMamnoonBackgroundLocation }) => stopMamnoonBackgroundLocation())
      .catch((error) => console.warn("[Mamnoon] could not stop background location:", error));
  }, [isActive, id]);

  useEffect(() => {
    if (!isActive || !currentUserId) {
      setOtherLocation(null);
      return;
    }
    const otherId = isCustomer ? currentProviderId : currentCustomerId;
    if (!otherId) return;

    supabase
      .from("live_locations")
.select("user_id, lat, lng, heading, updated_at")
      .eq("request_id", id)
      .eq("user_id", otherId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setOtherLocation({ latitude: data.lat, longitude: data.lng, heading: data.heading, updatedAt: data.updated_at });
      });

    const channel = supabase
      .channel(`locations-${id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "live_locations",
          filter: `request_id=eq.${id}`,
        },
        (payload) => {
          const row = payload.new as { user_id?: string; lat?: number; lng?: number; heading?: number | null; updated_at?: string };
          if (
            row.user_id === otherId &&
            typeof row.lat === "number" &&
            typeof row.lng === "number"
          ) {
            setOtherLocation({ latitude: row.lat, longitude: row.lng, heading: row.heading, updatedAt: row.updated_at });
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [
    id,
    isActive,
    isCustomer,
    currentRequestType,
    currentProviderId,
    currentCustomerId,
    currentUserId,
  ]);

  useEffect(() => {
    if (!isActive || !currentUserId) {
      setProviderRoutePoints([]);
      return;
    }
    let stillCurrent = true;
    supabase
      .from("trip_location_points")
      .select("lat,lng,recorded_at")
      .eq("request_id", id)
      .eq("role", "provider")
      .order("recorded_at", { ascending: true })
      .limit(1200)
      .then(({ data, error }) => {
        if (error) {
          console.warn("[Mamnoon] route history read failed:", error.message);
          return;
        }
        if (stillCurrent && data) {
          setProviderRoutePoints(data.map((point) => ({
            latitude: point.lat,
            longitude: point.lng,
          })));
        }
      });

    const channel = supabase
      .channel(`trip-route-${id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "trip_location_points",
          filter: `request_id=eq.${id}`,
        },
        (payload) => {
          const point = payload.new as { role?: string; lat?: number; lng?: number };
          if (stillCurrent && point.role === "provider" &&
              typeof point.lat === "number" && typeof point.lng === "number") {
            setProviderRoutePoints((previous) => [
              ...previous,
              { latitude: point.lat!, longitude: point.lng! },
            ].slice(-1200));
          }
        },
      )
      .subscribe();

    return () => {
      stillCurrent = false;
      supabase.removeChannel(channel);
    };
  }, [id, isActive, currentUserId]);

  useEffect(() => {
    if (!isActive) {
      roadRouteSequenceRef.current += 1;
      hasValidRoadRouteRef.current = false;
      setRoadRoutePoints([]);
      setRoadTrafficSegments([]);
      setNextRouteInstruction(null);
      setLiveRouteSource(null);
      return;
    }
    // A short GPS/network gap should not erase the last confirmed road route.
    if (!providerLiveLocation || !driverLocationFresh) return;
    // The provider always routes to the saved work/pickup point for a service.
    // For taxis, route to the passenger until boarding, then to the trip destination.
    const origin = providerLiveLocation;
    const tripStarted = request?.type === "taxi" && request.status === "in_progress" &&
      request.dest_lat != null && request.dest_lng != null;
    const serviceTarget = request?.type === "service" &&
      request.pickup_lat != null && request.pickup_lng != null
      ? { latitude: Number(request.pickup_lat), longitude: Number(request.pickup_lng) }
      : null;
    const destination = tripStarted
      ? { latitude: Number(request!.dest_lat), longitude: Number(request!.dest_lng) }
      : serviceTarget ?? (isCustomer ? myLocation : otherLocation);
    if (!destination) {
      setRoadRoutePoints([]);
      return;
    }
    // Live GPS arrives every few seconds. Reuse the current road line until
    // the provider has moved meaningfully or the route has aged out.
    const routeKey = [id, request?.type, request?.status,
      destination.latitude.toFixed(5), destination.longitude.toFixed(5)].join(":");
    const previousRouteRequest = lastRoadRouteRequestRef.current;
    if (previousRouteRequest && previousRouteRequest.routeKey !== routeKey) {
      // Clear the previous trip leg before calculating a route to a new target.
      acceptedMapFitKeyRef.current = null;
      hasValidRoadRouteRef.current = false;
      setRoadRoutePoints([]);
      setRoadTrafficSegments([]);
      setNextRouteInstruction(null);
      setLiveRouteSource(null);
    }
    const movedMeters = previousRouteRequest
      ? Math.hypot(
          (origin.latitude - previousRouteRequest.latitude) * 111320,
          (origin.longitude - previousRouteRequest.longitude) * 111320 * Math.cos(origin.latitude * Math.PI / 180),
        )
      : Number.POSITIVE_INFINITY;
    if (previousRouteRequest && previousRouteRequest.routeKey === routeKey &&
        movedMeters < 15 && Date.now() - previousRouteRequest.requestedAt < 8000) return;

    const sequence = ++roadRouteSequenceRef.current;
    const timeout = setTimeout(() => {
      lastRoadRouteRequestRef.current = {
        routeKey,
        latitude: origin.latitude,
        longitude: origin.longitude,
        requestedAt: Date.now(),
      };
      void callMamnoonMapsApi<{
        routePoints?: { lat: number; lng: number }[];
        routeSteps?: { instruction: string; distanceMeters: number }[];
        trafficSegments?: { startIndex: number; endIndex: number; speed: string }[];
        routeSource?: string;
      }>({
        action: "route",
        from: { lat: origin.latitude, lng: origin.longitude },
        to: { lat: destination.latitude, lng: destination.longitude },
        includeGeometry: true,
      }).then((route) => {
        if (sequence !== roadRouteSequenceRef.current) return;
        const points = (route.routePoints ?? []).filter((point) =>
          Number.isFinite(point.lat) && Number.isFinite(point.lng) &&
          Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180,
        );
        const validRoutePoints = points.length > 1 ? points.map((point) => ({ latitude: point.lat, longitude: point.lng })) : [];
        if (validRoutePoints.length > 1) {
          hasValidRoadRouteRef.current = true;
          setRoadRoutePoints(validRoutePoints);
        } else {
          throw new Error("لم يصل مسار شوارع صالح");
        }
        setRoadTrafficSegments((route.trafficSegments ?? []).filter((segment) =>
          Number.isInteger(segment.startIndex) && Number.isInteger(segment.endIndex) &&
          segment.startIndex >= 0 && segment.endIndex > segment.startIndex && segment.endIndex <= points.length,
        ));
        setNextRouteInstruction(route.routeSteps?.[0]?.instruction ?? null);
        setLiveRouteSource(route.routeSource ?? null);
      }).catch((error) => {
        if (sequence === roadRouteSequenceRef.current) {
          // Keep the last verified route visible during temporary routing failures.
          if (!hasValidRoadRouteRef.current) {
            setRoadRoutePoints([]);
            setRoadTrafficSegments([]);
            setNextRouteInstruction(null);
            setLiveRouteSource(null);
          }
          console.warn("[Mamnoon] road route refresh failed; retaining last valid route:", error instanceof Error ? error.message : "unknown");
        }
      });
    }, 350);
    return () => clearTimeout(timeout);
  }, [
    isActive,
    isCustomer,
    request?.type,
    request?.status,
    request?.dest_lat,
    request?.dest_lng,
    request?.pickup_lat,
    request?.pickup_lng,
    providerLiveLocation?.latitude,
    providerLiveLocation?.longitude,
    myLocation?.latitude,
    myLocation?.longitude,
    otherLocation?.latitude,
    otherLocation?.longitude,
    driverLocationFresh,
  ]);
  useEffect(() => {
    if (!acceptedMapMode || !request || !acceptedMapRef.current) return;
    const fitKey = `${request.id}:${request.status}`;
    const singlePointFitKey = `${fitKey}:single`;
    const target = request.type === "taxi" && request.status === "in_progress" &&
      request.dest_lat != null && request.dest_lng != null
      ? { latitude: Number(request.dest_lat), longitude: Number(request.dest_lng) }
      : request.pickup_lat != null && request.pickup_lng != null
        ? { latitude: Number(request.pickup_lat), longitude: Number(request.pickup_lng) }
        : isCustomer ? myLocation : otherLocation;
    const origin = isCustomer ? otherLocation : myLocation;
    const roadFitKey = `${fitKey}:road:${target?.latitude ?? "none"}:${target?.longitude ?? "none"}`;
    if (acceptedMapFitKeyRef.current === roadFitKey) return;
    if (acceptedMapFitKeyRef.current === fitKey && roadRoutePoints.length <= 1) return;
    if (roadRoutePoints.length > 1) {
      acceptedMapRef.current.fitToCoordinates(roadRoutePoints, {
        edgePadding: { top: 150, right: 52, bottom: 330, left: 52 },
        animated: true,
      });
      acceptedMapFitKeyRef.current = roadFitKey;
    } else {
      const coordinates = [origin, target].filter((point): point is Coordinates => point != null);
      if (coordinates.length > 1 && acceptedMapFitKeyRef.current !== fitKey) {
        acceptedMapRef.current.fitToCoordinates(coordinates, {
          edgePadding: { top: 150, right: 52, bottom: 330, left: 52 },
          animated: false,
        });
        acceptedMapFitKeyRef.current = fitKey;
      } else if (coordinates.length === 1 && acceptedMapFitKeyRef.current !== singlePointFitKey) {
        acceptedMapRef.current.animateToRegion({
          ...coordinates[0],
          latitudeDelta: 0.012,
          longitudeDelta: 0.012,
        }, 450);
        acceptedMapFitKeyRef.current = singlePointFitKey;
      }
    }
  }, [
    acceptedMapMode,
    request?.id,
    request?.type,
    request?.status,
    request?.pickup_lat,
    request?.pickup_lng,
    request?.dest_lat,
    request?.dest_lng,
    isCustomer,
    myLocation?.latitude,
    myLocation?.longitude,
    otherLocation?.latitude,
    otherLocation?.longitude,
    roadRoutePoints,
  ]);


  useEffect(() => {
    if (!isCustomer || !request || request.status !== "accepted" ||
        !driverLocationFresh || !otherLocation || request.pickup_lat == null || request.pickup_lng == null) {
      setDriverEtaMinutes(null);
      lastEtaRequestRef.current = null;
      return;
    }
    const previous = lastEtaRequestRef.current;
    const movedMeters = previous
      ? (() => {
          const radians = (value: number) => value * Math.PI / 180;
          const dLat = radians(otherLocation.latitude - previous.latitude);
          const dLng = radians(otherLocation.longitude - previous.longitude);
          const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(radians(previous.latitude)) * Math.cos(radians(otherLocation.latitude)) *
            Math.sin(dLng / 2) ** 2;
          return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        })()
      : Number.POSITIVE_INFINITY;
    if (previous && movedMeters < 120 && Date.now() - previous.requestedAt < 30000) return;

    lastEtaRequestRef.current = {
      latitude: otherLocation.latitude,
      longitude: otherLocation.longitude,
      requestedAt: Date.now(),
    };
    const sequence = ++etaSequenceRef.current;
    void callMamnoonMapsApi<{ durationMin: number }>({
      action: "route",
      from: { lat: otherLocation.latitude, lng: otherLocation.longitude },
      to: { lat: request.pickup_lat, lng: request.pickup_lng },
    }).then((route) => {
      if (sequence === etaSequenceRef.current && Number.isFinite(route.durationMin)) {
        setDriverEtaMinutes(Math.max(1, Math.round(route.durationMin)));
      }
    }).catch(() => {
      if (sequence === etaSequenceRef.current) setDriverEtaMinutes(null);
    });
  }, [isCustomer, request?.type, request?.status, request?.pickup_lat, request?.pickup_lng, driverLocationFresh, otherLocation?.latitude, otherLocation?.longitude, otherLocation?.updatedAt]);

  async function payRequestWithZainCash() {
    if (!user || !request || !isCustomer || paymentBusy || request.payment_method === "zaincash") return;
    setPaymentBusy(true);
    try {
      const {data,error}=await supabase.functions.invoke("zaincash-create-payment",{body:{purpose:"service_request",requestId:id}});
      if(error) throw error;
      if(typeof data?.redirectUrl!=="string" || !data.redirectUrl.startsWith("https://")) throw new Error("لم يصل رابط الدفع الآمن");
      await Linking.openURL(data.redirectUrl);
    } catch(e:any) {
      Alert.alert("تعذر بدء الدفع",e?.message || "حاول مرة ثانية لاحقاً.");
    } finally { setPaymentBusy(false); }
  }

  async function sendMessage(text?: string) {
    const msg = (text || newMsg).trim();
    if (!msg) return;
    if (!chatId || !user) {
      Alert.alert("المحادثة غير جاهزة", "تبدأ المحادثة بعد قبول الطلب.");
      return;
    }
    setNewMsg("");
    const { error } = await supabase.from("messages").insert({
      chat_id: chatId,
      sender_id: user.id,
      content: msg,
    });
    if (error) Alert.alert("تعذر إرسال الرسالة", error.message);
    else loadMessages();
  }

  async function retryDispatch() {
    const increase = Number(retryPriceIncrease.replace(/[^0-9]/g, ""));
    if (!Number.isSafeInteger(increase) || increase < 0 || increase > 50000 || increase % 250 !== 0) {
      Alert.alert("السعر غير صحيح", "زيادة السعر لازم تكون من مضاعفات 250 دينار وبحد أقصى 50 ألف.");
      return;
    }
    const activeSearch = request && ["pending", "searching"].includes(request.status);
    if (activeSearch && increase <= 0) {
      Alert.alert("اكتب مقدار الزيادة", "أدخل مبلغاً موجباً حتى نرفع السعر ونعيد إرسال الطلب للمزودين.");
      return;
    }
    setRetryingDispatch(true);
    const { data, error } = await (supabase as any).rpc(activeSearch ? "raise_request_price" : "retry_service_request", {
      _request_id: id,
      _price_increase: increase,
    });
    setRetryingDispatch(false);
    if (error) {
      Alert.alert("تعذر تحديث السعر", error.message || "حاول مرة ثانية.");
      return;
    }
    setRetryPriceIncrease("0");
    Alert.alert(activeSearch ? "تم رفع السعر" : "تمت إعادة الطلب", activeSearch ? "تم تحديث المبلغ وإعادة إرسال الطلب للمزودين القريبين." : increase > 0 ? "أعدنا إرسال نفس الطلب مع رفع السعر." : "أعدنا إرسال طلبك بنفس التفاصيل.");
    await loadRequest();
  }

  async function enableTaxiUrgency() {
    if (!request || taxiUrgencyBusy) return;
    setTaxiUrgencyBusy(true);
    const { error } = await (supabase as any).rpc("enable_taxi_request_urgency", { _request_id: id });
    setTaxiUrgencyBusy(false);
    if (error) {
      Alert.alert("تعذر تفعيل الاستعجال", error.message?.includes("taxi_urgency_not_available") ? "وضع الاستعجال غير متاح حالياً حسب إعدادات ممنون." : error.message || "حاول مرة ثانية.");
      return;
    }
    Alert.alert("تم تفعيل الاستعجال", "تم تحديث الأجرة وإعادة إرسال طلبك للسائقين القريبين.");
    await loadRequest();
  }

  async function acceptRequest() {
    const acceptWithTeam = async (teamSize: number) => {
      if (request?.type === "service" && user?.id) {
        const { error: teamError } = await (supabase as any)
          .from("worker_profiles")
          .update({ team_size: teamSize })
          .eq("user_id", user.id);
        if (teamError) {
          Alert.alert("تعذر حفظ حجم الفريق", teamError.message);
          return;
        }
      }
      const { error } = await supabase.rpc("accept_service_request", { _request_id: id });
      if (error) Alert.alert("تعذر قبول الطلب", error.message);
      else {
        await Promise.all([loadRequest(), loadChat()]);
      }
    };
    if (request?.type === "service") {
      const maxTeamSize = Math.min(5, Math.max(1, remainingPeopleCount || Number(request.workers_count) || 1));
      const teamChoices = (sizes: number[]) => sizes.filter((size) => size <= maxTeamSize).map((size) => ({
        text: size === 1 ? "أنا وحدي · 1" : size === 2 ? "أنا + عامل · 2" : `أنا + ${size - 1} عمال · ${size}`,
        onPress: () => void acceptWithTeam(size),
      }));
      const prompt = "اختَر العدد الكلي ويّاك (الخبير محسوب ضمن العدد).";
      if (maxTeamSize <= 3) {
        Alert.alert("كم شخص يجي وياك؟", prompt, teamChoices([1, 2, 3]));
      } else {
        Alert.alert("كم شخص يجي وياك؟", prompt, [
          ...teamChoices([1, 2]).slice(0, 2),
          {
            text: "خيارات أكثر",
            onPress: () => Alert.alert("اختَر عدد أفراد الفريق", prompt, teamChoices([3, 4, 5])),
          },
        ]);
      }
      return;
    }
    await acceptWithTeam(1);
  }

  async function retryLargeOffers() {
    setRetryingLargeOffers(true);
    const { data, error } = await (supabase as any).rpc("retry_large_vehicle_dispatch", { _request_id: id });
    setRetryingLargeOffers(false);
    if (error) {
      Alert.alert("تعذر إعادة الإرسال", error.message);
      return;
    }
    Alert.alert(Number(data) > 0 ? "تم إرسال الطلب" : "لا توجد سيارات متاحة", Number(data) > 0 ? "وصل الطلب لأصحاب السيارات المتاحين." : "طلبك يبقى محفوظاً وتكدر تعيد المحاولة لاحقاً.");
    await loadRequest();
  }

  async function sendLargeVehicleOffer() {
    if (!user || largeOfferBusy) return;
    const digits = normalizeCashDigits(largeOfferPrice);
    const amount = digits ? Number(digits) : NaN;
    if (!Number.isSafeInteger(amount) || amount < 250 || amount > 50000 || amount % 250 !== 0) {
      Alert.alert("السعر غير صحيح", "اكتب أجرتك من 250 إلى 50,000 دينار، ويكون المبلغ من مضاعفات 250.");
      return;
    }
    setLargeOfferBusy(true);
    try {
      const { error } = await (supabase as any).rpc("submit_large_vehicle_offer", {
        _request_id: id,
        _price: amount,
        _message: largeOfferMessage.trim() || null,
      });
      if (error) {
        const raw = String(error.message || "");
        const message = raw.includes("request_offer_expired") || raw.includes("request_offer_unavailable")
          ? "انتهت صلاحية استقبال العروض لهذا الطلب. حدّث الطلب أو انتظر طلباً جديداً."
          : raw.includes("driver_vehicle_not_eligible") || raw.includes("large_driver_no_longer_eligible")
            ? "سيارتك غير متاحة حالياً أو بياناتها غير مطابقة لهذا الطلب. تأكد أن حالة السيارة متاح وأن اعتمادها مكتمل."
            : raw.includes("provider_has_active_request")
              ? "عندك طلب آخر قيد التنفيذ. أكمله أولاً حتى ترسل عرضاً جديداً."
              : raw.includes("invalid_offer_price")
                ? "الأجرة لازم تكون بين 250 و50,000 دينار ومن مضاعفات 250."
                : raw;
        Alert.alert("تعذر إرسال العرض", message || "صار خلل أثناء إرسال العرض. حاول مرة ثانية.");
        return;
      }
      Alert.alert("تم إرسال عرضك", "وصل السعر للزبون. راح يگدر يشوف عرضك ويوافق عليه أو يختار عرضاً آخر.");
      await loadRequest();
    } catch (error: any) {
      Alert.alert("تعذر إرسال العرض", error?.message || "تحقق من الإنترنت وحاول مرة ثانية.");
    } finally {
      setLargeOfferBusy(false);
    }
  }

  async function acceptLargeVehicleRequest() {
    if (!request || acceptingLargeRequest) return;
    setAcceptingLargeRequest(true);
    try {
      const { error } = await (supabase as any).rpc("accept_large_vehicle_request", { _request_id: id });
      if (error) {
        const raw = String(error.message || "");
        const message = raw.includes("customer_price_missing")
          ? "الزبون ما محدد أجرة للطلب، استخدم إرسال عرض السعر بدلاً من القبول المباشر."
          : raw.includes("request_offer_unavailable")
            ? "هذا الطلب ما عاد ضمن الطلبات المرسلة إلك. حدّث قائمة الطلبات وحاول بطلب متاح."
            : raw.includes("large_driver_no_longer_eligible")
              ? "تأكد أن سيارتك الكبيرة معتمدة وحالتها متاح."
              : raw.includes("provider_has_active_request")
                ? "عندك طلب آخر قيد التنفيذ."
                : raw.includes("request_unavailable")
                  ? "الطلب انقبل من سائق آخر أو انتهت صلاحيته."
                  : raw;
        Alert.alert("تعذر قبول الطلب", message || "حاول مرة ثانية بعد تحديث الطلبات.");
        return;
      }
      Alert.alert("تم قبول الطلب", "تم تثبيت أجرة الزبون وفتح المحادثة. تگدر هسه تتواصل وياه وتتوجه لموقعه.");
      await Promise.all([loadRequest(), loadChat()]);
    } catch (error: any) {
      Alert.alert("تعذر قبول الطلب", error?.message || "تحقق من الإنترنت وحاول مرة ثانية.");
    } finally {
      setAcceptingLargeRequest(false);
    }
  }

  async function acceptLargeOffer(offerId: string) {
    setAcceptingLargeOffer(offerId);
    const { error } = await (supabase as any).rpc("accept_large_vehicle_offer", { _offer_id: offerId });
    setAcceptingLargeOffer(null);
    if (error) {
      Alert.alert("تعذر قبول العرض", error.message);
      return;
    }
    Alert.alert("تم الاتفاق", "تم قبول عرض السعر وفتح المحادثة بينكم.");
    await Promise.all([loadRequest(), loadChat()]);
  }

  async function rejectLargeOffer(offerId: string) {
    setAcceptingLargeOffer(offerId);
    const { error } = await (supabase as any).rpc("reject_large_vehicle_offer", { _offer_id: offerId });
    setAcceptingLargeOffer(null);
    if (error) {
      Alert.alert("تعذر رفض العرض", error.message);
      return;
    }
    await loadRequest();
  }

  async function markProviderArrived() {
    if (!request || !isProvider || request.status !== "accepted" || transitionBusy) return;
    setTransitionBusy(true);
    try {
      const { error } = await (supabase as any).rpc("mark_service_request_arrived", {
        _request_id: id,
      });
      if (error) {
        Alert.alert("تعذر تأكيد الوصول", error.message);
        return;
      }
      Alert.alert("تم تأكيد الوصول", "تم تسجيل وصولك إلى موقع الزبون.");
      await loadRequest();
    } finally {
      setTransitionBusy(false);
    }
  }

  async function startRide() {
    if (!request || !isProvider || request.status !== "accepted" || transitionBusy) return;
    const arrivalRequired = request.type === "service" ||
      (request.type === "taxi" && request.vehicle_category === "large");
    if (arrivalRequired && !request.provider_arrived_at) {
      Alert.alert("تأكيد الوصول مطلوب", "أكد وصولك إلى موقع الزبون أولاً قبل بدء تنفيذ الطلب.");
      return;
    }
    setTransitionBusy(true);
    try {
      const { error } = await supabase.rpc("transition_service_request", {
        _request_id: id,
        _status: "in_progress",
        _reason: null,
      });
      if (error) {
        const message = error.message?.includes("provider_not_arrived")
          ? "لازم تأكد وصولك للموقع أولاً قبل بدء التنفيذ."
          : error.message || "حاول مرة ثانية.";
        Alert.alert("تعذر بدء الطلب", message);
      } else {
        await loadRequest();
      }
    } finally {
      setTransitionBusy(false);
    }
  }

  function completeRide() {
    if (!request || !isProvider || request.status !== "in_progress" || transitionBusy) return;
    const fare = Number(request.customer_payable ?? request.customer_price ?? request.price_estimate ?? 0);
    setCashReceivedInput(request.payment_method === "zaincash" ? "0" : String(Math.max(0, Math.round(fare))));
    setCashSettlementOpen(true);
  }

  async function submitCashSettlement() {
    if (!request || transitionBusy) return;
    const digits = normalizeCashDigits(cashReceivedInput);
    const amount = digits === "" ? NaN : Number(digits);
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > 100000000) {
      Alert.alert("المبلغ غير صحيح", "اكتب المبلغ النقدي الذي استلمته من الزبون.");
      return;
    }
    if (request.payment_method === "zaincash" && amount !== 0) {
      Alert.alert("الدفع إلكتروني", "هذا الطلب مدفوع إلكترونياً؛ لا تدخل مبلغاً نقدياً.");
      return;
    }
    setTransitionBusy(true);
    try {
      const { data, error } = await (supabase as any).rpc("complete_service_request_with_cash", {
        _request_id: id,
        _cash_received_iqd: amount,
      });
      if (error) throw error;
      setCashSettlementOpen(false);
      const change = Number(data?.change_iqd ?? 0);
      Alert.alert(
        "تم إنهاء الطلب",
        change > 0
          ? `تمت إضافة ${change.toLocaleString("ar-IQ")} د.ع إلى محفظة الزبون كفرق الباقي.`
          : "تم تسجيل إكمال الطلب بنجاح.",
      );
      await loadRequest();
    } catch (error: any) {
      const raw = String(error?.message ?? "");
      const message = raw.includes("provider_wallet_debt_limit_exceeded")
        ? "رصيد محفظتك وصل حد المديونية. رجّع الباقي نقداً للزبون، ثم سجّل الأجرة التي احتفظت بها."
        : raw.includes("cash_received_less_than_fare")
          ? "المبلغ المستلم أقل من أجرة الطلب. تأكد من استلام الأجرة كاملة قبل الإكمال."
          : raw || "تعذّر تسجيل المبلغ وتسوية الباقي.";
      Alert.alert("تعذر إنهاء الطلب", message);
    } finally {
      setTransitionBusy(false);
    }
  }

  const customerCancelReasons = [
    "طلبت بالخطأ",
    "لم أعد بحاجة إلى الرحلة أو الخدمة",
    "تغيّر الموعد أو الخطة",
    "اخترت عنواناً أو موقعاً غير صحيح",
    "تفاصيل الطلب تحتاج إلى تعديل",
    "وجدت مقدم خدمة آخر",
    "تأخر مقدم الخدمة عن الموعد",
    "سبب شخصي أو ظرف طارئ",
    "سبب آخر",
  ];
  const providerCancelReasons = [
    "تعذّر التواصل مع الزبون",
    "موقع الاستلام غير دقيق",
    "عطل في المركبة أو المعدات",
    "ازدحام أو إغلاق طريق",
    "تفاصيل الطلب لا تطابق الخدمة",
    "ظرف طارئ خارج عن الإرادة",
    "تعذّر الوصول بأمان",
    "سبب آخر",
  ];

  function cancelRequest() {
    setCancelReason("");
    setCancelOtherReason("");
    setCancelError("");
    setShowCancelSheet(true);
  }

  async function submitCancellation() {
    if (!request || cancelBusy) return;
    const reason = cancelReason === "سبب آخر" ? cancelOtherReason.trim() : cancelReason;
    if (reason.length < 2) {
      setCancelError(cancelReason === "سبب آخر" ? "اكتب سبباً مختصراً حتى نكمل الإلغاء." : "اختَر سبب الإلغاء أولاً.");
      return;
    }
    setCancelBusy(true);
    setCancelError("");
    try {
      const { data, error } = await (supabase as any).rpc("cancel_service_request", {
        _request_id: id,
        _reason: reason,
      });
      if (error) {
        const raw = String(error.message || error.details || error.code || "");
        const message = raw.includes("provider_already_arrived")
          ? "مقدم الخدمة أكد وصوله، لذلك لا يمكن إلغاء الطلب من هذه المرحلة."
          : raw.includes("service_already_started")
            ? "بدأ تنفيذ الخدمة بالفعل، ولا يمكن إلغاؤها من التطبيق."
            : raw.includes("taxi_trip_already_started")
              ? "بدأت الرحلة بالفعل، ولا يمكن إلغاؤها بعد الانطلاق."
              : raw.includes("taxi_cancellation_disabled_after_acceptance")
                ? "لا يمكن إلغاء الرحلة بعد بدء السائق بها. إذا لم يصل بعد، حدّث الطلب وحاول مرة أخرى."
                : raw.includes("request_finished")
                  ? "هذا الطلب منتهٍ أو ملغي مسبقاً."
                  : raw.includes("forbidden") || raw.includes("unauthorized")
                    ? "تعذّر التحقق من صلاحيتك. سجّل الدخول من جديد وحاول."
                    : raw.includes("cancellation_reason_required")
                      ? "اختَر سبب الإلغاء أولاً."
                      : raw.includes("request_not_found")
                        ? "لم نعثر على هذا الطلب. حدّث الصفحة وحاول مرة أخرى."
                        : "تعذّر تنفيذ الإلغاء حالياً. تأكد من اتصال الإنترنت وحاول مرة أخرى.";
        setCancelError(message);
        return;
      }
      setShowCancelSheet(false);
      await loadRequest();
      Alert.alert(
        "تم الإلغاء بنجاح",
        data === "released"
          ? "تم فك ارتباطك بالطلب وإعادته للبحث عن مقدم خدمة آخر."
          : "تم إلغاء الطلب وحفظ السبب وإبلاغ الطرف المعني.",
      );
    } catch (error: any) {
      setCancelError(error?.message || "حدث خطأ غير متوقع. حاول مرة أخرى.");
    } finally {
      setCancelBusy(false);
    }
  }

  async function applyRequestUrgency(multiplier: 2 | 3) {
    if (!request || !isCustomer || urgencyBusy) return;
    setUrgencyBusy(true);
    try {
      const { data, error } = await (supabase as any).rpc("apply_request_urgency", {
        _request_id: id,
        _multiplier: multiplier,
      });
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : data;
      Alert.alert("تم تفعيل الاستعجال", `تم رفع الأجر بنسبة ${Number(result?.urgency_percent ?? urgencyAdminPercent * multiplier)}٪ وأُبلغ المزوّدون بالزيادة.`);
      await loadRequest();
    } catch (error: any) {
      Alert.alert("تعذر تفعيل الاستعجال", error?.message ?? "حاول مرة ثانية.");
    } finally {
      setUrgencyBusy(false);
    }
  }

  async function submitUserReport() {
    if (!user?.id || !request) return;
    if (!["in_progress", "completed"].includes(request.status)) { Alert.alert("البلاغات غير متاحة", "تگدر ترسل بلاغ بعد بدء الرحلة أو الخدمة فعلياً."); return; }
    const reportedId = isCustomer ? request.provider_id : request.customer_id;
    if (!reportedId) { Alert.alert("تعذر إرسال البلاغ", "لا يوجد طرف آخر مرتبط بهذا الطلب حتى الآن."); return; }
    if (!reportReason.trim()) { Alert.alert("تنبيه", "اختر تصنيف البلاغ."); return; }
    if (reportDetails.trim().length < 10) { Alert.alert("تفاصيل البلاغ مطلوبة", "اشرح المشكلة بتفاصيل لا تقل عن 10 أحرف حتى تتمكن الإدارة من مراجعتها."); return; }
    setReportBusy(true);
    const { error } = await (supabase as any).from("user_reports").insert({ reporter_id: user.id, reported_id: reportedId, request_id: id, reason: reportReason.trim(), details: reportDetails.trim(), status: "pending" });
    setReportBusy(false);
    if (error) { Alert.alert("تعذر إرسال البلاغ", error.message); return; }
    setShowReportForm(false); setReportDetails("");
    Alert.alert("تم استلام البلاغ", `تم ربط البلاغ بالرحلة ${request.request_code || request.id.slice(0, 8).toUpperCase()} وإرساله إلى إدارة ممنون للمراجعة.`);
  }

  async function submitRating() {
    if (rating === 0 || !user || ratingBusy) return;
    if (Object.values(ratingCriteria).some((value) => value < 1)) { Alert.alert("أكمل التقييم", "قيّم التعامل والالتزام والجودة كلٌّ على حدة."); return; }
    const otherId = isCustomer ? request?.provider_id : request?.customer_id;
    if (!otherId) return;
    setRatingBusy(true);
    try {
      const { error } = await (supabase as any).from("ratings").insert({
        request_id: id,
        rater_id: user.id,
        ratee_id: otherId,
        stars: rating,
        professionalism: ratingCriteria.professionalism,
        punctuality: ratingCriteria.punctuality,
        quality: ratingCriteria.quality,
        reasons: ratingReasons.slice(0, 12),
        comment: ratingComment.trim() || null,
      });
      if (error) {
        Alert.alert("تعذر حفظ التقييم", error.message?.includes("rating_already_given_this_week")
          ? "قيّمت هذا المستخدم خلال آخر 7 أيام."
          : error.message?.includes("row-level security")
            ? "لا يمكن تقييم الطلب إلا بعد اكتماله ومن أحد طرفيه."
            : "تعذّر حفظ التقييم. تحقق من الاتصال وحاول مرة أخرى.");
      } else {
        setShowRating(false);
        Alert.alert("شكراً لتقييمك", "تم حفظ تقييمك وربطه بهذا الطلب.");
        router.back();
      }
    } finally {
      setRatingBusy(false);
    }
  }

  if (loading)
    return (
      <View style={styles.center}>
        <Text style={{ color: "#64748b" }}>جاري التحميل...</Text>
      </View>
    );
  if (!request)
    return (
      <View style={styles.center}>
        <Text style={{ color: "#64748b" }}>الطلب غير موجود</Text>
      </View>
    );

  const mapRouteTarget: Coordinates | null = request.type === "taxi" &&
    request.status === "in_progress" && request.dest_lat != null && request.dest_lng != null
      ? { latitude: request.dest_lat, longitude: request.dest_lng }
      : request.pickup_lat != null && request.pickup_lng != null
        ? { latitude: request.pickup_lat, longitude: request.pickup_lng }
        : isCustomer ? myLocation : otherLocation;
  const mapRouteOrigin = providerLiveLocation ?? mapRouteTarget;
  const statusLabel: Record<string, string> = {
    searching: "بحث عن مزوّد...",
    pending: "بانتظار القبول",
    accepted: "تم القبول",
    in_progress: "قيد التنفيذ",
    completed: "مكتمل",
    cancelled: "ملغي",
  };
  const quickReplies = isCustomer ? QUICK_REPLIES_CUSTOMER : QUICK_REPLIES_PROVIDER;
  const acceptedPeopleCount = serviceProviders.reduce((sum, member) => sum + Number(member.team_size || 1), 0);
  const remainingPeopleCount = Math.max(0, Number(request.workers_count || 1) - acceptedPeopleCount);
  const ratingCriteriaOptions = isProvider
    ? [{ key: "professionalism" as const, label: "التعامل والاحترام" }, { key: "punctuality" as const, label: "الالتزام بالموعد" }, { key: "quality" as const, label: "وضوح الطلب والالتزام بالاتفاق" }]
    : request?.type === "taxi"
      ? [{ key: "professionalism" as const, label: "التعامل واحترام الخصوصية" }, { key: "punctuality" as const, label: "الالتزام بالوقت" }, { key: "quality" as const, label: "السلامة ونظافة المركبة" }]
      : [{ key: "professionalism" as const, label: "الاحترافية والتعامل" }, { key: "punctuality" as const, label: "الالتزام بالموعد" }, { key: "quality" as const, label: "جودة تنفيذ العمل" }];
  const ratingReasonOptions = isProvider
    ? ["محترم وحسن التعامل", "ملتزم بالموعد", "متعاون وواضح", "قدّم معلومات دقيقة", "احترم وقتي", "التزم بالاتفاق", "تأخر دون إشعار", "صعّب التواصل", "غيّر الاتفاق دون تنسيق", "تعامل غير لائق"]
    : request?.type === "taxi"
      ? ["قيادة آمنة", "احترام الخصوصية", "وصل بالموعد", "حسن التعامل", "السيارة نظيفة", "المكيف يعمل", "تواصل واضح", "تأخر دون إشعار", "قيادة غير آمنة", "السيارة غير نظيفة", "تعامل غير لائق", "لم يلتزم بالاتفاق"]
      : ["جودة العمل عالية", "أتقن العمل", "التزم بالموعد", "التزم بالسعر المتفق", "حسن التعامل", "حافظ على المكان", "تواصل واضح", "تأخر دون إشعار", "جودة العمل ضعيفة", "غيّر السعر دون اتفاق", "لم يحافظ على المكان", "تعامل غير لائق"];

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.container, acceptedMapMode && styles.containerMap]}>
        {acceptedMapMode && (
          <MapView
            ref={acceptedMapRef}
            key={`${request.id}:${request.status}`}
            style={styles.fullScreenTrackingMap}
            initialRegion={{
              latitude: mapRouteOrigin && mapRouteTarget
                ? (mapRouteOrigin.latitude + mapRouteTarget.latitude) / 2
                : mapRouteTarget?.latitude ?? 33.3152,
              longitude: mapRouteOrigin && mapRouteTarget
                ? (mapRouteOrigin.longitude + mapRouteTarget.longitude) / 2
                : mapRouteTarget?.longitude ?? 44.3661,
              latitudeDelta: mapRouteOrigin && mapRouteTarget
                ? Math.max(0.018, Math.abs(mapRouteTarget.latitude - mapRouteOrigin.latitude) * 1.6)
                : 0.018,
              longitudeDelta: mapRouteOrigin && mapRouteTarget
                ? Math.max(0.018, Math.abs(mapRouteTarget.longitude - mapRouteOrigin.longitude) * 1.6)
                : 0.018,
            }}
            showsUserLocation={request.type !== "taxi"}
            showsCompass
            showsTraffic
            toolbarEnabled={false}
            scrollEnabled
            zoomEnabled
            rotateEnabled
          >
            {roadRoutePoints.length > 1 && (
              <>
                <Polyline coordinates={roadRoutePoints} strokeColor="#FFFFFF" strokeWidth={11} lineCap="round" lineJoin="round" />
                <Polyline coordinates={roadRoutePoints} strokeColor="#0B63CE" strokeWidth={6} lineCap="round" lineJoin="round" />
                {roadTrafficSegments.map((segment, index) => {
                  const segmentPoints = roadRoutePoints.slice(segment.startIndex, segment.endIndex);
                  if (segmentPoints.length < 2) return null;
                  const trafficColor = segment.speed === "TRAFFIC_JAM" ? "#DC2626" : segment.speed === "SLOW" ? "#F59E0B" : "#16A34A";
                  return <Polyline key={index} coordinates={segmentPoints} strokeColor={trafficColor} strokeWidth={6} />;
                })}
              </>
            )}
            {providerRoutePoints.length > 1 && (
              <Polyline coordinates={providerRoutePoints} strokeColor="#D6A43B" strokeWidth={5} geodesic />
            )}
            {request.type === "taxi" ? (
              <>
                {request.pickup_lat != null && request.pickup_lng != null && (
                  <LocationTargetMarker coordinate={{ latitude: request.pickup_lat, longitude: request.pickup_lng }} title="نقطة انطلاق الزبون" />
                )}
                {request.dest_lat != null && request.dest_lng != null && (
                  <DestinationMarker coordinate={{ latitude: request.dest_lat, longitude: request.dest_lng }} />
                )}
                {driverLocationFresh && (isProvider ? myLocation : otherLocation) && (
                  <TaxiCarMarker
                    coordinate={(isProvider ? myLocation : otherLocation)!}
                    heading={(isProvider ? myLocation : otherLocation)?.heading}
                    imageSource={undefined}
                    imageUri={request.vehicle_category === "large"
                      ? "https://raw.githubusercontent.com/ali8102000/mamnoonChatGPT/main/public/images/" +
                        (request.vehicle_type === "kia_cargo" ? "kia-cargo" : "kia-passenger") + ".svg"
                      : "https://raw.githubusercontent.com/ali8102000/mamnoonChatGPT/main/public/vehicle-icons/" +
                        (["economy", "premium", "luxury"].includes(request.vehicle_category ?? "") ? request.vehicle_category : "economy") + ".svg"}
                  />
                )}
                {(isProvider ? otherLocation : myLocation) && (
                  <LocationTargetMarker coordinate={(isProvider ? otherLocation : myLocation)!} title={isProvider ? "موقع الزبون" : "موقعك"} />
                )}
              </>
            ) : (
              <>
                {request.pickup_lat != null && request.pickup_lng != null && (
                  <Marker coordinate={{ latitude: request.pickup_lat, longitude: request.pickup_lng }} title="موقع العمل" pinColor="#0f766e" />
                )}
                {request.dest_lat != null && request.dest_lng != null && (
                  <DestinationMarker coordinate={{ latitude: request.dest_lat, longitude: request.dest_lng }} />
                )}
                {driverLocationFresh && (isProvider ? myLocation : otherLocation) && (
                  <ServicePhotoMarker
                    coordinate={(isProvider ? myLocation : otherLocation)!}
                    imageSource={SERVICE_IMAGES[request.services?.slug ?? ""] ?? service_general}
                    title={request.services?.name_ar || "مقدم الخدمة"}
                  />
                )}
                {(isProvider ? otherLocation : myLocation) && (
                  <LocationTargetMarker
                    coordinate={(isProvider ? otherLocation : myLocation)!}
                    title={isProvider ? "موقع الزبون" : "موقعك"}
                  />
                )}
              </>
            )}
          </MapView>
        )}
        <View style={[styles.header, acceptedMapMode && styles.headerOnMap]}>

          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.backBtn}>→</Text>
          </TouchableOpacity>
          <View style={{ alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, flex: 1 }}><Text style={styles.headerTitle}>{request.type === "service" && request.status === "accepted" && remainingPeopleCount > 0 ? "اكتفى الزبون بالعدد المتوفر" : statusLabel[request.status] || request.status}</Text>{request.type === "taxi" && isCustomer && request.status === "accepted" && <Text style={styles.acceptedHint}>{otherLocation && request.pickup_lat != null && request.pickup_lng != null && (() => { const rad = (value: number) => value * Math.PI / 180; const dLat = rad(otherLocation.latitude - request.pickup_lat!); const dLng = rad(otherLocation.longitude - request.pickup_lng!); const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(request.pickup_lat!)) * Math.cos(rad(otherLocation.latitude)) * Math.sin(dLng / 2) ** 2; const meters = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); return !driverLocationFresh ? "بانتظار تحديث موقع السائق" : meters <= 50 ? "انا في نقطة الانطلاق" : driverEtaMinutes != null && driverEtaMinutes <= 2 ? "دقيقتين واوصل" : driverEtaMinutes != null ? `باقي ${driverEtaMinutes} دقيقة واوصل` : "الكابتن متجه إليك"; })()}</Text>}</View>
          <View style={{ width: 30 }} />
        </View>
        <View style={{ paddingHorizontal: 16, paddingVertical: 7, backgroundColor: acceptedMapMode ? "rgba(7,21,37,0.88)" : palette.surface, borderBottomWidth: 1, borderBottomColor: palette.line }}>
          <Text style={{ color: acceptedMapMode ? "#FFFFFF" : palette.ink, fontSize: 11, fontWeight: "900", textAlign: "center", writingDirection: "ltr" }}>رقم الطلب: {request.request_code || request.id.slice(0, 8).toUpperCase()}</Text>
        </View>
        <ScrollView
          ref={scrollRef}
          style={[styles.requestScroll, acceptedMapMode && styles.requestScrollOnMap]}
          contentContainerStyle={styles.requestScrollContent}
          showsVerticalScrollIndicator
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        >
        {acceptedMapMode && (
          <View style={styles.mapLiveBadge}>
            <View style={styles.mapLiveDot} />
            <Text style={styles.mapLiveBadgeTitle}>التتبع المباشر</Text>
            <Text style={styles.mapLiveBadgeText}>
              {request.type === "taxi" && request.status === "in_progress"
                ? "الرحلة مستمرة إلى وجهتك"
                : request.provider_arrived_at
                  ? "وصل مقدم الخدمة إلى الموقع"
                  : driverEtaMinutes != null
                  ? `الوصول المتوقع خلال ${driverEtaMinutes} دقيقة`
                  : driverLocationFresh
                    ? "الموقع يتحدث مباشرة"
                    : "بانتظار تحديث الموقع"}
            </Text>
            {nextRouteInstruction && <Text style={styles.mapLiveBadgeText} numberOfLines={1}>التالي: {nextRouteInstruction}</Text>}
            {liveRouteSource === "google_routes_traffic" && <Text style={styles.mapTrafficLabel}>المسار وحركة المرور المباشرة من Google</Text>}
          </View>
        )}
        {otherProfile && !["completed", "cancelled"].includes(request.status) && (
          <View style={[styles.personCard, request.type === "taxi" && isActive && styles.personCardCompact]}>
            <View style={[styles.personAvatar, request.type === "taxi" && isActive && { width: 38, height: 38, borderRadius: 13 }]}>
              {otherProfile.avatar_url && !avatarLoadFailed ? (
                <Image source={{ uri: otherProfile.avatar_url }} style={styles.personAvatarImage} onError={() => setAvatarLoadFailed(true)} />
              ) : (
                <Text style={styles.personAvatarText}>{(otherProfile.full_name || "؟")[0]}</Text>
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.personName}>{otherProfile.full_name || "مستخدم"}</Text>
              {!!otherProfile.phone && <Text style={styles.personPhone}>{otherProfile.phone}</Text>}
              <View style={styles.personQuickActions}>
                {!!otherProfile.phone && <TouchableOpacity style={styles.personQuickButton} onPress={() => showContactOptions(otherProfile.phone!)}><Text style={styles.personQuickButtonText}>اتصال</Text></TouchableOpacity>}
                {!!chatId && !["completed", "cancelled"].includes(request.status) && <TouchableOpacity style={styles.personQuickButton} onPress={() => router.push({ pathname: "/request/chat/[id]", params: { id } })}><Text style={styles.personQuickButtonText}>المحادثة{messages.length ? ` · ${messages.length}` : ""}</Text></TouchableOpacity>}
              </View>
              <Text style={styles.personRole}>{isCustomer ? "مقدم الخدمة" : "الزبون"}</Text>
            </View>
          </View>
        )}
        <View style={[styles.infoCard, request.type === "taxi" && isActive && styles.taxiInfoCard]}>
          {request.type === "service" && request.services?.slug && SERVICE_IMAGES[request.services.slug] ? (
            <Image source={SERVICE_IMAGES[request.services.slug]} style={styles.serviceIllustration} resizeMode="cover" />
          ) : null}
          <Text style={[styles.infoType, request.type === "taxi" && isActive && styles.taxiInfoType]}>
            {request.vehicle_category === "large" ? `🚚 طلب سيارة كبيرة — ${request.vehicle_type === "kia_passenger" ? "كيا ركاب" : "كيا حمل"}` : request.type === "taxi" ? "🚕 طلب سيارة" : `🛠️ ${request.services?.name_ar || "خدمة منزلية"}`}
          </Text>
          {request.type !== "taxi" || !isActive ? <>{request.pickup_text && <Text style={styles.infoRow}>من: {request.pickup_text}</Text>}{request.dest_text && <Text style={styles.infoRow}>إلى: {request.dest_text}</Text>}</> : null}
          {request.type === "taxi" && isActive && vehicleDetails && <Text style={styles.vehicleDetailsText}>السيارة: {[vehicleDetails.vehicle_make, vehicleDetails.vehicle_model, vehicleDetails.vehicle_year].filter(Boolean).join(" ")}{vehicleDetails.vehicle_color ? ` · ${vehicleDetails.vehicle_color}` : ""}{vehicleDetails.vehicle_plate ? ` · رقم اللوحة ${vehicleDetails.vehicle_plate}` : ""}</Text>}
          {request.work_description && <Text style={styles.infoRow}>تفاصيل العمل: {request.work_description}</Text>}
          {request.notes && (request.type !== "taxi" || request.vehicle_category === "large") && <Text style={styles.infoRow}>ملاحظات الطلب: {request.notes}</Text>}
          {attachmentUrl && (
            <View style={{ marginTop: 12, gap: 8, alignItems: "center" }}>
              <Text style={styles.infoRow}>الصورة المرفقة بالطلب</Text>
              <Image source={{ uri: attachmentUrl }} style={styles.requestAttachmentImage} resizeMode="contain" />
            </View>
          )}
          {request.workers_count != null && request.type === "service" && (
            <Text style={styles.infoRow}>العدد المطلوب: {request.workers_count} · تم تأكيد: {acceptedPeopleCount} · المتبقي: {remainingPeopleCount}</Text>
          )}
          {request.work_hours != null && (
            <Text style={styles.infoRow}>الساعات المتوقعة: {request.work_hours}</Text>
          )}
          {(request.customer_price ?? request.price_estimate) != null && (
            <Text style={styles.infoPrice}>
              {Number(request.customer_price ?? request.price_estimate).toLocaleString("en")} د.ع
              {request.pricing_mode === "hourly" ? " / ساعة" : ""}
            </Text>
          )}
          {request.type === "service" && request.pricing_mode === "negotiable" && request.customer_price == null && (
            <Text style={styles.infoPrice}>الأجر قابل للتفاوض</Text>
          )}
        </View>
        {isProvider && request.type === "service" && request.status === "searching" && (
          <View style={{ marginTop: 12, borderRadius: 16, padding: 13, backgroundColor: "#E8F7EF", borderWidth: 1, borderColor: palette.success }}>
            <Text style={{ color: palette.ink, fontWeight: "900", textAlign: "right" }}>تم تسجيلك ضمن فريق الطلب</Text>
            <Text style={{ color: palette.muted, fontSize: 12, textAlign: "right", marginTop: 4 }}>الفريق المؤكد: {acceptedPeopleCount} من {request.workers_count ?? 1} · المتبقي: {remainingPeopleCount}</Text>
          </View>
        )}
        {isCustomer && ["pending", "searching"].includes(request.status) && (
          <View style={{ marginTop: 14, borderRadius: 22, padding: 18, backgroundColor: palette.brandSoft, borderWidth: 1, borderColor: palette.brand + "35", alignItems: "center", gap: 8 }}>
            {request.type === "taxi" ? <Text style={{ fontSize: 28 }}>🚕</Text> : request.services?.slug && SERVICE_IMAGES[request.services.slug] ? <Image source={SERVICE_IMAGES[request.services.slug]} style={{ width: 76, height: 76, borderRadius: 18 }} resizeMode="cover" /> : <Text style={{ fontSize: 28 }}>🛠️</Text>}
            {request.type === "service" && request.services?.name_ar && <Text style={{ color: palette.ink, fontSize: 14, fontWeight: "900" }}>{request.services.name_ar}</Text>}
            <Text style={{ color: palette.ink, fontSize: 18, fontWeight: "900" }}>طلبك وصل إلى ممنون</Text>
            <Text style={{ color: palette.muted, fontSize: 12, textAlign: "center", lineHeight: 20 }}>
              {request.vehicle_category === "large" ? "نبحث عن أصحاب السيارات المناسبة، وستظهر لك عروض الأسعار عند وصولها." : request.type === "service" ? "نستقبل موافقات الفنيين إلى أن يكتمل العدد المطلوب أو تختار الاكتفاء بالفريق المتوفر." : "نبحث عن أقرب سائق أو فني متاح ومؤهل. أول شخص يقبل الطلب يحصل عليه."}
            </Text>
            {(() => {
              const start = Date.parse(request.searching_started_at || request.created_at || new Date().toISOString());
              const totalSeconds = 360 * (request.type === "service" ? Math.max(1, Number(request.workers_count) || 1) : 1);
              const remaining = Math.max(0, totalSeconds - Math.floor((dispatchClock - start) / 1000));
              return <View style={{ width: 104, height: 104, borderRadius: 52, borderWidth: 7, borderColor: remaining <= 10 && remaining > 0 ? palette.danger : palette.gold, alignItems: "center", justifyContent: "center", marginTop: 8, backgroundColor: remaining <= 10 && remaining > 0 ? palette.dangerSoft : palette.surface, opacity: remaining <= 10 && remaining > 0 ? 0.78 + (dispatchClock % 2) * 0.22 : 1 }}>
                <Text style={{ color: palette.ink, fontSize: 23, fontWeight: "900", fontVariant: ["tabular-nums"] }}>{String(Math.floor(remaining / 60)).padStart(2, "0")}:{String(remaining % 60).padStart(2, "0")}</Text>
                <Text style={{ color: palette.muted, fontSize: 10, fontWeight: "800" }}>وقت البحث</Text>
              </View>;
            })()}
            {request.type === "service" && <Text style={{ color: palette.brand, fontSize: 13, fontWeight: "900", textAlign: "center" }}>الفريق المؤكد: {acceptedPeopleCount} من {request.workers_count ?? 1} · المتبقي: {remainingPeopleCount}</Text>}
            <Text style={{ color: palette.muted, fontSize: 11, textAlign: "center" }}>{request.vehicle_category === "large" ? "ثلاثة نطاقات بحث، ثم نعيد المحاولة. إذا وصلت عروض تبقى متاحة حتى تختار." : request.type === "service" ? (Number(request.workers_count || 1) > 1 ? "نبحث عن بقية أفراد الفريق، وعند انتهاء الجولة تختار تثبيت الموجودين أو استئناف البحث." : "نبحث عن فني متاح ضمن نطاقات البحث المعتادة.") : "ثلاثة نطاقات بحث، ونعيد المحاولة مرة ثانية قبل إنهاء البحث."}</Text>
            {request.type === "service" && acceptedPeopleCount > 0 && !(request as any).staffing_search_paused_at && (
              <TouchableOpacity
                onPress={async () => {
                  const { error } = await (supabase as any).rpc("stop_service_request_acceptance", { _request_id: id });
                  if (error) Alert.alert("تعذر تثبيت العدد", error.message);
                  else { Alert.alert("تم تثبيت العدد الحالي"); await loadRequest(); }
                }}
                style={{ width: "100%", borderRadius: 14, padding: 13, backgroundColor: palette.success, marginTop: 6 }}
              >
                <Text style={{ color: "#FFFFFF", fontWeight: "900", textAlign: "center" }}>تثبيت العدد الحالي ({acceptedPeopleCount})</Text>
              </TouchableOpacity>
            )}
            {request.type === "service" && (request as any).staffing_search_paused_at && (
              <View style={{ width: "100%", marginTop: 8, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: palette.gold, backgroundColor: palette.goldSoft, gap: 8 }}>
                <Text style={{ color: palette.ink, fontWeight: "900", textAlign: "center" }}>انتهت جولة البحث</Text>
                <Text style={{ color: palette.muted, fontSize: 12, textAlign: "center" }}>الفريق المثبّت: {acceptedPeopleCount} من {request.workers_count ?? 1} · المتبقي: {remainingPeopleCount}</Text>
                {acceptedPeopleCount > 0 && <TouchableOpacity
                  onPress={async () => {
                    const { error } = await (supabase as any).rpc("stop_service_request_acceptance", { _request_id: id });
                    if (error) Alert.alert("تعذر تثبيت العدد", error.message);
                    else { Alert.alert("تم تثبيت العدد الحالي"); await loadRequest(); }
                  }}
                  style={{ width: "100%", borderRadius: 12, padding: 13, backgroundColor: palette.success }}
                ><Text style={{ color: "#FFFFFF", fontWeight: "900", textAlign: "center" }}>تثبيت العدد الحالي ({acceptedPeopleCount})</Text></TouchableOpacity>}
                <TouchableOpacity
                  onPress={async () => {
                    const { error } = await (supabase as any).rpc("resume_service_request_staffing", { _request_id: id });
                    if (error) Alert.alert("تعذر استئناف البحث", error.message);
                    else { Alert.alert("تم استئناف البحث", `نبحث الآن عن ${remainingPeopleCount} أشخاص إضافيين.`); await loadRequest(); }
                  }}
                  style={{ width: "100%", borderRadius: 12, padding: 13, backgroundColor: palette.brand }}
                ><Text style={{ color: "#FFFFFF", fontWeight: "900", textAlign: "center" }}>البحث عن الفنيين الباقين ({remainingPeopleCount})</Text></TouchableOpacity>
              </View>
            )}
            {urgencyAllowed && Number(request.customer_price ?? request.price_estimate ?? 0) > 0 && <View style={{ width: "100%", marginTop: 8, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: palette.gold, backgroundColor: palette.goldSoft }}>
              <Text style={{ color: palette.ink, fontSize: 14, fontWeight: "900", textAlign: "right" }}>⚡ وضع الاستعجال</Text>
              <Text style={{ color: palette.muted, fontSize: 11, textAlign: "right", marginTop: 4 }}>نسبة الزيادة الأساسية من الإدارة: {urgencyAdminPercent}٪. اختر ×2 أو ×3 لرفع الأجر وتشجيع المزوّدين على قبول الطلب.</Text>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                <TouchableOpacity disabled={urgencyBusy} onPress={() => void applyRequestUrgency(2)} style={{ flex: 1, borderRadius: 12, padding: 12, alignItems: "center", backgroundColor: palette.gold, opacity: urgencyBusy ? 0.5 : 1 }}><Text style={{ color: palette.brandDeep, fontWeight: "900" }}>×2 استعجال</Text></TouchableOpacity>
                <TouchableOpacity disabled={urgencyBusy} onPress={() => void applyRequestUrgency(3)} style={{ flex: 1, borderRadius: 12, padding: 12, alignItems: "center", backgroundColor: palette.brand, opacity: urgencyBusy ? 0.5 : 1 }}><Text style={{ color: palette.white, fontWeight: "900" }}>×3 أقصى استعجال</Text></TouchableOpacity>
              </View>
              {Number(request.urgency_multiplier ?? 1) > 1 && <Text style={{ color: palette.success, fontSize: 11, fontWeight: "900", textAlign: "right", marginTop: 8 }}>مفعّل حالياً ×{request.urgency_multiplier} · زيادة {Number(request.urgency_percent ?? 0)}٪</Text>}
            </View>}
            {isCustomer && request.type === "taxi" && request.vehicle_category !== "large" && (
              <View style={{ width: "100%", marginTop: 8, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: palette.gold, backgroundColor: palette.surface }}>
                {request.taxi_urgency_enabled ? (
                  <Text style={{ color: palette.brand, textAlign: "right", fontWeight: "900" }}>⚡ وضع الاستعجال مفعّل — {Number(request.taxi_urgency_percent || 0)}٪</Text>
                ) : (
                  <TouchableOpacity onPress={enableTaxiUrgency} disabled={taxiUrgencyBusy} style={{ paddingVertical: 7, opacity: taxiUrgencyBusy ? 0.5 : 1 }}>
                    <Text style={{ color: palette.brand, textAlign: "right", fontWeight: "900" }}>{taxiUrgencyBusy ? "جارٍ تفعيل الاستعجال..." : "⚡ تفعيل وضع الاستعجال أثناء البحث"}</Text>
                    <Text style={{ color: palette.muted, textAlign: "right", fontSize: 10, marginTop: 3 }}>تُضاف الزيادة المحددة من الإدارة إلى الأجرة ويُعاد إرسال الطلب للسائقين</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
            {isCustomer && ["pending", "searching"].includes(request.status) && (
              <View style={{ width: "100%", marginTop: 8, padding: 12, borderRadius: 14, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line }}>
                <Text style={{ color: palette.ink, fontSize: 12, fontWeight: "900", textAlign: "right" }}>تأخر القبول؟ تگدر ترفع السعر حتى تشجع مزودين أكثر</Text>
                <TextInput value={retryPriceIncrease} onChangeText={setRetryPriceIncrease} keyboardType="number-pad" placeholder="مقدار الزيادة بالدينار" placeholderTextColor={palette.muted} style={{ marginTop: 8, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.canvas, color: palette.ink, borderRadius: 12, padding: 11, textAlign: "center", fontWeight: "900" }} />
                <TouchableOpacity disabled={retryingDispatch} onPress={retryDispatch} style={[styles.actionBtn, { marginTop: 8, opacity: retryingDispatch ? 0.5 : 1 }]}>
                  <Text style={styles.actionBtnText}>{retryingDispatch ? "جارٍ تحديث السعر..." : "رفع السعر وإعادة البحث"}</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
        {isCustomer && request.status === "cancelled" && request.payment_method === "zaincash" && (
          <View style={{ marginTop: 14, borderRadius: 18, padding: 16, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.gold, gap: 8 }}>
            <Text style={{ color: palette.ink, fontSize: 16, fontWeight: "900", textAlign: "right" }}>متابعة إلغاء واسترداد زين كاش</Text>
            <Text style={{ color: palette.muted, fontSize: 12, lineHeight: 20, textAlign: "right" }}>تم تسجيل إلغاء الطلب المدفوع بزين كاش. ستصلك إشعارات عند صدور قرار الإدارة أو تسجيل إعادة المبلغ. لم يتم أي تحويل تلقائي.</Text>
            <TouchableOpacity onPress={() => router.push({ pathname: "/support-chat", params: { requestId: request.id } })} style={[styles.actionBtn, { backgroundColor: palette.brand }]}>
              <Text style={styles.actionBtnText}>مراسلة شركة ممنون بخصوص هذا الطلب</Text>
            </TouchableOpacity>
          </View>
        )}
        {isCustomer && request.status === "cancelled" && request.cancellation_reason === "dispatch_no_provider" && (
          <View style={{ marginTop: 14, borderRadius: 22, padding: 18, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.gold }}>
            <Text style={{ color: palette.ink, fontSize: 17, fontWeight: "900", textAlign: "right" }}>🤍 نعتذر منك، ما حصلنا مزوّد متاح</Text>
            <Text style={{ color: palette.muted, fontSize: 12, lineHeight: 20, textAlign: "right", marginTop: 6 }}>احتفظنا بكل تفاصيل طلبك. تگدر تعيد المحاولة بنفس الطلب أو ترفع السعر حتى تشجع مزوّدين أكثر.</Text>
            <Text style={{ color: palette.muted, fontSize: 11, fontWeight: "800", textAlign: "right", marginTop: 12 }}>زيادة السعر اختيارياً (دينار عراقي)</Text>
            <TextInput value={retryPriceIncrease} onChangeText={setRetryPriceIncrease} keyboardType="number-pad" placeholder="0" placeholderTextColor={palette.muted} style={{ marginTop: 7, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.canvas, color: palette.ink, borderRadius: 13, padding: 12, textAlign: "center", fontWeight: "900" }} />
            <TouchableOpacity disabled={retryingDispatch} onPress={retryDispatch} style={[styles.actionBtn, { marginTop: 10, opacity: retryingDispatch ? 0.5 : 1 }]}>
              <Text style={styles.actionBtnText}>{retryingDispatch ? "جارٍ إعادة البحث..." : Number(retryPriceIncrease) > 0 ? "إعادة الطلب مع رفع السعر" : "إعادة نفس الطلب"}</Text>
            </TouchableOpacity>
          </View>
        )}
        {activeOffer && !isCustomer && activeOffer.proposed_price == null && (
          <View style={{ marginTop: 14, borderRadius: 20, padding: 14, backgroundColor: palette.surface, borderWidth: 1, borderColor: urgentOfferFlash ? palette.danger : palette.gold, alignItems: "center" }}>
            <Text style={{ color: urgentOfferFlash ? palette.danger : palette.ink, fontWeight: "900", fontSize: 14 }}>{activeOfferSeconds !== null && activeOfferSeconds <= 10 ? "🚨 انتبه، قرب ينتهي الطلب" : "⏳ عندك دقيقة لقبول الطلب"}</Text>
            <Text style={{ color: urgentOfferFlash ? palette.danger : palette.brand, fontWeight: "900", fontSize: 26, fontVariant: ["tabular-nums"], marginTop: 5 }}>
              {(() => { const seconds = activeOfferSeconds ?? 0; return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`; })()}
            </Text>
            {activeOffer.distance_km != null && <Text style={{ color: palette.muted, fontSize: 11, marginTop: 4 }}>المسافة من موقعك: {Number(activeOffer.distance_km).toFixed(1)} كم</Text>}
          </View>
        )}
        {isCustomer && ["accepted","in_progress","completed"].includes(request.status) && request.payment_method !== "zaincash" && Number(request.customer_payable ?? request.customer_price ?? request.price_estimate) > 0 && (
          <View style={styles.paymentCompact}><View style={{ flex: 1 }}><Text style={styles.paymentCompactTitle}>الدفع الإلكتروني · زين كاش</Text><Text style={styles.paymentCompactHint}>{paymentGatewayEnabled ? "الدفع متاح" : "غير متاح حالياً"}</Text></View><TouchableOpacity onPress={payRequestWithZainCash} disabled={paymentBusy || !paymentGatewayEnabled} style={[styles.paymentCompactButton, (!paymentGatewayEnabled || paymentBusy) && { opacity: 0.5 }]}><Text style={styles.paymentCompactButtonText}>{paymentBusy ? "..." : "ادفع"}</Text></TouchableOpacity></View>
        )}
        {request.vehicle_category === "large" && isCustomer && ["pending", "searching"].includes(request.status) && (
          <View style={styles.largeOffersCard}>
            <Text style={styles.largeOffersTitle}>عروض أصحاب السيارات</Text>
            {largeOffers.length === 0 ? (
              <Text style={styles.largeOffersEmpty}>بانتظار أصحاب السيارات يرسلون أسعارهم...</Text>
            ) : largeOffers.map((offer) => (
              <View key={offer.id} style={styles.largeOfferItem}>
                <Text style={styles.largeOfferName}>{offer.profile?.full_name || "صاحب سيارة"}</Text>
                <Text style={styles.largeOfferPrice}>{Number(offer.proposed_price).toLocaleString("en")} د.ع</Text>
                {!!offer.offer_message && <Text style={styles.largeOfferMessage}>{offer.offer_message}</Text>}
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <TouchableOpacity
                    style={[styles.largeOfferAccept, { flex: 1, backgroundColor: palette.muted }]}
                    disabled={!!acceptingLargeOffer}
                    onPress={() => rejectLargeOffer(offer.id)}
                  >
                    <Text style={styles.largeOfferAcceptText}>رفض</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.largeOfferAccept, { flex: 1 }]}
                    disabled={!!acceptingLargeOffer}
                    onPress={() => acceptLargeOffer(offer.id)}
                  >
                    <Text style={styles.largeOfferAcceptText}>{acceptingLargeOffer === offer.id ? "جارٍ التنفيذ..." : "الموافقة"}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
            <TouchableOpacity
              style={[styles.largeOfferAccept, { backgroundColor: palette.gold }]}
              disabled={retryingLargeOffers}
              onPress={retryLargeOffers}
            >
              <Text style={styles.largeOfferAcceptText}>{retryingLargeOffers ? "جارٍ إعادة الإرسال..." : "إعادة إرسال الطلب لأصحاب السيارات"}</Text>
            </TouchableOpacity>
          </View>
        )}
        {request.vehicle_category === "large" && !isCustomer && roles.includes("large_driver") && ["pending", "searching"].includes(request.status) && (
          <View style={styles.largeOffersCard}>
            <Text style={styles.largeOffersTitle}>🚚 طلب سيارة كبيرة</Text>
            <Text style={{ color: palette.muted, fontSize: 12, textAlign: "right", lineHeight: 20, marginBottom: 10 }}>
              اختَر الطريقة المناسبة: اقبل أجرة الزبون مباشرة إذا تناسبك، أو اكتب أجرتك وأرسل عرضاً جديداً.
            </Text>
            {Number(request.customer_price ?? request.customer_payable ?? request.price_estimate ?? 0) > 0 ? (
              <View style={{ backgroundColor: palette.goldSoft, borderWidth: 1, borderColor: palette.gold, borderRadius: 14, padding: 12, marginBottom: 10 }}>
                <Text style={{ color: palette.muted, fontSize: 11, textAlign: "right" }}>الأجرة التي حددها الزبون</Text>
                <Text style={{ color: palette.brand, fontSize: 22, fontWeight: "900", textAlign: "right", marginTop: 3 }}>
                  {Number(request.customer_price ?? request.customer_payable ?? request.price_estimate).toLocaleString("en")} د.ع
                </Text>
                <TouchableOpacity
                  style={[styles.largeOfferAccept, { marginTop: 10, backgroundColor: palette.success, opacity: acceptingLargeRequest ? 0.55 : 1 }]}
                  disabled={acceptingLargeRequest || largeOfferBusy}
                  onPress={acceptLargeVehicleRequest}
                >
                  <Text style={styles.largeOfferAcceptText}>{acceptingLargeRequest ? "جارٍ قبول الطلب..." : "قبول الطلب بهذه الأجرة"}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <Text style={styles.largeOffersEmpty}>الزبون ما محدد أجرة؛ تگدر ترسل أجرتك المقترحة أدناه.</Text>
            )}
            {myLargeOffer?.proposed_price ? (
              <Text style={styles.largeOffersEmpty}>عرضك الحالي: {Number(myLargeOffer.proposed_price).toLocaleString("en")} د.ع — تگدر تعدله وترسله من جديد.</Text>
            ) : null}
            <Text style={{ color: palette.ink, fontSize: 12, fontWeight: "900", textAlign: "right", marginTop: 5 }}>أجرتك المقترحة (دينار عراقي)</Text>
            <TextInput
              style={styles.largeOfferInput}
              value={largeOfferPrice}
              onChangeText={(value) => setLargeOfferPrice(normalizeCashDigits(value))}
              placeholder="مثال: 25000"
              placeholderTextColor="#94a3b8"
              keyboardType="number-pad"
              editable={!largeOfferBusy && !acceptingLargeRequest}
            />
            <Text style={{ color: palette.muted, fontSize: 10, textAlign: "right", marginTop: 5 }}>
              من 250 إلى 50,000 دينار، ويكون من مضاعفات 250.
            </Text>
            <Text style={{ color: palette.ink, fontSize: 12, fontWeight: "900", textAlign: "right", marginTop: 12 }}>ملاحظة للزبون (اختياري)</Text>
            <TextInput
              style={[styles.largeOfferInput, { minHeight: 76, textAlignVertical: "top" }]}
              value={largeOfferMessage}
              onChangeText={setLargeOfferMessage}
              placeholder="مثلاً: أگدر أوصل خلال نصف ساعة"
              placeholderTextColor="#94a3b8"
              multiline
              editable={!largeOfferBusy && !acceptingLargeRequest}
            />
            <TouchableOpacity
              style={[styles.largeOfferAccept, { opacity: largeOfferBusy || acceptingLargeRequest ? 0.55 : 1 }]}
              disabled={largeOfferBusy || acceptingLargeRequest}
              onPress={sendLargeVehicleOffer}
            >
              <Text style={styles.largeOfferAcceptText}>{largeOfferBusy ? "جارٍ إرسال العرض..." : myLargeOffer?.proposed_price ? "تحديث وإرسال العرض" : "إرسال عرض السعر للزبون"}</Text>
            </TouchableOpacity>
          </View>
        )}
        {!acceptedMapMode && isActive &&
          (request.pickup_lat != null && request.pickup_lng != null || myLocation != null || otherLocation != null) && (
            <View style={styles.trackingCard}>
              {request.type !== "taxi" && <Text style={styles.trackingTitle}>موقع الطلب المباشر</Text>}
              <MapView
                style={[styles.trackingMap, request.type === "taxi" && styles.trackingMapTaxi]}
                initialRegion={{
                  latitude: request.pickup_lat ?? (isProvider ? otherLocation?.latitude : myLocation?.latitude) ?? myLocation?.latitude ?? 33.3152,
                  longitude: request.pickup_lng ?? (isProvider ? otherLocation?.longitude : myLocation?.longitude) ?? myLocation?.longitude ?? 44.3661,
                  latitudeDelta: 0.009,
                  longitudeDelta: 0.009,
                }}
                showsUserLocation={request.type !== "taxi"}
              >
                {roadRoutePoints.length > 1 && (
                  <Polyline
                    coordinates={roadRoutePoints}
                    strokeColor="#2563EB"
                    strokeWidth={6}
                  />
                )}
                {providerRoutePoints.length > 1 && (
                  <Polyline
                    coordinates={providerRoutePoints}
                    strokeColor="#D6A43B"
                    strokeWidth={5}
                    geodesic
                  />
                )}
                {request.type === "taxi" ? (
                  <>
                    {(isProvider ? myLocation : otherLocation) && <TaxiCarMarker coordinate={(isProvider ? myLocation : otherLocation)!} heading={(isProvider ? myLocation : otherLocation)?.heading} />}
                    {(isProvider ? otherLocation : myLocation) && <LocationTargetMarker coordinate={(isProvider ? otherLocation : myLocation)!} title={isProvider ? "موقع الزبون" : "موقعك"} />}
                  </>
                ) : (
                  <>
                    {(request.pickup_lat != null && request.pickup_lng != null) && <Marker coordinate={{ latitude: request.pickup_lat, longitude: request.pickup_lng }} title="موقع العمل" pinColor="#0f766e" />}
                    {request.pickup_lat == null && request.pickup_lng == null && (isProvider ? otherLocation : myLocation) && <LocationTargetMarker coordinate={(isProvider ? otherLocation : myLocation)!} title="موقع الزبون" />}
                    {request.dest_lat != null && request.dest_lng != null && <DestinationMarker coordinate={{ latitude: request.dest_lat, longitude: request.dest_lng }} />}
                    {myLocation && <LocationTargetMarker coordinate={myLocation} title={isProvider ? "موقعي كفني" : "موقعي"} />}
                    {otherLocation && <LocationTargetMarker coordinate={otherLocation} title={isProvider ? "موقع الزبون" : "موقع الفني"} />}
                  </>
                )}
              </MapView>
              {request.type !== "taxi" && <Text style={styles.trackingHint}>
                {isCustomer
                  ? request.provider_arrived_at
                    ? "وصل مقدم الخدمة إلى الموقع"
                    : driverEtaMinutes != null
                      ? `مقدم الخدمة بالطريق إليك · الوصول المتوقع خلال ${driverEtaMinutes} دقيقة`
                      : providerRoutePoints.length > 1
                        ? "مقدم الخدمة بالطريق إليك · موقعه يتحدث مباشرة"
                        : driverLocationFresh
                          ? "تم قبول الطلب · موقع مقدم الخدمة مباشر"
                          : "بانتظار تحديث موقع مقدم الخدمة"
                  : driverLocationFresh
                    ? "موقعك وموقع الزبون ظاهران مباشرة"
                    : "بانتظار تحديث موقع الزبون"}
              </Text>}
            </View>
          )}
        {request.status === "accepted" &&
          ((isProvider && (request.type === "taxi" || request.type === "service")) ||
            (isCustomer && request.type === "taxi" && request.dest_lat != null && request.dest_lng != null)) && (
          <View style={styles.navigationPanel}>
            <Text style={styles.navigationButtonText}>
              🧭 {isCustomer ? "تحديد المسار إلى وجهتك" : request.type === "service" ? "تحديد المسار إلى موقع العمل" : "تحديد المسار إلى الزبون"}
            </Text>
            <Text style={styles.navigationButtonHint}>افتح المسار مباشرةً في تطبيق موثوق</Text>
            <View style={styles.navigationAppsRow}>
              <TouchableOpacity style={styles.navigationApp} onPress={() => openTaxiNavigation("google")}>
                <Image source={{ uri: "https://cdn.simpleicons.org/googlemaps/4285F4" }} style={styles.navigationAppIcon} resizeMode="contain" />
                <Text style={styles.navigationAppLabel}>خرائط Google</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.navigationApp} onPress={() => openTaxiNavigation("waze")}>
                <Image source={{ uri: "https://cdn.simpleicons.org/waze/33CCFF" }} style={styles.navigationAppIcon} resizeMode="contain" />
                <Text style={styles.navigationAppLabel}>Waze</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        <View style={styles.actionsRow}>
          {["pending", "searching"].includes(request.status) && canAccept && request.vehicle_category !== "large" && (
            <TouchableOpacity style={styles.actionBtn} onPress={acceptRequest}>
              <Text style={styles.actionBtnText}>قبول الطلب</Text>
            </TouchableOpacity>
          )}
          {request.status === "accepted" && isProvider &&
            (request.type !== "taxi" || request.vehicle_category === "large") &&
            !request.provider_arrived_at && (
              <TouchableOpacity style={styles.actionBtn} onPress={markProviderArrived} disabled={transitionBusy}>
                <Text style={styles.actionBtnText}>{transitionBusy ? "جارٍ التأكيد..." : request.vehicle_category === "large" ? "وصلت للزبون" : "وصلت للموقع"}</Text>
              </TouchableOpacity>
          )}
          {request.status === "accepted" && isProvider &&
            ((request.type === "taxi" && request.vehicle_category !== "large") || !!request.provider_arrived_at) && (
              <TouchableOpacity style={styles.actionBtn} onPress={startRide} disabled={transitionBusy}>
                <Text style={styles.actionBtnText}>{transitionBusy ? "جارٍ البدء..." : request.type === "taxi" ? "ركب الزبون" : "بدء تنفيذ الخدمة"}</Text>
              </TouchableOpacity>
          )}
          {request.status === "in_progress" && isProvider && (
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: palette.success }]}
              onPress={completeRide}
              disabled={transitionBusy}
            >
              <Text style={styles.actionBtnText}>تأكيد الإكمال</Text>
            </TouchableOpacity>
          )}
          {cashSettlementOpen && request.status === "in_progress" && isProvider && (
            <View style={{ backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.lg, padding: 14, gap: 10 }}>
              <Text style={{ color: palette.ink, fontSize: 15, fontWeight: "900", textAlign: "right" }}>تسوية المبلغ النقدي</Text>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ color: palette.muted, fontSize: 12 }}>الأجرة المطلوبة</Text>
                <Text style={{ color: palette.ink, fontSize: 12, fontWeight: "900" }}>{Number(request.customer_payable ?? request.customer_price ?? request.price_estimate ?? 0).toLocaleString("ar-IQ")} د.ع</Text>
              </View>
              {request.payment_method === "zaincash" ? (
                <Text style={{ color: palette.muted, fontSize: 12, textAlign: "right" }}>الطلب مدفوع إلكترونياً؛ لا يوجد مبلغ نقدي مستلم.</Text>
              ) : (
                <>
                  <TouchableOpacity
                    onPress={() => setCashReceivedInput(String(Math.max(0, Math.round(Number(request.customer_payable ?? request.customer_price ?? request.price_estimate ?? 0)))))}
                    style={{ borderWidth: 1, borderColor: palette.brand, borderRadius: 10, padding: 11, alignItems: "center" }}
                  >
                    <Text style={{ color: palette.brand, fontWeight: "900", fontSize: 12 }}>استلمت الأجرة بالضبط</Text>
                  </TouchableOpacity>
                  <Text style={{ color: palette.ink, fontSize: 12, fontWeight: "800", textAlign: "right" }}>كم استلمت من الزبون نقداً؟</Text>
                  <TextInput
                    value={cashReceivedInput}
                    onChangeText={(value) => setCashReceivedInput(normalizeCashDigits(value))}
                    keyboardType="number-pad"
                    placeholder="مثلاً 5000"
                    placeholderTextColor={palette.muted}
                    style={{ borderWidth: 1, borderColor: palette.line, borderRadius: 10, padding: 12, color: palette.ink, textAlign: "right", fontWeight: "900" }}
                  />
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ color: palette.muted, fontSize: 12 }}>الباقي للزبون</Text>
                    <Text style={{ color: palette.brand, fontSize: 12, fontWeight: "900" }}>{Math.max(0, (Number(cashReceivedInput) || 0) - Number(request.customer_payable ?? request.customer_price ?? request.price_estimate ?? 0)).toLocaleString("ar-IQ")} د.ع</Text>
                  </View>
                </>
              )}
              <TouchableOpacity
                onPress={() => void submitCashSettlement()}
                disabled={transitionBusy}
                style={[styles.actionBtn, { backgroundColor: palette.success, opacity: transitionBusy ? 0.55 : 1 }]}
              >
                <Text style={styles.actionBtnText}>{transitionBusy ? "جارٍ تسجيل المبلغ..." : "تأكيد المبلغ وإنهاء الطلب"}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setCashSettlementOpen(false)} disabled={transitionBusy} style={{ padding: 8, alignItems: "center" }}>
                <Text style={{ color: palette.muted, fontWeight: "800", fontSize: 12 }}>رجوع</Text>
              </TouchableOpacity>
            </View>
          )}
          {(isCustomer || (isProvider && request.type === "service")) &&
            request.status !== "cancelled" &&
            request.status !== "completed" &&
            request.status !== "in_progress" &&
            !request.provider_arrived_at && (
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: palette.danger }]}
                onPress={cancelRequest}
              >
                <Text style={styles.actionBtnText}>{isProvider ? "اعتذار وإعادة البحث عن فني" : "إلغاء الطلب"}</Text>
              </TouchableOpacity>
            )}
        </View>

        {["in_progress", "completed"].includes(request.status) && (isCustomer ? !!request.provider_id : !!request.customer_id) && (
          <View style={styles.reportCard}>
            {!showReportForm ? (
              <TouchableOpacity onPress={() => setShowReportForm(true)} style={styles.reportButton}>
                <Text style={styles.reportButtonText}>إبلاغ عن {isCustomer ? (request.type === "taxi" ? "السائق" : "الفني") : "الزبون"}</Text>
                <Text style={styles.reportButtonArrow}>إرسال بلاغ ←</Text>
              </TouchableOpacity>
            ) : (
              <View style={{ gap: 10 }}>
                <Text style={styles.reportTitle}>تفاصيل البلاغ للإدارة</Text>
                <View style={{ gap: 7 }}>
                  <Text style={{ color: palette.muted, fontSize: 11, fontWeight: "900", textAlign: "right" }}>اختر تصنيف البلاغ</Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7 }}>
                    {["مشكلة أثناء الرحلة أو الخدمة", "سلوك غير مناسب", "مشكلة في السعر أو الاتفاق", "تأخير أو عدم التزام", "ضرر أو فقدان ممتلكات", "سلامة أو قيادة خطرة", "أخرى"].map((item) => <TouchableOpacity key={item} onPress={() => setReportReason(item)} style={{ paddingHorizontal: 10, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: reportReason === item ? palette.brand : palette.line, backgroundColor: reportReason === item ? palette.brandSoft : palette.surface }}><Text style={{ color: reportReason === item ? palette.brand : palette.ink, fontSize: 10, fontWeight: "800" }}>{item}</Text></TouchableOpacity>)}
                  </View>
                </View>
                <TextInput value={reportDetails} onChangeText={setReportDetails} placeholder="اشرح المشكلة بوضوح: ماذا حدث؟ ومتى؟ وأي تفاصيل تساعد الإدارة على التحقق؟" placeholderTextColor="#94a3b8" multiline maxLength={1500} style={[styles.reportInput, { minHeight: 92, textAlignVertical: "top" }]} />
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <TouchableOpacity onPress={() => setShowReportForm(false)} style={[styles.reportAction, { backgroundColor: palette.surfaceSoft }]}><Text style={{ color: palette.ink, fontWeight: "900" }}>إلغاء</Text></TouchableOpacity>
                  <TouchableOpacity disabled={reportBusy} onPress={submitUserReport} style={styles.reportAction}><Text style={{ color: palette.white, fontWeight: "900" }}>{reportBusy ? "جارٍ الإرسال..." : "إرسال البلاغ للإدارة"}</Text></TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        )}
        {!["completed", "cancelled"].includes(request.status) ? null : (
          <View style={styles.chatClosed}>
            <Text style={styles.chatClosedTitle}>{request.status === "completed" ? "اكتمل الطلب" : "تم إلغاء الطلب"}</Text>
            <Text style={styles.chatClosedText}>انتهت المحادثة وتم إخفاء بيانات الطرف الآخر.</Text>
            {isCustomer && Number(request.cash_change_iqd ?? 0) > 0 ? (
              <Text style={{ color: palette.brand, fontSize: 12, fontWeight: "900", textAlign: "center", marginTop: 8 }}>
                تم إرجاع باقي المبلغ إلى محفظتك: {Number(request.cash_change_iqd).toLocaleString("ar-IQ")} د.ع
              </Text>
            ) : null}
          </View>
        )}
        </ScrollView>
        {showCancelSheet && (
          <View style={styles.cancelOverlay}>
            <View style={styles.cancelCard}>
              <View style={styles.feedbackHandle} />
              <View style={styles.feedbackHeader}>
                <View style={styles.cancelIconBadge}><Text style={{ fontSize: 22 }}>✦</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.feedbackEyebrow}>MAMNOON • REQUEST CONTROL</Text>
                  <Text style={styles.cancelTitle}>{isCustomer ? (request.type === "taxi" ? "إلغاء الرحلة" : "إلغاء الطلب") : "الاعتذار عن الطلب"}</Text>
                  <Text style={styles.feedbackSubtitle}>اختَر السبب الأقرب حتى نوثّق الإجراء ونحسّن الخدمة</Text>
                </View>
                <TouchableOpacity onPress={() => setShowCancelSheet(false)} style={styles.feedbackClose}><Text style={styles.feedbackCloseText}>×</Text></TouchableOpacity>
              </View>
              <ScrollView style={styles.feedbackOptionsScroll} contentContainerStyle={styles.feedbackOptions} showsVerticalScrollIndicator={false}>
                {(isCustomer ? customerCancelReasons : providerCancelReasons).map((reason, index) => {
                  const selected = cancelReason === reason;
                  return (
                    <TouchableOpacity key={reason} onPress={() => { setCancelReason(reason); setCancelError(""); }} activeOpacity={0.82} style={[styles.reasonChoice, selected && styles.reasonChoiceSelected]}>
                      <View style={[styles.reasonIndex, selected && styles.reasonIndexSelected]}><Text style={[styles.reasonIndexText, selected && styles.reasonIndexTextSelected]}>{selected ? "✓" : String(index + 1).padStart(2, "0")}</Text></View>
                      <Text style={[styles.reasonChoiceText, selected && styles.reasonChoiceTextSelected]}>{reason}</Text>
                      <View style={[styles.reasonRadio, selected && styles.reasonRadioSelected]}>{selected && <View style={styles.reasonRadioDot} />}</View>
                    </TouchableOpacity>
                  );
                })}
                {cancelReason === "سبب آخر" && (
                  <TextInput value={cancelOtherReason} onChangeText={(value) => { setCancelOtherReason(value.slice(0, 280)); setCancelError(""); }} placeholder="اكتب سبب الإلغاء..." placeholderTextColor="#94A3B8" multiline maxLength={280} style={styles.feedbackNoteInput} />
                )}
                {!!cancelError && <Text style={styles.feedbackError}>{cancelError}</Text>}
              </ScrollView>
              <View style={styles.feedbackFooter}>
                <TouchableOpacity onPress={() => setShowCancelSheet(false)} disabled={cancelBusy} style={styles.feedbackBackButton}><Text style={styles.feedbackBackText}>رجوع</Text></TouchableOpacity>
                <TouchableOpacity onPress={submitCancellation} disabled={cancelBusy || !cancelReason || (cancelReason === "سبب آخر" && cancelOtherReason.trim().length < 2)} style={[styles.feedbackConfirmButton, (cancelBusy || !cancelReason || (cancelReason === "سبب آخر" && cancelOtherReason.trim().length < 2)) && { opacity: 0.5 }]}>
                  <Text style={styles.feedbackConfirmText}>{cancelBusy ? "جارٍ الإلغاء..." : "تأكيد الإلغاء"}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
        {showRating && (
          <View style={styles.ratingOverlay}>
            <View style={styles.ratingCard}>
              <View style={styles.feedbackHandle} />
              <Text style={styles.feedbackEyebrow}>MAMNOON • VERIFIED FEEDBACK</Text>
              <Text style={styles.ratingTitle}>{isProvider ? "قيّم تجربة الزبون" : request.type === "taxi" ? "قيّم رحلتك" : "قيّم الخدمة"}</Text>
              <Text style={styles.ratingSubtitle}>رأيك يساعد الناس تختار بثقة ويرفع جودة مجتمع ممنون</Text>
              <View style={styles.ratingHero}>
                <View style={styles.starsRow}>
                  {[1, 2, 3, 4, 5].map((s) => (
                    <TouchableOpacity key={s} onPress={() => setRating(s)} activeOpacity={0.75} style={[styles.starTap, s <= rating && styles.starTapActive]}>
                      <Text style={[styles.star, s <= rating && styles.starActive]}>★</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.ratingScore}>{rating ? ["", "ضعيف", "مقبول", "جيد", "جيد جداً", "ممتاز"][rating] : "اختَر تقييمك من نجمة إلى خمس نجوم"}</Text>
              </View>
              <ScrollView style={styles.ratingScroll} contentContainerStyle={styles.ratingScrollContent} showsVerticalScrollIndicator={false}>
                <View style={styles.criteriaPanel}>
                  {ratingCriteriaOptions.map((criterion) => (
                    <View key={criterion.key} style={styles.criteriaRow}>
                      <Text style={styles.criteriaLabel}>{criterion.label}</Text>
                      <View style={styles.criteriaStars}>
                        {[1, 2, 3, 4, 5].map((score) => (
                          <TouchableOpacity key={score} onPress={() => setRatingCriteria((current) => ({ ...current, [criterion.key]: score }))} style={styles.criteriaStarTap}>
                            <Text style={[styles.criteriaStar, score <= ratingCriteria[criterion.key] && styles.criteriaStarActive]}>★</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  ))}
                </View>
                <View style={styles.reasonHeader}>
                  <Text style={styles.reasonHeaderTitle}>شنو أكثر شي ميّز التجربة؟</Text>
                  <Text style={styles.reasonHeaderCount}>{ratingReasons.length}/12</Text>
                </View>
                <View style={styles.ratingChips}>
                  {ratingReasonOptions.map((reason) => {
                    const selected = ratingReasons.includes(reason);
                    const limitReached = ratingReasons.length >= 12 && !selected;
                    return (
                      <TouchableOpacity key={reason} disabled={limitReached} onPress={() => setRatingReasons((current) => selected ? current.filter((item) => item !== reason) : [...current, reason])} activeOpacity={0.82} style={[styles.ratingChip, selected && styles.ratingChipSelected, limitReached && { opacity: 0.4 }]}>
                        <Text style={[styles.ratingChipText, selected && styles.ratingChipTextSelected]}>{selected ? "✓  " : "+  "}{reason}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <TextInput value={ratingComment} onChangeText={setRatingComment} placeholder="اكتب ملاحظة اختيارية عن تجربتك..." placeholderTextColor="#94A3B8" multiline maxLength={500} style={styles.feedbackNoteInput} />
              </ScrollView>
              <View style={styles.ratingFooter}>
                <TouchableOpacity onPress={() => setShowRating(false)} disabled={ratingBusy} style={styles.feedbackBackButton}><Text style={styles.feedbackBackText}>لاحقاً</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.ratingSubmit, (rating === 0 || Object.values(ratingCriteria).some((value) => value < 1) || ratingBusy) && { opacity: 0.45 }]} disabled={rating === 0 || Object.values(ratingCriteria).some((value) => value < 1) || ratingBusy} onPress={submitRating}>
                  <Text style={styles.ratingSubmitText}>{ratingBusy ? "جارٍ حفظ التقييم..." : "إرسال التقييم"}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.pageCanvas },
  containerMap: { backgroundColor: "transparent" },
  fullScreenTrackingMap: { ...StyleSheet.absoluteFillObject, zIndex: 0 },
  headerOnMap: { backgroundColor: "rgba(255,255,255,0.94)", borderBottomColor: "rgba(15,23,42,0.10)", elevation: 4 },
  requestScrollOnMap: { position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "38%", backgroundColor: "rgba(255,255,255,0.96)", borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: "hidden", elevation: 8 },
  mapLiveBadge: { flexDirection: "row", alignItems: "center", alignSelf: "center", gap: 7, marginTop: 10, marginBottom: 3, paddingHorizontal: 13, paddingVertical: 8, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.96)", borderWidth: 1, borderColor: palette.line, elevation: 3 },
  mapLiveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: palette.success },
  mapLiveBadgeTitle: { color: palette.ink, fontSize: 11, fontWeight: "900" },
  mapLiveBadgeText: { color: palette.muted, fontSize: 10, fontWeight: "700" },
  requestScroll: { flex: 1 },
  requestScrollContent: { flexGrow: 1, paddingBottom: 28 },
  navigationPanel: { marginHorizontal: 16, marginBottom: 12, padding: 12, borderRadius: 16, backgroundColor: palette.brandSoft, borderWidth: 1, borderColor: palette.brand, alignItems: "center", gap: 8 },
  navigationAppsRow: { flexDirection: "row", width: "100%", gap: 8, marginTop: 4 },
  navigationApp: { flex: 1, minHeight: 74, paddingVertical: 8, borderRadius: 13, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, alignItems: "center", justifyContent: "center", gap: 5 },
  navigationAppIcon: { width: 30, height: 30 },
  navigationAppLabel: { color: palette.ink, fontSize: 10, fontWeight: "900" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: palette.pageCanvas },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingTop: 52, paddingBottom: 14, backgroundColor: palette.surface, borderBottomWidth: 1, borderBottomColor: palette.line },
  backBtn: { fontSize: 24, color: palette.brand, fontWeight: "900" },
  headerTitle: { fontSize: 17, fontWeight: "900", color: palette.ink },
  acceptedHint: { fontSize: 9, fontWeight: "800", color: palette.success, marginTop: 2 },
  personCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: palette.surface, borderRadius: radius.lg, padding: 15, marginHorizontal: 16, marginTop: 12, borderWidth: 1, borderColor: palette.line },
  personCardCompact: { padding: 8, gap: 8, marginTop: 7 },
  personAvatar: { width: 56, height: 56, borderRadius: 18, overflow: "hidden", backgroundColor: palette.brand, alignItems: "center", justifyContent: "center" },
  personAvatarImage: { width: "100%", height: "100%" },
  personAvatarText: { color: palette.white, fontSize: 23, fontWeight: "900" },
  personName: { color: palette.ink, fontSize: 15, fontWeight: "900" },
  personPhone: { color: palette.muted, fontSize: 12, marginTop: 3 },
  personRole: { color: palette.brand, fontSize: 11, fontWeight: "900", marginTop: 3 },
  personQuickActions: { flexDirection: "row", gap: 7, marginTop: 7 },
  personQuickButton: { minHeight: 36, borderRadius: 16, backgroundColor: palette.brandSoft, paddingHorizontal: 12, paddingVertical: 6, alignItems: "center", justifyContent: "center" },
  personQuickButtonText: { color: palette.brand, fontWeight: "900", fontSize: 11 },
  infoCard: { backgroundColor: palette.surface, borderRadius: radius.lg, padding: 17, margin: 16, borderWidth: 1, borderColor: palette.line },
  taxiInfoCard: { padding: 9, marginTop: 8, marginBottom: 8 },
  vehicleDetailsText: { fontSize: 11, color: palette.muted, marginTop: 3, textAlign: "right" },
  paymentCompact: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginHorizontal: 16, marginTop: 7, marginBottom: 7, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.surface },
  paymentCompactTitle: { fontSize: 11, fontWeight: "900", color: palette.ink, textAlign: "right" },
  paymentCompactHint: { fontSize: 9, color: palette.muted, marginTop: 2, textAlign: "right" },
  paymentCompactButton: { minHeight: 36, backgroundColor: palette.brand, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 6, alignItems: "center", justifyContent: "center" },
  paymentCompactButtonText: { color: palette.white, fontWeight: "900", fontSize: 11 },
  trackingCard: { backgroundColor: palette.surface, borderRadius: radius.lg, padding: 13, marginHorizontal: 16, marginBottom: 12, borderWidth: 1, borderColor: palette.line },
  trackingTitle: { fontSize: 15, fontWeight: "900", color: palette.ink, marginBottom: 10 },
  trackingMap: { height: 220, borderRadius: radius.md },
  trackingMapTaxi: { height: 340 },
  endpointPin: { width: 30, height: 38, alignItems: "center", justifyContent: "flex-start", paddingTop: 4, backgroundColor: "#17324D", borderRadius: 16, borderBottomLeftRadius: 4, transform: [{ rotate: "-45deg" }], borderWidth: 2, borderColor: "#FFFFFF", elevation: 7 },
  endpointPinCore: { width: 14, height: 14, borderRadius: 7, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  endpointPinDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#D6A43B" },
  destinationPin: { width: 34, height: 42, alignItems: "center", justifyContent: "flex-start", paddingTop: 5, borderRadius: 18, borderBottomLeftRadius: 4, transform: [{ rotate: "-45deg" }], borderWidth: 2.5, borderColor: "#FFFFFF", elevation: 10, shadowColor: "#9F1239", shadowOpacity: 0.35, shadowRadius: 5, shadowOffset: { width: 0, height: 3 }, overflow: "hidden" },
  destinationPinCore: { width: 16, height: 16, borderRadius: 8, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  destinationPinDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#C62828" },
  luxuryCarPhoto: { width: 32, height: 24, borderRadius: 12 },
  requestPhotoMarker: { width: 38, height: 38, borderRadius: 19, overflow: "hidden", borderWidth: 3, borderColor: "#FFFFFF", backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", elevation: 9, shadowColor: "#000", shadowOpacity: 0.28, shadowRadius: 5, shadowOffset: { width: 0, height: 2 } },
  requestPhotoMarkerImage: { width: 32, height: 32, borderRadius: 16 },
  mapTrafficLabel: { color: "#0F766E", fontSize: 9, fontWeight: "900" },
  luxuryCarMarker: { width: 38, height: 38, borderRadius: 19, backgroundColor: "#FFFFFF", borderWidth: 3, borderColor: "#FFFFFF", alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 7 },
  luxuryCarRoof: { position: "absolute", top: 3, width: 25, height: 12, borderTopLeftRadius: 10, borderTopRightRadius: 10, backgroundColor: "#24364A" },
  luxuryCarWindows: { position: "absolute", top: 5, width: 21, height: 7, borderRadius: 4, backgroundColor: "#9CC6D8" },
  luxuryCarFront: { position: "absolute", right: 2, width: 4, height: 8, borderRadius: 3, backgroundColor: "#F8E7A0" },
  luxuryCarWheelLeft: { position: "absolute", left: 8, bottom: -3, width: 7, height: 5, borderRadius: 3, backgroundColor: "#111827" },
  luxuryCarWheelRight: { position: "absolute", right: 8, bottom: -3, width: 7, height: 5, borderRadius: 3, backgroundColor: "#111827" },
  luxuryCarEmoji: { fontSize: 27 },
  chatToolbar: { flexDirection: "row", gap: 8, marginHorizontal: 16, marginTop: 8, marginBottom: 8 },
  chatToggleButton: { flex: 1, minHeight: 40, borderWidth: 1, borderColor: palette.line, borderRadius: 16, backgroundColor: palette.surface, paddingVertical: 8, alignItems: "center", justifyContent: "center" },
  chatToggleText: { color: palette.ink, fontWeight: "900", fontSize: 12 },
  soundToggleButton: { width: 48, height: 48, minHeight: 48, borderWidth: 1, borderColor: palette.line, borderRadius: 16, backgroundColor: palette.surface, alignItems: "center", justifyContent: "center" },
  soundToggleText: { fontSize: 18 },
  largeOffersCard: { backgroundColor: palette.surface, borderRadius: radius.lg, padding: 15, marginHorizontal: 16, marginTop: 12, borderWidth: 1, borderColor: palette.gold },
  largeOffersTitle: { fontSize: 16, fontWeight: "900", color: palette.brand, marginBottom: 10, textAlign: "right" },
  largeOffersEmpty: { fontSize: 12, color: palette.muted, textAlign: "right", marginBottom: 8 },
  largeOfferItem: { backgroundColor: palette.goldSoft, borderRadius: radius.md, padding: 13, marginBottom: 10, borderWidth: 1, borderColor: "#E9D9B5" },
  largeOfferName: { fontSize: 14, fontWeight: "900", color: palette.ink, textAlign: "right" },
  largeOfferPrice: { fontSize: 18, fontWeight: "900", color: palette.brand, textAlign: "right", marginTop: 4 },
  largeOfferMessage: { fontSize: 12, color: palette.muted, textAlign: "right", marginTop: 5 },
  largeOfferInput: { backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.line, paddingHorizontal: 12, paddingVertical: 12, color: palette.ink, marginTop: 8, textAlign: "right" },
  largeOfferAccept: { minHeight: 45, backgroundColor: palette.brand, borderRadius: 16, paddingVertical: 10, paddingHorizontal: 16, alignItems: "center", justifyContent: "center", marginTop: 8 },
  largeOfferAcceptText: { color: palette.white, fontWeight: "900", fontSize: 13 },
  trackingHint: { fontSize: 12, color: palette.muted, textAlign: "center", marginTop: 8 },
  serviceIllustration: { width: 96, height: 96, borderRadius: radius.lg, marginBottom: 12, backgroundColor: palette.surfaceSoft },
  infoType: { fontSize: 18, fontWeight: "900", color: palette.ink, marginBottom: 8 },
  taxiInfoType: { fontSize: 13, marginBottom: 3 },
  infoRow: { fontSize: 13, color: palette.muted, marginTop: 5 },
  requestAttachmentImage: { width: "100%", height: 240, alignSelf: "center", borderRadius: radius.md, backgroundColor: palette.surfaceSoft, borderWidth: 1, borderColor: palette.line },
  infoPrice: { fontSize: 18, fontWeight: "900", color: palette.brand, marginTop: 8 },
  actionsRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 8 },
  actionBtn: { flex: 1, minHeight: 40, backgroundColor: palette.brand, borderRadius: 16, paddingVertical: 8, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  navigationButton: { minHeight: 45, marginHorizontal: 16, marginBottom: 10, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 16, backgroundColor: palette.brandSoft, borderWidth: 1, borderColor: palette.brand, alignItems: "center", justifyContent: "center" },
  navigationButtonText: { color: palette.brand, fontSize: 14, fontWeight: "900" },
  navigationButtonHint: { color: palette.muted, fontSize: 10, marginTop: 3 },
  actionBtnText: { color: palette.white, fontSize: 14, fontWeight: "900" },
  reportCard: { marginHorizontal: 16, marginBottom: 12, padding: 14, borderRadius: radius.lg, borderWidth: 1, borderColor: "#D6A936", backgroundColor: palette.surface },
  reportButton: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  reportButtonText: { color: "#9A6811", fontSize: 13, fontWeight: "900" },
  reportButtonArrow: { color: palette.brand, fontSize: 11, fontWeight: "900" },
  reportTitle: { color: palette.ink, fontSize: 14, fontWeight: "900", textAlign: "right" },
  reportInput: { backgroundColor: palette.canvas, borderRadius: radius.md, borderWidth: 1, borderColor: palette.line, padding: 12, color: palette.ink, textAlign: "right" },
  reportAction: { flex: 1, minHeight: 40, backgroundColor: palette.brand, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  chatHeader: { paddingHorizontal: 18, paddingVertical: 10, backgroundColor: palette.surface, borderTopWidth: 1, borderBottomWidth: 1, borderColor: palette.line },
  chatHeaderTitle: { color: palette.ink, fontSize: 14, fontWeight: "900", textAlign: "right" },
  chatHeaderHint: { color: palette.muted, fontSize: 11, marginTop: 3, textAlign: "right" },
  chatClosed: { margin: 16, padding: 22, borderRadius: radius.lg, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, alignItems: "center" },
  chatClosedTitle: { color: palette.ink, fontSize: 16, fontWeight: "900" },
  chatClosedText: { color: palette.muted, fontSize: 12, marginTop: 6, textAlign: "center" },
  msgBubble: { maxWidth: "75%", borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 11, marginBottom: 8 },
  msgMine: { backgroundColor: palette.brand, alignSelf: "flex-end", borderBottomRightRadius: 6, shadowColor: palette.brand, shadowOpacity: 0.12, shadowRadius: 8, elevation: 2 },
  msgOther: { backgroundColor: palette.surface, alignSelf: "flex-start", borderWidth: 1, borderColor: palette.line, borderBottomLeftRadius: 6, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 },
  msgText: { fontSize: 14, color: palette.ink, lineHeight: 21 },
  msgTextMine: { color: palette.white },
  msgTime: { fontSize: 9, color: palette.muted, marginTop: 5, textAlign: "left" },
  msgTimeMine: { color: "rgba(255,255,255,0.72)" },
  quickReply: { backgroundColor: palette.brandSoft, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 9 },
  quickReplyText: { fontSize: 12, color: palette.brand, fontWeight: "800" },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: palette.surface, borderTopWidth: 1, borderTopColor: palette.line, paddingBottom: 24 },
  msgInput: { flex: 1, borderWidth: 1, borderColor: palette.line, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 11, fontSize: 14, color: palette.ink, backgroundColor: palette.canvas },
  sendBtn: { backgroundColor: palette.brand, borderRadius: radius.pill, paddingHorizontal: 20, paddingVertical: 12 },
  sendBtnText: { color: palette.white, fontWeight: "900", fontSize: 14 },
  cancelOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 80, backgroundColor: "rgba(5,13,27,0.70)", justifyContent: "flex-end", padding: 10 },
  cancelCard: { maxHeight: "88%", backgroundColor: "#F8FAFC", borderRadius: 28, padding: 17, borderWidth: 1, borderColor: "rgba(255,255,255,0.75)", elevation: 24 },
  feedbackHandle: { width: 42, height: 4, borderRadius: 3, backgroundColor: "#CBD5E1", alignSelf: "center", marginBottom: 14 },
  feedbackHeader: { flexDirection: "row", alignItems: "center", gap: 11, marginBottom: 14 },
  cancelIconBadge: { width: 46, height: 46, borderRadius: 16, backgroundColor: "#FFF1F2", borderWidth: 1, borderColor: "#FECDD3", alignItems: "center", justifyContent: "center" },
  feedbackEyebrow: { color: "#B58A37", fontSize: 8, fontWeight: "900", letterSpacing: 1.2, textAlign: "right" },
  cancelTitle: { color: "#14253D", fontSize: 20, fontWeight: "900", textAlign: "right", marginTop: 2 },
  feedbackSubtitle: { color: "#64748B", fontSize: 10, fontWeight: "700", textAlign: "right", marginTop: 3, lineHeight: 16 },
  feedbackClose: { width: 32, height: 32, borderRadius: 12, backgroundColor: "#E9EEF5", alignItems: "center", justifyContent: "center" },
  feedbackCloseText: { color: "#475569", fontSize: 23, lineHeight: 25, fontWeight: "400" },
  feedbackOptionsScroll: { maxHeight: 390 },
  feedbackOptions: { gap: 8, paddingBottom: 8 },
  reasonChoice: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 11, paddingVertical: 9, borderRadius: 16, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E2E8F0" },
  reasonChoiceSelected: { backgroundColor: "#EFF6FF", borderColor: "#1D4ED8", borderWidth: 1.5 },
  reasonIndex: { width: 30, height: 30, borderRadius: 10, backgroundColor: "#F1F5F9", alignItems: "center", justifyContent: "center" },
  reasonIndexSelected: { backgroundColor: "#1D4ED8" },
  reasonIndexText: { color: "#64748B", fontSize: 9, fontWeight: "900" },
  reasonIndexTextSelected: { color: "#FFFFFF" },
  reasonChoiceText: { flex: 1, color: "#334155", fontSize: 12, fontWeight: "800", textAlign: "right" },
  reasonChoiceTextSelected: { color: "#1D4ED8" },
  reasonRadio: { width: 18, height: 18, borderRadius: 10, borderWidth: 1.5, borderColor: "#CBD5E1", alignItems: "center", justifyContent: "center" },
  reasonRadioSelected: { borderColor: "#1D4ED8" },
  reasonRadioDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: "#1D4ED8" },
  feedbackNoteInput: { minHeight: 76, maxHeight: 120, borderRadius: 15, borderWidth: 1, borderColor: "#CBD5E1", backgroundColor: "#FFFFFF", padding: 12, color: "#14253D", textAlign: "right", textAlignVertical: "top", fontSize: 12, marginTop: 9 },
  feedbackError: { color: "#B91C1C", fontSize: 11, fontWeight: "800", textAlign: "right", padding: 10, backgroundColor: "#FEF2F2", borderRadius: 12, overflow: "hidden" },
  feedbackFooter: { flexDirection: "row", gap: 9, marginTop: 12 },
  feedbackBackButton: { minHeight: 48, flex: 1, borderRadius: 15, borderWidth: 1, borderColor: "#CBD5E1", backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  feedbackBackText: { color: "#475569", fontSize: 12, fontWeight: "900" },
  feedbackConfirmButton: { minHeight: 48, flex: 1.4, borderRadius: 15, backgroundColor: "#B42332", alignItems: "center", justifyContent: "center" },
  feedbackConfirmText: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" },
  ratingOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 81, backgroundColor: "rgba(5,13,27,0.72)", justifyContent: "flex-end", padding: 10 },
  ratingCard: { maxHeight: "90%", backgroundColor: "#F8FAFC", borderRadius: 28, padding: 17, borderWidth: 1, borderColor: "rgba(255,255,255,0.78)", elevation: 24 },
  ratingTitle: { fontSize: 20, fontWeight: "900", color: "#14253D", textAlign: "center", marginTop: 4 },
  ratingSubtitle: { color: "#64748B", fontSize: 10, fontWeight: "700", textAlign: "center", marginTop: 5, marginBottom: 12, lineHeight: 16 },
  ratingHero: { backgroundColor: "#10233F", borderRadius: 20, paddingVertical: 14, paddingHorizontal: 12, alignItems: "center", marginBottom: 12, borderWidth: 1, borderColor: "#D6B15B" },
  starsRow: { flexDirection: "row", gap: 8, justifyContent: "center", marginBottom: 6 },
  starTap: { width: 42, height: 42, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.10)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)" },
  starTapActive: { backgroundColor: "rgba(245,190,70,0.18)", borderColor: "#E7BE63" },
  star: { fontSize: 28, color: "rgba(255,255,255,0.36)" },
  starActive: { color: "#F5C451" },
  ratingScore: { color: "#FFFFFF", fontSize: 11, fontWeight: "900", marginTop: 4 },
  ratingScroll: { maxHeight: 350 },
  ratingScrollContent: { paddingBottom: 8, gap: 11 },
  criteriaPanel: { borderRadius: 18, padding: 12, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E2E8F0", gap: 11 },
  criteriaRow: { gap: 5 },
  criteriaLabel: { color: "#334155", fontSize: 11, fontWeight: "900", textAlign: "right" },
  criteriaStars: { flexDirection: "row", justifyContent: "flex-start", gap: 10 },
  criteriaStarTap: { paddingHorizontal: 4, paddingVertical: 1 },
  criteriaStar: { fontSize: 23, color: "#CBD5E1" },
  criteriaStarActive: { color: "#D9A52D" },
  reasonHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  reasonHeaderTitle: { color: "#14253D", fontSize: 12, fontWeight: "900" },
  reasonHeaderCount: { color: "#64748B", fontSize: 10, fontWeight: "900" },
  ratingChips: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  ratingChip: { borderRadius: 14, paddingHorizontal: 11, paddingVertical: 9, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#DCE3EC" },
  ratingChipSelected: { backgroundColor: "#EAF2FF", borderColor: "#2563EB" },
  ratingChipText: { color: "#475569", fontSize: 10, fontWeight: "800" },
  ratingChipTextSelected: { color: "#1D4ED8" },
  ratingFooter: { flexDirection: "row", gap: 9, marginTop: 10 },
  ratingSubmit: { flex: 1.4, backgroundColor: "#142B4B", borderRadius: 15, paddingHorizontal: 18, paddingVertical: 14, alignItems: "center", justifyContent: "center" },
  ratingSubmitText: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" },
});