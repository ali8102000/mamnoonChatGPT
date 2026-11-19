import { useState, useEffect, useRef } from "react";
import * as SecureStore from "expo-secure-store";
import { router, useLocalSearchParams } from "expo-router";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
  ActivityIndicator,
  Image,
  BackHandler,
  PanResponder,
  useWindowDimensions,
} from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";
import Svg, { Circle, Path } from "react-native-svg";
import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { callMamnoonMapsApi } from "@/lib/maps-api";
import { IRAQ_GOVERNORATES, getMobileGovernorate, nearestGovernorateKey } from "@/lib/governorates";
import { Button } from "@/components/ui";
import { getServiceImage } from "@/lib/service-visuals";
import { ServiceArtwork, hasServiceArtwork } from "@/components/service-artwork";
import { palette, radius } from "@/styles/theme";

type Coordinates = { latitude: number; longitude: number };
type VehicleCategory = "economy" | "premium" | "luxury" | "large";

type FavoritePlace = { id: string; label: string; address: string; latitude: number; longitude: number; governorate_key: string | null };
type CatalogService = { id: string; slug: string; name_ar: string };

const EXPERT_ONLY_SERVICE_SLUGS = new Set([
  "build", "plaster", "carpentry_form", "flooring", "chef", "plumbing", "electric_setup", "electric_street",
]);


const VEHICLE_CATS: { key: VehicleCategory; label: string; emoji: string }[] = [
  { key: "economy", label: "ممنون اقتصادي", emoji: "🚗" },
  { key: "premium", label: "ممنون المتميز", emoji: "🚙" },
  { key: "luxury", label: "ممنون فاخر", emoji: "🏎️" },
  { key: "large", label: "سيارة كبيرة", emoji: "🚚" },
];

// Start with an Iraq-wide view when location permission is unavailable.
// A successful GPS lookup immediately zooms the map to the user's position.
const IRAQ_REGION = {
  latitude: 33.2,
  longitude: 43.8,
  latitudeDelta: 9,
  longitudeDelta: 11,
};

function MapCenterPin() {
  return (
    <View style={styles.pinArtwork}>
      <Svg width={42} height={52} viewBox="0 0 42 52">
        <Path d="M21 50C17 43 3 29 3 19A18 18 0 1 1 39 19C39 29 25 43 21 50Z" fill="#D6A43B" stroke="#FFFFFF" strokeWidth={2.5} />
        <Circle cx={21} cy={19} r={7} fill="#FFFFFF" />
        <Circle cx={21} cy={19} r={3.2} fill="#17324D" />
      </Svg>
      <View style={styles.pinShadow} />
    </View>
  );
}

function formatAddress(parts: Location.LocationGeocodedAddress[] | null | undefined) {
  const item = parts?.[0];
  if (!item) return "";
  return [item.name, item.street, item.district, item.city, item.region]
    .filter((part): part is string => Boolean(part?.trim()))
    .filter((part, index, all) => all.indexOf(part) === index)
    .join("، ");
}

async function resolveGovernorate(coords: Coordinates): Promise<string> {
  const detected = await callMamnoonMapsApi<{ key: string }>({
    action: "detectGovernorate",
    center: { lat: coords.latitude, lng: coords.longitude },
  });
  if (!detected.key) throw new Error("تعذّر تحديد المحافظة.");
  const validation = await callMamnoonMapsApi<{ valid: boolean }>({
    action: "validateGovernorate",
    center: { lat: coords.latitude, lng: coords.longitude },
    governorateKey: detected.key,
  });
  if (!validation.valid) throw new Error("الموقع المحدد خارج حدود المحافظات العراقية.");
  return detected.key;
}


function GovernoratePickerModal({ visible, selectedKey, onClose, onSelect }: { visible: boolean; selectedKey: string | null; onClose: () => void; onSelect: (key: string) => void }) {
  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(5,10,18,0.72)", justifyContent: "center", padding: 20 }}>
        <View style={{ maxHeight: "78%", borderRadius: 24, padding: 18, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.gold }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <TouchableOpacity onPress={onClose} style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: palette.canvas, alignItems: "center", justifyContent: "center" }}><Text style={{ color: palette.ink, fontSize: 22, fontWeight: "900" }}>×</Text></TouchableOpacity>
            <View style={{ flex: 1, alignItems: "flex-end" }}><Text style={{ color: palette.ink, fontSize: 19, fontWeight: "900" }}>اختر محافظة</Text><Text style={{ color: palette.muted, fontSize: 11, marginTop: 3 }}>حدد المحافظة للبحث عن الأماكن القريبة</Text></View>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled"><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {IRAQ_GOVERNORATES.map((governorate) => { const selected = selectedKey === governorate.key; return <TouchableOpacity key={governorate.key} onPress={() => onSelect(governorate.key)} style={{ minWidth: "47%", flexGrow: 1, paddingVertical: 13, paddingHorizontal: 10, borderRadius: 13, borderWidth: 1, borderColor: selected ? palette.gold : palette.line, backgroundColor: selected ? palette.brand : palette.canvas, alignItems: "center" }}><Text style={{ color: selected ? palette.white : palette.ink, fontSize: 13, fontWeight: "900" }}>{selected ? "✓  " : ""}{governorate.name}</Text></TouchableOpacity>; })}
          </View></ScrollView>
        </View>
      </View>
    </Modal>
  );
}

type ActiveRequestPreview = {
  id: string;
  type: string;
  status: string;
  provider_arrived_at: string | null;
  vehicle_category: string | null;
  vehicle_type: string | null;
  service_id: string | null;
  serviceSlug?: string | null;
  serviceName?: string | null;
};

