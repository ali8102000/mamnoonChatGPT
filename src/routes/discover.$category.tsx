import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, MapPin, RefreshCw, Store } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { MobileShell } from "@/components/mobile-shell";

type PartnerType = "hotel" | "restaurant" | "store" | "mall";
type Coordinates = { latitude: number; longitude: number };
type Category = { category_key: string; vertical: "store" | "restaurant"; title: string; image_url: string };
type Business = { id: string; partner_type: PartnerType; business_name: string; city: string; address: string; description: string | null; phone: string; promotion_latitude: number | null; promotion_longitude: number | null };
type Product = { id: string; name: string; description: string | null; price_amount: number; currency: string; image_urls: string[]; profile: { id: string; business_name: string; city: string; address: string; business_vertical: string; promotion_latitude: number | null; promotion_longitude: number | null } };

export const Route = createFileRoute("/discover/$category")({ ssr: false, component: DiscoverCategoryPage });

function distanceKm(a: Coordinates, b: Coordinates) {
  const rad = (v: number) => v * Math.PI / 180;
  const dLat = rad(b.latitude - a.latitude), dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
function getBrowserLocation(): Promise<Coordinates | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise(resolve => navigator.geolocation.getCurrentPosition(
    p => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
    () => resolve(null),
    { enableHighAccuracy: false, timeout: 7000, maximumAge: 120000 },
  ));
}
function sortByNearest<T extends { promotion_latitude: number | null; promotion_longitude: number | null }>(rows: T[], location: Coordinates | null) {
  if (!location) return rows;
  return [...rows].sort((a, b) => {
    const distance = (x: T) => x.promotion_latitude == null || x.promotion_longitude == null ? Number.POSITIVE_INFINITY : distanceKm(location, { latitude: x.promotion_latitude, longitude: x.promotion_longitude });
    return distance(a) - distance(b);
  });
}

