import { createFileRoute, useNavigate, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useGoBack } from "@/components/back-button";
import luxuryCar from "@/assets/car-luxury.png";
import { serviceIcon } from "@/lib/service-visuals";
import technicianIcon from "@/assets/service-technician.png";
import expertIcon from "@/assets/service-expert.png";
import { GOVERNORATES, GOV_STORAGE_KEY, getGovernorate, governorateOf, isInGovernorate } from "@/lib/governorates";
import { Button } from "@/components/ui/button";
import { z } from "zod";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/lib/toast";
import { arabicWarning } from "@/lib/arabic-errors";
import {
  Loader as Loader2,
  ArrowLeft,
  ArrowRight,
  MapPin,
  CircleCheck as CheckCircle2,
  User,
  Users,
  Compass,
  ChevronUp,
  ChevronDown,
  ImagePlus,
  X,
} from "lucide-react";
import { MapPicker } from "@/components/map-picker";
import { dispatchRequest } from "@/lib/dispatch.functions";
import { useNearbyProviders } from "@/lib/use-nearby-providers";
import { lookupMapPlace } from "@/lib/maps.functions";
import {
  taxiFare,
  calculateFareBreakdown,
  FARE_TABLE,
  WEATHER_RATES,
  ROAD_RATES,
  type VehicleCategory,
  type WeatherCondition,
  type RoadCondition,
} from "@/lib/taxi-fares";
import { detectWeatherCondition, seasonalWeatherFallback } from "@/lib/weather";

const search = z.object({ type: z.enum(["taxi", "service"]).default("taxi"), vehicle: z.enum(["large"]).optional() });

export const Route = createFileRoute("/request/new")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "طلب جديد | ممنون" },
      { name: "description", content: "حدد موقعك ووجهتك لطلب سيارة أو خدمة بسهولة وسرعة." },
      { property: "og:title", content: "طلب جديد | ممنون" },
      { property: "og:description", content: "حدد موقعك ووجهتك لطلب سيارة أو خدمة بسهولة وسرعة." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: search,
  component: NewRequest,
});

type FavoritePlace = { id: string; label: string; address: string; latitude: number; longitude: number; governorate_key: string | null };

type Service = { id: string; slug: string; name_ar: string };

const EXPERT_ONLY_SERVICE_SLUGS = new Set([
  "build", "plaster", "carpentry_form", "flooring", "chef", "plumbing", "electric_setup", "electric_street",
]);

