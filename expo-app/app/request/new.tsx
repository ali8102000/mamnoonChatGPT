import { useState, useEffect, useRef } from "react";
import { router, useLocalSearchParams } from "expo-router";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  TextInput,
  ActivityIndicator,
  Image,
} from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";
import * as Location from "expo-location";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { callMamnoonMapsApi } from "@/lib/maps-api";
import { IRAQ_GOVERNORATES, getMobileGovernorate, nearestGovernorateKey } from "@/lib/governorates";
import { Button } from "@/components/ui";
import { getServiceImage } from "@/lib/service-visuals";
import { palette, radius } from "@/styles/theme";

type Coordinates = { latitude: number; longitude: number };
type VehicleCategory = "economy" | "premium" | "luxury" | "large";

const TAXI_SERVICE = { slug: "taxi", label: "سيارة", emoji: "🚕", color: palette.brand };
type CatalogService = { id: string; slug: string; name_ar: string };


const VEHICLE_CATS: { key: VehicleCategory; label: string; emoji: string }[] = [
  { key: "economy", label: "اقتصادية", emoji: "🚗" },
  { key: "premium", label: "فاخرة", emoji: "🚙" },
  { key: "luxury", label: "VIP", emoji: "🚘" },
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

function formatAddress(parts: Location.LocationGeocodedAddress[] | null | undefined) {
  const item = parts?.[0];
  if (!item) return "";
  return [item.name, item.street, item.district, item.city, item.region]
    .filter((part): part is string => Boolean(part?.trim()))
    .filter((part, index, all) => all.indexOf(part) === index)
    .join("، ");
}

export default function NewRequest() {
  const { type, vehicle } = useLocalSearchParams<{ type: string; vehicle?: string }>();
  const { user } = useAuth();
  const [selectedService, setSelectedService] = useState(type || "taxi");
  const [serviceCatalog, setServiceCatalog] = useState<CatalogService[]>([]);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [servicesError, setServicesError] = useState<string | null>(null);
  const [pickup, setPickup] = useState("");
  const [destination, setDestination] = useState("");
  const [pickupCoords, setPickupCoords] = useState<Coordinates | null>(null);
  const [destinationCoords, setDestinationCoords] = useState<Coordinates | null>(null);
  const [mapMode, setMapMode] = useState<"pickup" | "destination">("pickup");
  const [pickupGovernorateKey, setPickupGovernorateKey] = useState<string | null>("baghdad");
  const [destinationGovernorateKey, setDestinationGovernorateKey] = useState<string | null>(null);
  const activeGovernorateKey = mapMode === "pickup" ? pickupGovernorateKey : destinationGovernorateKey;
  const activeGovernorate = getMobileGovernorate(activeGovernorateKey);
  const [region, setRegion] = useState(IRAQ_REGION);
  const [locationLoading, setLocationLoading] = useState(true);
  const [vehicleCat, setVehicleCat] = useState<VehicleCategory>(vehicle === "large" ? "large" : "economy");
  const [vehicleType, setVehicleType] = useState<"kia_cargo" | "kia_passenger" | "bus">("kia_cargo");
  const [workerLevel, setWorkerLevel] = useState<"fani" | "khabir">("fani");
  const [extraWorkers, setExtraWorkers] = useState(0);
  const [notes, setNotes] = useState("");
  const [workDescription, setWorkDescription] = useState("");
  const [customerPrice, setCustomerPrice] = useState("");
  const [pricingMode, setPricingMode] = useState<"fixed" | "hourly" | "negotiable">("fixed");
  const [workHours, setWorkHours] = useState("");
  const [busy, setBusy] = useState(false);
  const [routeKm, setRouteKm] = useState<number | null>(null);
  const [routeDurationMin, setRouteDurationMin] = useState<number | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [placeQuery, setPlaceQuery] = useState("");
  const [placeSuggestions, setPlaceSuggestions] = useState<Array<{ id: string; text: string; address?: string; coords?: { lat: number; lng: number } }>>([]);
  const [searchingPlaces, setSearchingPlaces] = useState(false);
  const [placeSearchError, setPlaceSearchError] = useState<string | null>(null);
  const [focusSearchAfterProvince, setFocusSearchAfterProvince] = useState(false);
  const placeSearchInputRef = useRef<TextInput>(null);
  const isTaxi = selectedService === "taxi";
  const isLargeVehicle = vehicle === "large";

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
        if (permission.status !== "granted") return;
        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
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
        setRegion({ ...coords, latitudeDelta: 0.02, longitudeDelta: 0.02 });
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
    if (!pickupCoords || !destinationCoords || !isTaxi || isLargeVehicle) {
      setRouteKm(null);
      setRouteDurationMin(null);
      setRouteError(null);
      setRouteLoading(false);
      return;
    }
    let active = true;
    const timer = setTimeout(async () => {
      setRouteLoading(true);
      setRouteError(null);
      try {
        const route = await callMamnoonMapsApi<{ distanceKm: number; durationMin: number }>({
          action: "route",
          from: { lat: pickupCoords.latitude, lng: pickupCoords.longitude },
          to: { lat: destinationCoords.latitude, lng: destinationCoords.longitude },
        });
        if (!active) return;
        setRouteKm(route.distanceKm);
        setRouteDurationMin(route.durationMin);
      } catch (error) {
        if (!active) return;
        setRouteKm(null);
        setRouteDurationMin(null);
        setRouteError(error instanceof Error ? error.message : "تعذّر حساب مسافة الطريق.");
      } finally {
        if (active) setRouteLoading(false);
      }
    }, 350);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [pickupCoords, destinationCoords, isTaxi, isLargeVehicle, vehicleCat]);

  useEffect(() => {
    const query = placeQuery.trim();
    if (query.length < 2 || !activeGovernorateKey) {
      setPlaceSuggestions([]);
      setSearchingPlaces(false);
      setPlaceSearchError(null);
      return;
    }
    let active = true;
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
        if (active) setPlaceSuggestions(result.suggestions ?? []);
      } catch (error) {
        if (active) {
          setPlaceSuggestions([]);
          setPlaceSearchError(error instanceof Error ? error.message : "تعذّر البحث عن الأماكن.");
        }
      } finally {
        if (active) setSearchingPlaces(false);
      }
    }, 450);
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
      setPickupCoords(coords);
      setPickupGovernorateKey(nearestGovernorateKey(coords));
      void callMamnoonMapsApi<{ key: string }>({ action: "detectGovernorate", center: { lat: coords.latitude, lng: coords.longitude } })
        .then((result) => setPickupGovernorateKey(result.key))
        .catch(() => {});
      setRegion({ ...coords, latitudeDelta: 0.015, longitudeDelta: 0.015 });
      const address = formatAddress(await Location.reverseGeocodeAsync(coords));
      setPickup(address || "موقعي الحالي");
      setMapMode("pickup");
      setPlaceQuery("");
      setPlaceSuggestions([]);
    } catch {
      Alert.alert("تعذر تحديد الموقع", "تأكد من تشغيل GPS وحاول مرة أخرى.");
    } finally {
      setLocationLoading(false);
    }
  }

  async function chooseMapPoint(coords: Coordinates) {
    if (activeGovernorateKey) {
      try {
        const validation = await callMamnoonMapsApi<{ valid: boolean }>({
          action: "validateGovernorate",
          center: { lat: coords.latitude, lng: coords.longitude },
          governorateKey: activeGovernorateKey,
        });
        if (!validation.valid) {
          Alert.alert("الموقع خارج المحافظة", `اختر نقطة داخل محافظة ${activeGovernorate?.name ?? "المحافظة المحددة"} أو غيّر المحافظة.`);
          return;
        }
      } catch (error) {
        Alert.alert("تعذّر التحقق من الموقع", error instanceof Error ? error.message : "حاول مرة ثانية.");
        return;
      }
    }
    if (mapMode === "pickup") {
      setPickupCoords(coords);
      const address = formatAddress(await Location.reverseGeocodeAsync(coords).catch(() => []));
      setPickup(address || `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`);
    } else {
      setDestinationCoords(coords);
      const address = formatAddress(await Location.reverseGeocodeAsync(coords).catch(() => []));
      setDestination(address || `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`);
    }
  }

  function chooseGovernorate(key: string) {
    const governorate = getMobileGovernorate(key);
    if (!governorate) return;
    if (mapMode === "pickup") setPickupGovernorateKey(key);
    else setDestinationGovernorateKey(key);
    setPlaceQuery("");
    setPlaceSuggestions([]);
    setPlaceSearchError(null);
    setFocusSearchAfterProvince(true);
    setRegion({ latitude: governorate.latitude, longitude: governorate.longitude, latitudeDelta: 0.12, longitudeDelta: 0.12 });
    if (mapMode === "pickup") {
      setPickupCoords(null);
      setPickup("");
    } else {
      setDestinationCoords(null);
      setDestination("");
    }
  }

  function choosePlaceSuggestion(item: { text: string; address?: string; coords?: { lat: number; lng: number } }) {
    if (!item.coords) {
      Alert.alert("الموقع غير متوفر", "اختر اقتراحاً آخر يحتوي على إحداثيات دقيقة.");
      return;
    }
    const coords = { latitude: item.coords.lat, longitude: item.coords.lng };
    const label = item.address || item.text;
    if (mapMode === "pickup") {
      setPickupCoords(coords);
      setPickup(label);
    } else {
      setDestinationCoords(coords);
      setDestination(label);
    }
    setRegion({ ...coords, latitudeDelta: 0.018, longitudeDelta: 0.018 });
    setPlaceQuery("");
    setPlaceSuggestions([]);
  }

  async function submit() {
    if (!user) {
      Alert.alert("تسجيل الدخول مطلوب", "سجّل الدخول قبل إرسال الطلب.");
      return;
    }
    if (!pickupCoords) {
      Alert.alert("حدد موقع الانطلاق", "اختر موقعك من الخريطة أو استخدم تحديد موقعي.");
      return;
    }
    if (isTaxi && !isLargeVehicle && !destinationCoords) {
      Alert.alert("حدد الوجهة", "اختر الوجهة من الخريطة قبل طلب السيارة.");
      return;
    }
    if (!pickup.trim() || (isTaxi && !isLargeVehicle && !destination.trim())) {
      Alert.alert("بيانات ناقصة", "أكمل وصف الموقع والوجهة.");
      return;
    }

    const proposedPrice = customerPrice.trim() ? Number(customerPrice.replace(/[^0-9]/g, "")) : null;
    if (isLargeVehicle && customerPrice.trim() && (proposedPrice === null || !Number.isSafeInteger(proposedPrice) || proposedPrice < 250 || proposedPrice % 250 !== 0)) {
      Alert.alert("السعر غير صحيح", "السعر المقترح يجب أن يكون 250 ديناراً أو أكثر ومن مضاعفات 250.");
      return;
    }
    if (!isTaxi && pricingMode !== "negotiable" && (proposedPrice === null || !Number.isSafeInteger(proposedPrice) || proposedPrice < 250 || proposedPrice % 250 !== 0)) {
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
      let requestId: string;
      if (isTaxi && isLargeVehicle) {
        const { data: largeRequest, error: largeError } = await supabase
          .from("service_requests")
          .insert({
            customer_id: user.id,
            type: "taxi",
            status: "pending",
            vehicle_category: "large",
            vehicle_type: vehicleType,
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
            notes: `نوع السيارة: ${vehicleType === "kia_cargo" ? "كيا حمل" : vehicleType === "kia_passenger" ? "كيا ركاب" : "باص"}${notes.trim() ? ` | ${notes.trim()}` : ""}`,
          } as any)
          .select("id")
          .single();
        if (largeError || !largeRequest) throw largeError ?? new Error("تعذّر إنشاء طلب السيارة الكبيرة.");
        requestId = largeRequest.id;
        // The database trigger starts the nearby large-driver offer flow.
      } else if (isTaxi) {
        const taxiRequest = await callMamnoonMapsApi<{ requestId: string }>({
          action: "createTaxiRequest",
          from: { lat: pickupCoords.latitude, lng: pickupCoords.longitude },
          to: { lat: destinationCoords!.latitude, lng: destinationCoords!.longitude },
          pickupText: pickup,
          destinationText: destination,
          pickupGovernorateKey: pickupGovernorateKey ?? undefined,
          destinationGovernorateKey: destinationGovernorateKey ?? undefined,
          vehicleCategory: vehicleCat,
          notes,
        });
        if (!taxiRequest.requestId) throw new Error("تعذّر إنشاء طلب التكسي.");
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
            type: "service",
            status: "pending",
            service_id: serviceRow.id,
            pickup_text: pickup,
            pickup_lat: pickupCoords.latitude,
            pickup_lng: pickupCoords.longitude,
            dest_text: destination || null,
            dest_lat: destinationCoords?.latitude ?? null,
            dest_lng: destinationCoords?.longitude ?? null,
            level_required: workerLevel,
            workers_count: extraWorkers + 1,
            pricing_mode: pricingMode,
            customer_price: pricingMode === "negotiable" ? null : proposedPrice,
            work_hours: pricingMode === "hourly" ? hours : null,
            work_description: workDescription.trim() || null,
            notes: notes || null,
          })
          .select("id")
          .single();
        if (error || !request) throw error ?? new Error("تعذّر إنشاء طلب الخدمة.");
        requestId = request.id;
      }

      router.replace({ pathname: "/request/[id]", params: { id: requestId } });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "حدث خطأ غير متوقع";
      Alert.alert("تعذر إرسال الطلب", message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>{vehicle === "large" ? "طلب سيارة كبيرة" : "طلب جديد"}</Text>
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
      {vehicle !== "large" && (
        <>
          <Text style={styles.label}>نوع الخدمة</Text>
          {servicesLoading && <ActivityIndicator style={{ marginVertical: 12 }} color={palette.brand} />}
          {!!servicesError && <TouchableOpacity onPress={() => router.replace("/request/new" as never)}><Text style={{ color: palette.danger, marginBottom: 10 }}>{servicesError} اضغط لإعادة المحاولة.</Text></TouchableOpacity>}
          <View style={styles.serviceGrid}>
            {[TAXI_SERVICE, ...serviceCatalog.map((service) => ({ ...service, label: service.name_ar, emoji: "", color: "#0f766e" }))].map((service) => (
              <TouchableOpacity
                key={service.slug}
                style={[
                  styles.serviceTile,
                  selectedService === service.slug && {
                    backgroundColor: service.color + "20",
                    borderColor: service.color,
                  },
                ]}
                onPress={() => setSelectedService(service.slug)}
              >
                {service.slug === "taxi" ? <Text style={styles.serviceEmoji}>{service.emoji}</Text> : <Image source={getServiceImage(service.slug)} style={styles.serviceImage} resizeMode="contain" />}
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
            <Text style={styles.locateButtonText}>موقعي</Text>
          )}
        </TouchableOpacity>
      </View>

      <Text style={styles.label}>المحافظة</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.governorateRow}>
        {IRAQ_GOVERNORATES.map((governorate) => (
          <TouchableOpacity
            key={governorate.key}
            style={[styles.governorateChip, activeGovernorateKey === governorate.key && styles.governorateChipActive]}
            onPress={() => chooseGovernorate(governorate.key)}
          >
            <Text style={[styles.governorateChipText, activeGovernorateKey === governorate.key && styles.governorateChipTextActive]}>
              {activeGovernorateKey === governorate.key ? "✓ " : ""}{governorate.name}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <TextInput
        ref={placeSearchInputRef}
        style={styles.input}
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
          style={styles.map}
          provider={PROVIDER_GOOGLE}
          region={region}
          onRegionChangeComplete={setRegion}
          onPress={(event) => chooseMapPoint(event.nativeEvent.coordinate)}
          showsUserLocation
          showsMyLocationButton={false}
          loadingEnabled
        >
          {pickupCoords && (
            <Marker coordinate={pickupCoords} title="نقطة الانطلاق" pinColor={palette.brand} />
          )}
          {destinationCoords && isTaxi && (
            <Marker coordinate={destinationCoords} title="الوجهة" pinColor={palette.success} />
          )}
        </MapView>
        <Text style={styles.mapHint}>
          {mapMode === "pickup"
            ? "اضغط على الخريطة لتحديد الانطلاق"
            : "اضغط على الخريطة لتحديد الوجهة"}
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
            <TouchableOpacity
              style={[styles.catChip, workerLevel === "khabir" && styles.catChipActive]}
              onPress={() => setWorkerLevel("khabir")}
            >
              <Text style={[styles.catLabel, workerLevel === "khabir" && styles.catLabelActive]}>
                خبير
              </Text>
            </TouchableOpacity>
          </View>
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
          <Text style={styles.label}>وصف العمل المطلوب</Text>
          <TextInput
            style={[styles.input, { height: 90 }]}
            value={workDescription}
            onChangeText={setWorkDescription}
            placeholder="مثلاً: بناء جدار بطول 5 أمتار وارتفاع 3 أمتار..."
            placeholderTextColor="#94a3b8"
            multiline
          />
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
              <Text style={styles.label}>{pricingMode === "hourly" ? "الأجر لكل ساعة بالدينار" : "الأجر المقترح بالدينار"}</Text>
              <TextInput
                style={styles.input}
                value={customerPrice}
                onChangeText={(value) => setCustomerPrice(value.replace(/[^0-9]/g, ""))}
                placeholder="مثلاً 25000"
                placeholderTextColor="#94a3b8"
                keyboardType="numeric"
              />
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
      {routeKm !== null && isTaxi && !isLargeVehicle && (
        <View style={styles.priceBox}>
          <Text style={styles.priceLabel}>مسافة الطريق الفعلية</Text>
          <Text style={styles.priceValue}>{routeKm.toFixed(1)} كم</Text>
          <Text style={styles.priceNote}>الوقت التقريبي: {Math.max(1, Math.round(routeDurationMin ?? 1))} دقيقة. الأجرة النهائية يحسبها الخادم.</Text>
        </View>
      )}
      <View style={{ height: 24 }} />
      <Button title="إرسال الطلب" onPress={submit} loading={busy} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.canvas, paddingHorizontal: 18, paddingTop: 52 },
  title: { fontSize: 27, fontWeight: "900", color: palette.ink, marginBottom: 20 },
  label: { fontSize: 13, fontWeight: "900", color: palette.ink, marginBottom: 8, marginTop: 16 },
  serviceGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  serviceTile: { width: "31%", aspectRatio: 1, borderRadius: radius.md, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, alignItems: "center", justifyContent: "center" },
  serviceEmoji: { fontSize: 30, marginBottom: 4 },
  serviceImage: { width: 58, height: 58, marginBottom: 4 },
  serviceLabel: { fontSize: 12, fontWeight: "800", color: palette.ink },
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
  mapHint: { position: "absolute", bottom: 10, alignSelf: "center", backgroundColor: palette.brandDeep, color: palette.white, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, fontSize: 11, overflow: "hidden" },
  input: { minHeight: 54, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, paddingHorizontal: 16, paddingVertical: 14, fontSize: 14, fontWeight: "600", color: palette.ink, backgroundColor: palette.surface, textAlign: "right" },
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
  priceBox: { backgroundColor: palette.brandSoft, borderRadius: radius.lg, padding: 18, alignItems: "center", marginTop: 20, borderWidth: 1, borderColor: palette.line },
  priceLabel: { fontSize: 13, color: palette.muted, fontWeight: "700" },
  priceValue: { fontSize: 25, fontWeight: "900", color: palette.brand, marginTop: 4 },
  priceNote: { fontSize: 11, color: palette.muted, marginTop: 6, textAlign: "center" },
});
