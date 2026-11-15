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
import MapView, { Marker } from "react-native-maps";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import { loadNotificationSoundPreference, setNotificationSoundPreference } from "@/lib/notification-sound";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import service_build from "../../assets/services/build.png";
import service_plaster from "../../assets/services/plaster.png";
import service_carpentry_form from "../../assets/services/carpentry_form.png";
import service_flooring from "../../assets/services/flooring.png";
import service_chef from "../../assets/services/chef.png";
import service_plumbing from "../../assets/services/plumbing.png";
import service_electric_setup from "../../assets/services/electric_setup.png";
import service_electric_street from "../../assets/services/electric_street.png";
import service_washer_repair from "../../assets/services/washer_repair.png";
import service_stove_repair from "../../assets/services/stove_repair.png";
import service_fridge_repair from "../../assets/services/fridge_repair.png";
import service_ac_repair from "../../assets/services/ac_repair.png";
import service_cleaning from "../../assets/services/cleaning.png";
import service_wood_carpentry from "../../assets/services/wood_carpentry.png";
import service_blacksmith from "../../assets/services/blacksmith.png";
import service_general from "../../assets/services/general.png";
import { palette, radius } from "@/styles/theme";
import { callMamnoonMapsApi } from "@/lib/maps-api";

const QUICK_REPLIES_CUSTOMER = ["وصلت!", "كم دقيقة؟", "أين أنت؟", "شكراً جزيلاً", "هل أنت قريب؟"];
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

type Coordinates = { latitude: number; longitude: number; heading?: number | null };
type RequestRecord = {
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
};
type ChatMessage = {
  id: string;
  chat_id: string;
  sender_id: string;
  content: string;
  created_at: string;
};


function TaxiCarMarker({ coordinate, heading }: { coordinate: Coordinates; heading?: number | null }) {
  const markerRef = useRef<any>(null);
  const initialCoordinate = useRef(coordinate).current;
  const [iosCoordinate, setIosCoordinate] = useState(coordinate);
  const rotation = useSharedValue(Number.isFinite(heading) ? Number(heading) : 0);

  useEffect(() => {
    if (Platform.OS === "android" && markerRef.current?.animateMarkerToCoordinate) {
      markerRef.current.animateMarkerToCoordinate(coordinate, 4500);
    } else {
      setIosCoordinate(coordinate);
    }
  }, [coordinate.latitude, coordinate.longitude]);

  useEffect(() => {
    if (heading == null || !Number.isFinite(heading)) return;
    const current = rotation.value;
    const delta = ((heading - current + 540) % 360) - 180;
    rotation.value = withTiming(current + delta, {
      duration: 650,
      easing: Easing.out(Easing.cubic),
    });
  }, [heading, rotation]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <Marker
      ref={markerRef}
      coordinate={Platform.OS === "android" ? initialCoordinate : iosCoordinate}
      flat
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges
    >
      <Animated.View style={[styles.luxuryCarMarker, animatedStyle]}>
        <View style={styles.luxuryCarRoof} />
        <View style={styles.luxuryCarWindows} />
        <View style={styles.luxuryCarFront} />
        <View style={styles.luxuryCarWheelLeft} />
        <View style={styles.luxuryCarWheelRight} />
      </Animated.View>
    </Marker>
  );
}