const VEHICLE_CATS: {
  key: VehicleCategory;
  label: string;
  emoji: string;
  gradient: string;
  eta: string;
  desc: string;
  img?: string;
}[] = [
  {
    key: "economy",
    label: "ممنون اقتصادي",
    emoji: "🚗",
    gradient: "from-emerald-400 to-teal-500",
    eta: "3-5 د",
    desc: "توفير وسرعة في الوصول",
  },
  {
    key: "premium",
    label: "ممنون المتميز",
    emoji: "🚙",
    gradient: "from-sky-500 to-indigo-600",
    eta: "4-6 د",
    desc: "سيارة واسعة ومكيفة بالكامل",
  },
  {
    key: "luxury",
    label: "ممنون فاخر",
    emoji: "🏎️",
    gradient: "from-amber-400 to-orange-500",
    eta: "5-8 د",
    desc: "أحدث الموديلات وراحة استثنائية",
    img: luxuryCar,
  },
  {
    key: "large",
    label: "سيارة كبيرة",
    emoji: "🚚",
    gradient: "from-orange-500 to-amber-600",
    eta: "حسب المسار",
    desc: "كيا حمل أو كيا ركاب",
  },
];

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function NewRequest() {
  const { type, vehicle } = Route.useSearch();
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const runDispatch = useServerFn(dispatchRequest);

  // Common & Service State
  const [services, setServices] = useState<Service[]>([]);
  const [servicesLoadError, setServicesLoadError] = useState<string | null>(null);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [serviceDetailsStep, setServiceDetailsStep] = useState(false);
  const [level, setLevel] = useState<"fani" | "khabir">("fani");
  const [khabirMode, setKhabirMode] = useState<"alone" | "with_workers">("alone");
  const [workersCount, setWorkersCount] = useState(1);
  const [pricingMode, setPricingMode] = useState<"fixed" | "hourly" | "negotiable">("fixed");
  const [customerPrice, setCustomerPrice] = useState("");
  const [workHours, setWorkHours] = useState("");
  const [workDescription, setWorkDescription] = useState("");
  const [brickQuantity, setBrickQuantity] = useState("");
  const [cargoLoadDescription, setCargoLoadDescription] = useState("");
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [attachmentPreview, setAttachmentPreview] = useState<string | null>(null);

  useEffect(() => () => {
    if (attachmentPreview) URL.revokeObjectURL(attachmentPreview);
  }, [attachmentPreview]);
  const [couponCode, setCouponCode] = useState("");
  const [couponPreview, setCouponPreview] = useState<{ discount: number; payable: number } | null>(null);
  const [couponError, setCouponError] = useState("");
  const [couponLoading, setCouponLoading] = useState(false);

  // Taxi State
  const [vehicleCategory, setVehicleCategory] = useState<VehicleCategory>(vehicle === "large" ? "large" : "economy");
  const [uiVisuals, setUiVisuals] = useState<Record<string, any>>({});
  const [urgencyEnabled, setUrgencyEnabled] = useState(false);
  const [urgencyAllowed, setUrgencyAllowed] = useState(false);
  const [vehicleType, setVehicleType] = useState<"kia_cargo" | "kia_passenger" | "bus">("kia_cargo");
  const [weatherCondition, setWeatherCondition] = useState<WeatherCondition>(() =>
    seasonalWeatherFallback(),
  );
  const [roadCondition, setRoadCondition] = useState<RoadCondition>("normal");
  const [tripOptionsExpanded, setTripOptionsExpanded] = useState(false);
  const [tripType, setTripType] = useState<"one_way" | "round_trip" | "second_trip" | "stop">("one_way");
  const [extraMinutes, setExtraMinutes] = useState(0);
  const [drawerExpanded, setDrawerExpanded] = useState(true);
  const [showFareDetails, setShowFareDetails] = useState(false);

  // Coordinates
  const [pickupCoords, setPickupCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [pickupLabel, setPickupLabel] = useState("");
  const [destCoords, setDestCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [destLabel, setDestLabel] = useState("");
  const [mapStep, setMapStep] = useState<"pickup" | "dest">("pickup");
  const [favoritePlaces, setFavoritePlaces] = useState<FavoritePlace[]>([]);
  const [favoritePlacesLoading, setFavoritePlacesLoading] = useState(false);
  const [favoriteName, setFavoriteName] = useState("");
  const [showFavoriteNameInput, setShowFavoriteNameInput] = useState(false);
  const [destConfirmed, setDestConfirmed] = useState(false);
  const goBack = useGoBack();
  const [govKey, setGovKey] = useState<string | null>(null);
  const [govReady, setGovReady] = useState(false);
  const [govPickerOpen, setGovPickerOpen] = useState(false);
  useEffect(() => {
    let active = true;
    if (!session?.user?.id) { setFavoritePlaces([]); return; }
    setFavoritePlacesLoading(true);
    (supabase as any).from("customer_favorite_places")
      .select("id,label,address,latitude,longitude,governorate_key")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .then(({ data, error }: any) => {
        if (!active) return;
        if (!error) setFavoritePlaces((data ?? []) as FavoritePlace[]);
        setFavoritePlacesLoading(false);
      });
    return () => { active = false; };
  }, [session?.user?.id]);

  async function saveFavoritePlace() {
    const label = favoriteName.trim();
    if (!session?.user?.id || !destCoords || !label) { toast.error("اكتب اسماً للمكان وحدد الوجهة أولاً."); return; }
    const row = { user_id: session.user.id, label, address: destLabel || label, latitude: destCoords.lat, longitude: destCoords.lng, governorate_key: destinationGovernorateKey ?? gov?.key ?? null };
    const { data, error } = await (supabase as any).from("customer_favorite_places").insert(row).select("id,label,address,latitude,longitude,governorate_key").single();
    if (error) { toast.error(error.code === "23505" ? "عندك مكان محفوظ بنفس الاسم." : "تعذّر حفظ المكان."); return; }
    setFavoritePlaces((items) => [data as FavoritePlace, ...items]);
    setFavoriteName(""); setShowFavoriteNameInput(false);
    toast.message("انحفظ المكان ضمن المفضلة.");
  }

  function chooseFavoritePlace(place: FavoritePlace) {
    const coords = { lat: Number(place.latitude), lng: Number(place.longitude) };
    const outside = !!gov && !!place.governorate_key && place.governorate_key !== gov.key;
    setInterCity(outside);
    setDestinationGovernorateKey(place.governorate_key ?? gov?.key ?? null);
    setDestCoords(coords); setDestLabel(place.address || place.label);
    setMapStep("dest"); setDestConfirmed(true); setRouteError(null);
    setShowFavoriteNameInput(false);
  }

  async function deleteFavoritePlace(id: string) {
    const { error } = await (supabase as any).from("customer_favorite_places").delete().eq("id", id);
    if (error) { toast.error("تعذّر حذف المكان."); return; }
    setFavoritePlaces((items) => items.filter((item) => item.id !== id));
  }
  const [destinationGovernorateKey, setDestinationGovernorateKey] = useState<string | null>(null);
  const [interCity, setInterCity] = useState(false);
  useEffect(() => { setUrgencyEnabled(false); setUrgencyAllowed(false); }, [type, vehicle]);
  useEffect(() => {
    let active = true;
    (supabase as any).from("app_ui_elements_public").select("element_key,published_config,title,subtitle,sort_order")
      .then(({ data, error }: any) => {
        if (!active || error) return;
        const next: Record<string, any> = {};
        for (const item of data ?? []) next[item.element_key] = { ...(item.published_config ?? {}), title: item.title, subtitle: item.subtitle, sort_order: item.sort_order };
        setUiVisuals(next);
      });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const restoreGovernorate = () => {
      const selected = getGovernorate(localStorage.getItem(GOV_STORAGE_KEY));
      setGovKey(selected?.key ?? null);
      if (selected) setPickupCoords({ lat: selected.lat, lng: selected.lng });
    };
    restoreGovernorate();
    setGovReady(true);
    window.addEventListener("storage", restoreGovernorate);
    return () => window.removeEventListener("storage", restoreGovernorate);
  }, []);
  const gov = getGovernorate(govKey);
  function chooseGov(key: string) {
    localStorage.setItem(GOV_STORAGE_KEY, key);
    setGovKey(key);
    setGovPickerOpen(false);
    setInterCity(false);
    setDestinationGovernorateKey(null);
    const g = getGovernorate(key);
    if (!g) return;
    setPickupCoords({ lat: g.lat, lng: g.lng });
    setPickupLabel(g.name);
    setMapStep("pickup");
    setDestConfirmed(false);
    setDestCoords(null);
    setDestLabel("");
    setRouteKm(null);
  }
  function confirmDest(c = destCoords) {
    if (!c) return;
    if (!gov) {
      toast.error("اختر محافظة الانطلاق أولاً.");
      return;
    }
    if (!interCity && !isInGovernorate(c, gov.key)) {
      setInterCity(true);
      setDestinationGovernorateKey(null);
      setDestConfirmed(false);
      toast.error(`أنت خارج محافظتك (${gov.name})، يرجى تحديد المحافظة المراد التوجه إليها.`);
      return;
    }
    if (interCity) {
      const target = getGovernorate(destinationGovernorateKey);
      if (!target) {
        setDestConfirmed(false);
        toast.error("أنت خارج محافظتك، يرجى تحديد المحافظة المراد التوجه إليها أولاً.");
        return;
      }
      if (!isInGovernorate(c, target.key)) {
        setDestConfirmed(false);
        toast.error(`الموقع المحدد خارج محافظة ${target.name}. حرّك الخريطة إلى داخلها.`);
        return;
      }
    }
    setDestConfirmed(true);
  }

  const [notes, setNotes] = useState("");
  const [routeKm, setRouteKm] = useState<number | null>(null);
  const [routeDurationMin, setRouteDurationMin] = useState<number | null>(null);
  const [serverTaxiFare, setServerTaxiFare] = useState<number | null>(null);
  const [serverTaxiFares, setServerTaxiFares] = useState<Partial<Record<"economy" | "premium" | "luxury", number>>>({});
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeRetry, setRouteRetry] = useState(0);
  const runLookup = useServerFn(lookupMapPlace);
  const [busy, setBusy] = useState(false);
  const [activeRequestPreview, setActiveRequestPreview] = useState<any>(null);
  const [activeRequestChoice, setActiveRequestChoice] = useState<"keep" | "cancel">("keep");
  const [activeRequestPromptVisible, setActiveRequestPromptVisible] = useState(false);
  const serviceWorkerCount = type === "service" ? (level === "khabir" ? (khabirMode === "alone" ? 1 : 1 + workersCount) : workersCount) : 1;
  const servicePriceMultiplier = serviceWorkerCount + (level === "khabir" ? 1 : 0);
  const serviceTotalPrice = Number(customerPrice || 0) * servicePriceMultiplier;
  const getCouponBaseAmount = () => {
    if (type === "taxi") {
      if (vehicle === "large") return customerPrice.trim() ? Number(customerPrice) : null;
      if (routeKm === null || serverTaxiFare === null) return null;
      return serverTaxiFare;
    }
    if (pricingMode === "negotiable") return null;
    const amount = Number(customerPrice);
    return Number.isFinite(amount) && amount > 0 ? amount : null;
  };

  function handleAttachmentFileChange(event: { currentTarget: HTMLInputElement }) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast.error("اختَر صورة بصيغة JPG أو PNG أو WebP");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error("حجم الصورة أكبر من 8 ميغابايت. اختَر صورة أصغر.");
      return;
    }
    setAttachmentFile(file);
    setAttachmentPreview(URL.createObjectURL(file));
  }

  function clearAttachment() {
    setAttachmentFile(null);
    setAttachmentPreview(null);
  }

  async function previewCoupon() {
    const code = couponCode.trim();
    const amount = getCouponBaseAmount();
    if (!code) { setCouponError("اكتب رمز الكوبون"); return; }
    if (!amount || amount <= 0) { setCouponError("حدد سعر الطلب أولاً حتى نتحقق من الخصم"); return; }
    setCouponLoading(true);
    setCouponError("");
    setCouponPreview(null);
    try {
      const { data, error } = await (supabase as any).rpc("preview_my_coupon", { p_code: code, p_amount: amount });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw new Error("الكوبون غير متاح");
      setCouponPreview({ discount: Number(row.discount), payable: Number(row.payable) });
    } catch (error: any) {
      setCouponError(error?.message || "تعذّر التحقق من الكوبون");
    } finally {
      setCouponLoading(false);
    }
  }

  useEffect(() => { setCouponPreview(null); setCouponError(""); }, [serverTaxiFare, urgencyEnabled]);

  const couponPanel = (
    <div className="rounded-2xl border border-amber-300/60 bg-amber-50/70 p-3 space-y-2" dir="rtl">
      <div className="font-black text-sm text-foreground">🎁 عندك كوبون خصم؟</div>
      <div className="flex gap-2">
        <input value={couponCode} onChange={(e) => { setCouponCode(e.target.value.toUpperCase()); setCouponPreview(null); setCouponError(""); }} placeholder="اكتب رمز الكوبون" className="min-w-0 flex-1 rounded-xl border border-amber-200 bg-white dark:bg-black dark:text-slate-100 dark:border-slate-700 px-3 py-2.5 text-sm font-bold outline-none" />
        <button type="button" disabled={couponLoading} onClick={previewCoupon} className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-black text-white disabled:opacity-50">{couponLoading ? "..." : "تحقق"}</button>
      </div>
      {couponError && <p className="text-xs font-bold text-red-600">{couponError}</p>}
      {couponPreview && <div className="rounded-xl bg-white dark:bg-black dark:text-slate-100 dark:border-slate-700 p-3 text-sm space-y-1">
        <div className="font-bold text-emerald-700">تم التحقق من الكوبون</div>
        <div>قيمة الخصم: <b>{couponPreview.discount.toLocaleString("ar-IQ")} د.ع</b></div>
        <div>المبلغ بعد الخصم: <b>{couponPreview.payable.toLocaleString("ar-IQ")} د.ع</b></div>
        <div className="text-[11px] text-muted-foreground">الخصم تتحمله ممنون ولا يقلل مستحقات السائق.</div>
      </div>}
    </div>
  );

  const requestAttachmentPanel = (type === "service" || vehicle === "large") ? (
    <div className="rounded-2xl border border-dashed border-primary/35 bg-card p-3 space-y-2" dir="rtl">
      <div className="text-sm font-black">صورة توضيحية للطلب <span className="text-xs font-medium text-muted-foreground">(اختياري)</span></div>
      <label className="flex items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 py-3 text-sm font-bold cursor-pointer btn-press">
        <ImagePlus className="h-5 w-5 text-primary" />
        <span>{attachmentFile ? "تغيير الصورة" : "اختيار صورة من الجهاز"}</span>
        <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={handleAttachmentFileChange} />
      </label>
      {attachmentPreview && (
        <div className="relative w-full max-w-xs">
          <img src={attachmentPreview} alt="معاينة الصورة المرفقة" className="w-full max-h-48 rounded-xl object-contain bg-background border border-border" />
          <button type="button" onClick={clearAttachment} aria-label="حذف الصورة" className="absolute top-2 left-2 h-8 w-8 rounded-full bg-black/70 text-white grid place-items-center">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">JPG أو PNG أو WebP، بحد أقصى 8 ميغابايت. الصورة تظهر ضمن تفاصيل الطلب للأطراف المصرّح لها.</p>
    </div>
  ) : null;

  const pickupLat = pickupCoords?.lat;
  const pickupLng = pickupCoords?.lng;
  const destLat = destCoords?.lat;
  const destLng = destCoords?.lng;

  // The server calculates route distance, ETA and fare.
  useEffect(() => {
    setRouteKm(null);
    setRouteDurationMin(null);
    setServerTaxiFare(null);
    setServerTaxiFares({});
    setRouteError(null);
    if (type !== "taxi" || vehicle === "large" || !destConfirmed || pickupLat == null || pickupLng == null || destLat == null || destLng == null) return;
    let stale = false;
    const t = setTimeout(async () => {
      try {
        const { data, error } = await supabase.functions.invoke("auto-taxi-pricing", {
          body: { action: "quote", from: { lat: pickupLat, lng: pickupLng }, to: { lat: destLat, lng: destLng }, vehicleCategory, tripType, extraMinutes, isIntercity: interCity, pickupGovernorateKey: govKey, destinationGovernorateKey: destinationGovernorateKey ?? govKey, urgencyEnabled },
        });
        if (error) throw error;
        if (stale) return;
        if (!Number.isFinite(data?.distanceKm) || data.distanceKm <= 0 || !Number.isFinite(data?.durationMin) || data.durationMin < 0 || !Number.isFinite(data?.priceEstimate)) throw new Error("تعذّر الحصول على تسعير موثوق من الخادم");
        setRouteKm(Number(data.distanceKm));
        setRouteDurationMin(Number(data.durationMin));
        setServerTaxiFare(Number(data.priceEstimate));
        setUrgencyAllowed(Boolean(data.urgencyAllowed));
        if (!data.urgencyAllowed) setUrgencyEnabled(false);
        setServerTaxiFares(data.categoryPrices && typeof data.categoryPrices === "object"
          ? data.categoryPrices
          : { [vehicleCategory]: Number(data.priceEstimate) });
      } catch (e) { if (!stale) setRouteError(arabicWarning(e)); }
    }, 350);
    return () => { stale = true; clearTimeout(t); };
  }, [type, destConfirmed, pickupLat, pickupLng, destLat, destLng, vehicle, vehicleCategory, tripType, extraMinutes, interCity, destinationGovernorateKey, govKey, urgencyEnabled, routeRetry]);

  useEffect(() => {
    if (pickupLat == null || pickupLng == null) return;
    const controller = new AbortController();
    detectWeatherCondition(pickupLat, pickupLng, controller.signal)
      .then(setWeatherCondition)
      .catch(() => {});
    return () => controller.abort();
  }, [pickupLat, pickupLng]);

  const nearby = useNearbyProviders({
    center: pickupCoords,
    type,
    category: type === "taxi" ? vehicleCategory : null,
    serviceId: type === "service" ? serviceId : null,
    radiusKm: type === "service" || vehicle === "large" ? 25 : 5,
    enabled: !!pickupCoords,
  });

  async function loadServiceCatalog() {
    setServicesLoading(true);
    setServicesLoadError(null);
    try {
      // Use the same authenticated catalog RPC as technician onboarding.
      const catalog = await supabase.rpc("get_worker_service_catalog");
      if (!catalog.error && Array.isArray(catalog.data) && catalog.data.length > 0) {
        setServices((catalog.data as Service[]).filter((service) => service.slug !== "taxi"));
        return;
      }

      // Backward-compatible fallback for deployments where the catalog RPC
      // has not yet been applied. Never silently turn a failed query into an
      // empty service picker.
      const fallback = await supabase
        .from("services")
        .select("id, slug, name_ar")
        .order("sort_order");
      if (fallback.error) throw fallback.error;
      const rows = (fallback.data ?? []) as Service[];
      setServices(rows.filter((service) => service.slug !== "taxi"));
      if (!rows.length) {
        throw new Error("قائمة الخدمات فارغة في قاعدة البيانات. يلزم تطبيق تحديث كتالوج الخدمات.");
      }
    } catch (error: unknown) {
      console.error("[service catalog] failed to load:", error);
      setServices([]);
      setServicesLoadError(
        error instanceof Error
          ? error.message
          : "تعذر تحميل الخدمات. تحقق من اتصال قاعدة البيانات ثم أعد المحاولة.",
      );
    } finally {
      setServicesLoading(false);
    }
  }

  useEffect(() => {
    if (type === "service") void loadServiceCatalog();
  }, [type]);

  if (loading) return null;
  if (!session) return <Navigate to="/auth" />;

  // Transition from Pickup to Destination step
  function advanceToDestination() {
    if (!pickupCoords) {
      toast.error("يرجى تحديد موقع الانطلاق أولاً");
      return;
    }
    if (gov && !isInGovernorate(pickupCoords, gov.key)) {
      toast.error(`موقع الانطلاق يجب أن يكون داخل ${gov.name}`);
      return;
    }
    if (vehicle === "large") {
      setDestConfirmed(true);
      return;
    }
    setMapStep("dest");
    setDestConfirmed(false);
    setInterCity(false);
    setDestinationGovernorateKey(gov?.key ?? governorateOf(pickupCoords).key);
    setDestCoords(pickupCoords);
    setDestLabel(pickupLabel || gov?.name || "موقع الانطلاق");
  }

  // Submit Request
  async function submit(skipActiveRequestPrompt = false) {
    if (!session) return;
    if (!pickupCoords) {
      toast.error("يرجى تحديد موقع الانطلاق");
      return;
    }
    if (type === "taxi" && vehicle !== "large" && !destCoords) {
      toast.error("يرجى تحديد موقع الوجهة على الخريطة لحساب المسافة بدقة");
      return;
    }
    if (type === "taxi" && vehicle !== "large" && interCity && !destinationGovernorateKey) {
      toast.error("أنت خارج محافظتك، يرجى تحديد المحافظة المراد التوجه إليها.");
      return;
    }
    if (type === "taxi" && vehicle !== "large" && (!destConfirmed || routeKm === null || routeError)) {
      toast.error("انتظر حساب السعر من مسافة الطريق قبل الطلب");
      return;
    }
    if (type === "service" && !serviceId) {
      toast.error("اختر الخدمة");
      return;
    }

    const finalWorkers =
      type === "service" && level === "khabir"
        ? khabirMode === "alone"
          ? 1
          : 1 + workersCount
        : workersCount;

    let verifiedRouteKm = routeKm;
    let priceEstimate: number | null = null;

    const unitPriceNum = parseInt(customerPrice.replace(/[^0-9]/g, ""), 10);
    const priceNum = type === "service" && Number.isFinite(unitPriceNum) ? unitPriceNum * (finalWorkers + (level === "khabir" ? 1 : 0)) : unitPriceNum;
    if (vehicle === "large" && customerPrice.trim() && (!Number.isSafeInteger(priceNum) || priceNum < 250 || priceNum > 50000 || priceNum % 250 !== 0)) {
      toast.error("السعر المقترح يجب أن يكون من 250 إلى 50000 دينار ومن مضاعفات 250");
      return;
    }
    if (type === "service" && pricingMode !== "negotiable" && !(unitPriceNum > 0)) {
      toast.error("اكتب المبلغ اللي تريد تدفعه");
      return;
    }
    if (type === "service" && pricingMode !== "negotiable" && unitPriceNum % 250 !== 0) {
      toast.error("المبلغ لازم يكون من مضاعفات 250 دينار");
      return;
    }

    setBusy(true);
    try {
      if (!skipActiveRequestPrompt) {
        const { data: previousRequest, error: previousRequestError } = await (supabase as any)
          .from("service_requests")
          .select("id,type,status,provider_arrived_at,vehicle_category,vehicle_type,service_id")
          .eq("customer_id", session.user.id)
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
          setBusy(false);
          return;
        }
      }
      if (type === "taxi" && vehicle !== "large") {
        if (routeKm === null || routeDurationMin === null || serverTaxiFare === null) throw new Error("لم يصل تسعير موثوق من الخادم. أعد تحديد الوجهة وحاول مرة ثانية.");
        verifiedRouteKm = routeKm;
        priceEstimate = serverTaxiFare;
      }
      if (type === "taxi" && vehicle !== "large" && couponCode.trim()) {
        const amount = priceEstimate;
        if (!amount || amount <= 0) throw new Error("حدد سعر الطلب أولاً حتى نطبق الكوبون");
        const { data: couponData, error: couponCheckError } = await (supabase as any).rpc("preview_my_coupon", {
          p_code: couponCode.trim(),
          p_amount: amount,
        });
        if (couponCheckError) throw couponCheckError;
        if (!couponData || !couponData.length) throw new Error("الكوبون غير متاح لهذا الطلب");
      }
      let data: any;
      let error: any;
      if (type === "taxi" && vehicle !== "large") {
        const { data: secureTaxi, error: secureTaxiError } = await supabase.functions.invoke("auto-taxi-pricing", {
          body: { action: "create", from: { lat: pickupCoords!.lat, lng: pickupCoords!.lng }, to: { lat: destCoords!.lat, lng: destCoords!.lng }, vehicleCategory, tripType, extraMinutes, isIntercity: interCity, destinationGovernorateKey: destinationGovernorateKey ?? govKey, urgencyEnabled: false, couponCode: couponCode.trim() || undefined, pickupText: pickupLabel, destinationText: destLabel, governorateKey: govKey ?? governorateOf(pickupCoords!).key, notes },
        });
        if (secureTaxiError) throw secureTaxiError;
        if (!secureTaxi?.requestId) throw new Error(secureTaxi?.error || "تعذّر إنشاء طلب التاكسي.");
        data = { id: secureTaxi.requestId, coupon_discount: secureTaxi.couponDiscount ?? 0, customer_payable: secureTaxi.customerPayable };
      } else {
      const inserted = await supabase
        .from("service_requests")
        .insert({
          customer_id: session.user.id,
          governorate_key: govKey ?? (pickupCoords ? governorateOf(pickupCoords).key : null),
          coupon_code: type === "taxi" && vehicle !== "large" ? couponCode.trim() || null : null,
          type,
          status: "pending",
          service_id: type === "service" ? serviceId : null,
          level_required: type === "service" ? level : null,
          workers_count: finalWorkers,
          vehicle_category: type === "taxi" ? vehicleCategory : null,
          vehicle_type: type === "taxi" && vehicleCategory === "large" ? vehicleType : null,
          price_estimate: vehicle === "large" ? null : priceEstimate,
          ...(vehicle === "large" ? { pricing_mode: customerPrice.trim() ? "fixed" : "negotiable", customer_price: customerPrice.trim() ? priceNum : null, large_vehicle_urgency_enabled: urgencyEnabled } : {}),
          service_urgency_enabled: type === "service" ? urgencyEnabled : false,
          pickup_text: pickupLabel || "موقع محدد على الخريطة",
          pickup_lat: pickupCoords?.lat ?? null,
          pickup_lng: pickupCoords?.lng ?? null,
          dest_text: destLabel || null,
          dest_lat: destCoords?.lat ?? null,
          dest_lng: destCoords?.lng ?? null,
          notes: [
            notes.trim(),
            vehicle === "large" && vehicleType === "kia_cargo" && cargoLoadDescription.trim()
              ? `تفاصيل الحمولة: ${cargoLoadDescription.trim()}`
              : "",
          ].filter(Boolean).join("\n") || null,
          distance_km: type === "taxi" ? verifiedRouteKm : null,
          is_intercity: type === "taxi" ? interCity : false,
          trip_type: type === "taxi" ? tripType : "one_way",
          extra_minutes: type === "taxi" ? extraMinutes : 0,
          ...(type === "service"
            ? {
                pricing_mode: pricingMode,
                customer_price: pricingMode === "negotiable" ? null : priceNum,
                work_hours: pricingMode === "hourly" && workHours ? Number(workHours) : null,
                work_description: [
                  workDescription.trim(),
                  selectedService?.slug === "build" && brickQuantity.trim()
                    ? `كمية الطابوق: ${brickQuantity.trim()}`
                    : "",
                ].filter(Boolean).join("\n") || null,
              }
            : {}),
        } as any)
        .select("id,coupon_discount,customer_payable")
        .single();
      data = inserted.data;
      error = inserted.error;


      }
      if (error) throw error;
      if (attachmentFile) {
        const extension = attachmentFile.type === "image/png" ? "png" : attachmentFile.type === "image/webp" ? "webp" : "jpg";
        const attachmentPath = `${data.id}/${session.user.id}/${Date.now()}.${extension}`;
        const { error: uploadError } = await supabase.storage
          .from("request-attachments")
          .upload(attachmentPath, attachmentFile, {
            contentType: attachmentFile.type,
            cacheControl: "3600",
            upsert: false,
          });
        if (uploadError) {
          console.error("[request attachment] upload failed:", uploadError);
          toast.error("تم إرسال الطلب، لكن تعذّر رفع الصورة. تگدر تكمل الطلب بدونها.");
        } else {
          const { data: linkedRequest, error: pathError } = await (supabase as any)
            .from("service_requests")
            .update({ attachment_path: attachmentPath })
            .eq("id", data.id)
            .eq("customer_id", session.user.id)
            .select("id")
            .maybeSingle();
          if (pathError || !linkedRequest) {
            await supabase.storage.from("request-attachments").remove([attachmentPath]);
            console.error("[request attachment] path save failed:", pathError ?? "request row was not updated");
            toast.error("تم إرسال الطلب، لكن تعذّر إرفاق الصورة به.");
          }
        }
      }
      toast.success(data.coupon_discount > 0
        ? `تم إرسال الطلب وتطبيق خصم ${Number(data.coupon_discount).toLocaleString("ar-IQ")} د.ع`
        : "تم إرسال الطلب بنجاح!");
      if (type === "taxi" && vehicle !== "large") {
        runDispatch({ data: { requestId: data.id } }).catch((e) => console.warn("[dispatch]", e));
        try {
          if (typeof BroadcastChannel !== "undefined") {
            const bc = new BroadcastChannel("mumnun-offers");
            bc.postMessage({ type: "NEW_TAXI_REQUEST", requestId: data.id });
            setTimeout(() => bc.close(), 1000);
          }
        } catch {}
      }
      setUrgencyEnabled(false);
      navigate({ to: "/request/$id", params: { id: data.id } });
    } catch (e: any) {
      toast.error(e.message ?? "تعذّر إرسال الطلب");
    } finally {
      setBusy(false);
    }
  }

  async function confirmActiveRequestChoice() {
    if (!activeRequestPreview) return;
    setActiveRequestPromptVisible(false);
    if (activeRequestChoice === "cancel") {
      if (activeRequestPreview.provider_arrived_at || activeRequestPreview.status === "in_progress") {
        toast.error("وصل مقدم الخدمة أو بدأ التنفيذ، لذلك لا يمكن إلغاء الطلب السابق.");
        return;
      }
      setBusy(true);
      try {
        const { error } = await (supabase as any).rpc("cancel_service_request", {
          _request_id: activeRequestPreview.id,
          _reason: "ألغى الزبون الطلب لفتح طلب جديد",
        });
        if (error) throw error;
      } catch (error: any) {
        toast.error(error?.message ?? "تعذر إلغاء الطلب السابق. لم يتم إرسال الطلب الجديد.");
        setBusy(false);
        return;
      }
    }
    setActiveRequestPreview(null);
    await submit(true);
  }

  function activeRequestConfirmation() {
    if (!activeRequestPreview) return null;
    const canCancel = !activeRequestPreview.provider_arrived_at && activeRequestPreview.status !== "in_progress";
    const statusLabel = activeRequestPreview.status === "pending" || activeRequestPreview.status === "searching"
      ? "قيد البحث عن سائق أو فني"
      : activeRequestPreview.status === "accepted" ? "تم قبول الطلب" : "قيد التنفيذ";
    const imageSlug = activeRequestPreview.type === "service"
      ? activeRequestPreview.serviceSlug || "general"
      : activeRequestPreview.vehicle_category === "large"
        ? activeRequestPreview.vehicle_type === "kia_cargo" ? "goods_transport" : activeRequestPreview.vehicle_type === "bus" ? "bus" : "kia_driver"
        : "kia_driver";
    return (
      <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm grid place-items-center p-5" dir="rtl" role="dialog" aria-modal="true" aria-labelledby="active-request-title">
        <div className="w-full max-w-md rounded-3xl border border-amber-400/70 bg-background p-5 shadow-2xl space-y-4">
          <h2 id="active-request-title" className="text-lg font-black text-right">عندك طلب سابق نشط</h2>
          <div className="flex items-center gap-3">
            <img src={serviceIcon(imageSlug)} alt="" className="w-24 h-20 rounded-xl object-cover bg-muted" />
            <div className="min-w-0 flex-1 text-right space-y-1">
              <div className="font-black">{activeRequestPreview.serviceName || (activeRequestPreview.type === "taxi" ? activeRequestPreview.vehicle_category === "large" ? "سيارة كبيرة" : "طلب تكسي" : "طلب خدمة")}</div>
              <div className="text-xs text-muted-foreground">رمز الطلب: {String(activeRequestPreview.id).slice(0,8).toUpperCase()}</div>
              <div className="text-sm font-black text-primary">{statusLabel}</div>
            </div>
          </div>
          <button type="button" onClick={() => setActiveRequestChoice("keep")} className={`w-full rounded-xl border p-3 text-right font-bold ${activeRequestChoice === "keep" ? "border-primary bg-primary/10" : "border-border"}`}>
            {activeRequestChoice === "keep" ? "● " : "○ "}الاحتفاظ بالطلب السابق وإرسال طلب جديد
          </button>
          <button type="button" disabled={!canCancel} onClick={() => setActiveRequestChoice("cancel")} className={`w-full rounded-xl border p-3 text-right font-bold disabled:opacity-40 ${activeRequestChoice === "cancel" ? "border-destructive bg-destructive/10" : "border-border"}`}>
            {activeRequestChoice === "cancel" ? "● " : "○ "}إلغاء الطلب السابق وإرسال طلب جديد
            {!canCancel && <span className="block mt-1 text-xs text-destructive">لا يمكن الإلغاء بعد وصول مقدم الخدمة أو بدء التنفيذ</span>}
          </button>
          <p className="text-xs text-muted-foreground text-right">لن يتغير أي طلب قبل الضغط على «تأكيد الاختيار»</p>
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => setActiveRequestPromptVisible(false)} className="flex-1 rounded-xl border border-border py-3 font-bold">رجوع</button>
            <button type="button" disabled={busy || (activeRequestChoice === "cancel" && !canCancel)} onClick={() => void confirmActiveRequestChoice()} className="flex-1 rounded-xl bg-primary py-3 font-black text-primary-foreground disabled:opacity-50">{busy ? "جارٍ التنفيذ..." : "تأكيد الاختيار"}</button>
          </div>
        </div>
      </div>
    );
  }

  // Active calculated taxi fare
  const activeFare = serverTaxiFare ?? FARE_TABLE[vehicleCategory].minimum;

  const estimatedEtaMinutes = routeDurationMin !== null ? Math.max(1, Math.round(routeDurationMin)) : 5;

  if (type === "service" && !serviceDetailsStep) {
    return (
      <div className="min-h-screen px-5 pt-10 pb-12" dir="rtl">
        <button onClick={goBack} className="text-sm text-muted-foreground mb-4">رجوع</button>
        <h1 className="text-2xl font-black">الفنيون والخدمات</h1>
        <p className="mt-2 text-sm text-muted-foreground">اختَر اختصاص الفني حتى نعرض لك تفاصيل الطلب بالخطوة التالية.</p>
        {servicesLoading && <div className="mt-5 rounded-2xl bg-card p-4 text-center text-sm text-muted-foreground">جارٍ تحميل قائمة الفنيين...</div>}
        {servicesLoadError && <div className="mt-4 rounded-2xl border border-destructive/30 p-4 text-sm text-destructive">{servicesLoadError}<button onClick={() => void loadServiceCatalog()} className="block mt-3 font-bold">إعادة المحاولة</button></div>}
        <div className="mt-5 grid grid-cols-3 gap-3">
          {services.map((s) => (
            <button key={s.id} type="button" onClick={() => { setServiceId(s.id); if (!EXPERT_ONLY_SERVICE_SLUGS.has(s.slug)) setLevel("fani"); setServiceDetailsStep(true); }}
              className="min-h-44 rounded-2xl bg-card p-1 flex flex-col items-center justify-center gap-0 border border-border shadow-sm overflow-hidden">
              <img src={serviceIcon(s.slug)} alt="" className="mx-auto h-40 w-[92%] rounded-xl object-cover block" />
              <span className="px-2 py-2 text-sm font-black text-center">{s.name_ar}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  /* =========================================================================
     1. TAXI VIEW: FULL-SCREEN INTERACTIVE MAP WITH AUTO TRANSITION & REAL PRICING
     ========================================================================= */
  if (type === "taxi") {
    const currentBreakdown = calculateFareBreakdown(vehicleCategory, routeKm ?? 0, {
      weather: "mild" as const,
      roadCondition,
      demandMultiplier: 1,
      isIntercity: interCity,
      tripType,
      extraMinutes,
    });

    return (
      <div className="fixed inset-0 overflow-hidden flex flex-col bg-slate-900 select-none">
      {activeRequestConfirmation()}
        {govReady && (!gov || govPickerOpen) && (
          <div
            className="absolute inset-0 z-50 backdrop-blur p-5 overflow-y-auto"
            style={{ backgroundColor: "#0b1220", color: "#f8fafc" }}
            dir="rtl"
          >
            <h2 className="text-xl font-black mb-1" style={{ color: "#ffffff" }}>اختر محافظتك</h2>
            <p className="text-sm mb-4" style={{ color: "#cbd5e1" }}>ستكون طلباتك داخل هذه المحافظة.</p>
            <div className="grid grid-cols-2 gap-2">
              {GOVERNORATES.map((g) => {
                const selected = g.key === govKey;
                return (
                  <button
                    key={g.key}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => chooseGov(g.key)}
                    className="min-h-12 py-3 px-2 rounded-2xl border font-extrabold text-sm btn-press transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                    style={{
                      backgroundColor: selected ? "#0e7490" : "#263449",
                      color: "#ffffff",
                      borderColor: selected ? "#67e8f9" : "#64748b",
                      boxShadow: selected ? "0 0 0 2px rgba(103,232,249,.28)" : "none",
                    }}
                  >
                    <span className="flex items-center justify-center gap-2">
                      {g.name}
                      {selected && <span aria-label="المحافظة محددة" className="text-cyan-200">✓</span>}
                    </span>
                  </button>
                );
              })}
            </div>
            {gov && (
              <button
                type="button"
                onClick={() => setGovPickerOpen(false)}
                className="mt-4 w-full py-3 text-sm text-muted-foreground"
              >
                إلغاء
              </button>
            )}
          </div>
        )}
        {/* Full-Screen Real Map Canvas (Locked full screen like Baly) */}
        <div className="absolute inset-0 z-0">
          {govReady && gov && (
            <MapPicker
              key={`${gov.key}-${mapStep}-${mapStep === "dest" ? destinationGovernorateKey ?? gov.key : gov.key}`}
              value={mapStep === "pickup" ? pickupCoords : destCoords}
              accent={mapStep === "pickup" ? "#0284c7" : "#e11d48"}
              nearby={mapStep === "pickup" ? nearby : undefined}
              nearbyKind="car"
              autoLocateOnMount={mapStep === "pickup"}
              governorateKey={mapStep === "pickup" ? gov?.key : destinationGovernorateKey ?? gov?.key}
              placeholder={
                mapStep === "pickup"
                  ? `ابحث عن موقع الانطلاق في ${gov?.name ?? "محافظتك"}...`
                  : `ابحث عن وجهة الوصول في ${getGovernorate(destinationGovernorateKey)?.name ?? gov?.name ?? "المحافظة المختارة"}...`
              }
              showLocateButton={true}
              isFullScreen={true}
              searchTop={72}
              hideOutsideButtons={true}
              bottomOffset={(mapStep === "dest" && destConfirmed) || (vehicle === "large" && destConfirmed) ? 360 : 150}
              confirmLabel={mapStep === "pickup" ? "تأكيد الانطلاق" : "تأكيد الوجهة"}
              onSelectPlace={(c, addr) => {
                if (mapStep === "pickup") {
                  setPickupCoords(c);
                  if (addr) setPickupLabel(addr);
                  if (gov && !isInGovernorate(c, gov.key)) {
                    toast.error(`موقع الانطلاق يجب أن يكون داخل ${gov.name}`);
                    return;
                  }
                  if (vehicle === "large") {
                    setDestConfirmed(true);
                  } else {
                    setMapStep("dest");
                    setDestConfirmed(false);
                  }
                } else {
                  setDestCoords(c);
                  if (addr) setDestLabel(addr);
                  confirmDest(c);
                }
              }}
              onConfirm={() => {
                if (mapStep === "pickup") {
                  advanceToDestination();
                } else {
                  confirmDest();
                }
              }}
              onChange={(c, addr) => {
                setRouteKm(null);
                setDestConfirmed(false);
                if (mapStep === "pickup") {
                  setPickupCoords(c);
                  setPickupLabel(addr?.trim() || "موقع محدد على الخريطة");
                } else {
                  setDestCoords(c);
                  setDestLabel(addr?.trim() || "وجهة محددة على الخريطة");
                }
              }}
            />
          )}
        </div>

        {/* Floating Top Control Bar (Header & Step Switcher) */}
        <div className="relative z-30 pt-3 px-3 pointer-events-none">
          <div className="flex items-center gap-2 pointer-events-auto">
            <button
              type="button"
              onClick={() => {
                if (mapStep === "dest") {
                  setMapStep("pickup");
                  setDestConfirmed(false);
                  setDestCoords(null);
                  setDestLabel("");
                  setRouteKm(null);
                  setRouteError(null);
                  setShowFareDetails(false);
                } else goBack();
              }}
              className="h-11 w-11 rounded-2xl bg-white/95 dark:bg-black/95 dark:text-slate-100 dark:border-slate-700 backdrop-blur-md shadow-lg border border-border/40 grid place-items-center btn-press text-foreground shrink-0"
              aria-label="رجوع"
            >
              <span className="grid h-8 w-8 place-items-center rounded-xl border border-amber-400/40 bg-gradient-to-br from-primary/10 to-amber-400/20 shadow-inner"><ArrowRight className="h-5 w-5 stroke-[2.8] text-primary" /></span>
            </button>
            <button
              type="button"
              onClick={() => setGovPickerOpen(true)}
              className="h-11 px-3 rounded-2xl bg-white/95 dark:bg-black/95 dark:text-slate-100 dark:border-slate-700 shadow-lg border border-border/40 text-xs font-black text-foreground shrink-0 btn-press"
            >
              📍 {gov?.name ?? "المحافظة"}
            </button>

            {/* 2-Step Toggle Pills: 1. Pickup | 2. Destination */}
            <div className="flex-1 bg-white/95 dark:bg-black/95 dark:text-slate-100 dark:border-slate-700 backdrop-blur-md rounded-2xl p-1 shadow-lg border border-border/40 flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setMapStep("pickup");
                  setDestConfirmed(false);
                }}
                className={`flex-1 py-2 px-2.5 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 btn-press ${
                  mapStep === "pickup"
                    ? "bg-sky-600 text-white shadow-md scale-[1.02]"
                    : "text-muted-foreground hover:bg-slate-100"
                }`}
              >
                <span className="h-2 w-2 rounded-full bg-sky-300" />
                <span>١. الانطلاق</span>
                {pickupCoords && <CheckCircle2 className="h-3 w-3" />}
              </button>

              {vehicle !== "large" && (              <button
                type="button"
                onClick={() => {
                  if (!pickupCoords) {
                    toast.error("حدد موقع الانطلاق أولاً");
                    return;
                  }
                  advanceToDestination();
                }}
                className={`flex-1 py-2 px-2.5 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 btn-press ${
                  mapStep === "dest"
                    ? "bg-rose-600 text-white shadow-md scale-[1.02]"
                    : "text-muted-foreground hover:bg-slate-100"
                }`}
              >
                <span className="h-2 w-2 rounded-full bg-rose-300" />
                <span>٢. الوجهة</span>
                {destCoords && <CheckCircle2 className="h-3 w-3" />}
              </button>)}
            </div>
          </div>
        </div>

        {/* STEP 1: PICKUP */}
        {mapStep === "pickup" && !(vehicle === "large" && destConfirmed) && (
          <div className="mt-auto relative z-30 p-4 pb-6">
            <div className="bg-white/95 dark:bg-black/95 dark:text-slate-100 dark:border-slate-700 backdrop-blur-md rounded-3xl p-4 shadow-2xl border border-border/50 max-w-md mx-auto space-y-3">
              {vehicle === "large" && (
                <div className="space-y-2">
                  <div className="font-black text-sm text-foreground">اختر نوع الكيا</div>
                  <div className="grid grid-cols-2 gap-2">
                    {([{ key: "kia_cargo", label: "كيا حمل" }, { key: "kia_passenger", label: "كيا ركاب" }, { key: "bus", label: "باص", image: "https://xcode.shamayah.co.ke/assets/login-bus-CChLKdVW.png" }] as const).map((item) => (
                      <button key={item.key} type="button" onClick={() => setVehicleType(item.key)} className={`rounded-2xl border p-2.5 font-black flex flex-col items-center gap-1 ${vehicleType === item.key ? "border-orange-500 bg-white dark:bg-black dark:text-slate-100 dark:border-slate-700 ring-2 ring-orange-300" : "border-orange-200 bg-white dark:bg-black dark:text-slate-100 dark:border-slate-700/70 dark:bg-black/70 dark:text-slate-100 dark:border-slate-700"}`}>
                        {(() => { const key = item.key === "kia_cargo" ? "vehicle_kia_cargo" : item.key === "kia_passenger" ? "vehicle_kia_passenger" : "vehicle_bus"; const visual = uiVisuals[key]; return visual?.icon_name ? <span className="text-3xl">{visual.icon_name}</span> : visual?.image_url ? <img src={visual.image_url} alt={item.label} style={{ width: Number(visual.width_px) || undefined, height: Number(visual.height_px) || undefined, transform: `scale(${Math.max(.6,Math.min(1.6,Number(visual.element_scale)||1))})` }} className="w-full h-16 object-contain" /> : <span className="text-4xl">{item.key === "kia_cargo" ? "🚚" : item.key === "kia_passenger" ? "🚐" : "🚌"}</span>; })()}
                        <span>{uiVisuals[item.key === "kia_cargo" ? "vehicle_kia_cargo" : item.key === "kia_passenger" ? "vehicle_kia_passenger" : "vehicle_bus"]?.title || item.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2.5">
                <MapPin className="h-5 w-5 text-sky-600 shrink-0" />
                <div className="text-sm font-black text-foreground truncate">
                  {pickupLabel || "حرّك الخريطة إلى موقعك"}
                </div>
              </div>
              <button
                type="button"
                onClick={advanceToDestination}
                className="w-full h-14 rounded-2xl bg-primary text-primary-foreground font-black text-base shadow-lg flex items-center justify-center gap-2 btn-press"
              >
                <span>تأكيد الانطلاق</span>
                <span className="grid h-8 w-8 place-items-center rounded-xl border border-white/30 bg-white/15 shadow-inner"><ArrowLeft className="h-5 w-5 stroke-[2.8] drop-shadow-sm" /></span>
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: DESTINATION */}
        {mapStep === "dest" && !destConfirmed && (
          <div className="mt-auto relative z-30 p-4 pb-6">
            <div className="bg-white/95 dark:bg-black/95 dark:text-slate-100 dark:border-slate-700 backdrop-blur-md rounded-3xl p-4 shadow-2xl border border-border/50 max-w-md mx-auto space-y-3">
              <div className="flex items-center gap-2.5">
                <MapPin className="h-5 w-5 text-rose-600 shrink-0" />
                <div className="text-sm font-black text-foreground truncate">
                  {destLabel || "حرّك الخريطة إلى وجهتك"}
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-black text-foreground">أماكني المفضلة</span>
                  {favoritePlacesLoading && <span className="text-[10px] text-muted-foreground">جارٍ التحميل...</span>}
                </div>
                {favoritePlaces.length > 0 ? <div className="flex gap-2 overflow-x-auto pb-1">{favoritePlaces.map((place) => <div key={place.id} className="flex shrink-0 items-center rounded-xl border border-amber-300/70 bg-amber-50/80 dark:bg-amber-950/30"><button type="button" onClick={() => chooseFavoritePlace(place)} className="px-3 py-2 text-xs font-black text-foreground">📍 {place.label}</button><button type="button" onClick={() => deleteFavoritePlace(place.id)} aria-label={"حذف " + place.label} className="px-2 text-xs text-red-600">×</button></div>)}</div> : <p className="text-[11px] text-muted-foreground">احفظ بيتك أو عملك حتى تختاره بضغطة واحدة.</p>}
                {destCoords && !showFavoriteNameInput && <button type="button" onClick={() => setShowFavoriteNameInput(true)} className="w-full rounded-xl border border-dashed border-primary/50 py-2 text-xs font-black text-primary">＋ حفظ هذه الوجهة بالمفضلة</button>}
                {showFavoriteNameInput && <div className="flex gap-2"><input value={favoriteName} onChange={(e) => setFavoriteName(e.target.value)} maxLength={60} placeholder="مثلاً: البيت أو العمل" className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm" /><button type="button" onClick={saveFavoritePlace} className="rounded-xl bg-primary px-3 py-2 text-xs font-black text-primary-foreground">حفظ</button><button type="button" onClick={() => { setShowFavoriteNameInput(false); setFavoriteName(""); }} className="rounded-xl border px-3 py-2 text-xs">إلغاء</button></div>}
              </div>
              <button
                type="button"
                onClick={() => {
                  const next = !interCity;
                  setInterCity(next);
                  setDestinationGovernorateKey(next ? null : gov?.key ?? null);
                  setDestConfirmed(false);
                  if (next) {
                    toast.message("اختر المحافظة التي تريد الوصول إليها حتى تظهر اقتراحاتها فقط.");
                  } else if (gov) {
                    setDestCoords({ lat: gov.lat, lng: gov.lng });
                    setDestLabel(gov.name);
                  }
                }}
                className={`w-full py-2 rounded-xl text-xs font-bold border btn-press ${interCity ? "bg-primary text-primary-foreground border-primary" : "border-border/60 text-muted-foreground"}`}
              >
                {interCity ? "✓ رحلة لمحافظة أخرى" : "رحلة لمحافظة أخرى؟"}
              </button>
              {interCity && (
                <div className="space-y-2">
                  {!destinationGovernorateKey && (
                    <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                      أنت خارج محافظتك، اختر المحافظة المراد التوجه إليها حتى نعرض أماكنها فقط
                    </p>
                  )}
                  <div className="flex gap-1.5 overflow-x-auto pb-1">
                  {GOVERNORATES.filter((g) => g.key !== gov?.key).map((g) => (
                    <button
                      key={g.key}
                      type="button"
                      onClick={() => {
                        setInterCity(true);
                        setDestinationGovernorateKey(g.key);
                        setDestCoords({ lat: g.lat, lng: g.lng });
                        setDestLabel(g.name);
                        setDestConfirmed(false);
                      }}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold border shrink-0 btn-press ${destinationGovernorateKey === g.key ? "bg-primary text-primary-foreground border-primary" : "border-border/60 text-muted-foreground"}`}
                    >
                      {destinationGovernorateKey === g.key ? `✓ ${g.name}` : g.name}
                    </button>
                  ))}
                  </div>
                </div>
              )}
              <button
                type="button"
                disabled={!destCoords || (interCity && !destinationGovernorateKey)}
                onClick={() => confirmDest()}
                className="w-full h-14 rounded-2xl bg-primary text-primary-foreground font-black text-base shadow-lg flex items-center justify-center gap-2 btn-press disabled:opacity-50"
              >
                <span>تأكيد الوجهة</span>
                <ArrowLeft className="h-5 w-5" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: CARS ONLY */}
        {((mapStep === "dest" && destConfirmed) || (vehicle === "large" && mapStep === "pickup" && destConfirmed)) && (
          <div className="mt-auto relative z-30 bg-white dark:bg-black dark:text-slate-100 dark:border-slate-700 rounded-t-[32px] shadow-2xl border-t border-border/60 max-w-lg mx-auto w-full p-5 space-y-3">
            {vehicle !== "large" && routeKm === null && !routeError && (
              <div
                className="flex items-center justify-center gap-2 text-sm text-muted-foreground"
                role="status"
              >
                <Loader2 className="h-4 w-4 animate-spin" /> جارٍ حساب سعر الطريق…
              </div>
            )}
            {routeError && (
              <div className="space-y-2">
                <p role="alert" className="text-sm text-destructive">
                  {routeError}
                </p>
                <Button variant="outline" onClick={() => setRouteRetry((v) => v + 1)}>
                  إعادة حساب السعر
                </Button>
              </div>
            )}
            {vehicle === "large" ? (
              <div className="rounded-2xl border border-orange-200 bg-orange-50 p-3 space-y-2">
                <div className="font-black text-sm text-foreground">طلب سيارة كبيرة</div>
                <div className="text-xs text-muted-foreground">ما نحسب السعر بالمسافة؛ اكتب السعر اللي تقترحه أو اتركه حتى توصلك عروض أصحاب السيارات</div>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                  {[15000, 20000, 25000, 30000, 35000, 40000, 45000, 50000].map((amount) => (
                    <button key={amount} type="button" onClick={() => setCustomerPrice(String(amount))} className={`rounded-xl border px-2 py-2 text-xs font-black transition ${customerPrice === String(amount) ? "border-orange-500 bg-orange-100 text-orange-800 dark:bg-orange-950/80 dark:text-orange-200 dark:border-orange-700 ring-1 ring-orange-300" : "border-orange-200 bg-white dark:bg-black dark:text-slate-100 dark:border-slate-700 text-slate-700"}`}>
                      {(amount / 1000).toLocaleString("en")} ألف
                    </button>
                  ))}
                </div>
                <input
                  inputMode="numeric"
                  value={customerPrice}
                  onChange={(e) => setCustomerPrice(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="أو اكتب أي سعر بالدينار"
                  className="w-full bg-white dark:bg-black dark:text-slate-100 dark:border-slate-700 border border-orange-200 rounded-xl px-4 py-3 text-sm font-bold outline-none"
                />
                <label className="flex items-center justify-between gap-3 rounded-xl border border-orange-300/60 bg-white/70 dark:bg-black/40 p-3">
                  <span className="text-right"><span className="block text-sm font-black">⚡ وضع الاستعجال</span><span className="block text-[11px] text-muted-foreground">يظهر طلب السيارة للمزودين كطلب مستعجل</span></span>
                  <input type="checkbox" checked={urgencyEnabled} onChange={(e) => setUrgencyEnabled(e.target.checked)} className="h-5 w-5 accent-orange-500" />
                </label>
              </div>
            ) : (
              <div className="space-y-2">
                {VEHICLE_CATS.filter((item) => item.key !== "large").sort((a, b) => Number(uiVisuals[`vehicle_${a.key}`]?.sort_order ?? 0) - Number(uiVisuals[`vehicle_${b.key}`]?.sort_order ?? 0)).map((c) => {
                  const active = vehicleCategory === c.key;
                  const visual = uiVisuals[`vehicle_${c.key}`] || {};
                  const fare = routeKm !== null ? (serverTaxiFares[c.key as Exclude<VehicleCategory, "large">] ?? (active ? serverTaxiFare : null)) : null;
                  return (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => setVehicleCategory(c.key)}
                      className={`w-full text-right p-3 rounded-2xl btn-press flex items-center gap-3 border ${
                        active ? "ring-2 ring-primary border-primary" : "border-border/60"
                      }`} style={{backgroundColor:visual.background_color||undefined,borderRadius:Number(visual.border_radius_px)||undefined,padding:Number(visual.card_padding_px)||undefined}}
                    >
                      {uiVisuals[`vehicle_${c.key}`]?.icon_name ? <span className="text-3xl shrink-0">{uiVisuals[`vehicle_${c.key}`].icon_name}</span> : (
                        <img src={uiVisuals[`vehicle_${c.key}`]?.image_url || c.img || `/vehicle-icons/${c.key}.svg`} alt={uiVisuals[`vehicle_${c.key}`]?.title || c.label} style={{ width: Number(visual.width_px) || 76, height: Number(visual.height_px) || 52, transform: `scale(${Math.max(.5,Math.min(2,Number(visual.icon_scale)||1)) * Math.max(.6,Math.min(1.6,Number(visual.element_scale)||1))})` }} className="object-contain shrink-0" />
                      )}
                      <div className="flex-1 font-black text-sm" style={{fontSize:Number(visual.title_size_px)||14,color:visual.title_color||undefined}}>{visual.title || c.label}</div>
                      <div className="font-black text-base text-primary shrink-0">
                        {fare !== null ? `${fare.toLocaleString()} د.ع` : "—"}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            {vehicle !== "large" && <div className="text-[11px] text-muted-foreground">خيار الاستعجال يظهر بعد إرسال الطلب أثناء البحث عن أقرب سائق.</div>}
            {vehicle !== "large" && (
              <div className="rounded-2xl border border-amber-300/50 bg-card p-3 space-y-3">
                <button type="button" onClick={() => setTripOptionsExpanded((value) => !value)} className="w-full flex items-center justify-between text-sm font-black">
                  <span>خيارات الرحلة الاختيارية</span>
                  <span className="text-primary text-xs">{tripOptionsExpanded ? "إخفاء ▲" : "إظهار ▼"}</span>
                </button>
                {tripOptionsExpanded && (
                  <>
                    <p className="text-xs text-muted-foreground">الاختيار الافتراضي ذهاب فقط. فعّل خياراً إضافياً عند الحاجة.</p>
                    <div className="grid grid-cols-2 gap-2">
                      {([
                        { key: "one_way", label: "ذهاب فقط" },
                        { key: "round_trip", label: "ذهاب وإياب" },
                        { key: "second_trip", label: "رحلة ثانية" },
                        { key: "stop", label: "توقف بالطريق" },
                      ] as const).map((item) => (
                        <button key={item.key} type="button" onClick={() => { setTripType(item.key); if (item.key !== "stop") setExtraMinutes(0); }} className={`rounded-xl border px-3 py-2.5 text-xs font-bold ${tripType === item.key ? "bg-primary text-primary-foreground border-primary" : "bg-surface-2 border-border/60"}`}>
                          {item.label}
                        </button>
                      ))}
                    </div>
                    {tripType === "round_trip" && <p className="text-[11px] text-emerald-600 font-bold">تم تطبيق خصم 10٪ على أجرة الذهاب والإياب.</p>}
                    {tripType === "stop" && (
                      <>
                        <div className="flex items-center justify-between text-xs font-black">
                          <span>مدة التوقف</span>
                          <span>{extraMinutes} دقيقة · {(Math.ceil(extraMinutes / 5) * 500).toLocaleString("ar-IQ")} د.ع</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground">مدة التوقف يحددها الزبون، كل 5 دقائق بـ500 دينار، والحد الأعلى ساعتان.</p>
                        <input type="range" min={0} max={120} step={5} value={extraMinutes} onChange={(event) => setExtraMinutes(Number(event.target.value))} className="w-full accent-primary" aria-label="مدة التوقف بالدقائق" />
                        <div className="flex justify-between text-[11px] text-muted-foreground"><span>بدون توقف</span><span>ساعتان</span></div>
                      </>
                    )}
                  </>
                )}
              </div>
            )}
            {vehicle === "large" && vehicleType === "kia_cargo" && (
              <div className="rounded-2xl border border-orange-200 bg-orange-50/70 p-3 space-y-2" dir="rtl">
                <div className="text-sm font-black">كمية الحمولة أو وصفها <span className="text-xs font-medium text-muted-foreground">(اختياري — كيا حمل فقط)</span></div>
                <input value={cargoLoadDescription} onChange={(e) => setCargoLoadDescription(e.target.value.slice(0, 300))} placeholder="مثلاً: 500 طابوقة أو حمولة نصف طن" className="w-full bg-white dark:bg-black dark:text-slate-100 dark:border-slate-700 border border-orange-200 rounded-xl px-4 py-3 text-sm font-medium outline-none" />
              </div>
            )}
            {requestAttachmentPanel}
            {vehicle !== "large" ? couponPanel : null}

            {vehicle === "large" && (
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ملاحظات إضافية (اختياري) — اكتب الوجهة أو أي تفاصيل تريدها" rows={2} className="w-full resize-none bg-white dark:bg-black dark:text-slate-100 dark:border-slate-700 border border-orange-200 rounded-xl px-4 py-3 text-sm font-medium outline-none" />
            )}
            <button
              type="button"
              disabled={busy || !pickupCoords || (vehicle !== "large" && (!destCoords || routeKm === null || !!routeError))}
              onClick={() => void submit()}
              className="w-full py-4 rounded-2xl bg-primary text-primary-foreground font-black text-base shadow-xl btn-press disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <span>{vehicle === "large" ? "إرسال الطلب" : "اطلب الآن"}</span>}
            </button>
          </div>
        )}
      </div>
    );
  }

  /* =========================================================================
     2. HOME SERVICE VIEW: CLASSIC CLEAN SERVICE FORM
     ========================================================================= */
  const selectedService = services.find((s) => s.id === serviceId);

  return (
    <div className="min-h-screen px-5 pt-10 pb-36">
      {activeRequestConfirmation()}
      <button onClick={() => setServiceDetailsStep(false)} className="text-sm text-muted-foreground mb-4 flex items-center gap-1">← قائمة الفنيين</button>
      <h1 className="text-3xl font-black flex items-center gap-2">
        <img
          src={technicianIcon}
          alt=""
          width={40}
          height={40}
          className="h-10 w-10 object-contain"
        />
        طلب خدمة منزلية
      </h1>
      <p className="text-sm text-muted-foreground mt-1">اختر الحرفة وحدد موقع العمل بسهولة</p>
      {selectedService && <div className="mt-4 mb-4 flex items-center gap-3 rounded-2xl border border-border bg-card p-3"><img src={serviceIcon(selectedService.slug)} alt={selectedService.name_ar} className="h-16 w-16 rounded-xl object-cover" /><div className="text-right"><div className="text-xs text-muted-foreground">الخدمة المختارة</div><div className="font-black">{selectedService.name_ar}</div></div></div>}

      {/* Technician choices are shown on the previous dedicated screen. */}
      {/* Level Selection */}
      <div className="mb-2 text-sm font-bold text-muted-foreground">المستوى المطلوب</div>
      <div className="grid grid-cols-2 gap-3 mb-5">
        {(
          [
            { k: "fani", label: "فني", img: technicianIcon, desc: "خبرة جيدة" },
            ...(selectedService && EXPERT_ONLY_SERVICE_SLUGS.has(selectedService.slug)
              ? [{ k: "khabir" as const, label: "خبير", img: expertIcon, desc: "خبرة عالية" }]
              : []),
          ]
        ).map((opt) => (
          <button
            key={opt.k}
            onClick={() => setLevel(opt.k as "fani" | "khabir")}
            className={`p-4 rounded-2xl btn-press text-center transition-all ${
              level === opt.k
                ? "bg-gradient-to-br from-primary to-primary-glow text-primary-foreground shadow-lg scale-105"
                : "bg-white dark:bg-black dark:text-slate-100 dark:border-slate-700/70 dark:bg-black/70 dark:text-slate-100 dark:border-slate-700"
            }`}
          >
            <img
              src={opt.img}
              alt=""
              loading="lazy"
              width={40}
              height={40}
              className="h-10 w-10 mx-auto mb-1 object-contain"
            />
            <div className="font-black text-sm">{opt.label}</div>
            <div
              className={`text-[10px] mt-0.5 ${level === opt.k ? "opacity-90" : "text-muted-foreground"}`}
            >
              {opt.desc}
            </div>
          </button>
        ))}
      </div>

      {level === "khabir" && selectedService && EXPERT_ONLY_SERVICE_SLUGS.has(selectedService.slug) ? (
        <>
          <div className="mb-3 rounded-2xl border border-amber-300/60 bg-amber-50/80 dark:bg-amber-950/20 p-3 text-right">
            <div className="font-black text-sm text-amber-800 dark:text-amber-300">مميزات اختيار الخبير</div>
            <p className="mt-1 text-xs leading-6 text-amber-900/80 dark:text-amber-200/80">خبرة تخصصية أعلى، تشخيص أدق، تنفيذ الأعمال المعقدة، وإمكانية طلب خبير منفرد أو خبير مع فريق عمال حسب حجم العمل.</p>
          </div>
          <div className="mb-2 text-sm font-bold text-muted-foreground">الخبير يحتاج عمال؟</div>
          <div className="grid grid-cols-2 gap-3 mb-5">
            <button
              onClick={() => setKhabirMode("alone")}
              className={`p-4 rounded-2xl btn-press transition-all ${
                khabirMode === "alone"
                  ? "bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-lg scale-105"
                  : "bg-white dark:bg-black dark:text-slate-100 dark:border-slate-700/70 dark:bg-black/70 dark:text-slate-100 dark:border-slate-700"
              }`}
            >
              <User className="h-6 w-6 mx-auto mb-1" />
              <div className="font-black text-sm">خبير فقط</div>
              <div className="text-[10px] mt-0.5 opacity-90">بدون عمال</div>
            </button>
            <button
              onClick={() => setKhabirMode("with_workers")}
              className={`p-4 rounded-2xl btn-press transition-all ${
                khabirMode === "with_workers"
                  ? "bg-gradient-to-br from-fuchsia-400 to-purple-500 text-white shadow-lg scale-105"
                  : "bg-white dark:bg-black dark:text-slate-100 dark:border-slate-700/70 dark:bg-black/70 dark:text-slate-100 dark:border-slate-700"
              }`}
            >
              <Users className="h-6 w-6 mx-auto mb-1" />
              <div className="font-black text-sm">خبير + عمال</div>
              <div className="text-[10px] mt-0.5 opacity-90">طاقم متكامل</div>
            </button>
          </div>
          {khabirMode === "with_workers" && (
            <>
              <div className="mb-2 text-sm font-bold text-muted-foreground">
                عدد العمال المساعدين
              </div>
              <div className="flex items-center gap-3 mb-5 glass rounded-2xl p-3">
                <button
                  onClick={() => setWorkersCount(Math.max(1, workersCount - 1))}
                  className="h-10 w-10 rounded-xl bg-surface-2 font-black btn-press"
                >
                  −
                </button>
                <div className="flex-1 text-center font-black text-2xl">{workersCount}</div>
                <button
                  onClick={() => setWorkersCount(Math.min(10, workersCount + 1))}
                  className="h-10 w-10 rounded-xl bg-primary text-primary-foreground font-black btn-press"
                >
                  +
                </button>
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <div className="mb-2 text-sm font-bold text-muted-foreground">عدد العمال المطلوب</div>
          <div className="flex items-center gap-3 mb-5 glass rounded-2xl p-3">
            <button
              onClick={() => setWorkersCount(Math.max(1, workersCount - 1))}
              className="h-10 w-10 rounded-xl bg-surface-2 font-black btn-press"
            >
              −
            </button>
            <div className="flex-1 text-center font-black text-2xl">{workersCount}</div>
            <button
              onClick={() => setWorkersCount(Math.min(10, workersCount + 1))}
              className="h-10 w-10 rounded-xl bg-primary text-primary-foreground font-black btn-press"
            >
              +
            </button>
          </div>
        </>
      )}

      {/* Map location for service */}
      <div className="mt-4 mb-2 text-sm font-bold text-muted-foreground">📍 موقع تقديم الخدمة</div>
      <MapPicker
        key={gov?.key ?? "no-governorate"}
        value={pickupCoords}
        accent="#0284c7"
        nearby={nearby}
        nearbyKind="worker"
        autoLocateOnMount={true}
        governorateKey={gov?.key}
        placeholder={`ابحث عن عنوان المنزل أو المحل في ${gov?.name ?? "المحافظة المختارة"}...`}
        confirmLabel="تأكيد موقع الخدمة"
        onConfirm={() => toast.success("تم تثبيت موقع الخدمة ✓")}
        onChange={(c, addr) => {
          setPickupCoords(c);
          setPickupLabel(addr?.trim() || "موقع محدد على الخريطة");
        }}
      />

      {/* Pricing and description */}
      <div className="mt-6 glass rounded-2xl p-4 space-y-3">
        <div className="text-sm font-black">💰 السعر والشغل</div>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { k: "fixed", label: "إنجاز تام" },
              { k: "hourly", label: "بالساعات" },
              { k: "negotiable", label: "يحدده الفني" },
            ] as const
          ).map((o) => (
            <button
              key={o.k}
              type="button"
              onClick={() => setPricingMode(o.k)}
              className={`py-3 rounded-xl text-xs font-bold btn-press ${
                pricingMode === o.k ? "bg-primary text-primary-foreground shadow" : "bg-surface-2"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <textarea
          value={workDescription}
          onChange={(e) => setWorkDescription(e.target.value)}
          rows={2}
          maxLength={1500}
          placeholder={selectedService?.slug?.includes("repair") || selectedService?.slug?.includes("electric") || selectedService?.slug === "plumbing" ? "اشرح العطل بالتفصيل حتى يعرف الفني شنو يحتاج" : "اشرح الشغل المطلوب بالتفصيل..."}
          className="w-full bg-input border border-border rounded-2xl px-4 py-3 text-sm font-medium outline-none focus:border-ring resize-none"
        />
        {selectedService?.slug === "build" && (
          <input
            value={brickQuantity}
            onChange={(e) => setBrickQuantity(e.target.value.slice(0, 100))}
            placeholder="كمية الطابوق المطلوبة (اختياري) — مثلاً 2000 طابوقة"
            className="w-full bg-input border border-border rounded-2xl px-4 py-3 text-sm font-medium outline-none focus:border-ring"
          />
        )}
        {requestAttachmentPanel}
        {pricingMode === "hourly" && (
          <input
            inputMode="numeric"
            value={workHours}
            onChange={(e) => setWorkHours(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="عدد الساعات المتوقعة"
            className="w-full bg-input border border-border rounded-2xl px-4 py-3 text-sm font-medium outline-none focus:border-ring"
          />
        )}
        {pricingMode !== "negotiable" && (
          <>
            <input
              inputMode="numeric"
              value={customerPrice}
              onChange={(e) => setCustomerPrice(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder={
                pricingMode === "hourly"
                  ? "الأجر لكل ساعة ولكل فني"
                  : "الأجر لكل فني بالدينار"
              }
              className="w-full bg-input border border-border rounded-2xl px-4 py-3 text-sm font-medium outline-none focus:border-ring"
            />
            <div className="flex flex-wrap gap-2">
              {[15000, 25000, 30000, 50000].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setCustomerPrice(String(v))}
                  className={`px-3 py-2 rounded-xl border text-xs font-black btn-press ${customerPrice === String(v) ? "border-primary bg-primary/10 text-primary" : "border-border bg-surface-2"}`}
                >
                  {(v / 1000).toLocaleString("ar-IQ")} ألف
                </button>
              ))}
            </div>
            <div className="rounded-xl bg-primary/10 px-3 py-3 text-right">
              <div className="text-xs text-muted-foreground">الإجمالي التقديري لجميع أفراد الطاقم</div>
              <div className="mt-1 text-lg font-black text-primary">{serviceTotalPrice.toLocaleString("ar-IQ")} د.ع</div>
              <div className="text-[10px] text-muted-foreground">سعر الفرد × {servicePriceMultiplier} وحدات أجرة · أجرة الخبير تعادل أجرتَي فني عادي</div>
            </div>
            <div className="text-[11px] text-muted-foreground">اختر الأجر للفرد، ويُحسب الإجمالي تلقائياً حسب عدد الفنيين ومستواهم.</div>
          </>
        )}
        <label className="flex items-center justify-between gap-3 rounded-xl border border-amber-300/50 bg-amber-50/60 dark:bg-amber-950/20 p-3">
          <span className="text-right"><span className="block text-sm font-black text-foreground">⚡ وضع الاستعجال</span><span className="block text-[11px] text-muted-foreground">يظهر طلبك للمزودين كطلب مستعجل أثناء البحث</span></span>
          <input type="checkbox" checked={urgencyEnabled} onChange={(e) => setUrgencyEnabled(e.target.checked)} className="h-5 w-5 accent-amber-500" />
        </label>
      </div>



      <div className="mt-5">
        <div className="text-xs font-bold text-muted-foreground mb-2">
          📝 ملاحظات إضافية (اختياري)
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="تفاصيل إضافية للتواصل..."
          className="w-full bg-input border border-border rounded-2xl px-4 py-3 text-sm font-medium outline-none focus:border-ring resize-none"
        />
      </div>

      {/* Floating Bottom Bar */}
      <div className="fixed bottom-0 inset-x-0 p-4 glass-strong border-t border-border z-30">
        <button
          disabled={busy}
          onClick={() => void submit()}
          className="w-full max-w-md mx-auto py-4 rounded-2xl bg-gradient-to-r from-primary to-primary-glow text-primary-foreground font-bold btn-press glow-primary disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {busy && <Loader2 className="h-5 w-5 animate-spin" />}
          إرسال الطلب
          <ArrowLeft className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
