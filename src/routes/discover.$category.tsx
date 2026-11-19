import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, MapPin, RefreshCw, Store } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { MobileShell } from "@/components/mobile-shell";

type PartnerType = "hotel" | "restaurant" | "store" | "mall";
type Business = { id: string; partner_type: PartnerType; business_name: string; city: string; address: string; description: string | null; phone: string };
const categories: Record<string, { title: string; subtitle: string; types: PartnerType[] }> = {
  restaurant: { title: "المطاعم", subtitle: "تصفح المطاعم وقوائم الطعام والخدمات المتاحة.", types: ["restaurant"] },
  hotel: { title: "الفنادق", subtitle: "اكتشف الفنادق والغرف والخدمات المتاحة.", types: ["hotel"] },
  store: { title: "المتاجر", subtitle: "تصفح المتاجر والمنتجات المعروضة.", types: ["store", "mall"] },
};

export const Route = createFileRoute("/discover/$category")({ ssr: false, component: DiscoverCategoryPage });

function DiscoverCategoryPage() {
  const { category: categoryKey } = Route.useParams();
  const category = categories[categoryKey];
  const [items, setItems] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!category) { setError("هذا القسم غير متاح."); setLoading(false); return; }
    setLoading(true); setError("");
    const { data, error: queryError } = await (supabase as any).from("partner_business_profiles")
      .select("id,partner_type,business_name,city,address,description,phone")
      .eq("is_published", true).in("partner_type", category.types).order("business_name");
    if (queryError) setError("تعذر تحميل المنشآت حالياً. حاول مرة ثانية.");
    setItems((data ?? []) as Business[]);
    setLoading(false);
  }, [categoryKey]);

  useEffect(() => { void load(); }, [load]);

  return <MobileShell><main dir="rtl" className="mx-auto min-h-[75vh] max-w-3xl space-y-5 px-4 pb-12 pt-6">
    <Link to="/home" className="inline-flex items-center gap-2 text-sm font-black text-primary"><ArrowRight className="h-4 w-4"/> رجوع للرئيسية</Link>
    <section className="rounded-3xl bg-gradient-to-br from-primary to-primary-glow p-6 text-primary-foreground">
      <div className="flex items-center gap-3"><Store className="h-8 w-8"/><div><h1 className="text-2xl font-black">{category?.title ?? "اكتشاف"}</h1><p className="mt-1 text-sm opacity-90">{category?.subtitle ?? "القسم غير متاح."}</p></div></div>
      <p className="mt-4 text-xs opacity-80">{items.length} منشأة منشورة</p>
    </section>
    {loading ? <div className="rounded-2xl border p-8 text-center text-sm text-muted-foreground">جارٍ تحميل المنشآت...</div> : error ? <div role="alert" className="rounded-2xl border border-destructive/30 p-5 text-sm text-destructive">{error}<button onClick={()=>void load()} className="mr-3 inline-flex items-center gap-1 font-bold"><RefreshCw className="h-3.5 w-3.5"/> إعادة المحاولة</button></div> : items.length===0 ? <div className="rounded-2xl border border-dashed p-8 text-center"><h2 className="font-black">ماكو منشآت منشورة حالياً</h2><p className="mt-2 text-sm leading-7 text-muted-foreground">من تنشر الإدارة المطاعم أو الفنادق أو المتاجر راح تظهر هنا مباشرة.</p></div> : <div className="grid gap-3 sm:grid-cols-2">{items.map(item=><Link key={item.id} to="/partner/$id" params={{id:item.id}} className="group rounded-2xl border border-border bg-card p-4 transition hover:border-primary/50 hover:shadow-md">
      <div className="flex items-center justify-between gap-2"><span className="rounded-full bg-primary/10 px-3 py-1 text-[10px] font-black text-primary">{item.partner_type==="hotel"?"فندق":item.partner_type==="restaurant"?"مطعم":item.partner_type==="mall"?"مول":"متجر"}</span><h2 className="text-base font-black">{item.business_name}</h2></div>
      <p className="mt-3 flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3.5 w-3.5 shrink-0"/>{item.city} · {item.address}</p>
      {item.description&&<p className="mt-2 line-clamp-2 text-xs leading-6 text-muted-foreground">{item.description}</p>}
      <p className="mt-3 text-xs font-black text-primary">عرض المحتويات والخدمات ←</p>
    </Link>)}</div>}
  </main></MobileShell>;
}
