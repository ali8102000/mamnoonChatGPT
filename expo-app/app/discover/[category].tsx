import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { supabase } from "@/lib/supabase";
import { palette, radius, space } from "@/styles/theme";
import * as Location from "expo-location";

type PartnerType = "hotel" | "restaurant" | "store" | "mall";
type Coordinates = { latitude: number; longitude: number };
type Category = { category_key: string; vertical: "store" | "restaurant" | "hotel"; title: string; image_url: string };
type Business = { id: string; partner_type: PartnerType; business_name: string; city: string; address: string; description: string | null; promotion_latitude: number | null; promotion_longitude: number | null };
type Product = { id: string; name: string; description: string | null; price_amount: number; currency: string; image_urls: string[]; profile: { id: string; business_name: string; city: string; address: string; business_vertical: string; partner_type: PartnerType; promotion_latitude: number | null; promotion_longitude: number | null } };
function distanceKm(a: Coordinates, b: Coordinates) {
  const rad = (v: number) => v * Math.PI / 180;
  const dLat = rad(b.latitude - a.latitude), dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
async function getDeviceLocation(): Promise<Coordinates | null> {
  try {
    let permission = await Location.getForegroundPermissionsAsync();
    if (!permission.granted) permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) return null;
    const point = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { latitude: point.coords.latitude, longitude: point.coords.longitude };
  } catch { return null; }
}
function sortByNearest<T extends { promotion_latitude: number | null; promotion_longitude: number | null }>(rows: T[], location: Coordinates | null) {
  if (!location) return rows;
  return [...rows].sort((a, b) => {
    const dist = (x: T) => x.promotion_latitude == null || x.promotion_longitude == null ? Number.POSITIVE_INFINITY : distanceKm(location, { latitude: x.promotion_latitude, longitude: x.promotion_longitude });
    return dist(a) - dist(b);
  });
}