function ActiveRequestConfirmModal({
  request, choice, visible, busy, onChoice, onConfirm, onClose,
}: {
  request: ActiveRequestPreview | null;
  choice: "keep" | "cancel";
  visible: boolean;
  busy: boolean;
  onChoice: (choice: "keep" | "cancel") => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  if (!request) return null;
  const canCancel = !request.provider_arrived_at && request.status !== "in_progress";
  const statusLabel = request.status === "pending" || request.status === "searching"
    ? "قيد البحث عن سائق أو فني"
    : request.status === "accepted" ? "تم قبول الطلب" : "قيد التنفيذ";
  const imageSlug = request.type === "service"
    ? request.serviceSlug || "general"
    : request.vehicle_category === "large"
      ? request.vehicle_type === "kia_cargo" ? "goods_transport" : request.vehicle_type === "bus" ? "bus" : "kia_driver"
      : "kia_driver";
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(5,10,18,0.78)", justifyContent: "center", padding: 20 }}>
        <View style={{ borderRadius: 24, padding: 18, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.gold, gap: 12 }}>
          <Text style={{ color: palette.ink, fontSize: 19, fontWeight: "900", textAlign: "right" }}>عندك طلب سابق نشط</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Image source={getServiceImage(imageSlug)} style={{ width: 82, height: 72, borderRadius: 14, backgroundColor: palette.canvas }} resizeMode="cover" />
            <View style={{ flex: 1, alignItems: "flex-end", gap: 5 }}>
              <Text style={{ color: palette.ink, fontWeight: "900", fontSize: 14 }}>{request.serviceName || (request.type === "taxi" ? request.vehicle_category === "large" ? "سيارة كبيرة" : "طلب تكسي" : "طلب خدمة")}</Text>
              <Text style={{ color: palette.muted, fontSize: 11 }}>رمز الطلب: {request.id.slice(0, 8).toUpperCase()}</Text>
              <Text style={{ color: palette.brand, fontSize: 12, fontWeight: "900" }}>{statusLabel}</Text>
            </View>
          </View>
          <TouchableOpacity onPress={() => onChoice("keep")} style={{ padding: 12, borderRadius: 13, borderWidth: 1.5, borderColor: choice === "keep" ? palette.brand : palette.line, backgroundColor: choice === "keep" ? palette.brandSoft : palette.canvas }}>
            <Text style={{ color: palette.ink, textAlign: "right", fontWeight: "900" }}>{choice === "keep" ? "● " : "○ "}الاحتفاظ بالطلب السابق وإرسال طلب جديد</Text>
          </TouchableOpacity>
          <TouchableOpacity disabled={!canCancel} onPress={() => onChoice("cancel")} style={{ padding: 12, borderRadius: 13, borderWidth: 1.5, borderColor: choice === "cancel" ? palette.danger : palette.line, opacity: canCancel ? 1 : 0.45 }}>
            <Text style={{ color: palette.ink, textAlign: "right", fontWeight: "900" }}>{choice === "cancel" ? "● " : "○ "}إلغاء الطلب السابق وإرسال طلب جديد</Text>
            {!canCancel && <Text style={{ color: palette.danger, textAlign: "right", fontSize: 10, marginTop: 5 }}>لا يمكن الإلغاء بعد وصول مقدم الخدمة أو بدء التنفيذ</Text>}
          </TouchableOpacity>
          <Text style={{ color: palette.muted, fontSize: 10, textAlign: "right" }}>لن يتغير أي طلب قبل الضغط على «تأكيد الاختيار»</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TouchableOpacity onPress={onClose} disabled={busy} style={{ flex: 1, padding: 13, borderRadius: 13, backgroundColor: palette.canvas, alignItems: "center" }}><Text style={{ color: palette.ink, fontWeight: "900" }}>رجوع</Text></TouchableOpacity>
            <TouchableOpacity onPress={onConfirm} disabled={busy || (choice === "cancel" && !canCancel)} style={{ flex: 1, padding: 13, borderRadius: 13, backgroundColor: palette.brand, alignItems: "center", opacity: busy || (choice === "cancel" && !canCancel) ? 0.55 : 1 }}><Text style={{ color: palette.white, fontWeight: "900" }}>{busy ? "جارٍ التنفيذ..." : "تأكيد الاختيار"}</Text></TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default function NewRequest() {
  const { type, vehicle } = useLocalSearchParams<{ type: string; vehicle?: string }>();
  const { user } = useAuth();
  const window = useWindowDimensions();
  const [taxiSheetHeight, setTaxiSheetHeight] = useState(320);
  const [selectedService, setSelectedService] = useState(type || "taxi");
  const [serviceDetailsStep, setServiceDetailsStep] = useState(false);
  const [serviceCatalog, setServiceCatalog] = useState<CatalogService[]>([]);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [servicesError, setServicesError] = useState<string | null>(null);
  const [pickup, setPickup] = useState("");
  const [destination, setDestination] = useState("");
  const [pickupCoords, setPickupCoords] = useState<Coordinates | null>(null);
  const [destinationCoords, setDestinationCoords] = useState<Coordinates | null>(null);
  const [mapMode, setMapMode] = useState<"pickup" | "destination">("pickup");
  const [favoritePlaces, setFavoritePlaces] = useState<FavoritePlace[]>([]);
  const [favoritePlacesLoading, setFavoritePlacesLoading] = useState(false);
  const [favoriteName, setFavoriteName] = useState("");
  const [showFavoriteNameInput, setShowFavoriteNameInput] = useState(false);
  const [destinationConfirmed, setDestinationConfirmed] = useState(false);
  const [pickupGovernorateKey, setPickupGovernorateKey] = useState<string | null>(null);
  const [destinationGovernorateKey, setDestinationGovernorateKey] = useState<string | null>(null);
  const activeGovernorateKey = mapMode === "pickup" ? pickupGovernorateKey : destinationGovernorateKey ?? pickupGovernorateKey;
  useEffect(() => {
    let active = true;
    if (!user?.id) { setFavoritePlaces([]); return; }
    setFavoritePlacesLoading(true);
    (supabase as any).from("customer_favorite_places")
      .select("id,label,address,latitude,longitude,governorate_key")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .then(({ data, error }: any) => {
        if (!active) return;
        if (!error) setFavoritePlaces((data ?? []) as FavoritePlace[]);
        setFavoritePlacesLoading(false);
      });
    return () => { active = false; };
  }, [user?.id]);

  async function saveFavoritePlace() {
    const label = favoriteName.trim();
    if (!user?.id || !destinationCoords || !label) { Alert.alert("بيانات ناقصة", "اكتب اسماً للمكان وحدد الوجهة أولاً."); return; }
    const row = { user_id: user.id, label, address: destination || label, latitude: destinationCoords.latitude, longitude: destinationCoords.longitude, governorate_key: destinationGovernorateKey ?? pickupGovernorateKey };
    const { data, error } = await (supabase as any).from("customer_favorite_places").insert(row).select("id,label,address,latitude,longitude,governorate_key").single();
    if (error) { Alert.alert("تعذر الحفظ", error.code === "23505" ? "عندك مكان محفوظ بنفس الاسم." : "حاول مرة ثانية."); return; }
    setFavoritePlaces((items) => [data as FavoritePlace, ...items]);
    setFavoriteName(""); setShowFavoriteNameInput(false);
    Alert.alert("تم الحفظ", "انضاف المكان إلى أماكنك المفضلة.");
  }

  function chooseFavoritePlace(place: FavoritePlace) {
    const coords = { latitude: Number(place.latitude), longitude: Number(place.longitude) };
    setDestinationGovernorateKey(place.governorate_key ?? pickupGovernorateKey);
    setDestinationCoords(coords); setDestination(place.address || place.label);
    setMapMode("destination"); setDestinationConfirmed(false);
    setRouteKm(null); setRouteError(null); setShowFavoriteNameInput(false);
    setPlaceQuery(""); setPlaceSuggestions([]); setPlaceSearchError(null);
    moveMap({ ...coords, latitudeDelta: 0.008, longitudeDelta: 0.008 });
  }

  async function deleteFavoritePlace(id: string) {
    const { error } = await (supabase as any).from("customer_favorite_places").delete().eq("id", id);
    if (error) { Alert.alert("تعذر الحذف", "حاول مرة ثانية."); return; }
    setFavoritePlaces((items) => items.filter((item) => item.id !== id));
  }
  const activeGovernorate = getMobileGovernorate(activeGovernorateKey);
  const [governoratePickerVisible, setGovernoratePickerVisible] = useState(false);
  const outsideGovernoratePromptShownRef = useRef(false);
  const nearbySelectionRef = useRef(0);
  const placeSelectionRef = useRef(0);
  const confirmDestinationPendingRef = useRef(false);
  useEffect(() => { if (pickupGovernorateKey) void SecureStore.setItemAsync("mamnoon_governorate", pickupGovernorateKey).catch(() => {}); }, [pickupGovernorateKey]);
  const [region, setRegion] = useState(IRAQ_REGION);
  const [nearbyDrivers, setNearbyDrivers] = useState<Array<{ pin_id: string; lat: number; lng: number; heading: number | null }>>([]);
  const [locationLoading, setLocationLoading] = useState(true);
  const [vehicleCat, setVehicleCat] = useState<VehicleCategory>(vehicle === "large" ? "large" : "economy");
  const [uiVisuals, setUiVisuals] = useState<Record<string, any>>({});
  const [urgencyEnabled, setUrgencyEnabled] = useState(false);
  const [urgencyAllowed, setUrgencyAllowed] = useState(false);
  const [vehicleType, setVehicleType] = useState<"kia_cargo" | "kia_passenger" | "bus">("kia_cargo");
  const [workerLevel, setWorkerLevel] = useState<"fani" | "khabir">("fani");
  const [extraWorkers, setExtraWorkers] = useState(0);
  const [notes, setNotes] = useState("");
  const [workDescription, setWorkDescription] = useState("");
  const [brickQuantity, setBrickQuantity] = useState("");
  const [cargoLoadDescription, setCargoLoadDescription] = useState("");
  const [requestPhoto, setRequestPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [customerPrice, setCustomerPrice] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [couponPreview, setCouponPreview] = useState<{ discount: number; payable: number } | null>(null);
  const [couponError, setCouponError] = useState("");
  const [couponLoading, setCouponLoading] = useState(false);
  const [pricingMode, setPricingMode] = useState<"fixed" | "hourly" | "negotiable">("fixed");
  const [workHours, setWorkHours] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeRequestPreview, setActiveRequestPreview] = useState<ActiveRequestPreview | null>(null);
  const [activeRequestChoice, setActiveRequestChoice] = useState<"keep" | "cancel">("keep");
  const [activeRequestPromptVisible, setActiveRequestPromptVisible] = useState(false);
  const [routeKm, setRouteKm] = useState<number | null>(null);
  const [serverTaxiFare, setServerTaxiFare] = useState<number | null>(null);
  const [serverTaxiFares, setServerTaxiFares] = useState<Partial<Record<"economy" | "premium" | "luxury", number>>>({});
  const [routeDurationMin, setRouteDurationMin] = useState<number | null>(null);
  const [routeIsIntercity, setRouteIsIntercity] = useState(false);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeRetry, setRouteRetry] = useState(0);
  const [tripOptionsExpanded, setTripOptionsExpanded] = useState(false);
  const [tripType, setTripType] = useState<"one_way" | "round_trip" | "second_trip" | "stop">("one_way");
  const [extraMinutes, setExtraMinutes] = useState(0);
  const [placeQuery, setPlaceQuery] = useState("");
  const [placeSuggestions, setPlaceSuggestions] = useState<Array<{ id: string; text: string; address?: string; coords?: { lat: number; lng: number }; governorateKey?: string }>>([]);
  const [searchingPlaces, setSearchingPlaces] = useState(false);
  const [placeSearchError, setPlaceSearchError] = useState<string | null>(null);
  const [focusSearchAfterProvince, setFocusSearchAfterProvince] = useState(false);
  const placeSearchInputRef = useRef<TextInput>(null);
  const regionChangeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userPannedMapRef = useRef(false);
  const mapRef = useRef<MapView>(null);
  const extraTimeTrackWidthRef = useRef(1);
  const extraTimePanResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event) => updateExtraMinutesFromPosition(event.nativeEvent.locationX),
    onPanResponderMove: (event) => updateExtraMinutesFromPosition(event.nativeEvent.locationX),
  })).current;

  function updateExtraMinutesFromPosition(x: number) {
    const ratio = 1 - Math.max(0, Math.min(1, x / Math.max(1, extraTimeTrackWidthRef.current)));
    const steps = Math.round(ratio * 24);
    setExtraMinutes(steps * 5);
  }

  useEffect(() => () => {
    if (regionChangeTimerRef.current) clearTimeout(regionChangeTimerRef.current);
  }, []);
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (selectedService === "taxi" && vehicle !== "large" && mapMode === "destination") {
        setMapMode("pickup");
        setDestinationCoords(null);
        setDestination("");
        setDestinationConfirmed(false);
        setRouteKm(null);
        setRouteDurationMin(null);
        setRouteError(null);
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [selectedService, vehicle, mapMode]);

  useEffect(() => {
    const requestedType = type || "taxi";
    setSelectedService((current) => current === requestedType ? current : requestedType);
    // The same Expo Router screen can be reused when moving between service
    // and taxi requests. Clear technician-only form state on route changes.
    setUrgencyEnabled(false);
    setUrgencyAllowed(false);
    if (requestedType === "taxi" || requestedType === "service") {
      setWorkerLevel("fani");
      setExtraWorkers(0);
      setWorkDescription("");
      setBrickQuantity("");
      setCargoLoadDescription("");
      setPricingMode("fixed");
      setWorkHours("");
      setCustomerPrice("");
      setRequestPhoto(null);
      setNotes("");
      setDestination("");
      setDestinationCoords(null);
      setDestinationGovernorateKey(null);
      setDestinationConfirmed(false);
      setMapMode("pickup");
      setRouteKm(null);
      setServerTaxiFare(null);
      setRouteDurationMin(null);
      setRouteError(null);
      setCouponCode("");
      setCouponPreview(null);
      setCouponError("");
    }
  }, [type]);

  useEffect(() => {
    let active = true;
    (supabase as any).from("app_ui_elements_public").select("element_key,published_config,title,sort_order")
      .then(({ data, error }: any) => {
        if (!active || error) return;
        const next: Record<string, any> = {};
        for (const item of data ?? []) next[item.element_key] = { ...(item.published_config ?? {}), title: item.title, sort_order: item.sort_order };
        setUiVisuals(next);
      });
    return () => { active = false; };
  }, []);

  const isTaxi = selectedService === "taxi";
  const isLargeVehicle = vehicle === "large";
  const isIntercity = routeIsIntercity;
  const showRequestPhoto = !isTaxi || isLargeVehicle;
  const estimatedTaxiFare = routeKm !== null && isTaxi && !isLargeVehicle ? (serverTaxiFares[vehicleCat as Exclude<VehicleCategory, "large">] ?? serverTaxiFare) : null;
  // The selected amount is per ordinary technician; an expert costs two technician rates.
  const servicePriceMultiplier = extraWorkers + 1 + (workerLevel === "khabir" ? 1 : 0);
  const serviceTotalPrice = Number(customerPrice || 0) * servicePriceMultiplier;

  function getCouponBaseAmount() {
    if (!isTaxi || isLargeVehicle) return null;
    return estimatedTaxiFare;
  }

  async function previewCoupon() {
    const code = couponCode.trim().toUpperCase();
    const amount = getCouponBaseAmount();
    if (!code) {
      setCouponError("اكتب رمز الكوبون");
      return;
    }
    if (!amount || amount <= 0) {
      setCouponError("حدد سعر الطلب أولاً حتى نتحقق من الخصم");
      return;
    }
    setCouponLoading(true);
    setCouponError("");
    setCouponPreview(null);
    try {
      const { data, error } = await supabase.rpc("preview_my_coupon", {
        p_code: code,
        p_amount: amount,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw new Error("الكوبون غير متاح لهذا الطلب");
      setCouponPreview({ discount: Number(row.discount), payable: Number(row.payable) });
    } catch (error: any) {
      setCouponError(error?.message || "تعذّر التحقق من الكوبون");
    } finally {
      setCouponLoading(false);
    }
  }

  useEffect(() => {
    setCouponPreview(null);
  }, [customerPrice, pricingMode, routeKm, tripType, extraMinutes, vehicleCat, selectedService, isTaxi, isLargeVehicle, isIntercity, urgencyEnabled]);

  function moveMap(nextRegion: typeof region) {
    setRegion(nextRegion);
    mapRef.current?.animateToRegion(nextRegion, 0);
  }

  useEffect(() => {
    if (!destinationCoords || destinationGovernorateKey) return;
    let active = true;
    void callMamnoonMapsApi<{ key: string }>({
      action: "detectGovernorate",
      center: { lat: destinationCoords.latitude, lng: destinationCoords.longitude },
    }).then((result) => {
      if (active) setDestinationGovernorateKey(result.key);
    }).catch(() => {});
    return () => { active = false; };
  }, [destinationCoords, destinationGovernorateKey]);

  useEffect(() => {
    if (!focusSearchAfterProvince) return;
    const timer = setTimeout(() => {
      placeSearchInputRef.current?.focus();
      setFocusSearchAfterProvince(false);
    }, 120);
    return () => clearTimeout(timer);
  }, [focusSearchAfterProvince, activeGovernorateKey, mapMode]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const catalog = await supabase.rpc("get_worker_service_catalog");
        let rows = !catalog.error && Array.isArray(catalog.data) ? catalog.data as CatalogService[] : [];
        if (!rows.length) {
          const fallback = await supabase.from("services")
            .select("id, slug, name_ar")
            .order("sort_order");
          if (fallback.error) throw fallback.error;
          rows = (fallback.data ?? []) as CatalogService[];
        }
        if (!active) return;
        setServiceCatalog(rows.filter((service) => service.slug !== "taxi"));
        setServicesError(rows.length ? null : "لا توجد خدمات متاحة حالياً.");
      } catch (error: any) {
        if (!active) return;
        setServicesError(/invalid api key/i.test(error?.message || "")
          ? "مفتاح اتصال قاعدة البيانات غير صالح في هذه النسخة."
          : "تعذر تحميل الخدمات. تحقق من الاتصال ثم أعد المحاولة.");
      } finally {
        if (active) setServicesLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);


  useEffect(() => {
    let mounted = true;
    async function locateInitialPosition() {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== "granted") {
          if (mounted) {
            Alert.alert(
              "إذن الموقع مطلوب",
              "اسمح لممنون بتحديد موقعك حتى يضع نقطة الانطلاق أو موقع الخدمة تلقائياً. تقدر تختار الموقع يدوياً إذا ما تريد تفعيل الإذن.",
            );
          }
          return;
        }
        const lastKnown = await Location.getLastKnownPositionAsync();
        const position = lastKnown ?? await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        if (!mounted) return;
        const coords = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        setPickupCoords(coords);
        setPickupGovernorateKey(nearestGovernorateKey(coords));
        void callMamnoonMapsApi<{ key: string }>({ action: "detectGovernorate", center: { lat: coords.latitude, lng: coords.longitude } })
          .then((result) => { if (mounted) setPickupGovernorateKey(result.key); })
          .catch(() => {});
        moveMap({ ...coords, latitudeDelta: 0.02, longitudeDelta: 0.02 });
        const address = formatAddress(await Location.reverseGeocodeAsync(coords));
        if (address) setPickup(address);
      } catch {
        if (mounted) Alert.alert("تعذر تحديد الموقع", "حدد موقع الانطلاق يدوياً من الخريطة.");
      } finally {
        if (mounted) setLocationLoading(false);
      }
    }
    locateInitialPosition();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!pickupCoords || !isTaxi) {
      setNearbyDrivers([]);
      return;
    }
    let active = true;
    const loadNearbyDrivers = async () => {
      const { data, error } = await (supabase as any).rpc("find_nearby_provider_pins", {
        _lat: pickupCoords.latitude,
        _lng: pickupCoords.longitude,
        _type: "taxi",
        _category: isLargeVehicle ? "large" : vehicleCat,
        _service_id: null,
        _radius_km: isLargeVehicle ? 25 : 5,
        _limit: 30,
      });
      if (!active || error) return;
      setNearbyDrivers((data ?? []).filter((item: any) =>
        typeof item?.lat === "number" && typeof item?.lng === "number" &&
        Number.isFinite(item.lat) && Number.isFinite(item.lng)
      ));
    };
    void loadNearbyDrivers();
    const timer = setInterval(() => void loadNearbyDrivers(), 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [pickupCoords?.latitude, pickupCoords?.longitude, isTaxi, isLargeVehicle, vehicleCat]);

  useEffect(() => {
    if (!pickupCoords || !destinationCoords || !isTaxi || isLargeVehicle) {
      setRouteKm(null);
      setRouteDurationMin(null);
      setRouteIsIntercity(false);
      setRouteError(null);
      setRouteLoading(false);
      return;
    }

    // Invalidate the previous quote immediately when either pin changes.
    // Never leave a stale route price tappable while the next route is loading.
    setRouteKm(null);
    setServerTaxiFare(null);
    setServerTaxiFares({});
    setRouteDurationMin(null);
    setRouteError(null);
    setRouteLoading(true);
    let active = true;
    const timer = setTimeout(async () => {
      try {
        // One authoritative quote call calculates route, governorates and all category prices.
        // Avoid four extra detect/validate network round-trips before pricing.
        const { data: route, error: quoteError } = await supabase.functions.invoke("auto-taxi-pricing", {
          body: { action: "quote", from: { lat: pickupCoords.latitude, lng: pickupCoords.longitude }, to: { lat: destinationCoords.latitude, lng: destinationCoords.longitude }, vehicleCategory: "economy", tripType, extraMinutes, pickupGovernorateKey, destinationGovernorateKey: destinationGovernorateKey ?? pickupGovernorateKey, urgencyEnabled },
        });
        if (quoteError) throw quoteError;
        if (!active) return;
        if (
          !Number.isFinite(route.distanceKm) ||
          route.distanceKm <= 0 ||
          !Number.isFinite(route.durationMin) ||
          route.durationMin < 0 ||
          !Number.isFinite(route.priceEstimate)
        ) {
          throw new Error("تعذّر التحقق من مسافة الطريق. حرّك نقطة الوجهة أو أعد المحاولة.");
        }
        if (!route.fromGovernorateKey || !route.toGovernorateKey) {
          throw new Error("تعذّر تحديد المحافظتين للطريق.");
        }
        setPickupGovernorateKey(route.fromGovernorateKey);
        setDestinationGovernorateKey(route.toGovernorateKey);
        setRouteIsIntercity(Boolean(route.isIntercity));
        setRouteKm(route.distanceKm);
        setRouteDurationMin(route.durationMin);
        setServerTaxiFare(Number(route.priceEstimate));
        setUrgencyAllowed(Boolean(route.urgencyAllowed));
        if (!route.urgencyAllowed) setUrgencyEnabled(false);
        setServerTaxiFares(route.categoryPrices && typeof route.categoryPrices === "object"
          ? route.categoryPrices
          : { [vehicleCat]: Number(route.priceEstimate) });
        // If the user tapped confirm while the authoritative quote was loading,
        // complete the confirmation immediately when that quote arrives.
        if (confirmDestinationPendingRef.current) {
          confirmDestinationPendingRef.current = false;
          setDestinationConfirmed(true);
        }
      } catch (error) {
        if (!active) return;
        setRouteKm(null);
        setRouteDurationMin(null);
        confirmDestinationPendingRef.current = false;
        setRouteError(error instanceof Error ? error.message : "تعذّر حساب مسافة الطريق.");
      } finally {
        if (active) setRouteLoading(false);
      }
    }, 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [pickupCoords, destinationCoords, pickupGovernorateKey, destinationGovernorateKey, isTaxi, isLargeVehicle, tripType, extraMinutes, urgencyEnabled, routeRetry]);

  useEffect(() => {
    const query = placeQuery.trim();
    if (query.length < 2 || !activeGovernorateKey) {
      setPlaceSuggestions([]);
      setSearchingPlaces(false);
      setPlaceSearchError(null);
      return;
    }
    let active = true;
    // Never leave predictions from the previous query selectable while a new
    // search is pending; this prevents tapping a stale destination.
    setPlaceSuggestions([]);
    const timer = setTimeout(async () => {
      setSearchingPlaces(true);
      setPlaceSearchError(null);
      const center = mapMode === "pickup" ? pickupCoords : destinationCoords;
      const fallback = activeGovernorate;
      try {
        const result = await callMamnoonMapsApi<{ suggestions: Array<{ id: string; text: string; address?: string; coords?: { lat: number; lng: number } }> }>({
          action: "autocomplete",
          input: query,
          center: center ? { lat: center.latitude, lng: center.longitude } : { lat: fallback!.latitude, lng: fallback!.longitude },
          governorateKey: activeGovernorateKey,
        });
        if (active) setPlaceSuggestions((result.suggestions ?? []).slice(0, 30));
      } catch (error) {
        if (active) {
          setPlaceSuggestions([]);
          setPlaceSearchError(error instanceof Error ? error.message : "تعذّر البحث عن الأماكن.");
        }
      } finally {
        if (active) setSearchingPlaces(false);
      }
    }, 100);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [placeQuery, activeGovernorateKey, mapMode, pickupCoords, destinationCoords]);

  async function locateMe() {
    setLocationLoading(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        Alert.alert("إذن الموقع مطلوب", "اسمح لممنون باستخدام الموقع أو اختر النقطة يدوياً.");
        return;
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      const coords = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
      setDestinationConfirmed(false);
      moveMap({ ...coords, latitudeDelta: 0.015, longitudeDelta: 0.015 });
      const address = formatAddress(await Location.reverseGeocodeAsync(coords));
      if (mapMode === "destination") {
        const detectedGovernorate = await callMamnoonMapsApi<{ key: string }>({ action: "detectGovernorate", center: { lat: coords.latitude, lng: coords.longitude } });
        setDestinationCoords(coords);
        setDestinationGovernorateKey(detectedGovernorate.key);
        setDestination(address || "موقع محدد على الخريطة");
      } else {
        setPickupCoords(coords);
        setPickupGovernorateKey(nearestGovernorateKey(coords));
        void callMamnoonMapsApi<{ key: string }>({ action: "detectGovernorate", center: { lat: coords.latitude, lng: coords.longitude } })
          .then((result) => setPickupGovernorateKey(result.key))
          .catch(() => {});
        setPickup(address || "موقع محدد على الخريطة");
      }
      setPlaceQuery("");
      setPlaceSuggestions([]);
    } catch {
      Alert.alert("تعذر تحديد الموقع", "تأكد من تشغيل GPS وحاول مرة أخرى.");
    } finally {
      setLocationLoading(false);
    }
  }

  function handleRegionChangeComplete(nextRegion: typeof region, details?: { isGesture?: boolean }) {
    // Pinch zoom is a map gesture too, but it is not a new location selection.
    if (!details?.isGesture || !userPannedMapRef.current) return;
    userPannedMapRef.current = false;
    if (regionChangeTimerRef.current) clearTimeout(regionChangeTimerRef.current);
    regionChangeTimerRef.current = setTimeout(async () => {
      const coords = { latitude: nextRegion.latitude, longitude: nextRegion.longitude };
      if (activeGovernorateKey) {
        try {
          const validation = await callMamnoonMapsApi<{ valid: boolean }>({
            action: "validateGovernorate",
            center: { lat: coords.latitude, lng: coords.longitude },
            governorateKey: activeGovernorateKey,
          });
          if (!validation.valid) {
            if (mapMode === "destination" && !outsideGovernoratePromptShownRef.current) {
              outsideGovernoratePromptShownRef.current = true;
              Alert.alert(
                "أنت خارج محافظتك",
                "يرجى تحديد المحافظة المراد التوجه إليها حتى نعرض لك اقتراحاتها فقط.",
                [
                  { text: "تحديد المحافظة", onPress: () => setGovernoratePickerVisible(true) },
                  { text: "إلغاء", style: "cancel" },
                ],
              );
            }
            return;
          }
        } catch {
          return;
        }
      }
      const address = formatAddress(await Location.reverseGeocodeAsync(coords).catch(() => []));
      setDestinationConfirmed(false);
      if (mapMode === "pickup") {
        setPickupCoords(coords);
        setPickup(address || "موقع محدد على الخريطة");
      } else {
        setDestinationCoords(coords);
        setDestination(address || "وجهة محددة على الخريطة");
      }
    }, 450);
  }

  function chooseGovernorate(key: string) {
    const governorate = getMobileGovernorate(key);
    if (!governorate) return;
    setDestinationConfirmed(false);
    if (mapMode === "pickup") setPickupGovernorateKey(key);
    else setDestinationGovernorateKey(key);
    outsideGovernoratePromptShownRef.current = false;
    setPlaceQuery("");
    setPlaceSuggestions([]);
    setPlaceSearchError(null);
    setFocusSearchAfterProvince(true);
    moveMap({ latitude: governorate.latitude, longitude: governorate.longitude, latitudeDelta: 0.12, longitudeDelta: 0.12 });
    if (mapMode === "pickup") {
      setPickupCoords(null);
      setPickup("");
    } else {
      setDestinationCoords(null);
      setDestination("");
    }
  }

  async function chooseRequestPhoto() {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.75,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      if (asset.fileSize && asset.fileSize > 8 * 1024 * 1024) {
        Alert.alert("الصورة كبيرة", "الحد الأعلى لحجم الصورة 8 ميغابايت. اختَر صورة أصغر.");
        return;
      }
      const mimeType = asset.mimeType ?? (asset.uri.toLowerCase().endsWith(".png") ? "image/png" : asset.uri.toLowerCase().endsWith(".webp") ? "image/webp" : "image/jpeg");
      if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
        Alert.alert("صيغة الصورة غير مدعومة", "اختَر صورة JPG أو PNG أو WebP.");
        return;
      }
      setRequestPhoto({ ...asset, mimeType });
    } catch (error) {
      Alert.alert("تعذر اختيار الصورة", error instanceof Error ? error.message : "حاول مرة ثانية.");
    }
  }

  async function uploadRequestPhoto(requestId: string) {
    if (!requestPhoto || !user) return;
    const mimeType = requestPhoto.mimeType ?? "image/jpeg";
    const extension = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
    const response = await fetch(requestPhoto.uri);
    if (!response.ok) throw new Error("تعذر قراءة الصورة من الجهاز.");
    const fileBuffer = await response.arrayBuffer();
    if (fileBuffer.byteLength > 8 * 1024 * 1024) throw new Error("حجم الصورة أكبر من 8 ميغابايت.");
    const attachmentPath = requestId + "/" + user.id + "/" + Date.now() + "." + extension;
    const { error: uploadError } = await supabase.storage
      .from("request-attachments")
      .upload(attachmentPath, fileBuffer, { contentType: mimeType, cacheControl: "3600", upsert: false });
    if (uploadError) throw uploadError;
    const { data: linkedRequest, error: pathError } = await (supabase as any)
      .from("service_requests")
      .update({ attachment_path: attachmentPath })
      .eq("id", requestId)
      .eq("customer_id", user.id)
      .select("id")
      .maybeSingle();
    if (pathError || !linkedRequest) {
      await supabase.storage.from("request-attachments").remove([attachmentPath]);
      throw pathError ?? new Error("لم يتم ربط الصورة بالطلب.");
    }
  }

  async function choosePlaceSuggestion(item: { id: string; text: string; address?: string; coords?: { lat: number; lng: number }; governorateKey?: string }) {
    const selectionRequest = ++placeSelectionRef.current;
    try {
      setSearchingPlaces(true);
      let point = item.coords;
      let label = item.address || item.text;
      // Autocomplete predictions may contain only a place ID. Resolve exact coordinates
      // before moving the native map so every suggestion is genuinely selectable.
      if (!point) {
        const details = await callMamnoonMapsApi<{ coords: { lat: number; lng: number }; address?: string }>({
          action: "details",
          placeId: item.id,
        });
        point = details.coords;
        label = details.address || label;
      }
      if (selectionRequest !== placeSelectionRef.current) return;
      if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
        throw new Error("لم تتوفر إحداثيات دقيقة لهذا المكان.");
      }
      // Maps-proxy autocomplete already filters every returned point against
      // this governorate polygon; keep the extra check for older clients/sources.
      if (activeGovernorateKey && item.governorateKey !== activeGovernorateKey) {
        const validation = await callMamnoonMapsApi<{ valid: boolean }>({
          action: "validateGovernorate",
          center: { lat: point.lat, lng: point.lng },
          governorateKey: activeGovernorateKey,
        });
        if (selectionRequest !== placeSelectionRef.current) return;
        if (!validation.valid) {
          if (mapMode === "destination") {
            outsideGovernoratePromptShownRef.current = false;
            Alert.alert("أنت خارج محافظتك", "يرجى تحديد المحافظة المراد التوجه إليها.", [
              { text: "تحديد المحافظة", onPress: () => setGovernoratePickerVisible(true) },
              { text: "إلغاء", style: "cancel" },
            ]);
          } else {
            Alert.alert("موقع غير صحيح", `اختر مكاناً داخل ${activeGovernorate?.name ?? "المحافظة المحددة"}.`);
          }
          return;
        }
      }
      const coords = { latitude: point.lat, longitude: point.lng };
      setDestinationConfirmed(false);
      if (mapMode === "pickup") {
        setPickupCoords(coords);
        setPickup(label);
      } else {
        setDestinationCoords(coords);
        setDestination(label);
      }
      moveMap({ ...coords, latitudeDelta: 0.008, longitudeDelta: 0.008 });
      setPlaceQuery("");
      setPlaceSuggestions([]);

      // Nearby landmarks are fetched after the native pin has already moved.
      const nearbyRequest = ++nearbySelectionRef.current;
      const selectedGovernorate = item.governorateKey ?? activeGovernorateKey;
      if (selectedGovernorate) {
        void callMamnoonMapsApi<{ landmarks?: Array<{ name: string; distanceMeters: number }> }>({
          action: "nearby",
          center: { lat: point.lat, lng: point.lng },
          governorateKey: selectedGovernorate,
        }).then((result) => {
          if (nearbyRequest !== nearbySelectionRef.current) return;
          const labels = (result.landmarks ?? []).map((landmark) => {
            const distance = Number(landmark.distanceMeters);
            return `${landmark.name} (${distance >= 1000 ? `${(distance / 1000).toFixed(1)} كم` : `${Math.round(distance)} م`})`;
          });
          if (!labels.length) return;
          const detailedLabel = `${label} · قريب من ${labels.join("، ")}`;
          if (mapMode === "pickup") setPickup(detailedLabel);
          else setDestination(detailedLabel);
        }).catch(() => {});
      }
    } catch (error) {
      if (selectionRequest === placeSelectionRef.current) {
        Alert.alert("تعذر تحديد المكان", error instanceof Error ? error.message : "حاول اختيار اقتراح آخر.");
      }
    } finally {
      if (selectionRequest === placeSelectionRef.current) setSearchingPlaces(false);
    }
  }

  async function confirmPickupStep() {
    if (!pickupCoords) {
      Alert.alert("حدد موقع الانطلاق", "حرّك الخريطة إلى موقعك أو استخدم البحث عن مكان.");
      return;
    }
    try {
      const governorateKey = await resolveGovernorate(pickupCoords);
      setPickupGovernorateKey(governorateKey);
      if (isLargeVehicle) {
        setDestinationConfirmed(true);
        return;
      }
      setMapMode("destination");
      setDestinationConfirmed(false);
      setDestinationCoords(null);
      setDestination("");
      setDestinationGovernorateKey(governorateKey);
      outsideGovernoratePromptShownRef.current = false;
      setRouteKm(null);
      setRouteDurationMin(null);
      setRouteError(null);
    } catch (error) {
      Alert.alert("الموقع غير صالح", error instanceof Error ? error.message : "اختر موقعاً داخل العراق.");
    }
  }

  async function confirmDestinationStep() {
    if (!destinationCoords) {
      Alert.alert("حدد الوجهة", "حرّك الخريطة إلى مكان الوصول أو ابحث عن الوجهة.");
      return;
    }
    // The authoritative quote validates both points against Iraq's governorate
    // polygons and returns the resolved keys; don't repeat the network request.
    if (routeError) {
      Alert.alert("تعذّر تأكيد الطريق", routeError);
      return;
    }
    if (routeLoading || routeKm === null || !pickupGovernorateKey || !destinationGovernorateKey) {
      // Accept the tap immediately; the quote is already running in parallel.
      // Auto-advance as soon as the validated route and fare return.
      confirmDestinationPendingRef.current = true;
      return;
    }
    confirmDestinationPendingRef.current = false;
    setDestinationConfirmed(true);
  }

  async function submit(skipActiveRequestPrompt = false) {
    if (!user) {
      Alert.alert("تسجيل الدخول مطلوب", "سجّل الدخول قبل إرسال الطلب.");
      return;
    }
    if (!pickupCoords) {
      Alert.alert("حدد موقع الانطلاق", "اختر موقعك من الخريطة أو استخدم تحديد موقعي.");
      return;
    }
    if (isTaxi && isLargeVehicle && !destinationConfirmed) {
      Alert.alert("أكد موقع الانطلاق", "اضغط تأكيد الانطلاق قبل إرسال طلب السيارة الكبيرة.");
      return;
    }
    if (isTaxi && !isLargeVehicle && !destinationConfirmed) {
      Alert.alert("أكد الوجهة", "اضغط تأكيد الوجهة بعد اكتمال حساب المسافة والسعر.");
      return;
    }
    if (isTaxi && !isLargeVehicle && !destinationCoords) {
      Alert.alert("حدد الوجهة", "اختر الوجهة من الخريطة قبل طلب السيارة.");
      return;
    }
    if (isTaxi && !isLargeVehicle && (routeLoading || routeKm === null || routeError || !pickupGovernorateKey || !destinationGovernorateKey)) {
      Alert.alert("انتظر تأكيد الطريق", routeError || "نحسب مسافة الطريق ونحدد المحافظتين بدقة. جرّب الإرسال بعد ظهور السعر.");
      return;
    }
    if (!pickup.trim() || (isTaxi && !isLargeVehicle && !destination.trim())) {
      Alert.alert("بيانات ناقصة", "أكمل وصف الموقع والوجهة.");
      return;
    }

    const proposedUnitPrice = customerPrice.trim() ? Number(customerPrice.replace(/[^0-9]/g, "")) : null;
    const servicePriceMultiplier = extraWorkers + 1 + (workerLevel === "khabir" ? 1 : 0);
    const proposedPrice = proposedUnitPrice === null ? null : (isTaxi ? proposedUnitPrice : proposedUnitPrice * servicePriceMultiplier);
    if (isLargeVehicle && customerPrice.trim() && (proposedPrice === null || !Number.isSafeInteger(proposedPrice) || proposedPrice < 250 || proposedPrice > 50000 || proposedPrice % 250 !== 0)) {
      Alert.alert("السعر غير صحيح", "السعر المقترح يجب أن يكون من 250 إلى 50000 دينار ومن مضاعفات 250.");
      return;
    }
    if (!isTaxi && pricingMode !== "negotiable" && (proposedUnitPrice === null || !Number.isSafeInteger(proposedUnitPrice) || proposedUnitPrice < 250 || proposedUnitPrice % 250 !== 0)) {
      Alert.alert("الأجر غير صحيح", "اكتب أجراً صحيحاً لا يقل عن 250 ديناراً ويكون من مضاعفات 250.");
      return;
    }
    const hours = workHours.trim() ? Number(workHours) : null;
    if (!isTaxi && pricingMode === "hourly" && (hours === null || !Number.isFinite(hours) || hours <= 0 || hours > 24)) {
      Alert.alert("عدد الساعات غير صحيح", "أدخل عدد ساعات أكبر من صفر ولا يتجاوز 24 ساعة.");
      return;
    }

    setBusy(true);
    try {
      if (!skipActiveRequestPrompt) {
        const { data: previousRequest, error: previousRequestError } = await (supabase as any)
          .from("service_requests")
          .select("id,type,status,provider_arrived_at,vehicle_category,vehicle_type,service_id")
          .eq("customer_id", user.id)
          .in("status", ["pending", "searching", "accepted", "in_progress"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (previousRequestError) throw previousRequestError;
        if (previousRequest) {
          let serviceSlug: string | null = null;
          let serviceName: string | null = null;
          if (previousRequest.service_id) {
            const { data: serviceInfo } = await (supabase as any).from("services").select("slug,name_ar").eq("id", previousRequest.service_id).maybeSingle();
            serviceSlug = serviceInfo?.slug ?? null;
            serviceName = serviceInfo?.name_ar ?? null;
          }
          setActiveRequestPreview({ ...previousRequest, serviceSlug, serviceName });
          setActiveRequestChoice("keep");
          setActiveRequestPromptVisible(true);
          return;
        }
      }
      const effectivePickupGovernorateKey = pickupGovernorateKey || await resolveGovernorate(pickupCoords);
      await SecureStore.setItemAsync("mamnoon_governorate", effectivePickupGovernorateKey).catch(() => {});
      if (isTaxi && !isLargeVehicle && (routeKm === null || serverTaxiFare === null)) {
        throw new Error("لم يصل تسعير موثوق من الخادم. أعد المحاولة.");
      }
      if (isTaxi && !isLargeVehicle && couponCode.trim()) {
        const amount = getCouponBaseAmount();
        if (!amount || amount <= 0) throw new Error("حدد سعر الطلب أولاً حتى نطبق الكوبون");
        const { data: couponData, error: couponCheckError } = await supabase.rpc("preview_my_coupon", {
          p_code: couponCode.trim().toUpperCase(),
          p_amount: amount,
        });
        if (couponCheckError) throw couponCheckError;
        const couponRow = Array.isArray(couponData) ? couponData[0] : couponData;
        if (!couponRow) throw new Error("الكوبون غير متاح لهذا الطلب");
      }

      let requestId: string;
      if (isTaxi && isLargeVehicle) {
        const { data: largeRequest, error: largeError } = await supabase
          .from("service_requests")
          .insert({
            customer_id: user.id,
            coupon_code: null,
            type: "taxi",
            status: "pending",
            vehicle_category: "large",
            vehicle_type: vehicleType,
            governorate_key: effectivePickupGovernorateKey,
            pickup_text: pickup,
            pickup_lat: pickupCoords.latitude,
            pickup_lng: pickupCoords.longitude,
            dest_text: null,
            dest_lat: null,
            dest_lng: null,
            distance_km: null,
            price_estimate: null,
            customer_price: proposedPrice,
            pricing_mode: proposedPrice === null ? "negotiable" : "fixed",
            large_vehicle_urgency_enabled: urgencyEnabled,
            notes: [
              "نوع السيارة: " + (vehicleType === "kia_cargo" ? "كيا حمل" : vehicleType === "kia_passenger" ? "كيا ركاب" : "باص"),
              vehicleType === "kia_cargo" && cargoLoadDescription.trim() ? "تفاصيل الحمولة: " + cargoLoadDescription.trim() : "",
              notes.trim(),
            ].filter(Boolean).join(" | "),
          } as any)
          .select("id")
          .single();
        if (largeError || !largeRequest) throw largeError ?? new Error("تعذّر إنشاء طلب السيارة الكبيرة.");
        requestId = largeRequest.id;
        // The database trigger starts the nearby large-driver offer flow.
      } else if (isTaxi) {
        const { data: taxiRequest, error: taxiError } = await supabase.functions.invoke("auto-taxi-pricing", {
          body: {
            action: "create", couponCode: couponCode.trim().toUpperCase() || undefined,
            tripType, extraMinutes, isIntercity,
            from: { lat: pickupCoords.latitude, lng: pickupCoords.longitude },
            to: { lat: destinationCoords!.latitude, lng: destinationCoords!.longitude },
            pickupText: pickup, destinationText: destination,
            governorateKey: effectivePickupGovernorateKey,
            pickupGovernorateKey: effectivePickupGovernorateKey,
            destinationGovernorateKey: destinationGovernorateKey ?? effectivePickupGovernorateKey,
            vehicleCategory: vehicleCat, urgencyEnabled: false, notes,
          },
        });
        if (taxiError) throw taxiError;
        if (!taxiRequest?.requestId) throw new Error(taxiRequest?.error || "تعذّر إنشاء طلب التكسي.");
        requestId = taxiRequest.requestId;
      } else {
        const { data: serviceRow, error: serviceError } = await supabase
          .from("services")
          .select("id")
          .eq("slug", selectedService)
          .maybeSingle();
        if (serviceError) throw serviceError;
        if (!serviceRow?.id) throw new Error("الخدمة المختارة غير متاحة حالياً.");

        const { data: request, error } = await supabase
          .from("service_requests")
          .insert({
            customer_id: user.id,
            coupon_code: null,
            type: "service",
            status: "pending",
            governorate_key: effectivePickupGovernorateKey,
            service_id: serviceRow.id,
            pickup_text: pickup,
            pickup_lat: pickupCoords.latitude,
            pickup_lng: pickupCoords.longitude,
            dest_text: destination || null,
            dest_lat: destinationCoords?.latitude ?? null,
            dest_lng: destinationCoords?.longitude ?? null,
            level_required: workerLevel,
            workers_count: extraWorkers + 1,
            service_urgency_enabled: urgencyEnabled,
            pricing_mode: pricingMode,
            customer_price: pricingMode === "negotiable" ? null : proposedPrice,
            work_hours: pricingMode === "hourly" ? hours : null,
            work_description: [workDescription.trim(), selectedService === "build" && brickQuantity.trim() ? "كمية الطابوق: " + brickQuantity.trim() : ""].filter(Boolean).join("\n") || null,
            notes: notes || null,
          } as any)
          .select("id")
          .single();
        if (error || !request) throw error ?? new Error("تعذّر إنشاء طلب الخدمة.");
        requestId = request.id;
      }

      if (requestPhoto) {
        try {
          await uploadRequestPhoto(requestId);
        } catch (photoError) {
          console.warn("[request attachment] upload failed:", photoError);
          Alert.alert("تم إرسال الطلب بدون الصورة", photoError instanceof Error ? photoError.message : "تعذر إرفاق الصورة. تقدر تكمل الطلب بدونها.", [
            { text: "فتح الطلب", onPress: () => { setUrgencyEnabled(false); router.replace({ pathname: "/request/[id]", params: { id: requestId } }); } },
          ]);
          return;
        }
      }
      setUrgencyEnabled(false);
      router.replace({ pathname: "/request/[id]", params: { id: requestId } });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "حدث خطأ غير متوقع";
      Alert.alert("تعذر إرسال الطلب", message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmActiveRequestChoice() {
    if (!activeRequestPreview) return;
    setActiveRequestPromptVisible(false);
    if (activeRequestChoice === "cancel") {
      if (activeRequestPreview.provider_arrived_at || activeRequestPreview.status === "in_progress") {
        Alert.alert("لا يمكن الإلغاء", "وصل مقدم الخدمة أو بدأ التنفيذ، لذلك يبقى الطلب السابق فعالاً.");
        return;
      }
      setBusy(true);
      try {
        const { error } = await (supabase as any).rpc("cancel_service_request", {
          _request_id: activeRequestPreview.id,
          _reason: "ألغى الزبون الطلب لفتح طلب جديد",
        });
        if (error) throw error;
      } catch (error) {
        Alert.alert("تعذر إلغاء الطلب السابق", error instanceof Error ? error.message : "حاول مرة ثانية. لم يتم إرسال الطلب الجديد.");
        setBusy(false);
        return;
      }
      setActiveRequestPreview(null);
      await submit(true);
      return;
    }
    setActiveRequestPreview(null);
    await submit(true);
  }

  if (isTaxi) {
    return (
      <View style={styles.taxiScreen}>
        <ActiveRequestConfirmModal request={activeRequestPreview} visible={activeRequestPromptVisible} choice={activeRequestChoice} busy={busy} onChoice={setActiveRequestChoice} onConfirm={() => void confirmActiveRequestChoice()} onClose={() => setActiveRequestPromptVisible(false)} />
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFillObject}
          provider={PROVIDER_GOOGLE}
          initialRegion={region}
          mapPadding={{ top: 158, right: 0, bottom: taxiSheetHeight, left: 0 }}
          onPanDrag={() => { userPannedMapRef.current = true; }}
          onRegionChangeComplete={handleRegionChangeComplete}
          showsUserLocation
          showsMyLocationButton={false}
          loadingEnabled
        >
          {mapMode === "destination" && pickupCoords && (
            <Marker
              coordinate={pickupCoords}
              title="نقطة الانطلاق"
              pinColor="#0284c7"
            />
          )}
          {mapMode === "pickup" && nearbyDrivers.map((driver) => (
            <Marker
              key={driver.pin_id}
              coordinate={{ latitude: driver.lat, longitude: driver.lng }}
              title="سيارة قريبة"
              anchor={{ x: 0.5, y: 0.5 }}
              flat
              rotation={Number.isFinite(driver.heading) ? Number(driver.heading) : 0}
            >
              <View style={styles.taxiNearbyMarker}><Text style={styles.taxiNearbyMarkerText}>🚕</Text></View>
            </Marker>
          ))}
        </MapView>
        {(
          <TouchableOpacity
            style={[styles.taxiLocateFloating, { bottom: taxiSheetHeight + 10 }]}
            onPress={locateMe}
            disabled={locationLoading}
            accessibilityRole="button"
            accessibilityLabel="تحديد موقعي الحالي"
          >
            {locationLoading ? (
              <ActivityIndicator color={palette.brand} size="small" />
            ) : (
              <Svg width={19} height={19} viewBox="0 0 24 24">
                <Path d="M12 2v3m0 14v3M2 12h3m14 0h3" stroke={palette.brand} strokeWidth={2.2} strokeLinecap="round" />
                <Circle cx={12} cy={12} r={6.5} stroke={palette.brand} strokeWidth={2.2} fill="none" />
                <Circle cx={12} cy={12} r={2} fill={palette.gold} />
              </Svg>
            )}
            <Text style={styles.taxiLocateFloatingText}>موقعي</Text>
          </TouchableOpacity>
        )}
        <View pointerEvents="none" style={[styles.taxiCenterPin, { top: 92 + Math.max(0, window.height - 92 - taxiSheetHeight) / 2 - 36 }]}>
          <MapCenterPin />
        </View>

        <View style={styles.taxiTopBar}>
          <View style={styles.taxiTopControls}>
          <TouchableOpacity
            style={styles.taxiBackButton}
            onPress={() => {
              if (mapMode === "destination") {
                setMapMode("pickup");
                setDestinationConfirmed(false);
              } else {
                router.back();
              }
            }}
            accessibilityRole="button"
            accessibilityLabel="رجوع"
          >
            <View style={styles.taxiArrowMedallion}>
              <Svg width={22} height={22} viewBox="0 0 24 24">
                <Path d="M15 5 8 12l7 7" stroke={palette.brand} strokeWidth={2.7} strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </Svg>
            </View>
          </TouchableOpacity>
          <TouchableOpacity style={styles.taxiGovernorateBadge} onPress={() => setGovernoratePickerVisible(true)}>
            <Text style={styles.taxiGovernorateText}>📍 {activeGovernorate?.name ?? "اختر المحافظة"}</Text>
          </TouchableOpacity>
          <View style={styles.taxiStepTabs}>
            <TouchableOpacity
              style={[styles.taxiStepTab, mapMode === "pickup" && styles.taxiStepTabPickup]}
              onPress={() => { setMapMode("pickup"); setDestinationConfirmed(false); }}
            >
              <Text style={[styles.taxiStepText, mapMode === "pickup" && styles.taxiStepTextActive]}>١. الانطلاق {pickupCoords ? "✓" : ""}</Text>
            </TouchableOpacity>
            {!isLargeVehicle && (
              <TouchableOpacity
                style={[styles.taxiStepTab, mapMode === "destination" && styles.taxiStepTabDestination]}
                onPress={() => {
                  if (!pickupCoords) {
                    Alert.alert("حدد الانطلاق أولاً", "اختَر موقع الانطلاق قبل تحديد الوجهة.");
                    return;
                  }
                  setMapMode("destination");
                  setDestinationConfirmed(false);
                }}
              >
                <Text style={[styles.taxiStepText, mapMode === "destination" && styles.taxiStepTextActive]}>٢. الوجهة {destinationCoords ? "✓" : ""}</Text>
              </TouchableOpacity>
            )}
          </View>
          </View>
          <View style={styles.taxiSearchRow}>
            <TextInput style={styles.taxiSearchInput} value={placeQuery} onChangeText={(value) => { placeSelectionRef.current += 1; setPlaceQuery(value); }} placeholder={activeGovernorate ? "ابحث داخل " + activeGovernorate.name + "..." : "اختر المحافظة أولاً"} placeholderTextColor={palette.muted} editable={!!activeGovernorateKey} returnKeyType="search" />
          </View>
          {searchingPlaces && <ActivityIndicator style={{ marginTop: 6 }} color={palette.brand} />}
          {!!placeSearchError && <Text style={styles.taxiErrorText}>{placeSearchError}</Text>}
          {placeSuggestions.length > 0 && (
            <View style={styles.taxiSuggestionList}>
              <ScrollView nestedScrollEnabled style={{ maxHeight: 250 }}>
                {placeSuggestions.map((item) => (
                  <TouchableOpacity key={item.id} style={styles.taxiSuggestionItem} onPress={() => choosePlaceSuggestion(item)}>
                    <Text style={styles.taxiSuggestionTitle}>{item.text}</Text>
                    {!!item.address && item.address !== item.text && <Text style={styles.taxiSuggestionAddress}>{item.address}</Text>}
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <Text style={styles.taxiHintText}>بيانات الأماكن © OpenStreetMap · {placeSuggestions.length} اقتراح داخل {activeGovernorate?.name}</Text>
            </View>
          )}
        </View>

        <View style={styles.taxiBottomSheet} onLayout={(event) => setTaxiSheetHeight(event.nativeEvent.layout.height)}>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.taxiSheetContent}>
            {!destinationConfirmed ? (
              <>
                <Text style={styles.taxiSheetTitle}>{mapMode === "pickup" ? "حدد موقع الانطلاق" : "حدد وجهة الوصول"}</Text>
                <Text style={styles.taxiSelectedAddress} numberOfLines={2}>
                  {mapMode === "pickup"
                    ? pickup || "حرّك الخريطة حتى تصبح نقطة الانطلاق تحت الدبوس"
                    : destination || "حرّك الخريطة حتى تصبح وجهتك تحت الدبوس"}
                </Text>
                {mapMode === "destination" && (
                  <View style={{ gap: 9, marginTop: 4 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <Text style={{ color: palette.ink, fontSize: 12, fontWeight: "900" }}>أماكني المفضلة</Text>
                      {favoritePlacesLoading && <ActivityIndicator size="small" color={palette.brand} />}
                    </View>
                    {favoritePlaces.length > 0 ? (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                        {favoritePlaces.map((place) => (
                          <View key={place.id} style={{ flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: palette.gold, backgroundColor: palette.surfaceSoft, borderRadius: 13, overflow: "hidden" }}>
                            <TouchableOpacity onPress={() => chooseFavoritePlace(place)} style={{ paddingHorizontal: 12, paddingVertical: 9 }}>
                              <Text style={{ color: palette.ink, fontSize: 12, fontWeight: "900" }}>📍 {place.label}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => deleteFavoritePlace(place.id)} style={{ paddingHorizontal: 9, paddingVertical: 9 }}>
                              <Text style={{ color: "#DC2626", fontWeight: "900" }}>×</Text>
                            </TouchableOpacity>
                          </View>
                        ))}
                      </ScrollView>
                    ) : <Text style={{ color: palette.muted, fontSize: 11, textAlign: "right" }}>احفظ بيتك أو عملك حتى تختاره بضغطة واحدة.</Text>}
                    {destinationCoords && !showFavoriteNameInput && (
                      <TouchableOpacity onPress={() => setShowFavoriteNameInput(true)} style={{ borderWidth: 1, borderStyle: "dashed", borderColor: palette.gold, borderRadius: 12, paddingVertical: 10, alignItems: "center" }}>
                        <Text style={{ color: palette.brand, fontSize: 12, fontWeight: "900" }}>＋ حفظ هذه الوجهة بالمفضلة</Text>
                      </TouchableOpacity>
                    )}
                    {showFavoriteNameInput && (
                      <View style={{ flexDirection: "row", gap: 7 }}>
                        <TextInput value={favoriteName} onChangeText={setFavoriteName} maxLength={60} placeholder="مثلاً: البيت أو العمل" placeholderTextColor={palette.muted} style={{ flex: 1, minWidth: 0, borderWidth: 1, borderColor: palette.line, borderRadius: 11, paddingHorizontal: 10, paddingVertical: 8, color: palette.ink, textAlign: "right" }} />
                        <TouchableOpacity onPress={saveFavoritePlace} style={{ backgroundColor: palette.brand, borderRadius: 11, paddingHorizontal: 13, justifyContent: "center" }}><Text style={{ color: palette.white, fontWeight: "900", fontSize: 12 }}>حفظ</Text></TouchableOpacity>
                        <TouchableOpacity onPress={() => { setShowFavoriteNameInput(false); setFavoriteName(""); }} style={{ borderWidth: 1, borderColor: palette.line, borderRadius: 11, paddingHorizontal: 10, justifyContent: "center" }}><Text style={{ color: palette.ink, fontWeight: "800", fontSize: 12 }}>إلغاء</Text></TouchableOpacity>
                      </View>
                    )}
                  </View>
                )}


                {isLargeVehicle && mapMode === "pickup" && (
                  <View style={styles.taxiLargeTypePanel}>
                    <Text style={styles.taxiFieldLabel}>اختر نوع السيارة الكبيرة</Text>
                    <View style={styles.taxiLargeTypeRow}>
                      {([
                        { key: "kia_cargo", label: "كيا حمل", image: "https://cdn.iqcars.io/img/CarAttachmentsDetail/1771867416862.09778.jpg" },
                        { key: "kia_passenger", label: "كيا ركاب", image: "https://cdn.iqcars.io/img/CarAttachmentsDetail/1771246088220.14922.jpg" },
                        { key: "bus", label: "باص", image: "https://xcode.shamayah.co.ke/assets/login-bus-CChLKdVW.png" },
                      ] as const).map((item) => (
                        <TouchableOpacity key={item.key} style={[styles.taxiLargeTypeCard, vehicleType === item.key && styles.taxiLargeTypeCardActive]} onPress={() => setVehicleType(item.key)}>
                          {"image" in item ? (uiVisuals[item.key === "kia_cargo" ? "vehicle_kia_cargo" : item.key === "kia_passenger" ? "vehicle_kia_passenger" : "vehicle_bus"]?.icon_name ? <Text style={styles.taxiLargeBus}>{uiVisuals[item.key === "kia_cargo" ? "vehicle_kia_cargo" : item.key === "kia_passenger" ? "vehicle_kia_passenger" : "vehicle_bus"].icon_name}</Text> : <Image source={{ uri: uiVisuals[item.key === "kia_cargo" ? "vehicle_kia_cargo" : item.key === "kia_passenger" ? "vehicle_kia_passenger" : "vehicle_bus"]?.image_url || item.image }} style={[styles.taxiLargeTypeImage, { width: Number(uiVisuals[item.key === "kia_cargo" ? "vehicle_kia_cargo" : item.key === "kia_passenger" ? "vehicle_kia_passenger" : "vehicle_bus"]?.width_px) || 76, height: Number(uiVisuals[item.key === "kia_cargo" ? "vehicle_kia_cargo" : item.key === "kia_passenger" ? "vehicle_kia_passenger" : "vehicle_bus"]?.height_px) || 56 }]} resizeMode="contain" />) : <Text style={styles.taxiLargeBus}>🚌</Text>}
                          <Text style={[styles.taxiLargeTypeText, vehicleType === item.key && styles.taxiLargeTypeTextActive]}>{uiVisuals[item.key === "kia_cargo" ? "vehicle_kia_cargo" : item.key === "kia_passenger" ? "vehicle_kia_passenger" : "vehicle_bus"]?.title || item.label}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                )}

                {mapMode === "destination" && routeLoading && (
                  <Text style={styles.taxiHintText}>جارٍ حساب مسافة الطريق وتأكيد المحافظة...</Text>
                )}
                {mapMode === "destination" && !!routeError && (
                  <View style={styles.taxiErrorPanel}>
                    <Text style={styles.taxiErrorText}>{routeError}</Text>
                    <TouchableOpacity style={styles.taxiRetryButton} onPress={() => setRouteRetry((value) => value + 1)}>
                      <Text style={styles.taxiRetryText}>إعادة حساب الطريق</Text>
                    </TouchableOpacity>
                  </View>
                )}
                <TouchableOpacity
                  style={[styles.taxiPrimaryButton, (mapMode === "pickup" ? !pickupCoords : !destinationCoords || !!routeError || confirmDestinationPendingRef.current) && styles.taxiButtonDisabled]}
                  disabled={mapMode === "pickup" ? !pickupCoords : !destinationCoords || !!routeError || confirmDestinationPendingRef.current}
                  onPress={mapMode === "pickup" ? confirmPickupStep : confirmDestinationStep}
                >
                  <Text style={styles.taxiPrimaryButtonText}>
                    {mapMode === "pickup" ? "تأكيد الانطلاق" : confirmDestinationPendingRef.current ? "جارٍ تأكيد الوجهة..." : "تأكيد الوجهة"}
                  </Text>
                  <View style={styles.taxiPrimaryArrow}>
                    <Svg width={18} height={18} viewBox="0 0 24 24">
                      <Path d="M19 12H5m7-7-7 7 7 7" stroke={palette.white} strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                    </Svg>
                  </View>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <View style={styles.taxiDetailsHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.taxiSheetTitle}>{isLargeVehicle ? "طلب سيارة كبيرة" : "اختَر السيارة المناسبة"}</Text>
                    <Text style={styles.taxiSelectedAddress} numberOfLines={2}>
                      {pickup || "موقع الانطلاق"}{!isLargeVehicle ? " ← " + (destination || "الوجهة") : ""}
                    </Text>
                  </View>
                  <TouchableOpacity style={styles.taxiEditButton} onPress={() => { setDestinationConfirmed(false); setMapMode(isLargeVehicle ? "pickup" : "destination"); }}>
                    <Text style={styles.taxiEditButtonText}>تعديل</Text>
                  </TouchableOpacity>
                </View>

                {routeLoading && !isLargeVehicle && <Text style={styles.taxiHintText}>جارٍ حساب مسافة الطريق الفعلية...</Text>}
                {!!routeError && (
                  <View style={styles.taxiErrorPanel}>
                    <Text style={styles.taxiErrorText}>{routeError}</Text>
                    <TouchableOpacity style={styles.taxiRetryButton} onPress={() => setRouteRetry((value) => value + 1)}>
                      <Text style={styles.taxiRetryText}>إعادة حساب الطريق</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {!isLargeVehicle && (
                  <>
                    <View style={styles.taxiRouteSummary}>
                      <View style={styles.taxiRouteMetric}>
                        <Text style={styles.taxiRouteMetricLabel}>مسافة الطريق</Text>
                        <Text style={styles.taxiRouteMetricValue}>{routeKm !== null ? routeKm.toFixed(2) + " كم" : "—"}</Text>
                      </View>
                      <View style={styles.taxiRouteMetric}>
                        <Text style={styles.taxiRouteMetricLabel}>الوقت التقريبي</Text>
                        <Text style={styles.taxiRouteMetricValue}>{routeDurationMin !== null ? Math.max(1, Math.round(routeDurationMin)) + " دقيقة" : "—"}</Text>
                      </View>
                    </View>
                    <Text style={styles.taxiFieldLabel}>فئة السيارة</Text>
                    <View style={styles.taxiVehicleList}>
                      {VEHICLE_CATS.filter((category) => category.key !== "large").sort((a, b) => Number(uiVisuals[`vehicle_${a.key}`]?.sort_order ?? 0) - Number(uiVisuals[`vehicle_${b.key}`]?.sort_order ?? 0)).map((category) => {
                        const active = vehicleCat === category.key;
                        const fare = routeKm !== null ? (serverTaxiFares[category.key as Exclude<VehicleCategory, "large">] ?? (active ? serverTaxiFare : null)) : null;
                        return (
                          <TouchableOpacity key={category.key} style={[styles.taxiVehicleCard, active && styles.taxiVehicleCardActive]} onPress={() => setVehicleCat(category.key as Exclude<VehicleCategory, "large">)}>
                            {uiVisuals[`vehicle_${category.key}`]?.icon_name ? <Text style={styles.taxiVehicleEmoji}>{uiVisuals[`vehicle_${category.key}`].icon_name}</Text> : uiVisuals[`vehicle_${category.key}`]?.image_url ? <Image source={{ uri: uiVisuals[`vehicle_${category.key}`].image_url }} style={{ width: Number(uiVisuals[`vehicle_${category.key}`].width_px) || 64, height: Number(uiVisuals[`vehicle_${category.key}`].height_px) || 48 }} resizeMode="contain" /> : <Text style={styles.taxiVehicleEmoji}>{category.emoji}</Text>}
                            <Text style={styles.taxiVehicleName}>{uiVisuals[`vehicle_${category.key}`]?.title || category.label}</Text>
                            <Text style={styles.taxiVehicleFare}>{fare !== null ? fare.toLocaleString("ar-IQ") + " د.ع" : "—"}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </>
                )}

                {isLargeVehicle && (
                  <View style={styles.taxiLargeTypePanel}>
                    <Text style={styles.taxiFieldLabel}>السعر المقترح (اختياري)</Text>
                    <View style={styles.taxiBudgetRow}>
                      {[15000, 20000, 25000, 30000, 35000, 40000, 45000, 50000].map((amount) => (
                        <TouchableOpacity key={amount} style={[styles.taxiBudgetChip, customerPrice === String(amount) && styles.taxiBudgetChipActive]} onPress={() => setCustomerPrice(String(amount))}>
                          <Text style={[styles.taxiBudgetText, customerPrice === String(amount) && styles.taxiBudgetTextActive]}>{(amount / 1000).toLocaleString("en") + " ألف"}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <TextInput style={styles.taxiSearchInputFull} value={customerPrice} onChangeText={(value) => setCustomerPrice(value.replace(/[^0-9]/g, ""))} placeholder="أو اكتب أي سعر بالدينار" placeholderTextColor={palette.muted} keyboardType="numeric" />
                    <Text style={styles.taxiHintText}>ماكو تسعير بالكيلومتر؛ أصحاب السيارات يرسلون عروضهم وتختار الأنسب.</Text>
                    <TouchableOpacity onPress={() => setUrgencyEnabled((value) => !value)} style={{ marginTop: 10, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: urgencyEnabled ? palette.brand : palette.line, backgroundColor: urgencyEnabled ? palette.brandSoft : palette.surface, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: palette.ink, fontWeight: "900", textAlign: "right" }}>⚡ وضع الاستعجال</Text>
                        <Text style={{ color: palette.muted, fontSize: 10, textAlign: "right", marginTop: 3 }}>يظهر للمزودين ضمن نتائج البحث عن السيارة</Text>
                      </View>
                      <Text style={{ color: urgencyEnabled ? palette.brand : palette.muted, fontWeight: "900" }}>{urgencyEnabled ? "مفعّل" : "متوقف"}</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {!isLargeVehicle && (
                  <View style={styles.taxiOptionsPanel}>
                    <TouchableOpacity style={styles.taxiOptionsHeader} onPress={() => setTripOptionsExpanded((value) => !value)}>
                      <Text style={styles.taxiOptionsTitle}>خيارات الرحلة الاختيارية</Text>
                      <Text style={styles.taxiOptionsToggle}>{tripOptionsExpanded ? "إخفاء ▲" : "إظهار ▼"}</Text>
                    </TouchableOpacity>
                    {tripOptionsExpanded && (
                      <>
                        <Text style={styles.taxiHintText}>الاختيار الافتراضي ذهاب فقط. فعّل خياراً إضافياً عند الحاجة.</Text>
                        <View style={styles.taxiTripTypeGrid}>
                          {([
                            { key: "one_way", label: "ذهاب فقط" },
                            { key: "round_trip", label: "ذهاب وإياب" },
                            { key: "second_trip", label: "رحلة ثانية" },
                            { key: "stop", label: "توقف بالطريق" },
                          ] as const).map((item) => (
                            <TouchableOpacity key={item.key} style={[styles.taxiTripTypeChip, tripType === item.key && styles.taxiTripTypeChipActive]} onPress={() => { setTripType(item.key); if (item.key !== "stop") setExtraMinutes(0); }}>
                              <Text style={[styles.taxiTripTypeText, tripType === item.key && styles.taxiTripTypeTextActive]}>{item.label}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                        {tripType === "round_trip" && <Text style={styles.taxiSuccessText}>تم تطبيق خصم 10٪ على أجرة الذهاب والإياب.</Text>}
                        {tripType === "stop" && (
                          <>
                            <View style={styles.taxiOptionsHeader}>
                              <Text style={styles.taxiOptionsTitle}>مدة التوقف</Text>
                              <Text style={styles.taxiOptionsToggle}>{extraMinutes} دقيقة · {(Math.ceil(extraMinutes / 5) * 500).toLocaleString("ar-IQ")} د.ع</Text>
                            </View>
                            <Text style={styles.taxiHintText}>كل 5 دقائق بـ500 دينار، والحد الأعلى ساعتان.</Text>
                            <View style={styles.extraTimeSliderTouch} onLayout={(event) => { extraTimeTrackWidthRef.current = event.nativeEvent.layout.width; }} {...extraTimePanResponder.panHandlers}>
                              <View style={styles.extraTimeSliderTrack}>
                                <View style={[styles.extraTimeSliderFill, { width: (String((extraMinutes / 120) * 100) + "%") as any }]} />
                                <View style={[styles.extraTimeSliderThumb, { right: (String((extraMinutes / 120) * 100) + "%") as any }]} />
                              </View>
                            </View>
                            <View style={styles.extraTimeScale}>
                              <Text style={styles.taxiHintText}>بدون توقف</Text>
                              <Text style={styles.taxiHintText}>30 دقيقة</Text>
                              <Text style={styles.taxiHintText}>ساعة</Text>
                              <Text style={styles.taxiHintText}>ساعتان</Text>
                            </View>
                          </>
                        )}
                      </>
                    )}
                  </View>
                )}

                {!isLargeVehicle && (
                  <View style={styles.taxiCouponPanel}>
                    <Text style={styles.taxiFieldLabel}>🎁 عندك كوبون خصم؟</Text>
                    <View style={styles.taxiSearchRow}>
                      <TextInput style={[styles.taxiSearchInput, { flex: 1 }]} value={couponCode} onChangeText={(value) => { setCouponCode(value.toUpperCase()); setCouponPreview(null); setCouponError(""); }} placeholder="اكتب رمز الكوبون" placeholderTextColor={palette.muted} autoCapitalize="characters" />
                      <TouchableOpacity style={styles.taxiCouponButton} onPress={previewCoupon} disabled={couponLoading}>
                        {couponLoading ? <ActivityIndicator color={palette.white} /> : <Text style={styles.taxiCouponButtonText}>تحقق</Text>}
                      </TouchableOpacity>
                    </View>
                    {!!couponError && <Text style={styles.taxiErrorText}>{couponError}</Text>}
                    {couponPreview && (
                      <View style={styles.taxiCouponResult}>
                        <Text style={styles.taxiSuccessText}>تم التحقق من الكوبون</Text>
                        <Text style={styles.taxiCouponText}>قيمة الخصم: {couponPreview.discount.toLocaleString("ar-IQ")} د.ع</Text>
                        <Text style={styles.taxiCouponText}>المبلغ بعد الخصم: {couponPreview.payable.toLocaleString("ar-IQ")} د.ع</Text>
                        <Text style={styles.taxiHintText}>الخصم تتحمله ممنون ولا يقلل مستحقات السائق.</Text>
                      </View>
                    )}
                  </View>
                )}

                {isLargeVehicle && vehicleType === "kia_cargo" && (
                  <View style={styles.taxiLargeTypePanel}>
                    <Text style={styles.taxiFieldLabel}>كمية الحمولة أو وصفها (اختياري)</Text>
                    <TextInput style={styles.taxiSearchInputFull} value={cargoLoadDescription} onChangeText={(value) => setCargoLoadDescription(value.slice(0, 300))} placeholder="مثلاً: 500 طابوقة أو حمولة نصف طن" placeholderTextColor={palette.muted} />
                  </View>
                )}

                {isLargeVehicle && (
                  <View style={styles.taxiPhotoPanel}>
                    <Text style={styles.taxiFieldLabel}>صورة توضيحية للطلب (اختياري)</Text>
                    <TouchableOpacity style={styles.taxiPhotoButton} onPress={chooseRequestPhoto}>
                      <Text style={styles.taxiPhotoButtonText}>{requestPhoto ? "تغيير الصورة" : "اختيار صورة من الجهاز"}</Text>
                    </TouchableOpacity>
                    {requestPhoto && (
                      <View style={{ alignItems: "center", marginTop: 8 }}>
                        <Image source={{ uri: requestPhoto.uri }} style={styles.requestPhotoPreview} />
                        <TouchableOpacity onPress={() => setRequestPhoto(null)}><Text style={{ color: palette.danger, fontWeight: "900", marginTop: 6 }}>حذف الصورة</Text></TouchableOpacity>
                      </View>
                    )}
                  </View>
                )}

                <TextInput
                  style={styles.taxiNotesInput}
                  value={notes}
                  onChangeText={setNotes}
                  placeholder={isLargeVehicle ? "ملاحظات إضافية — اكتب الوجهة أو تفاصيل الحمولة" : "ملاحظات إضافية (اختياري)"}
                  placeholderTextColor={palette.muted}
                  multiline
                />
                <TouchableOpacity
                  style={[styles.taxiPrimaryButton, (busy || (!isLargeVehicle && (routeKm === null || routeLoading || !!routeError))) && styles.taxiButtonDisabled]}
                  disabled={busy || (!isLargeVehicle && (routeKm === null || routeLoading || !!routeError))}
                  onPress={() => void submit()}
                >
                  {busy ? <ActivityIndicator color={palette.white} /> : <Text style={styles.taxiPrimaryButtonText}>{isLargeVehicle ? "إرسال الطلب" : "اطلب الآن"}</Text>}
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </View>
        <GovernoratePickerModal visible={governoratePickerVisible} selectedKey={activeGovernorateKey} onClose={() => setGovernoratePickerVisible(false)} onSelect={(key) => { chooseGovernorate(key); setGovernoratePickerVisible(false); }} />
      </View>
    );
  }

  if (type === "service" && !serviceDetailsStep) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
        <TouchableOpacity onPress={() => router.back()} style={{ marginBottom: 12 }}>
          <Text style={{ color: palette.brand, fontSize: 13, fontWeight: "900", textAlign: "right" }}>رجوع</Text>
        </TouchableOpacity>
        <Text style={styles.title}>الفنيون والخدمات</Text>
        <Text style={{ color: palette.muted, fontSize: 12, textAlign: "right", marginBottom: 16 }}>اختَر اختصاص الفني حتى نعرض لك تفاصيل الطلب بالخطوة التالية.</Text>
        {servicesLoading && <ActivityIndicator color={palette.brand} style={{ marginVertical: 16 }} />}
        {!!servicesError && <Text style={{ color: palette.danger, textAlign: "right" }}>{servicesError}</Text>}
        <View style={styles.serviceGrid}>
          {serviceCatalog.filter((service) => service.slug !== "taxi").map((service) => (
            <TouchableOpacity key={service.slug} style={styles.serviceTile} onPress={() => { setSelectedService(service.slug); if (!EXPERT_ONLY_SERVICE_SLUGS.has(service.slug)) setWorkerLevel("fani"); setServiceDetailsStep(true); }}>
              {hasServiceArtwork(service.slug) ? <ServiceArtwork slug={service.slug} /> : <Image source={getServiceImage(service.slug)} style={styles.serviceImage} resizeMode="cover" />}
              <Text style={styles.serviceLabel}>{service.name_ar}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
    >
      <ActiveRequestConfirmModal request={activeRequestPreview} visible={activeRequestPromptVisible} choice={activeRequestChoice} busy={busy} onChoice={setActiveRequestChoice} onConfirm={() => void confirmActiveRequestChoice()} onClose={() => setActiveRequestPromptVisible(false)} />
      <Text style={styles.title}>{vehicle === "large" ? "طلب سيارة كبيرة" : "تفاصيل طلب الفني"}</Text>
      {!isTaxi && serviceDetailsStep && <TouchableOpacity onPress={() => setServiceDetailsStep(false)} style={{ marginBottom: 12 }}><Text style={{ color: palette.brand, textAlign: "right", fontWeight: "900" }}>← قائمة الفنيين</Text></TouchableOpacity>}
      {isLargeVehicle && (
        <View style={{ marginBottom: 8, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: palette.gold, backgroundColor: palette.goldSoft }}>
          <Text style={styles.label}>اختار نوع الكيا أولاً</Text>
          <View style={styles.catRow}>
            {([{ key: "kia_cargo", label: "كيا حمل", image: "https://cdn.iqcars.io/img/CarAttachmentsDetail/1771867416862.09778.jpg" }, { key: "kia_passenger", label: "كيا ركاب", image: "https://cdn.iqcars.io/img/CarAttachmentsDetail/1771246088220.14922.jpg" }, { key: "bus", label: "باص" }] as const).map((item) => (
              <TouchableOpacity key={item.key} style={[styles.catChip, { flexDirection: "column", paddingVertical: 8, minHeight: 112 }, vehicleType === item.key && styles.catChipActive]} onPress={() => setVehicleType(item.key)}>
                { "image" in item ? <Image source={{ uri: item.image }} style={{ width: 118, height: 68 }} resizeMode="contain" /> : <Text style={{ fontSize: 42 }}>🚌</Text> }
                <Text style={[styles.catLabel, vehicleType === item.key && styles.catLabelActive]}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}
      {vehicle !== "large" && !serviceDetailsStep && (
        <>
          <Text style={styles.label}>نوع الخدمة</Text>
          {servicesLoading && <ActivityIndicator style={{ marginVertical: 12 }} color={palette.brand} />}
          {!!servicesError && <TouchableOpacity onPress={() => router.replace("/request/new" as never)}><Text style={{ color: palette.danger, marginBottom: 10 }}>{servicesError} اضغط لإعادة المحاولة.</Text></TouchableOpacity>}
          <View style={styles.serviceGrid}>
            {serviceCatalog.map((service) => ({ ...service, label: service.name_ar, emoji: "", color: "#0f766e" })).map((service) => (
              <TouchableOpacity
                key={service.slug}
                style={[
                  styles.serviceTile,
                  selectedService === service.slug && {
                    backgroundColor: service.color + "20",
                    borderColor: service.color,
                  },
                ]}
                onPress={() => {
                  setSelectedService(service.slug);
                  if (!EXPERT_ONLY_SERVICE_SLUGS.has(service.slug)) setWorkerLevel("fani");
                }}
              >
                {service.slug === "taxi" ? <Text style={styles.serviceEmoji}>{service.emoji}</Text> : hasServiceArtwork(service.slug) ? <ServiceArtwork slug={service.slug} /> : <Image source={getServiceImage(service.slug)} style={styles.serviceImage} resizeMode="contain" />}
                <Text
                  style={[
                    styles.serviceLabel,
                    { color: selectedService === service.slug ? service.color : "#64748b" },
                  ]}
                >
                  {service.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      <Text style={styles.label}>حدد النقطة على الخريطة</Text>
      <View style={styles.mapModeRow}>
        <TouchableOpacity
          style={[styles.mapModeButton, mapMode === "pickup" && styles.mapModeButtonActive]}
          onPress={() => { setMapMode("pickup"); setPlaceQuery(""); setPlaceSuggestions([]); }}
        >
          <Text style={[styles.mapModeText, mapMode === "pickup" && styles.mapModeTextActive]}>
            نقطة الانطلاق
          </Text>
        </TouchableOpacity>
        {isTaxi && !isLargeVehicle && (
          <TouchableOpacity
            style={[styles.mapModeButton, mapMode === "destination" && styles.mapModeButtonActive]}
            onPress={() => { setMapMode("destination"); setPlaceQuery(""); setPlaceSuggestions([]); }}
          >
            <Text
              style={[styles.mapModeText, mapMode === "destination" && styles.mapModeTextActive]}
            >
              الوجهة
            </Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.locateButton} onPress={locateMe} disabled={locationLoading}>
          {locationLoading ? (
            <ActivityIndicator color={palette.white} size="small" />
          ) : (
            <Text style={styles.locateButtonText}>تحديد موقعي تلقائياً</Text>
          )}
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.governoratePickerButton} onPress={() => setGovernoratePickerVisible(true)}>
        <Text style={styles.governoratePickerLabel}>اختر محافظة</Text>
        <Text style={styles.governoratePickerValue}>{activeGovernorate?.name ?? "اضغط لاختيار المحافظة"} ⌄</Text>
      </TouchableOpacity>
      <TextInput
        ref={placeSearchInputRef}
        style={[styles.input, styles.placeSearchTop]}
        value={placeQuery}
        onChangeText={setPlaceQuery}
        placeholder={activeGovernorate ? `ابحث عن مكان داخل ${activeGovernorate.name}...` : "اختر المحافظة أولاً"}
        placeholderTextColor={palette.muted}
        editable={!!activeGovernorateKey}
        returnKeyType="search"
      />
      {searchingPlaces && <ActivityIndicator style={{ marginTop: 8 }} color={palette.brand} />}
      {!!placeSearchError && <Text style={styles.mapErrorText}>{placeSearchError}</Text>}
      {placeSuggestions.length > 0 && (
        <View style={styles.suggestionList}>
          {placeSuggestions.map((item) => (
            <TouchableOpacity key={item.id} style={styles.suggestionItem} onPress={() => choosePlaceSuggestion(item)}>
              <Text style={styles.suggestionTitle}>{item.text}</Text>
              {!!item.address && item.address !== item.text && <Text style={styles.suggestionAddress}>{item.address}</Text>}
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View style={styles.mapContainer}>
        <MapView
          ref={mapRef}
          style={styles.map}
          provider={PROVIDER_GOOGLE}
          initialRegion={region}
          onPanDrag={() => { userPannedMapRef.current = true; }}
          onRegionChangeComplete={handleRegionChangeComplete}
          showsUserLocation
          showsMyLocationButton={false}
          loadingEnabled
        >

        </MapView>
        <View pointerEvents="none" style={styles.mapCenterPin}><MapCenterPin /></View>
        <Text style={styles.mapHint}>
          {mapMode === "pickup"
            ? "حرّك الخريطة حتى تصبح النقطة تحت الدبوس"
            : "حرّك الخريطة حتى تصبح الوجهة تحت الدبوس"}
        </Text>
      </View>

      <Text style={styles.label}>وصف نقطة الانطلاق</Text>
      <TextInput
        style={styles.input}
        value={pickup}
        onChangeText={setPickup}
        placeholder="موقعك الحالي أو وصف المكان"
        placeholderTextColor="#94a3b8"
      />
      {isTaxi && !isLargeVehicle && (
        <>
          <Text style={styles.label}>وصف الوجهة</Text>
          <TextInput
            style={styles.input}
            value={destination}
            onChangeText={setDestination}
            placeholder="إلى أين؟"
            placeholderTextColor="#94a3b8"
          />
        </>
      )}

      {isTaxi ? (
        <>
          {vehicle !== "large" && (
            <>
              <Text style={styles.label}>فئة السيارة</Text>
              <View style={styles.catRow}>
                {VEHICLE_CATS.filter((category) => category.key !== "large").map((category) => (
                  <TouchableOpacity
                    key={category.key}
                    style={[styles.catChip, vehicleCat === category.key && styles.catChipActive]}
                    onPress={() => setVehicleCat(category.key)}
                  >
                    <Text style={styles.catEmoji}>{category.emoji}</Text>
                    <Text style={[styles.catLabel, vehicleCat === category.key && styles.catLabelActive]}>{category.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}
          {isLargeVehicle && (
            <View style={{ marginTop: 10, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: palette.gold, backgroundColor: palette.goldSoft }}>
              <Text style={styles.label}>السعر اللي تقترحه (اختياري)</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 10 }}>
                {[15000, 20000, 25000, 30000, 35000, 40000, 45000, 50000].map((amount) => (
                  <TouchableOpacity key={amount} onPress={() => setCustomerPrice(String(amount))} style={{ paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, borderWidth: 1, borderColor: customerPrice === String(amount) ? palette.brand : palette.line, backgroundColor: customerPrice === String(amount) ? palette.brandSoft : palette.surface }}>
                    <Text style={{ color: customerPrice === String(amount) ? palette.brand : palette.ink, fontSize: 12, fontWeight: "800" }}>{(amount / 1000).toLocaleString("en")} ألف</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput
                style={styles.input}
                value={customerPrice}
                onChangeText={(value) => setCustomerPrice(value.replace(/[^0-9]/g, ""))}
                placeholder="أو اكتب أي سعر بالدينار"
                placeholderTextColor="#94a3b8"
                keyboardType="numeric"
              />
              <Text style={{ color: palette.muted, fontSize: 11, marginTop: 6 }}>ماكو تسعير بالكيلومتر؛ أصحاب السيارات يرسلون عروضهم وتختار الأنسب</Text>
              {vehicleType === "kia_cargo" && (
                <>
                  <Text style={styles.label}>كمية الحمولة أو وصفها (اختياري — كيا حمل فقط)</Text>
                  <TextInput style={styles.input} value={cargoLoadDescription} onChangeText={(value) => setCargoLoadDescription(value.slice(0, 300))} placeholder="مثلاً: 500 طابوقة أو حمولة نصف طن" placeholderTextColor="#94a3b8" />
                </>
              )}
            </View>
          )}
          {isTaxi && !isLargeVehicle && (
                  <View style={{ marginTop: 18, marginBottom: 8, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: "#F59E0B80", backgroundColor: palette.goldSoft }}>
                    <Text style={{ color: palette.ink, fontSize: 14, fontWeight: "900", marginBottom: 9 }}>🎁 عندك كوبون خصم؟</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <TextInput
                        style={[styles.input, { flex: 1, marginTop: 0, marginBottom: 0 }]}
                        value={couponCode}
                        onChangeText={(value) => { setCouponCode(value.toUpperCase()); setCouponPreview(null); setCouponError(""); }}
                        placeholder="اكتب رمز الكوبون"
                        placeholderTextColor="#94a3b8"
                        autoCapitalize="characters"
                      />
                      <TouchableOpacity
                        disabled={couponLoading}
                        onPress={previewCoupon}
                        style={{ paddingHorizontal: 16, paddingVertical: 13, borderRadius: 12, backgroundColor: "#F59E0B", opacity: couponLoading ? 0.6 : 1 }}
                      >
                        {couponLoading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={{ color: "#FFFFFF", fontWeight: "900", fontSize: 13 }}>تحقق</Text>}
                      </TouchableOpacity>
                    </View>
                    {!!couponError && <Text style={{ color: "#DC2626", fontSize: 12, fontWeight: "800", marginTop: 8 }}>{couponError}</Text>}
                    {couponPreview && (
                      <View style={{ marginTop: 10, padding: 11, borderRadius: 12, backgroundColor: palette.surface }}>
                        <Text style={{ color: "#15803D", fontWeight: "900", marginBottom: 5 }}>تم التحقق من الكوبون</Text>
                        <Text style={{ color: palette.ink, fontSize: 12, marginTop: 3 }}>قيمة الخصم: {couponPreview.discount.toLocaleString("ar-IQ")} د.ع</Text>
                        <Text style={{ color: palette.ink, fontSize: 12, marginTop: 3 }}>المبلغ بعد الخصم: {couponPreview.payable.toLocaleString("ar-IQ")} د.ع</Text>
                        <Text style={{ color: palette.muted, fontSize: 10, marginTop: 5 }}>الخصم تتحمله ممنون ولا يقلل مستحقات السائق.</Text>
                      </View>
                    )}
                  </View>
          )}
        </>
      ) : (
        <>
          <Text style={styles.label}>مستوى الفني</Text>
          <View style={styles.catRow}>
            <TouchableOpacity
              style={[styles.catChip, workerLevel === "fani" && styles.catChipActive]}
              onPress={() => setWorkerLevel("fani")}
            >
              <Text style={[styles.catLabel, workerLevel === "fani" && styles.catLabelActive]}>
                فني
              </Text>
            </TouchableOpacity>
            {EXPERT_ONLY_SERVICE_SLUGS.has(selectedService) && (
              <TouchableOpacity
                style={[styles.catChip, workerLevel === "khabir" && styles.catChipActive]}
                onPress={() => setWorkerLevel("khabir")}
              >
                <Text style={[styles.catLabel, workerLevel === "khabir" && styles.catLabelActive]}>
                  خبير
                </Text>
              </TouchableOpacity>
            )}
          </View>
          {workerLevel === "khabir" && EXPERT_ONLY_SERVICE_SLUGS.has(selectedService) && (
            <View style={{ marginTop: 8, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: palette.gold, backgroundColor: palette.goldSoft }}>
              <Text style={{ color: palette.ink, fontSize: 13, fontWeight: "900", textAlign: "right" }}>مميزات اختيار الخبير</Text>
              <Text style={{ color: palette.muted, fontSize: 11, lineHeight: 19, textAlign: "right", marginTop: 5 }}>خبرة تخصصية أعلى، تشخيص أدق، تنفيذ الأعمال المعقدة، وإمكانية طلب خبير منفرد أو خبير مع فريق عمال حسب حجم العمل.</Text>
            </View>
          )}
          <Text style={styles.label}>عدد الفنيين الإضافيين: {extraWorkers}</Text>
          <View style={styles.stepperRow}>
            <TouchableOpacity
              style={styles.stepperBtn}
              onPress={() => setExtraWorkers(Math.max(0, extraWorkers - 1))}
            >
              <Text style={styles.stepperText}>−</Text>
            </TouchableOpacity>
            <Text style={styles.stepperValue}>{extraWorkers}</Text>
            <TouchableOpacity
              style={styles.stepperBtn}
              onPress={() => setExtraWorkers(Math.min(5, extraWorkers + 1))}
            >
              <Text style={styles.stepperText}>+</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {!isTaxi && (
        <>
          <TouchableOpacity onPress={() => setUrgencyEnabled((value) => !value)} style={{ marginTop: 12, marginBottom: 12, padding: 13, borderRadius: 14, borderWidth: 1, borderColor: urgencyEnabled ? palette.brand : palette.line, backgroundColor: urgencyEnabled ? palette.brandSoft : palette.surface, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: palette.ink, fontWeight: "900", textAlign: "right" }}>⚡ وضع الاستعجال</Text>
              <Text style={{ color: palette.muted, fontSize: 10, textAlign: "right", marginTop: 3 }}>يظهر طلبك للمزودين كطلب مستعجل أثناء البحث</Text>
            </View>
            <Text style={{ color: urgencyEnabled ? palette.brand : palette.muted, fontWeight: "900" }}>{urgencyEnabled ? "مفعّل" : "متوقف"}</Text>
          </TouchableOpacity>
          <Text style={styles.label}>{["washer_repair", "stove_repair", "fridge_repair", "ac_repair", "electric_street", "plumbing", "phone_repair", "electronics_repair", "computer_repair"].includes(selectedService) ? "وصف العطل" : "وصف العمل المطلوب"}</Text>
          <TextInput
            style={[styles.input, { height: 90 }]}
            value={workDescription}
            onChangeText={setWorkDescription}
            placeholder={["washer_repair", "stove_repair", "fridge_repair", "ac_repair", "electric_street", "plumbing", "phone_repair", "electronics_repair", "computer_repair"].includes(selectedService) ? "اشرح العطل بالتفصيل حتى يعرف الفني شنو يحتاج..." : "مثلاً: بناء جدار بطول 5 أمتار وارتفاع 3 أمتار..." }
            placeholderTextColor="#94a3b8"
            multiline
            maxLength={1500}
          />
          {selectedService === "build" && (
            <>
              <Text style={styles.label}>كمية الطابوق المطلوبة (اختياري)</Text>
              <TextInput style={styles.input} value={brickQuantity} onChangeText={(value) => setBrickQuantity(value.slice(0, 100))} placeholder="مثلاً: 2000 طابوقة" placeholderTextColor="#94a3b8" />
            </>
          )}
          <Text style={styles.label}>طريقة احتساب الأجر</Text>
          <View style={styles.catRow}>
            {([
              ["fixed", "إنجاز تام"],
              ["hourly", "بالساعة"],
              ["negotiable", "تفاوض"],
            ] as const).map(([mode, label]) => (
              <TouchableOpacity
                key={mode}
                style={[styles.catChip, pricingMode === mode && styles.catChipActive]}
                onPress={() => setPricingMode(mode)}
              >
                <Text style={[styles.catLabel, pricingMode === mode && styles.catLabelActive]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {pricingMode !== "negotiable" && (
            <>
              <Text style={styles.label}>{pricingMode === "hourly" ? "الأجر لكل ساعة لكل فني" : "الأجر لكل فني بالدينار"}</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 8 }}>
                {[15000, 25000, 30000, 50000].map((amount) => (
                  <TouchableOpacity key={amount} onPress={() => setCustomerPrice(String(amount))} style={{ paddingHorizontal: 13, paddingVertical: 10, borderRadius: 12, backgroundColor: customerPrice === String(amount) ? palette.brand : palette.surface, borderWidth: 1, borderColor: customerPrice === String(amount) ? palette.gold : palette.line }}>
                    <Text style={{ color: customerPrice === String(amount) ? palette.white : palette.ink, fontSize: 12, fontWeight: "900" }}>{(amount / 1000).toLocaleString("ar-IQ")} ألف</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput
                style={styles.input}
                value={customerPrice}
                onChangeText={(value) => setCustomerPrice(value.replace(/[^0-9]/g, ""))}
                placeholder="أجر الفني الواحد بالدينار"
                placeholderTextColor="#94a3b8"
                keyboardType="numeric"
              />
              {Number(customerPrice) > 0 && (
                <View style={{ padding: 12, borderRadius: 14, backgroundColor: palette.brandSoft, borderWidth: 1, borderColor: palette.brand }}>
                  <Text style={{ color: palette.ink, textAlign: "right", fontSize: 12, fontWeight: "800" }}>المبلغ الإجمالي للطلب</Text>
                  <Text style={{ color: palette.brand, textAlign: "right", fontSize: 20, fontWeight: "900", marginTop: 4 }}>{serviceTotalPrice.toLocaleString("ar-IQ")} د.ع</Text>
                  <Text style={{ color: palette.muted, textAlign: "right", fontSize: 10, marginTop: 3 }}>سعر الفرد × {servicePriceMultiplier} وحدات أجرة · أجرة الخبير ضعف أجرة الفني العادي{pricingMode === "hourly" ? " لكل ساعة" : ""}</Text>
                </View>
              )}
            </>
          )}
          {pricingMode === "hourly" && (
            <>
              <Text style={styles.label}>عدد ساعات العمل المتوقعة</Text>
              <TextInput
                style={styles.input}
                value={workHours}
                onChangeText={(value) => setWorkHours(value.replace(/[^0-9.]/g, ""))}
                placeholder="مثلاً 3"
                placeholderTextColor="#94a3b8"
                keyboardType="decimal-pad"
              />
            </>
          )}
        </>
      )}


      {showRequestPhoto && (
        <View style={{ marginTop: 18, padding: 14, borderRadius: 16, borderWidth: 1, borderStyle: "dashed", borderColor: palette.gold, backgroundColor: palette.surface }}>
          <Text style={styles.label}>صورة توضيحية للطلب (اختياري)</Text>
          <TouchableOpacity style={styles.photoUploadButton} onPress={chooseRequestPhoto}>
            <Text style={styles.photoUploadText}>{requestPhoto ? "تغيير الصورة" : "اختيار صورة من الجهاز"}</Text>
          </TouchableOpacity>
          {requestPhoto && (
            <View style={{ marginTop: 10, alignItems: "center", gap: 8 }}>
              <Image source={{ uri: requestPhoto.uri }} style={styles.requestPhotoPreview} />
              <TouchableOpacity onPress={() => setRequestPhoto(null)}><Text style={{ color: palette.danger, fontWeight: "900" }}>حذف الصورة</Text></TouchableOpacity>
            </View>
          )}
          <Text style={{ color: palette.muted, fontSize: 11, marginTop: 8 }}>JPG أو PNG أو WebP، بحد أقصى 8 ميغابايت. تظهر الصورة ضمن تفاصيل الطلب للأطراف المصرّح لها.</Text>
        </View>
      )}
      <Text style={styles.label}>ملاحظات إضافية (اختياري)</Text>
      <TextInput
        style={[styles.input, { height: 80 }]}
        value={notes}
        onChangeText={setNotes}
        placeholder={isLargeVehicle ? "اكتب الوجهة إن وجدت وأي تفاصيل عن الحمولة أو المشوار..." : "أي تفاصيل إضافية..."}
        placeholderTextColor="#94a3b8"
        multiline
      />

      {routeLoading && <Text style={styles.mapHintText}>جاري حساب مسافة الطريق الفعلية...</Text>}
      {!!routeError && <Text style={styles.mapErrorText}>{routeError}</Text>}
      {isTaxi && !isLargeVehicle && (
        <View style={styles.tripOptionsBox}>
          <TouchableOpacity style={styles.tripOptionsHeader} onPress={() => setTripOptionsExpanded((value) => !value)}>
            <Text style={styles.tripOptionsTitle}>خيارات الرحلة الاختيارية</Text>
            <Text style={styles.tripOptionsToggle}>{tripOptionsExpanded ? "إخفاء ▲" : "إظهار ▼"}</Text>
          </TouchableOpacity>
          {tripOptionsExpanded && (
            <>
              <Text style={styles.tripOptionsHint}>اختار نوع الرحلة فقط إذا تحتاجه؛ الافتراضي رحلة ذهاب.</Text>
              <View style={styles.catRow}>
                {([
                  { key: "one_way", label: "ذهاب فقط" },
                  { key: "round_trip", label: "ذهاب وإياب" },
                  { key: "second_trip", label: "رحلة ثانية" },
                  { key: "stop", label: "توقف بالطريق" },
                ] as const).map((item) => (
                  <TouchableOpacity key={item.key} style={[styles.catChip, tripType === item.key && styles.catChipActive]} onPress={() => { setTripType(item.key); if (item.key !== "stop") setExtraMinutes(0); }}>
                    <Text style={[styles.catLabel, tripType === item.key && styles.catLabelActive]}>{item.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {tripType === "round_trip" && <Text style={styles.tripOptionsHint}>تم تطبيق خصم 10٪ على أجرة الذهاب والإياب.</Text>}
              {tripType === "stop" && (
                <>
                <View style={styles.extraTimeHeader}>
                  <Text style={styles.tripOptionsTitle}>مدة التوقف</Text>
                  <Text style={styles.extraTimeValue}>{extraMinutes} دقيقة · {(Math.ceil(extraMinutes / 5) * 500).toLocaleString("ar-IQ")} د.ع</Text>
                </View>
                <Text style={styles.tripOptionsHint}>مدة التوقف يحددها الزبون بنفسه، كل 5 دقائق بـ500 دينار، والحد الأعلى ساعتان.</Text>
                <View
                  style={styles.extraTimeSliderTouch}
                  onLayout={(event) => { extraTimeTrackWidthRef.current = event.nativeEvent.layout.width; }}
                  {...extraTimePanResponder.panHandlers}
                  accessibilityRole="adjustable"
                  accessibilityLabel="مدة التوقف"
                  accessibilityValue={{ min: 0, max: 120, now: extraMinutes }}
                  accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
                  onAccessibilityAction={(event) => {
                    if (event.nativeEvent.actionName === "increment") setExtraMinutes((value) => Math.min(120, value + 5));
                    if (event.nativeEvent.actionName === "decrement") setExtraMinutes((value) => Math.max(0, value - 5));
                  }}
                >
                  <View style={styles.extraTimeSliderTrack}>
                    <View style={[styles.extraTimeSliderFill, { width: `${(extraMinutes / 120) * 100}%` }]} />
                    <View style={[styles.extraTimeSliderThumb, { right: `${(extraMinutes / 120) * 100}%` }]} />
                  </View>
                </View>
                <View style={styles.extraTimeScale}>
                  <Text style={styles.tripOptionsHint}>بدون توقف</Text>
                  <Text style={styles.tripOptionsHint}>30 دقيقة</Text>
                  <Text style={styles.tripOptionsHint}>ساعة</Text>
                  <Text style={styles.tripOptionsHint}>ساعتان</Text>
                </View>
                </>
              )}
            </>
          )}
        </View>
      )}
      {routeKm !== null && isTaxi && !isLargeVehicle && (
        <View style={styles.priceBox}>
          <Text style={styles.priceLabel}>مسافة الطريق الفعلية</Text>
          <Text style={styles.priceValue}>{routeKm.toFixed(2)} كم</Text>
          <Text style={[styles.priceLabel, { marginTop: 12 }]}>السعر التقديري حسب الفئة والطلب</Text>
          <Text style={styles.priceValue}>{estimatedTaxiFare?.toLocaleString("ar-IQ") ?? "—"} د.ع</Text>
          <Text style={styles.priceNote}>الوقت التقريبي: {Math.max(1, Math.round(routeDurationMin ?? 1))} دقيقة. يُعاد تأكيد المسافة والسعر من الخادم عند إرسال الطلب.</Text>
        </View>
      )}
      <View style={{ height: 24 }} />
      <Button title="إرسال الطلب" onPress={() => void submit()} loading={busy} />
      <GovernoratePickerModal visible={governoratePickerVisible} selectedKey={activeGovernorateKey} onClose={() => setGovernoratePickerVisible(false)} onSelect={(key) => { chooseGovernorate(key); setGovernoratePickerVisible(false); }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.pageCanvas, paddingHorizontal: 18, paddingTop: 52 },
  taxiScreen: { flex: 1, backgroundColor: palette.pageCanvas },
  governoratePickerButton: { minHeight: 52, paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.md, borderWidth: 1, borderColor: palette.gold, backgroundColor: palette.surface, flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 },
  governoratePickerLabel: { color: palette.muted, fontSize: 11, fontWeight: "800" },
  governoratePickerValue: { color: palette.ink, fontSize: 14, fontWeight: "900" },
  placeSearchTop: { borderWidth: 1.5, borderColor: palette.gold, backgroundColor: palette.surface, minHeight: 52, marginTop: 8 },
  taxiNearbyMarker: { width: 36, height: 36, borderRadius: 18, backgroundColor: palette.surface, borderWidth: 2, borderColor: palette.brand, alignItems: "center", justifyContent: "center", elevation: 5 },
  taxiNearbyMarkerText: { fontSize: 19 },
  taxiCenterPin: { position: "absolute", left: "50%", top: "50%", marginLeft: -21, marginTop: -48, zIndex: 4 },
  pinArtwork: { width: 42, height: 58, alignItems: "center", justifyContent: "flex-start" },
  pinShadow: { width: 17, height: 5, borderRadius: 10, backgroundColor: "rgba(15,23,42,0.22)", marginTop: -1 },
  taxiTopBar: { position: "absolute", top: 42, left: 10, right: 10, zIndex: 10, flexDirection: "column", alignItems: "stretch", gap: 8 },
  taxiTopControls: { flexDirection: "row", alignItems: "center", gap: 7 },
  taxiBackButton: { width: 42, height: 44, borderRadius: radius.md, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, alignItems: "center", justifyContent: "center" },
  taxiArrowMedallion: { width: 31, height: 31, borderRadius: 12, backgroundColor: palette.goldSoft, borderWidth: 1, borderColor: palette.gold + "66", alignItems: "center", justifyContent: "center" },
  taxiLocateFloating: { position: "absolute", left: 76, zIndex: 12, minHeight: 42, paddingHorizontal: 12, borderRadius: 22, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.gold, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, shadowColor: "#0F172A", shadowOpacity: 0.22, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
  taxiLocateFloatingText: { color: palette.brand, fontSize: 11, fontFamily: "Tajawal_900Black", fontWeight: "900" },
  taxiPrimaryArrow: { width: 30, height: 30, borderRadius: 11, backgroundColor: "rgba(255,255,255,0.16)", borderWidth: 1, borderColor: "rgba(255,255,255,0.32)", alignItems: "center", justifyContent: "center" },
  taxiGovernorateBadge: { minHeight: 44, paddingHorizontal: 11, borderRadius: radius.md, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, alignItems: "center", justifyContent: "center" },
  taxiGovernorateText: { color: palette.ink, fontSize: 11, fontFamily: "Tajawal_900Black", fontWeight: "900" },
  taxiStepTabs: { flex: 1, flexDirection: "row", padding: 4, borderRadius: radius.md, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, gap: 4 },
  taxiStepTab: { flex: 1, minHeight: 36, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  taxiStepTabPickup: { backgroundColor: "#0284c7" },
  taxiStepTabDestination: { backgroundColor: "#e11d48" },
  taxiStepText: { color: palette.muted, fontSize: 10, fontFamily: "Tajawal_900Black", fontWeight: "900" },
  taxiStepTextActive: { color: "#FFFFFF" },
  taxiBottomSheet: { position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "66%", backgroundColor: palette.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, borderTopWidth: 1, borderColor: palette.line, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 24, shadowColor: "#000000", shadowOpacity: 0.18, shadowRadius: 16, elevation: 12 },
  taxiSheetContent: { paddingBottom: 18, gap: 10 },
  taxiSheetTitle: { color: palette.ink, fontSize: 18, fontFamily: "Tajawal_900Black", fontWeight: "900", textAlign: "right" },
  taxiSelectedAddress: { color: palette.muted, fontSize: 12, fontFamily: "Tajawal_700Bold", fontWeight: "700", lineHeight: 18, textAlign: "right" },
  taxiSearchRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  taxiLocateButton: { minHeight: 48, minWidth: 70, paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: palette.gold, alignItems: "center", justifyContent: "center" },
  taxiLocateText: { color: palette.brandDeep, fontSize: 12, fontFamily: "Tajawal_900Black", fontWeight: "900" },
  taxiSearchInput: { flex: 1, minHeight: 48, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, paddingHorizontal: 12, color: palette.ink, backgroundColor: palette.canvas, fontSize: 13, fontFamily: "Tajawal_700Bold", fontWeight: "700", textAlign: "right" },
  taxiSearchInputFull: { minHeight: 48, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, paddingHorizontal: 12, color: palette.ink, backgroundColor: palette.surface, fontSize: 13, fontFamily: "Tajawal_700Bold", fontWeight: "700", textAlign: "right" },
  taxiSuggestionList: { marginTop: 4, borderRadius: radius.md, overflow: "hidden", borderWidth: 1, borderColor: palette.line, backgroundColor: palette.surface },
  taxiSuggestionItem: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: palette.line },
  taxiSuggestionTitle: { color: palette.ink, fontSize: 12, fontFamily: "Tajawal_900Black", fontWeight: "900", textAlign: "right" },
  taxiSuggestionAddress: { color: palette.muted, fontSize: 10, marginTop: 3, textAlign: "right" },
  taxiGovernorateRow: { flexDirection: "row", gap: 7, paddingVertical: 3 },
  taxiGovernorateChip: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: radius.pill, backgroundColor: palette.canvas, borderWidth: 1, borderColor: palette.line },
  taxiGovernorateChipActive: { backgroundColor: palette.brand, borderColor: palette.gold },
  taxiGovernorateChipText: { color: palette.ink, fontSize: 11, fontFamily: "Tajawal_800ExtraBold", fontWeight: "800" },
  taxiGovernorateChipTextActive: { color: palette.white },
  taxiFieldLabel: { color: palette.ink, fontSize: 12, fontFamily: "Tajawal_900Black", fontWeight: "900", textAlign: "right", marginTop: 5 },
  taxiPrimaryButton: { minHeight: 54, borderRadius: radius.lg, backgroundColor: palette.brand, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 16, marginTop: 5 },
  taxiButtonDisabled: { opacity: 0.45 },
  taxiPrimaryButtonText: { color: palette.white, fontSize: 15, fontFamily: "Tajawal_900Black", fontWeight: "900" },
  taxiErrorText: { color: palette.danger, fontSize: 11, fontFamily: "Tajawal_800ExtraBold", fontWeight: "800", textAlign: "right" },
  taxiHintText: { color: palette.muted, fontSize: 10, lineHeight: 16, textAlign: "right" },
  taxiLargeTypePanel: { padding: 11, borderRadius: radius.md, borderWidth: 1, borderColor: palette.gold, backgroundColor: palette.goldSoft, gap: 8 },
  taxiLargeTypeRow: { flexDirection: "row", gap: 7 },
  taxiLargeTypeCard: { flex: 1, minHeight: 88, borderRadius: radius.md, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.surface, alignItems: "center", justifyContent: "center", padding: 6 },
  taxiLargeTypeCardActive: { borderColor: palette.gold, backgroundColor: palette.brandSoft, borderWidth: 2 },
  taxiLargeTypeImage: { width: "100%", height: 52 },
  taxiLargeBus: { fontSize: 32 },
  taxiLargeTypeText: { color: palette.muted, fontSize: 10, fontFamily: "Tajawal_900Black", fontWeight: "900" },
  taxiLargeTypeTextActive: { color: palette.brand },
  taxiDetailsHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  taxiEditButton: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: radius.md, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.canvas },
  taxiEditButtonText: { color: palette.brand, fontSize: 11, fontFamily: "Tajawal_900Black", fontWeight: "900" },
  taxiRouteSummary: { flexDirection: "row", gap: 8, padding: 11, borderRadius: radius.md, backgroundColor: palette.brandSoft, borderWidth: 1, borderColor: palette.line },
  taxiRouteMetric: { flex: 1, alignItems: "center", gap: 3 },
  taxiRouteMetricLabel: { color: palette.muted, fontSize: 10, fontFamily: "Tajawal_700Bold", fontWeight: "700" },
  taxiRouteMetricValue: { color: palette.brand, fontSize: 15, fontFamily: "Tajawal_900Black", fontWeight: "900" },
  taxiVehicleList: { gap: 7 },
  taxiVehicleCard: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 56, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.surface },
  taxiVehicleCardActive: { borderColor: palette.brand, backgroundColor: palette.brandSoft, borderWidth: 2 },
  taxiVehicleEmoji: { fontSize: 25, width: 38, textAlign: "center" },
  taxiVehicleName: { flex: 1, color: palette.ink, fontSize: 12, fontFamily: "Tajawal_900Black", fontWeight: "900", textAlign: "right" },
  taxiVehicleFare: { color: palette.brand, fontSize: 13, fontFamily: "Tajawal_900Black", fontWeight: "900" },
  taxiOptionsPanel: { padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: palette.gold, backgroundColor: palette.surface, gap: 9 },
  taxiOptionsHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  taxiOptionsTitle: { color: palette.ink, fontSize: 12, fontFamily: "Tajawal_900Black", fontWeight: "900" },
  taxiOptionsToggle: { color: palette.brand, fontSize: 11, fontFamily: "Tajawal_900Black", fontWeight: "900" },
  taxiTripTypeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  taxiTripTypeChip: { width: "48%", minHeight: 40, borderRadius: radius.md, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.canvas, alignItems: "center", justifyContent: "center" },
  taxiTripTypeChipActive: { borderColor: palette.brand, backgroundColor: palette.brand },
  taxiTripTypeText: { color: palette.ink, fontSize: 11, fontFamily: "Tajawal_800ExtraBold", fontWeight: "800" },
  taxiTripTypeTextActive: { color: palette.white },
  taxiSuccessText: { color: palette.success, fontSize: 11, fontFamily: "Tajawal_900Black", fontWeight: "900", textAlign: "right" },
  taxiCouponPanel: { padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: "#F59E0B80", backgroundColor: palette.goldSoft, gap: 8 },
  taxiCouponButton: { minHeight: 46, paddingHorizontal: 15, borderRadius: radius.md, backgroundColor: "#F59E0B", alignItems: "center", justifyContent: "center" },
  taxiCouponButtonText: { color: "#FFFFFF", fontSize: 12, fontFamily: "Tajawal_900Black", fontWeight: "900" },
  taxiCouponResult: { padding: 10, borderRadius: radius.md, backgroundColor: palette.surface, gap: 4 },
  taxiCouponText: { color: palette.ink, fontSize: 11, textAlign: "right" },
  taxiBudgetRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  taxiBudgetChip: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.surface },
  taxiBudgetChipActive: { borderColor: palette.brand, backgroundColor: palette.brandSoft },
  taxiBudgetText: { color: palette.ink, fontSize: 10, fontFamily: "Tajawal_800ExtraBold", fontWeight: "800" },
  taxiBudgetTextActive: { color: palette.brand },
  taxiPhotoPanel: { padding: 12, borderRadius: radius.md, borderWidth: 1, borderStyle: "dashed", borderColor: palette.gold, backgroundColor: palette.surface, gap: 8 },
  taxiPhotoButton: { minHeight: 44, borderRadius: radius.md, backgroundColor: palette.brandSoft, alignItems: "center", justifyContent: "center" },
  taxiPhotoButtonText: { color: palette.brand, fontSize: 12, fontFamily: "Tajawal_900Black", fontWeight: "900" },
  taxiNotesInput: { minHeight: 72, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, padding: 12, color: palette.ink, backgroundColor: palette.surface, textAlign: "right", textAlignVertical: "top", fontSize: 12, fontFamily: "Tajawal_700Bold", fontWeight: "600" },
  taxiRetryButton: { alignSelf: "flex-end", paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md, backgroundColor: palette.brandSoft },
  taxiRetryText: { color: palette.brand, fontSize: 11, fontFamily: "Tajawal_900Black", fontWeight: "900" },
  taxiErrorPanel: { padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: palette.danger, backgroundColor: palette.dangerSoft, gap: 7 },
  title: { fontSize: 27, fontWeight: "900", color: palette.ink, marginBottom: 20 },
  label: { fontSize: 13, fontWeight: "900", color: palette.ink, marginBottom: 8, marginTop: 16 },
  serviceGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  serviceTile: { width: "31%", height: 148, borderRadius: radius.md, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, alignItems: "center", justifyContent: "flex-start", overflow: "hidden" },
  serviceEmoji: { fontSize: 30, marginBottom: 4 },
  serviceImage: { width: "100%", height: 112, marginBottom: 5 },
  serviceLabel: { fontSize: 12, fontWeight: "800", color: palette.ink, textAlign: "center", paddingHorizontal: 3 },
  mapModeRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  governorateRow: { flexDirection: "row", gap: 8, paddingVertical: 4 },
  governorateChip: { paddingHorizontal: 13, paddingVertical: 10, borderRadius: radius.pill, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line },
  governorateChipActive: { backgroundColor: palette.brand, borderColor: palette.gold },
  governorateChipText: { color: palette.ink, fontSize: 12, fontWeight: "800" },
  governorateChipTextActive: { color: palette.white },
  suggestionList: { marginTop: 8, borderRadius: radius.md, overflow: "hidden", borderWidth: 1, borderColor: palette.line, backgroundColor: palette.surface },
  suggestionItem: { paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: palette.line },
  suggestionTitle: { color: palette.ink, fontSize: 13, fontWeight: "800", textAlign: "right" },
  suggestionAddress: { color: palette.muted, fontSize: 11, marginTop: 4, textAlign: "right" },
  mapErrorText: { color: palette.danger, fontSize: 12, fontWeight: "700", marginTop: 8, textAlign: "right" },
  mapHintText: { color: palette.muted, fontSize: 12, fontWeight: "700", marginTop: 8, textAlign: "center" },
  mapModeButton: { flex: 1, minHeight: 46, borderRadius: radius.md, backgroundColor: palette.surfaceSoft, borderWidth: 1, borderColor: palette.line, alignItems: "center", justifyContent: "center" },
  mapModeButtonActive: { backgroundColor: palette.brand, borderColor: palette.brand },
  mapModeText: { color: palette.muted, fontWeight: "800", fontSize: 12 },
  mapModeTextActive: { color: palette.white },
  locateButton: { paddingHorizontal: 14, minHeight: 46, borderRadius: radius.md, backgroundColor: palette.gold, minWidth: 62, alignItems: "center", justifyContent: "center" },
  locateButtonText: { color: palette.brandDeep, fontWeight: "900", fontSize: 12 },
  mapContainer: { height: 280, borderRadius: radius.xl, overflow: "hidden", marginTop: 8, borderWidth: 1, borderColor: palette.line },
  map: { flex: 1 },
  mapCenterPin: { position: "absolute", left: "50%", top: "50%", marginLeft: -21, marginTop: -48, zIndex: 5 },
  mapHint: { position: "absolute", bottom: 10, alignSelf: "center", backgroundColor: palette.brandDeep, color: palette.white, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, fontSize: 11, overflow: "hidden" },
  input: { minHeight: 54, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, paddingHorizontal: 16, paddingVertical: 14, fontSize: 14, fontWeight: "600", color: palette.ink, backgroundColor: palette.surface, textAlign: "right" },
  photoUploadButton: { minHeight: 48, borderRadius: radius.md, backgroundColor: palette.brandSoft, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: palette.line },
  photoUploadText: { color: palette.brand, fontWeight: "900", fontSize: 13 },
  requestPhotoPreview: { width: 180, height: 135, borderRadius: radius.md, resizeMode: "cover" },
  catRow: { flexDirection: "row", gap: 10 },
  catChip: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: radius.md, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line },
  catChipActive: { borderColor: palette.gold, backgroundColor: palette.brandSoft },
  catEmoji: { fontSize: 18 },
  catLabel: { fontSize: 13, fontWeight: "800", color: palette.muted },
  catLabelActive: { color: palette.brand },
  stepperRow: { flexDirection: "row", alignItems: "center", gap: 20 },
  stepperBtn: { width: 46, height: 46, borderRadius: radius.md, backgroundColor: palette.surface, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: palette.line },
  stepperText: { fontSize: 24, fontWeight: "900", color: palette.brand },
  stepperValue: { fontSize: 20, fontWeight: "900", color: palette.ink },
  tripOptionsBox: { marginTop: 14, padding: 14, borderRadius: radius.md, borderWidth: 1, borderColor: palette.gold, backgroundColor: palette.surface },
  tripOptionsHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  tripOptionsTitle: { color: palette.ink, fontSize: 13, fontWeight: "900" },
  tripOptionsToggle: { color: palette.brand, fontSize: 12, fontWeight: "900" },
  tripOptionsHint: { color: palette.muted, fontSize: 11, marginTop: 8, lineHeight: 18 },
  extraTimeHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 14 },
  extraTimeSliderTouch: { paddingVertical: 12, paddingHorizontal: 4 },
  extraTimeSliderTrack: { height: 8, borderRadius: radius.pill, backgroundColor: palette.line, justifyContent: "center" },
  extraTimeSliderFill: { position: "absolute", right: 0, height: 8, borderRadius: radius.pill, backgroundColor: palette.gold },
  extraTimeSliderThumb: { position: "absolute", width: 22, height: 22, borderRadius: radius.pill, backgroundColor: palette.brand, borderWidth: 3, borderColor: palette.white, top: -7, marginRight: -11 },
  extraTimeScale: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  extraTimeValue: { color: palette.ink, fontSize: 12, fontWeight: "900" },
  goldLockedText: { color: palette.gold, fontSize: 12, fontWeight: "800", marginTop: 10 },
  priceBox: { backgroundColor: palette.brandSoft, borderRadius: radius.lg, padding: 18, alignItems: "center", marginTop: 20, borderWidth: 1, borderColor: palette.line },
  priceLabel: { fontSize: 13, color: palette.muted, fontWeight: "700" },
  priceValue: { fontSize: 25, fontWeight: "900", color: palette.brand, marginTop: 4 },
  priceNote: { fontSize: 11, color: palette.muted, marginTop: 6, textAlign: "center" },
});