export default function RequestDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, roles } = useAuth();
  const [request, setRequest] = useState<RequestRecord | null>(null);
  const [otherProfile, setOtherProfile] = useState<{ full_name: string | null; avatar_url: string | null; phone: string | null } | null>(null);
  const [vehicleDetails, setVehicleDetails] = useState<any>(null);
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [largeOffers, setLargeOffers] = useState<any[]>([]);
  const [myLargeOffer, setMyLargeOffer] = useState<any>(null);
  const [largeOfferPrice, setLargeOfferPrice] = useState("");
  const [largeOfferMessage, setLargeOfferMessage] = useState("");
  const [largeOfferBusy, setLargeOfferBusy] = useState(false);
  const [acceptingLargeOffer, setAcceptingLargeOffer] = useState<string | null>(null);
  const [retryingLargeOffers, setRetryingLargeOffers] = useState(false);
  const [chatId, setChatId] = useState<string | null>(null);
  const [myLocation, setMyLocation] = useState<Coordinates | null>(null);
  const [otherLocation, setOtherLocation] = useState<Coordinates | null>(null);
  const [driverEtaMinutes, setDriverEtaMinutes] = useState<number | null>(null);
  const lastEtaRequestRef = useRef<{ latitude: number; longitude: number; requestedAt: number } | null>(null);
  const etaSequenceRef = useRef(0);
  const [newMsg, setNewMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [rating, setRating] = useState(0);
  const [ratingReasons, setRatingReasons] = useState<string[]>([]);
  const [ratingComment, setRatingComment] = useState("");
  const [showRating, setShowRating] = useState(false);
  const [showReportForm, setShowReportForm] = useState(false);
  const [reportReason, setReportReason] = useState("مشكلة أثناء الطلب");
  const [reportDetails, setReportDetails] = useState("");
  const [reportBusy, setReportBusy] = useState(false);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentGatewayEnabled, setPaymentGatewayEnabled] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const weeklyRatingNoticeRef = useRef<string | null>(null);
  const isProvider = request?.provider_id === user?.id;
  const isCustomer = request?.customer_id === user?.id;
  const canAccept = Boolean(
    request &&
    !request.provider_id &&
    request.customer_id !== user?.id &&
    ((request.type === "taxi" && (request.vehicle_category === "large" ? roles.includes("large_driver") : roles.includes("driver")) ) ||
      (request.type === "service" && roles.includes("worker"))),
  );
  const isActive = request?.status === "in_progress" || request?.status === "accepted";
  const currentUserId = user?.id;
  const currentRequestType = request?.type;
  const currentProviderId = request?.provider_id;
  const currentCustomerId = request?.customer_id;

  useEffect(() => { void loadNotificationSoundPreference().then(setSoundEnabled); }, []);

  const loadRequest = useCallback(async () => {
    const { data, error } = await supabase
      .from("service_requests")
      .select(
        "provider_id, customer_id, status, type, pickup_text, dest_text, price_estimate, customer_payable, payment_method, customer_price, pricing_mode, work_hours, work_description, workers_count, services(name_ar, slug), pickup_lat, pickup_lng, dest_lat, dest_lng, vehicle_category, vehicle_type, notes",
      )
      .eq("id", id)
      .maybeSingle();
    if (error) {
      setRequest(null);
      setLoading(false);
      return;
    }
    setRequest(data as RequestRecord | null);
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
    const {data:paymentSettings}=await supabase.from("subscription_settings").select("payment_gateway_enabled").eq("id",1).maybeSingle();
    setPaymentGatewayEnabled(Boolean(paymentSettings?.payment_gateway_enabled));
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
  }, [request?.customer_id, request?.provider_id, user?.id]);

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
            void Notifications.scheduleNotificationAsync({ content: { title: "رسالة جديدة في ممنون", body: "وصلتك رسالة جديدة من الطرف الآخر", sound: soundEnabled ? "default" : false, data: { request_id: id } }, trigger: null }).catch((error) => console.warn("[messages] sound notification failed:", error));
          }
          void loadMessages();
        },
      )
      .subscribe();
    loadMessages();
    return () => {
      supabase.removeChannel(sub);
    };
  }, [chatId, loadMessages, user?.id, id, soundEnabled]);

  useEffect(() => {
    if (!isActive || !currentUserId) return;
    let mounted = true;
    let subscription: Location.LocationSubscription | null = null;
    const role = isCustomer ? "customer" : "provider";

    async function publishLocation(location: Location.LocationObject) {
      if (!mounted || !currentUserId) return;
      const coords = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        heading: location.coords.heading,
      };
      setMyLocation(coords);
      const { error } = await supabase.from("live_locations").upsert(
        {
          request_id: id,
          user_id: currentUserId,
          role,
          lat: coords.latitude,
          lng: coords.longitude,
          heading: location.coords.heading,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "request_id,user_id" },
      );
      if (error) console.warn("[Mamnoon] location update failed:", error.message);
    }

    async function startTracking() {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        if (mounted)
          Alert.alert("إذن الموقع مطلوب", "اسمح بمشاركة موقعك أثناء الرحلة حتى يظهر للطرف الآخر.");
        return;
      }
      const first = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      await publishLocation(first);
      if (!mounted) return;
      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: 5000, distanceInterval: 10 },
        (location) => {
          void publishLocation(location);
        },
      );
    }

    void startTracking().catch(() => {
      if (mounted) Alert.alert("تعذر تشغيل التتبع", "تحقق من GPS وحاول مرة أخرى.");
    });

    return () => {
      mounted = false;
      subscription?.remove();
    };
  }, [id, isActive, isCustomer, currentRequestType, currentUserId]);

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
        if (data) setOtherLocation({ latitude: data.lat, longitude: data.lng, heading: data.heading });
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
          const row = payload.new as { user_id?: string; lat?: number; lng?: number; heading?: number | null };
          if (
            row.user_id === otherId &&
            typeof row.lat === "number" &&
            typeof row.lng === "number"
          ) {
            setOtherLocation({ latitude: row.lat, longitude: row.lng, heading: row.heading });
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
    if (!isCustomer || request?.type !== "taxi" || request.status !== "accepted" ||
        !otherLocation || request.pickup_lat == null || request.pickup_lng == null) {
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
  }, [isCustomer, request?.type, request?.status, request?.pickup_lat, request?.pickup_lng, otherLocation?.latitude, otherLocation?.longitude]);

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
    const { data, error } = await supabase.rpc("retry_taxi_dispatch", { _request_id: id });
    if (error) {
      Alert.alert("تعذر إعادة البحث", "حاول مرة أخرى بعد قليل.");
      return;
    }
    if (Number(data ?? 0) > 0) {
      Alert.alert("البحث مستمر", "يوجد عرض حالي للسائقين أو أُرسلت عروض جديدة.");
    } else {
      Alert.alert("لا يوجد سائق متاح حالياً", "سيبقى طلبك محفوظاً ويمكنك إعادة المحاولة لاحقاً.");
    }
  }

  async function acceptRequest() {
    const { error } = await supabase.rpc("accept_service_request", { _request_id: id });
    if (error) Alert.alert("خطأ", error.message);
    else {
      await Promise.all([loadRequest(), loadChat()]);
    }
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
    if (!user) return;
    const amount = Number(largeOfferPrice.replace(/[^0-9]/g, ""));
    if (!Number.isSafeInteger(amount) || amount < 250 || amount % 250 !== 0) {
      Alert.alert("السعر غير صحيح", "اكتب سعراً لا يقل عن 250 ديناراً ومن مضاعفات 250.");
      return;
    }
    setLargeOfferBusy(true);
    const { error } = await (supabase as any).rpc("submit_large_vehicle_offer", {
      _request_id: id,
      _price: amount,
      _message: largeOfferMessage.trim() || null,
    });
    setLargeOfferBusy(false);
    if (error) {
      Alert.alert("تعذر إرسال العرض", error.message);
      return;
    }
    Alert.alert("تم إرسال العرض", "وصل سعرك للزبون، وتكدر تنتظر موافقته.");
    await loadRequest();
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

  async function startRide() {
    const { error } = await supabase.rpc("transition_service_request", {
      _request_id: id,
      _status: "in_progress",
      _reason: null,
    });
    if (error) Alert.alert("خطأ", error.message);
    else loadRequest();
  }

  async function completeRide() {
    const { error } = await supabase.rpc("transition_service_request", {
      _request_id: id,
      _status: "completed",
      _reason: null,
    });
    if (error) Alert.alert("خطأ", error.message);
    else {
      await loadRequest();
    }
  }

  async function cancelRequest() {
    Alert.alert("إلغاء الطلب", "هل أنت متأكد؟", [
      { text: "تراجع", style: "cancel" },
      {
        text: "إلغاء الطلب",
        style: "destructive",
        onPress: async () => {
          const { error } = await supabase.rpc("transition_service_request", {
            _request_id: id,
            _status: "cancelled",
            _reason: null,
          });
          if (error) Alert.alert("تعذر الإلغاء", error.message);
          else router.back();
        },
      },
    ]);
  }

  async function submitUserReport() {
    if (!user?.id || !request) return;
    if (request.status !== "in_progress") { Alert.alert("البلاغات غير متاحة", "تگدر ترسل بلاغ بعد بدء الرحلة أو الخدمة فعلياً."); return; }
    const reportedId = isCustomer ? request.provider_id : request.customer_id;
    if (!reportedId) { Alert.alert("تعذر إرسال البلاغ", "لا يوجد طرف آخر مرتبط بهذا الطلب حتى الآن."); return; }
    if (!reportReason.trim()) { Alert.alert("تنبيه", "اكتب سبب البلاغ."); return; }
    setReportBusy(true);
    const { error } = await (supabase as any).from("user_reports").insert({ reporter_id: user.id, reported_id: reportedId, request_id: id, reason: reportReason.trim(), details: reportDetails.trim() || null, status: "pending" });
    setReportBusy(false);
    if (error) { Alert.alert("تعذر إرسال البلاغ", error.message); return; }
    setShowReportForm(false); setReportDetails("");
    Alert.alert("تم استلام البلاغ", "وصل بلاغك إلى إدارة ممنون وسيظهر ضمن البلاغات الواردة للمراجعة.");
  }

  async function submitRating() {
    if (rating === 0 || !user) return;
    const otherId = isCustomer ? request?.provider_id : request?.customer_id;
    if (!otherId) return;
    const { error } = await (supabase as any).from("ratings").insert({
      request_id: id,
      rater_id: user.id,
      ratee_id: otherId,
      stars: rating,
      reasons: ratingReasons,
      comment: ratingComment.trim() || null,
    });
    if (error) Alert.alert("تعذر إرسال التقييم", error.message?.includes("rating_already_given_this_week") ? "لقد تم تقييم هذا الشخص من قبلك خلال آخر 7 أيام." : error.message);
    else {
      setShowRating(false);
      router.back();
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

  const statusLabel: Record<string, string> = {
    searching: "بحث عن مزوّد...",
    pending: "بانتظار القبول",
    accepted: "تم القبول",
    in_progress: "قيد التنفيذ",
    completed: "مكتمل",
    cancelled: "ملغي",
  };
  const quickReplies = isCustomer ? QUICK_REPLIES_CUSTOMER : QUICK_REPLIES_PROVIDER;
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
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.backBtn}>→</Text>
          </TouchableOpacity>
          <View style={{ alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, flex: 1 }}><Text style={styles.headerTitle}>{statusLabel[request.status] || request.status}</Text>{request.type === "taxi" && isCustomer && request.status === "accepted" && <Text style={styles.acceptedHint}>{otherLocation && request.pickup_lat != null && request.pickup_lng != null && (() => { const rad = (value: number) => value * Math.PI / 180; const dLat = rad(otherLocation.latitude - request.pickup_lat!); const dLng = rad(otherLocation.longitude - request.pickup_lng!); const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(request.pickup_lat!)) * Math.cos(rad(otherLocation.latitude)) * Math.sin(dLng / 2) ** 2; const meters = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); return meters <= 50 ? "انا في نقطة الانطلاق" : driverEtaMinutes != null && driverEtaMinutes <= 2 ? "دقيقتين واوصل" : driverEtaMinutes != null ? `باقي ${driverEtaMinutes} دقيقة واوصل` : "الكابتن متجه إليك"; })()}</Text>}</View>
          <View style={{ width: 30 }} />
        </View>
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
                {!!otherProfile.phone && <TouchableOpacity style={styles.personQuickButton} onPress={() => void Linking.openURL(`tel:${otherProfile.phone}`)}><Text style={styles.personQuickButtonText}>اتصال</Text></TouchableOpacity>}
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
          {request.workers_count != null && request.type === "service" && (
            <Text style={styles.infoRow}>عدد العاملين: {request.workers_count}</Text>
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
            <Text style={styles.largeOffersTitle}>أرسل عرض سعرك</Text>
            {request.customer_price ? <Text style={styles.largeOffersEmpty}>ميزانية الزبون: {Number(request.customer_price).toLocaleString("en")} د.ع</Text> : <Text style={styles.largeOffersEmpty}>الزبون ينتظر عروض الأسعار</Text>}
            {myLargeOffer?.proposed_price ? <Text style={styles.largeOffersEmpty}>عرضك الحالي: {Number(myLargeOffer.proposed_price).toLocaleString("en")} د.ع — تكدر تعدله وترسله من جديد</Text> : null}
            <TextInput
              style={styles.largeOfferInput}
              value={largeOfferPrice}
              onChangeText={(value) => setLargeOfferPrice(value.replace(/[^0-9]/g, ""))}
              placeholder="أجرتك بالدينار"
              placeholderTextColor="#94a3b8"
              keyboardType="numeric"
            />
            <TextInput
              style={[styles.largeOfferInput, { minHeight: 72 }]}
              value={largeOfferMessage}
              onChangeText={setLargeOfferMessage}
              placeholder="ملاحظة للزبون (اختياري)"
              placeholderTextColor="#94a3b8"
              multiline
            />
            <TouchableOpacity style={styles.largeOfferAccept} disabled={largeOfferBusy} onPress={sendLargeVehicleOffer}>
              <Text style={styles.largeOfferAcceptText}>{largeOfferBusy ? "جارٍ إرسال العرض..." : myLargeOffer?.proposed_price ? "تحديث عرض السعر" : "إرسال عرض السعر"}</Text>
            </TouchableOpacity>
          </View>
        )}
        {isActive &&
          request.pickup_lat != null &&
          request.pickup_lng != null && (
            <View style={styles.trackingCard}>
              {request.type !== "taxi" && <Text style={styles.trackingTitle}>موقع الطلب المباشر</Text>}
              <MapView
                style={[styles.trackingMap, request.type === "taxi" && styles.trackingMapTaxi]}
                initialRegion={{
                  latitude: request.pickup_lat,
                  longitude: request.pickup_lng,
                  latitudeDelta: 0.018,
                  longitudeDelta: 0.018,
                }}
                showsUserLocation={request.type !== "taxi"}
              >
                {request.type === "taxi" ? (
                  (isProvider ? myLocation : otherLocation) && <TaxiCarMarker coordinate={(isProvider ? myLocation : otherLocation)!} heading={(isProvider ? myLocation : otherLocation)?.heading} />
                ) : (
                  <>
                    <Marker coordinate={{ latitude: request.pickup_lat!, longitude: request.pickup_lng! }} title="نقطة الانطلاق" pinColor="#0f766e" />
                    {request.dest_lat != null && request.dest_lng != null && <Marker coordinate={{ latitude: request.dest_lat, longitude: request.dest_lng }} title="الوجهة" pinColor="#16a34a" />}
                    {myLocation && <Marker coordinate={myLocation} title="موقعي" pinColor="#7c3aed" />}
                    {otherLocation && <Marker coordinate={otherLocation} title="الطرف الآخر" pinColor="#f97316" />}
                  </>
                )}
              </MapView>
              {request.type !== "taxi" && <Text style={styles.trackingHint}>{otherLocation ? "يتم استقبال موقع الطرف الآخر" : "بانتظار مشاركة موقع الطرف الآخر"}</Text>}
            </View>
          )}
        <View style={styles.actionsRow}>
          {request.type === "taxi" &&
            request.vehicle_category !== "large" &&
            isCustomer &&
            ["pending", "searching"].includes(request.status) && (
              <TouchableOpacity style={styles.actionBtn} onPress={retryDispatch}>
                <Text style={styles.actionBtnText}>إعادة البحث عن سائقين</Text>
              </TouchableOpacity>
            )}
          {["pending", "searching"].includes(request.status) && canAccept && request.vehicle_category !== "large" && (
            <TouchableOpacity style={styles.actionBtn} onPress={acceptRequest}>
              <Text style={styles.actionBtnText}>قبول الطلب</Text>
            </TouchableOpacity>
          )}
          {request.status === "accepted" && isProvider && (
            <TouchableOpacity style={styles.actionBtn} onPress={startRide}>
              <Text style={styles.actionBtnText}>{request.type === "taxi" ? "ركب الزبون" : "بدء تنفيذ الخدمة"}</Text>
            </TouchableOpacity>
          )}
          {isActive && isProvider && (
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: palette.success }]}
              onPress={completeRide}
            >
              <Text style={styles.actionBtnText}>إنهاء</Text>
            </TouchableOpacity>
          )}
          {(isCustomer || isProvider) &&
            request.status !== "cancelled" &&
            request.status !== "completed" && (
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: palette.danger }]}
                onPress={cancelRequest}
              >
                <Text style={styles.actionBtnText}>إلغاء</Text>
              </TouchableOpacity>
            )}
        </View>

        {request.status === "in_progress" && (isCustomer ? !!request.provider_id : !!request.customer_id) && (
          <View style={styles.reportCard}>
            {!showReportForm ? (
              <TouchableOpacity onPress={() => setShowReportForm(true)} style={styles.reportButton}>
                <Text style={styles.reportButtonText}>إبلاغ عن {isCustomer ? (request.type === "taxi" ? "السائق" : "الفني") : "الزبون"}</Text>
                <Text style={styles.reportButtonArrow}>إرسال بلاغ ←</Text>
              </TouchableOpacity>
            ) : (
              <View style={{ gap: 10 }}>
                <Text style={styles.reportTitle}>تفاصيل البلاغ للإدارة</Text>
                <TextInput value={reportReason} onChangeText={setReportReason} placeholder="سبب البلاغ" placeholderTextColor="#94a3b8" style={styles.reportInput} />
                <TextInput value={reportDetails} onChangeText={setReportDetails} placeholder="اكتب ملاحظتك: نسيت شيئاً في السيارة أو اشرح المشكلة..." placeholderTextColor="#94a3b8" multiline maxLength={1500} style={[styles.reportInput, { minHeight: 92, textAlignVertical: "top" }]} />
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <TouchableOpacity onPress={() => setShowReportForm(false)} style={[styles.reportAction, { backgroundColor: palette.surfaceSoft }]}><Text style={{ color: palette.ink, fontWeight: "900" }}>إلغاء</Text></TouchableOpacity>
                  <TouchableOpacity disabled={reportBusy} onPress={submitUserReport} style={styles.reportAction}><Text style={{ color: palette.white, fontWeight: "900" }}>{reportBusy ? "جارٍ الإرسال..." : "إرسال البلاغ للإدارة"}</Text></TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        )}
        {!["completed", "cancelled"].includes(request.status) ? null : (
          <View style={styles.chatClosed}><Text style={styles.chatClosedTitle}>{request.status === "completed" ? "اكتمل الطلب" : "تم إلغاء الطلب"}</Text><Text style={styles.chatClosedText}>انتهت المحادثة وتم إخفاء بيانات الطرف الآخر.</Text></View>
        )}
        {showRating && (
          <View style={styles.ratingOverlay}>
            <View style={styles.ratingCard}>
              <Text style={styles.ratingTitle}>{isProvider ? "قيّم الزبون" : request.type === "taxi" ? "قيّم السائق" : "قيّم الفني"}</Text>
              <Text style={{ color: palette.muted, fontSize: 12, marginBottom: 10 }}>اختَر عدد النجوم بنفسك</Text>
              <View style={styles.starsRow}>
                {[1, 2, 3, 4, 5].map((s) => (
                  <TouchableOpacity key={s} onPress={() => setRating(s)}>
                    <Text style={[styles.star, s <= rating && styles.starActive]}>★</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={{ color: palette.ink, fontSize: 13, fontWeight: "900", textAlign: "right", alignSelf: "stretch", marginBottom: 8 }}>أسباب التقييم (اختياري – تقدر تختار أكثر من سبب)</Text>
              <View style={{ width: "100%", flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 14 }}>
                {ratingReasonOptions.map((reason) => {
                  const selected = ratingReasons.includes(reason);
                  return (
                    <TouchableOpacity key={reason} onPress={() => setRatingReasons((current) => selected ? current.filter((item) => item !== reason) : [...current, reason])} style={{ paddingHorizontal: 10, paddingVertical: 8, borderRadius: 18, borderWidth: 1, borderColor: selected ? palette.brand : palette.line, backgroundColor: selected ? palette.brandSoft : palette.surface }}>
                      <Text style={{ color: selected ? palette.brand : palette.ink, fontSize: 11, fontWeight: "800" }}>{selected ? "✓ " : ""}{reason}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <TextInput value={ratingComment} onChangeText={setRatingComment} placeholder="ملاحظة اختيارية" placeholderTextColor="#94a3b8" multiline maxLength={500} style={[styles.reportInput, { width: "100%", minHeight: 64, marginBottom: 14 }]} />
              <TouchableOpacity style={[styles.ratingSubmit, rating === 0 && { opacity: 0.45 }]} disabled={rating === 0} onPress={submitRating}>
                <Text style={styles.ratingSubmitText}>إرسال التقييم</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.canvas },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: palette.canvas },
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
  personQuickButton: { borderRadius: radius.md, backgroundColor: palette.brandSoft, paddingHorizontal: 12, paddingVertical: 7 },
  personQuickButtonText: { color: palette.brand, fontWeight: "900", fontSize: 11 },
  infoCard: { backgroundColor: palette.surface, borderRadius: radius.lg, padding: 17, margin: 16, borderWidth: 1, borderColor: palette.line },
  taxiInfoCard: { padding: 9, marginTop: 8, marginBottom: 8 },
  vehicleDetailsText: { fontSize: 11, color: palette.muted, marginTop: 3, textAlign: "right" },
  paymentCompact: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginHorizontal: 16, marginTop: 7, marginBottom: 7, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.surface },
  paymentCompactTitle: { fontSize: 11, fontWeight: "900", color: palette.ink, textAlign: "right" },
  paymentCompactHint: { fontSize: 9, color: palette.muted, marginTop: 2, textAlign: "right" },
  paymentCompactButton: { backgroundColor: palette.brand, borderRadius: radius.md, paddingHorizontal: 16, paddingVertical: 8 },
  paymentCompactButtonText: { color: palette.white, fontWeight: "900", fontSize: 11 },
  trackingCard: { backgroundColor: palette.surface, borderRadius: radius.lg, padding: 13, marginHorizontal: 16, marginBottom: 12, borderWidth: 1, borderColor: palette.line },
  trackingTitle: { fontSize: 15, fontWeight: "900", color: palette.ink, marginBottom: 10 },
  trackingMap: { height: 220, borderRadius: radius.md },
  trackingMapTaxi: { height: 340 },
  luxuryCarMarker: { width: 48, height: 30, borderRadius: 13, backgroundColor: "#B88A24", borderWidth: 2, borderColor: "#172033", alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 7 },
  luxuryCarRoof: { position: "absolute", top: 3, width: 25, height: 12, borderTopLeftRadius: 10, borderTopRightRadius: 10, backgroundColor: "#24364A" },
  luxuryCarWindows: { position: "absolute", top: 5, width: 21, height: 7, borderRadius: 4, backgroundColor: "#9CC6D8" },
  luxuryCarFront: { position: "absolute", right: 2, width: 4, height: 8, borderRadius: 3, backgroundColor: "#F8E7A0" },
  luxuryCarWheelLeft: { position: "absolute", left: 8, bottom: -3, width: 7, height: 5, borderRadius: 3, backgroundColor: "#111827" },
  luxuryCarWheelRight: { position: "absolute", right: 8, bottom: -3, width: 7, height: 5, borderRadius: 3, backgroundColor: "#111827" },
  luxuryCarEmoji: { fontSize: 27 },
  chatToolbar: { flexDirection: "row", gap: 8, marginHorizontal: 16, marginTop: 8, marginBottom: 8 },
  chatToggleButton: { flex: 1, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, backgroundColor: palette.surface, paddingVertical: 12, alignItems: "center" },
  chatToggleText: { color: palette.ink, fontWeight: "900", fontSize: 12 },
  soundToggleButton: { width: 48, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, backgroundColor: palette.surface, alignItems: "center", justifyContent: "center" },
  soundToggleText: { fontSize: 18 },
  largeOffersCard: { backgroundColor: palette.surface, borderRadius: radius.lg, padding: 15, marginHorizontal: 16, marginTop: 12, borderWidth: 1, borderColor: palette.gold },
  largeOffersTitle: { fontSize: 16, fontWeight: "900", color: palette.brand, marginBottom: 10, textAlign: "right" },
  largeOffersEmpty: { fontSize: 12, color: palette.muted, textAlign: "right", marginBottom: 8 },
  largeOfferItem: { backgroundColor: palette.goldSoft, borderRadius: radius.md, padding: 13, marginBottom: 10, borderWidth: 1, borderColor: "#E9D9B5" },
  largeOfferName: { fontSize: 14, fontWeight: "900", color: palette.ink, textAlign: "right" },
  largeOfferPrice: { fontSize: 18, fontWeight: "900", color: palette.brand, textAlign: "right", marginTop: 4 },
  largeOfferMessage: { fontSize: 12, color: palette.muted, textAlign: "right", marginTop: 5 },
  largeOfferInput: { backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.line, paddingHorizontal: 12, paddingVertical: 12, color: palette.ink, marginTop: 8, textAlign: "right" },
  largeOfferAccept: { backgroundColor: palette.brand, borderRadius: radius.md, paddingVertical: 13, alignItems: "center", marginTop: 8 },
  largeOfferAcceptText: { color: palette.white, fontWeight: "900", fontSize: 13 },
  trackingHint: { fontSize: 12, color: palette.muted, textAlign: "center", marginTop: 8 },
  serviceIllustration: { width: 96, height: 96, borderRadius: radius.lg, marginBottom: 12, backgroundColor: palette.surfaceSoft },
  infoType: { fontSize: 18, fontWeight: "900", color: palette.ink, marginBottom: 8 },
  taxiInfoType: { fontSize: 13, marginBottom: 3 },
  infoRow: { fontSize: 13, color: palette.muted, marginTop: 5 },
  infoPrice: { fontSize: 18, fontWeight: "900", color: palette.brand, marginTop: 8 },
  actionsRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 8 },
  actionBtn: { flex: 1, backgroundColor: palette.brand, borderRadius: radius.md, paddingVertical: 13, alignItems: "center" },
  actionBtnText: { color: palette.white, fontSize: 14, fontWeight: "900" },
  reportCard: { marginHorizontal: 16, marginBottom: 12, padding: 14, borderRadius: radius.lg, borderWidth: 1, borderColor: "#D6A936", backgroundColor: palette.surface },
  reportButton: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  reportButtonText: { color: "#9A6811", fontSize: 13, fontWeight: "900" },
  reportButtonArrow: { color: palette.brand, fontSize: 11, fontWeight: "900" },
  reportTitle: { color: palette.ink, fontSize: 14, fontWeight: "900", textAlign: "right" },
  reportInput: { backgroundColor: palette.canvas, borderRadius: radius.md, borderWidth: 1, borderColor: palette.line, padding: 12, color: palette.ink, textAlign: "right" },
  reportAction: { flex: 1, backgroundColor: palette.brand, paddingVertical: 12, borderRadius: radius.md, alignItems: "center" },
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
  ratingOverlay: { position: "absolute", inset: 0, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center" },
  ratingCard: { backgroundColor: palette.surface, borderRadius: radius.xl, padding: 28, alignItems: "center", width: "84%" },
  ratingTitle: { fontSize: 21, fontWeight: "900", color: palette.ink, marginBottom: 20 },
  starsRow: { flexDirection: "row", gap: 12, marginBottom: 24 },
  star: { fontSize: 40, color: "#C9D1CA" },
  starActive: { color: palette.gold },
  ratingSubmit: { backgroundColor: palette.brand, borderRadius: radius.md, paddingHorizontal: 32, paddingVertical: 14 },
  ratingSubmitText: { color: palette.white, fontSize: 15, fontWeight: "900" },
});