export default function DiscoverCategoryScreen() {
  const { category: rawParam } = useLocalSearchParams<{ category: string }>();
  const raw = String(rawParam ?? "");
  const isStore = raw.startsWith("store-"), isRestaurant = raw.startsWith("restaurant-"), isHotelCategory = raw.startsWith("hotel-"), isGrocery = raw === "grocery";
  const isStoreSection = raw === "store", isRestaurantSection = raw === "restaurant";
  const categoryKey = isStore ? raw.slice(6) : isRestaurant ? raw.slice(11) : isHotelCategory ? raw.slice(6) : isGrocery ? "grocery" : null;
  const vertical = isStore || isStoreSection ? "store" : isRestaurant || isRestaurantSection ? "restaurant" : isHotelCategory || raw === "hotel" ? "hotel" : null;
  const [title, setTitle] = useState(isGrocery ? "بقالة وخضروات" : vertical === "store" ? "المتاجر والمولات" : vertical === "restaurant" ? "المطاعم" : raw === "hotel" ? "الفنادق" : "اكتشاف");
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Business[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [location, setLocation] = useState<Coordinates | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const categoryScrollRef = useRef<ScrollView | null>(null);
  const categoryScrollX = useRef(0);
  const categoryScrollMax = useRef(0);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    const currentLocation = await getDeviceLocation();
    setLocation(currentLocation);

    if (vertical && !categoryKey) {
      let businessQuery = (supabase as any).from("partner_business_profiles").select("id,partner_type,business_name,city,address,description,promotion_latitude,promotion_longitude").eq("is_published", true).in("partner_type", vertical === "restaurant" ? ["restaurant"] : vertical === "hotel" ? ["hotel"] : ["store", "mall"]);
      if (vertical !== "hotel") businessQuery = businessQuery.eq("business_vertical", vertical);
      const [categoryResult, businessResult] = await Promise.all([
        (supabase as any).from("partner_catalog_categories").select("category_key,vertical,title,image_url").eq("vertical", vertical).eq("is_active", true).order("sort_order"),
        businessQuery.order("business_name"),
      ]);
      if (categoryResult.error || businessResult.error) setError("تعذر تحميل القسم حالياً.");
      setCategories((categoryResult.data ?? []) as Category[]);
      setItems(sortByNearest((businessResult.data ?? []) as Business[], currentLocation));
      setProducts([]); setLoading(false); return;
    }

    if (categoryKey) {
      const [cat, rows, categoryList] = await Promise.all([
        (supabase as any).from("partner_catalog_categories").select("title").eq("category_key", categoryKey).maybeSingle(),
        (supabase as any).from("partner_catalog_items").select("id,name,description,price_amount,currency,image_urls,profile:partner_business_profiles!inner(id,business_name,city,address,business_vertical,partner_type,promotion_latitude,promotion_longitude)").eq("category_key", categoryKey).eq("is_active", true).eq("profile.is_published", true).order("created_at", { ascending: false }),
        vertical === "store" || vertical === "restaurant"
          ? (supabase as any).from("partner_catalog_categories").select("category_key,vertical,title,image_url").eq("vertical", vertical).eq("is_active", true).order("sort_order")
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (cat.data?.title) setTitle(cat.data.title);
      if (rows.error || categoryList.error) setError("تعذر تحميل محتويات القسم حالياً.");
      const visible = ((rows.data ?? []) as Product[]).filter(p =>
        isGrocery ? p.profile.business_vertical === "grocery"
          : isHotelCategory ? p.profile.partner_type === "hotel"
          : isStore ? p.profile.business_vertical === "store" && ["store", "mall"].includes(p.profile.partner_type)
          : isRestaurant ? p.profile.partner_type === "restaurant" && p.profile.business_vertical === "restaurant"
          : true
      );
      const ordered = currentLocation ? [...visible].sort((a, b) => {
        const dist = (p: Product) => p.profile.promotion_latitude == null || p.profile.promotion_longitude == null ? Number.POSITIVE_INFINITY : distanceKm(currentLocation, { latitude: p.profile.promotion_latitude, longitude: p.profile.promotion_longitude });
        return dist(a) - dist(b);
      }) : visible;
      setProducts(ordered); setItems([]); setCategories((categoryList.data ?? []) as Category[]); setLoading(false); return;
    }

    const types: PartnerType[] = raw === "hotel" ? ["hotel"] : [];
    if (!types.length) { setError("هذا القسم غير متاح."); setLoading(false); return; }
    const { data, error: queryError } = await (supabase as any).from("partner_business_profiles").select("id,partner_type,business_name,city,address,description,promotion_latitude,promotion_longitude").eq("is_published", true).in("partner_type", types).order("business_name");
    if (queryError) setError("تعذر تحميل المنشآت حالياً.");
    setItems(sortByNearest((data ?? []) as Business[], currentLocation)); setProducts([]); setCategories([]); setLoading(false);
  }, [raw, categoryKey, vertical, isGrocery]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (categories.length < 2) return;
    const timer = setInterval(() => {
      const max = categoryScrollMax.current;
      if (max <= 0) return;
      const next = categoryScrollX.current + 84;
      const target = next >= max - 4 ? 0 : next;
      categoryScrollRef.current?.scrollTo({ x: target, animated: true });
      categoryScrollX.current = target;
    }, 3200);
    return () => clearInterval(timer);
  }, [categories]);
  const distanceLabel = (lat: number | null, lng: number | null) => location && lat != null && lng != null ? `يبعد ${distanceKm(location, { latitude: lat, longitude: lng }).toFixed(1)} كم` : "";

  return <ScrollView style={{ flex: 1, backgroundColor: palette.pageCanvas }} contentContainerStyle={{ padding: space.lg, paddingBottom: 48, gap: 14 }}>
    <Pressable onPress={() => router.back()} style={{ alignSelf: "flex-start", paddingVertical: 8 }}><Text style={{ color: palette.brand, fontWeight: "900" }}>→ رجوع</Text></Pressable>
    <View style={{ backgroundColor: palette.brand, borderRadius: radius.xl, padding: 20, gap: 6 }}><Text style={{ color: "#fff", fontSize: 24, fontWeight: "900", textAlign: "right" }}>{title}</Text><Text style={{ color: "#fff", opacity: .9, fontSize: 12, textAlign: "right" }}>{categoryKey ? (isHotelCategory ? "الغرف المنشورة ضمن هذه الفئة" : "المنتجات المنشورة ضمن هذه الفئة") : "اختار القسم اللي تريده وتصفح الأقرب إلك"}</Text><Text style={{ color: "#fff", opacity: .8, fontSize: 11, textAlign: "right" }}>{categoryKey ? products.length : items.length} {categoryKey ? "منتج" : "منشأة"}</Text></View>
    {!location && !loading ? <Text style={{ color: palette.muted, fontSize: 11, textAlign: "right" }}>اسمح بالوصول للموقع حتى نرتّب النتائج حسب الأقرب إلك. ما تحتاج تحدد محافظتك.</Text> : null}
    {loading ? <ActivityIndicator color={palette.brand} style={{ marginTop: 30 }} /> : error ? <View style={{ backgroundColor: palette.surface, borderRadius: radius.lg, padding: 18, gap: 10 }}><Text style={{ color: palette.danger, textAlign: "right" }}>{error}</Text><Pressable onPress={() => void load()}><Text style={{ color: palette.brand, fontWeight: "900", textAlign: "right" }}>إعادة المحاولة</Text></Pressable></View> : <>
      {categories.length > 0 ? <View style={{ gap: 8 }}><Text style={{ color: palette.ink, fontWeight: "900", textAlign: "right" }}>الأقسام</Text><ScrollView ref={categoryScrollRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }} onScroll={event => { categoryScrollX.current = event.nativeEvent.contentOffset.x; }} scrollEventThrottle={100} onContentSizeChange={width => { categoryScrollMax.current = Math.max(0, width - 24); }}>{categories.map(c => <Pressable key={c.category_key} onPress={() => router.push({ pathname: "/discover/[category]", params: { category: c.vertical + "-" + c.category_key } })} style={{ width: 76, height: 76, borderRadius: 16, borderWidth: categoryKey === c.category_key ? 2 : 1, borderColor: categoryKey === c.category_key ? palette.brand : palette.line, overflow: "hidden", backgroundColor: palette.surface }}><Image source={{ uri: c.image_url }} style={{ width: "100%", height: "100%" }} resizeMode="cover" /><View style={{ position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: "#0009", paddingHorizontal: 7, paddingVertical: 5 }}><Text numberOfLines={1} style={{ color: "#fff", fontSize: 11, fontWeight: "900", textAlign: "right" }}>{c.title}</Text></View></Pressable>)}</ScrollView></View> : null}
      {categoryKey ? products.length === 0 ? <View style={{ backgroundColor: palette.surface, borderRadius: radius.lg, padding: 22 }}><Text style={{ color: palette.ink, fontWeight: "900", textAlign: "center" }}>ماكو منتجات منشورة بهذه الفئة حالياً</Text></View> : products.map(p => <Pressable key={p.id} onPress={() => router.push({ pathname: "/partner/[id]", params: { id: p.profile.id } })} style={{ backgroundColor: palette.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: palette.line, overflow: "hidden" }}>{p.image_urls?.[0] ? <Image source={{ uri: p.image_urls[0] }} style={{ width: "100%", height: 170 }} resizeMode="cover" /> : null}<View style={{ padding: 14, gap: 6 }}><Text style={{ color: palette.ink, fontSize: 15, fontWeight: "900", textAlign: "right" }}>{p.name}</Text>{p.description ? <Text style={{ color: palette.muted, fontSize: 11, textAlign: "right" }}>{p.description}</Text> : null}<Text style={{ color: palette.brand, fontWeight: "900", textAlign: "right" }}>{Number(p.price_amount).toLocaleString("ar-IQ")} {p.currency === "USD" ? "$" : "د.ع"}</Text><Text style={{ color: palette.muted, fontSize: 10, textAlign: "right" }}>{p.profile.business_name} · {p.profile.city}</Text></View></Pressable>) : items.length === 0 ? <View style={{ backgroundColor: palette.surface, borderRadius: radius.lg, padding: 22 }}><Text style={{ color: palette.ink, fontWeight: "900", textAlign: "center" }}>ماكو منشآت منشورة حالياً</Text></View> : items.map(item => <Pressable key={item.id} onPress={() => router.push({ pathname: "/partner/[id]", params: { id: item.id } })} style={{ backgroundColor: palette.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: palette.line, padding: 16, gap: 7 }}><Text style={{ color: palette.ink, fontSize: 17, fontWeight: "900", textAlign: "right" }}>{item.business_name}</Text><Text style={{ color: palette.muted, fontSize: 12, textAlign: "right" }}>📍 {item.city} · {item.address}</Text>{distanceLabel(item.promotion_latitude, item.promotion_longitude) ? <Text style={{ color: palette.brand, fontSize: 11, fontWeight: "900", textAlign: "right" }}>{distanceLabel(item.promotion_latitude, item.promotion_longitude)}</Text> : null}{item.description ? <Text style={{ color: palette.muted, fontSize: 12, textAlign: "right" }}>{item.description}</Text> : null}<Text style={{ color: palette.brand, fontSize: 12, fontWeight: "900", textAlign: "right" }}>عرض المحتويات ←</Text></Pressable>)}
    </>}
  </ScrollView>;
}
