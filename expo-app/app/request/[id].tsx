import { useState, useEffect, useCallback, useRef } from "react";
import { router, useLocalSearchParams } from "expo-router";
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
import * as Location from "expo-location";
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
import { palette, radius, space } from "@/styles/theme";

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

type Coordinates = { latitude: number; longitude: number };
type RequestRecord = {
  provider_id: string | null;
  customer_id: string;
  status: string;
  type: string;
  pickup_text: string;
  dest_text: string | null;
  price_estimate: number | null;
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

export default function RequestDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, roles } = useAuth();
  const [request, setRequest] = useState<RequestRecord | null>(null);
  const [otherProfile, setOtherProfile] = useState<{ full_name: string | null; avatar_url: string | null; phone: string | null } | null>(null);
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
  const [newMsg, setNewMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [rating, setRating] = useState(0);
  const [showRating, setShowRating] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
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

  const loadRequest = useCallback(async () => {
    const { data, error } = await supabase
      .from("service_requests")
      .select(
        "provider_id, customer_id, status, type, pickup_text, dest_text, price_estimate, customer_price, pricing_mode, work_hours, work_description, workers_count, services(name_ar, slug), pickup_lat, pickup_lng, dest_lat, dest_lng, vehicle_category, vehicle_type, notes",
      )
      .eq("id", id)
      .maybeSingle();
    if (error) {
      setRequest(null);
      setLoading(false);
      return;
    }
    setRequest(data as RequestRecord | null);
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
    const otherId = request
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
  }, [id]);

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
          if (nextStatus === "completed") setShowRating(true);
          if (nextStatus === "accepted") loadChat();
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
        () => loadMessages(),
      )
      .subscribe();
    loadMessages();
    return () => {
      supabase.removeChannel(sub);
    };
  }, [chatId, loadMessages]);

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
      .select("user_id, lat, lng, updated_at")
      .eq("request_id", id)
      .eq("user_id", otherId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setOtherLocation({ latitude: data.lat, longitude: data.lng });
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
          const row = payload.new as { user_id?: string; lat?: number; lng?: number };
          if (
            row.user_id === otherId &&
            typeof row.lat === "number" &&
            typeof row.lng === "number"
          ) {
            setOtherLocation({ latitude: row.lat, longitude: row.lng });
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
      loadRequest();
      setShowRating(true);
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

  async function submitRating() {
    if (rating === 0 || !user) return;
    const otherId = isCustomer ? request?.provider_id : request?.customer_id;
    if (!otherId) return;
    const { error } = await supabase.from("ratings").insert({
      request_id: id,
      rater_id: user.id,
      ratee_id: otherId,
      stars: rating,
    });
    if (error) Alert.alert("تعذر إرسال التقييم", error.message);
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
          <Text style={styles.headerTitle}>{statusLabel[request.status] || request.status}</Text>
          <View style={{ width: 30 }} />
        </View>
        {otherProfile && (
          <View style={styles.personCard}>
            <View style={styles.personAvatar}>
              {otherProfile.avatar_url ? (
                <Image source={{ uri: otherProfile.avatar_url }} style={styles.personAvatarImage} />
              ) : (
                <Text style={styles.personAvatarText}>{(otherProfile.full_name || "؟")[0]}</Text>
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.personName}>{otherProfile.full_name || "مستخدم"}</Text>
              {!!otherProfile.phone && <Text style={styles.personPhone}>{otherProfile.phone}</Text>}
              <Text style={styles.personRole}>{isCustomer ? "مقدم الخدمة" : "الزبون"}</Text>
            </View>
          </View>
        )}
        <View style={styles.infoCard}>
          {request.type === "service" && request.services?.slug && SERVICE_IMAGES[request.services.slug] ? (
            <Image source={SERVICE_IMAGES[request.services.slug]} style={styles.serviceIllustration} resizeMode="cover" />
          ) : null}
          <Text style={styles.infoType}>
            {request.vehicle_category === "large" ? `🚚 طلب سيارة كبيرة — ${request.vehicle_type === "kia_passenger" ? "كيا ركاب" : "كيا حمل"}` : request.type === "taxi" ? "🚕 طلب سيارة" : `🛠️ ${request.services?.name_ar || "خدمة منزلية"}`}
          </Text>
          {request.pickup_text && <Text style={styles.infoRow}>من: {request.pickup_text}</Text>}
          {request.dest_text && <Text style={styles.infoRow}>إلى: {request.dest_text}</Text>}
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
                    style={[styles.largeOfferAccept, { flex: 1, backgroundColor: "#64748b" }]}
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
              style={[styles.largeOfferAccept, { backgroundColor: "#c2410c" }]}
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
              <Text style={styles.trackingTitle}>موقع الطلب المباشر</Text>
              <MapView
                style={styles.trackingMap}
                initialRegion={{
                  latitude: request.pickup_lat,
                  longitude: request.pickup_lng,
                  latitudeDelta: 0.025,
                  longitudeDelta: 0.025,
                }}
                showsUserLocation
              >
                <Marker
                  coordinate={{ latitude: request.pickup_lat, longitude: request.pickup_lng }}
                  title="نقطة الانطلاق"
                  pinColor="#0f766e"
                />
                {request.dest_lat != null && request.dest_lng != null && (
                  <Marker
                    coordinate={{ latitude: request.dest_lat, longitude: request.dest_lng }}
                    title="الوجهة"
                    pinColor="#16a34a"
                  />
                )}
                {myLocation && <Marker coordinate={myLocation} title="موقعي" pinColor="#7c3aed" />}
                {otherLocation && (
                  <Marker coordinate={otherLocation} title="الطرف الآخر" pinColor="#f97316" />
                )}
              </MapView>
              <Text style={styles.trackingHint}>
                {otherLocation ? "يتم استقبال موقع الطرف الآخر" : "بانتظار مشاركة موقع الطرف الآخر"}
              </Text>
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
              <Text style={styles.actionBtnText}>بدء الرحلة</Text>
            </TouchableOpacity>
          )}
          {isActive && isProvider && (
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: "#16a34a" }]}
              onPress={completeRide}
            >
              <Text style={styles.actionBtnText}>إنهاء</Text>
            </TouchableOpacity>
          )}
          {(isCustomer || isProvider) &&
            request.status !== "cancelled" &&
            request.status !== "completed" && (
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: "#dc2626" }]}
                onPress={cancelRequest}
              >
                <Text style={styles.actionBtnText}>إلغاء</Text>
              </TouchableOpacity>
            )}
        </View>
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          {messages.map((msg) => (
            <View
              key={msg.id}
              style={[
                styles.msgBubble,
                msg.sender_id === user?.id ? styles.msgMine : styles.msgOther,
              ]}
            >
              <Text style={styles.msgText}>{msg.content}</Text>
            </View>
          ))}
        </ScrollView>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 12, gap: 8 }}
        >
          {quickReplies.map((qr) => (
            <TouchableOpacity key={qr} style={styles.quickReply} onPress={() => sendMessage(qr)}>
              <Text style={styles.quickReplyText}>{qr}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.msgInput}
            value={newMsg}
            onChangeText={setNewMsg}
            placeholder="اكتب رسالة..."
            placeholderTextColor="#94a3b8"
            onSubmitEditing={() => sendMessage()}
          />
          <TouchableOpacity style={styles.sendBtn} onPress={() => sendMessage()}>
            <Text style={styles.sendBtnText}>إرسال</Text>
          </TouchableOpacity>
        </View>
        {showRating && (
          <View style={styles.ratingOverlay}>
            <View style={styles.ratingCard}>
              <Text style={styles.ratingTitle}>قيّم الخدمة</Text>
              <View style={styles.starsRow}>
                {[1, 2, 3, 4, 5].map((s) => (
                  <TouchableOpacity key={s} onPress={() => setRating(s)}>
                    <Text style={[styles.star, s <= rating && styles.starActive]}>★</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity style={styles.ratingSubmit} onPress={submitRating}>
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
  personCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: palette.surface, borderRadius: radius.lg, padding: 15, marginHorizontal: 16, marginTop: 12, borderWidth: 1, borderColor: palette.line },
  personAvatar: { width: 56, height: 56, borderRadius: 18, overflow: "hidden", backgroundColor: palette.brand, alignItems: "center", justifyContent: "center" },
  personAvatarImage: { width: "100%", height: "100%" },
  personAvatarText: { color: palette.white, fontSize: 23, fontWeight: "900" },
  personName: { color: palette.ink, fontSize: 15, fontWeight: "900" },
  personPhone: { color: palette.muted, fontSize: 12, marginTop: 3 },
  personRole: { color: palette.brand, fontSize: 11, fontWeight: "900", marginTop: 3 },
  infoCard: { backgroundColor: palette.surface, borderRadius: radius.lg, padding: 17, margin: 16, borderWidth: 1, borderColor: palette.line },
  trackingCard: { backgroundColor: palette.surface, borderRadius: radius.lg, padding: 13, marginHorizontal: 16, marginBottom: 12, borderWidth: 1, borderColor: palette.line },
  trackingTitle: { fontSize: 15, fontWeight: "900", color: palette.ink, marginBottom: 10 },
  trackingMap: { height: 220, borderRadius: radius.md },
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
  infoRow: { fontSize: 13, color: palette.muted, marginTop: 5 },
  infoPrice: { fontSize: 18, fontWeight: "900", color: palette.brand, marginTop: 8 },
  actionsRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 8 },
  actionBtn: { flex: 1, backgroundColor: palette.brand, borderRadius: radius.md, paddingVertical: 13, alignItems: "center" },
  actionBtnText: { color: palette.white, fontSize: 14, fontWeight: "900" },
  msgBubble: { maxWidth: "75%", borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 11, marginBottom: 8 },
  msgMine: { backgroundColor: palette.brand, alignSelf: "flex-end" },
  msgOther: { backgroundColor: palette.surface, alignSelf: "flex-start", borderWidth: 1, borderColor: palette.line },
  msgText: { fontSize: 14, color: palette.ink },
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