function DiscoverCategoryPage() {
  const { category: raw } = Route.useParams();
  const isStore = raw.startsWith("store-"), isRestaurant = raw.startsWith("restaurant-"), isGrocery = raw === "grocery";
  const isStoreSection = raw === "store", isRestaurantSection = raw === "restaurant";
  const categoryKey = isStore ? raw.slice(6) : isRestaurant ? raw.slice(11) : isGrocery ? "grocery" : null;
  const vertical = isStore || isStoreSection ? "store" : isRestaurant || isRestaurantSection ? "restaurant" : null;
  const [title, setTitle] = useState(isGrocery ? "بقالة وخضروات" : vertical === "store" ? "المتاجر والمولات" : vertical === "restaurant" ? "المطاعم" : raw === "hotel" ? "الفنادق" : "اكتشاف");
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Business[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [location, setLocation] = useState<Coordinates | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    const currentLocation = await getBrowserLocation();
    setLocation(currentLocation);

    if (vertical && !categoryKey) {
      const [categoryResult, businessResult] = await Promise.all([
        (supabase as any).from("partner_catalog_categories").select("category_key,vertical,title,image_url").eq("vertical", vertical).eq("is_active", true).order("sort_order"),
        (supabase as any).from("partner_business_profiles").select("id,partner_type,business_name,city,address,description,phone,promotion_latitude,promotion_longitude").eq("is_published", true).in("partner_type", vertical === "restaurant" ? ["restaurant"] : ["store", "mall"]).eq("business_vertical", vertical === "restaurant" ? "restaurant" : "store").order("business_name"),
      ]);
      if (categoryResult.error || businessResult.error) setError("تعذر تحميل القسم حالياً.");
      setCategories((categoryResult.data ?? []) as Category[]);
      setItems(sortByNearest((businessResult.data ?? []) as Business[], currentLocation));
      setProducts([]);
      setLoading(false);
      return;
    }

    if (categoryKey) {
      const [cat, rows] = await Promise.all([
        (supabase as any).from("partner_catalog_categories").select("title").eq("category_key", categoryKey).maybeSingle(),
        (supabase as any).from("partner_catalog_items").select("id,name,description,price_amount,currency,image_urls,profile:partner_business_profiles!inner(id,business_name,city,address,business_vertical,promotion_latitude,promotion_longitude)").eq("category_key", categoryKey).eq("is_active", true).eq("profile.is_published", true).order("created_at", { ascending: false }),
      ]);
      if (cat.data?.title) setTitle(cat.data.title);
      if (rows.error) setError("تعذر تحميل المنتجات حالياً.");
      const visible = ((rows.data ?? []) as Product[]).filter(p => isGrocery ? p.profile.business_vertical === "grocery" : true);
      const ordered = currentLocation ? [...visible].sort((a, b) => {
        const dist = (p: Product) => p.profile.promotion_latitude == null || p.profile.promotion_longitude == null ? Number.POSITIVE_INFINITY : distanceKm(currentLocation, { latitude: p.profile.promotion_latitude, longitude: p.profile.promotion_longitude });
        return dist(a) - dist(b);
      }) : visible;
      setProducts(ordered); setItems([]); setCategories([]); setLoading(false); return;
    }

    const types: PartnerType[] = raw === "hotel" ? ["hotel"] : [];
    if (!types.length) { setError("هذا القسم غير متاح."); setLoading(false); return; }
    const { data, error: queryError } = await (supabase as any).from("partner_business_profiles")
      .select("id,partner_type,business_name,city,address,description,phone,promotion_latitude,promotion_longitude")
      .eq("is_published", true).in("partner_type", types).order("business_name");
    if (queryError) setError("تعذر تحميل المنشآت حالياً.");
    setItems(sortByNearest((data ?? []) as Business[], currentLocation)); setProducts([]); setCategories([]); setLoading(false);
  }, [raw, categoryKey, vertical, isGrocery]);

  useEffect(() => { void load(); }, [load]);
  const distanceLabel = (lat: number | null, lng: number | null) => location && lat != null && lng != null ? `يبعد ${distanceKm(location, { latitude: lat, longitude: lng }).toFixed(1)} كم` : "";

  return <MobileShell><main dir="rtl" className="mx-auto min-h-[75vh] max-w-3xl space-y-5 px-4 pb-12 pt-6">
    <Link to="/home" className="inline-flex items-center gap-2 text-sm font-black text-primary"><ArrowRight className="h-4 w-4" /> رجوع للرئيسية</Link>
    <section className="rounded-3xl bg-gradient-to-br from-primary to-primary-glow p-6 text-primary-foreground"><div className="flex items-center gap-3"><Store className="h-8 w-8" /><div><h1 className="text-2xl font-black">{title}</h1><p className="mt-1 text-sm opacity-90">{categoryKey ? "المنتجات المنشورة ضمن هذه الفئة" : "اختار القسم اللي تريده وتصفح الأقرب إلك"}</p></div></div><p className="mt-4 text-xs opacity-80">{categoryKey ? products.length : items.length} {categoryKey ? "منتج" : "منشأة"}</p></section>
    {!location && !loading && <p className="rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">فعّل إذن الموقع حتى نرتّب النتائج حسب الأقرب إلك. ما تحتاج تحدد محافظتك.</p>}
    {loading ? <div className="rounded-2xl border p-8 text-center text-sm">جارٍ تحديد موقعك وتحميل الأقرب...</div> : error ? <div role="alert" className="rounded-2xl border border-destructive/30 p-5 text-sm text-destructive">{error}<button onClick={() => void load()} className="mr-3 inline-flex items-center gap-1 font-bold"><RefreshCw className="h-3.5 w-3.5" /> إعادة المحاولة</button></div> : <>
      {categories.length > 0 && <section className="space-y-3"><h2 className="font-black">الأقسام</h2><div className="grid grid-cols-3 gap-3 sm:grid-cols-4">{categories.map(c => <Link key={c.category_key} to="/discover/$category" params={{ category: c.vertical + "-" + c.category_key }} className="flex flex-col items-center gap-2 rounded-2xl border bg-card p-2 text-center shadow-sm"><img src={c.image_url} alt="" loading="lazy" className="h-20 w-full rounded-xl object-cover" /><span className="text-xs font-black">{c.title}</span></Link>)}</div></section>}
      {categoryKey ? products.length === 0 ? <div className="rounded-2xl border border-dashed p-8 text-center"><h2 className="font-black">ماكو منتجات منشورة بهذه الفئة حالياً</h2></div> : <div className="grid gap-3 sm:grid-cols-2">{products.map(p => <Link key={p.id} to="/partner/$id" params={{ id: p.profile.id }} className="overflow-hidden rounded-2xl border bg-card">{p.image_urls?.[0] ? <img src={p.image_urls[0]} alt={p.name} loading="lazy" className="h-44 w-full object-cover" /> : <div className="h-24 bg-muted" />}<div className="space-y-2 p-4"><h2 className="font-black">{p.name}</h2>{p.description && <p className="line-clamp-2 text-xs text-muted-foreground">{p.description}</p>}<strong className="text-sm text-primary">{Number(p.price_amount).toLocaleString("ar-IQ")} {p.currency === "USD" ? "$" : "د.ع"}</strong><p className="text-[11px] text-muted-foreground">{p.profile.business_name} · {p.profile.city}</p></div></Link>)}</div> : items.length === 0 ? <div className="rounded-2xl border border-dashed p-8 text-center"><h2 className="font-black">ماكو منشآت منشورة حالياً</h2></div> : <div className="grid gap-3 sm:grid-cols-2">{items.map(item => <Link key={item.id} to="/partner/$id" params={{ id: item.id }} className="rounded-2xl border bg-card p-4"><div className="flex items-center justify-between gap-2"><span className="rounded-full bg-primary/10 px-3 py-1 text-[10px] font-black text-primary">{item.partner_type === "hotel" ? "فندق" : item.partner_type === "restaurant" ? "مطعم" : item.partner_type === "mall" ? "مول" : "متجر"}</span><h2 className="text-base font-black">{item.business_name}</h2></div><p className="mt-3 flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3.5 w-3.5" />{item.city} · {item.address}</p>{distanceLabel(item.promotion_latitude, item.promotion_longitude) && <p className="mt-1 text-xs font-bold text-primary">{distanceLabel(item.promotion_latitude, item.promotion_longitude)}</p>}{item.description && <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{item.description}</p>}<p className="mt-3 text-xs font-black text-primary">عرض المحتويات ←</p></Link>)}</div>}
    </>}
  </main></MobileShell>;
}
