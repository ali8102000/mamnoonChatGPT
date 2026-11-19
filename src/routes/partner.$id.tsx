import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, MapPin, Phone, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { MobileShell } from "@/components/mobile-shell";

type Business = { id: string; partner_type: string; business_name: string; phone: string; city: string; address: string; description: string | null };
type CatalogItem = { id: string; item_type: string; name: string; description: string | null; price_amount: number; currency: string; quantity_available: number | null; image_urls: string[] };

export const Route = createFileRoute("/partner/$id")({ ssr: false, component: PublicPartnerDetailsPage });

function PublicPartnerDetailsPage() {
  const { id } = Route.useParams();
  const [business, setBusiness] = useState<Business | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    const { data: profile, error: profileError } = await (supabase as any).from("partner_business_profiles")
      .select("id,partner_type,business_name,phone,city,address,description")
      .eq("id",id).eq("is_published",true).maybeSingle();
    if (profileError || !profile) { setBusiness(null); setCatalog([]); setError("المنشأة غير متاحة أو تم إيقاف نشرها."); setLoading(false); return; }
    setBusiness(profile as Business);
    const expectedType = profile.partner_type==="hotel"?"room":profile.partner_type==="restaurant"?"menu_item":"product";
    const { data, error: catalogError } = await (supabase as any).from("partner_catalog_items")
      .select("id,item_type,name,description,price_amount,currency,quantity_available,image_urls")
      .eq("business_profile_id",id).eq("item_type",expectedType).eq("is_active",true).order("sort_order").order("created_at",{ascending:false});
    if (catalogError) setError("تعذر تحميل قائمة المحتويات حالياً.");
    setCatalog((data??[]) as CatalogItem[]);
    setLoading(false);
  },[id]);

  useEffect(()=>{void load();},[load]);
  const kind = business?.partner_type==="hotel"?"الغرف":business?.partner_type==="restaurant"?"قائمة الطعام":"المنتجات";

  return <MobileShell><main dir="rtl" className="mx-auto min-h-[75vh] max-w-3xl space-y-5 px-4 pb-12 pt-6">
    <Link to="/home" className="inline-flex items-center gap-2 text-sm font-black text-primary"><ArrowRight className="h-4 w-4"/> الرئيسية</Link>
    {loading ? <div className="rounded-2xl border p-8 text-center text-sm text-muted-foreground">جارٍ تحميل المحتويات...</div> : !business ? <div className="rounded-2xl border p-6 text-center text-sm text-destructive">{error||"المنشأة غير متاحة."}</div> : <>
      <section className="space-y-3 rounded-3xl bg-gradient-to-br from-primary to-primary-glow p-6 text-primary-foreground">
        <span className="text-xs font-bold opacity-80">{business.partner_type==="hotel"?"فندق":business.partner_type==="restaurant"?"مطعم":business.partner_type==="mall"?"مول":"متجر"}</span>
        <h1 className="text-2xl font-black">{business.business_name}</h1>
        <p className="flex items-center gap-2 text-xs opacity-90"><MapPin className="h-4 w-4"/>{business.city} · {business.address}</p>
        {business.description&&<p className="text-sm leading-7 opacity-90">{business.description}</p>}
        <a href={`tel:${business.phone}`} className="inline-flex w-fit items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-black text-primary"><Phone className="h-4 w-4"/> اتصال بالمنشأة</a>
      </section>
      <section><h2 className="text-xl font-black">{kind}</h2><p className="mt-1 text-xs text-muted-foreground">{catalog.length} عنصر متاح</p></section>
      {error&&<p role="alert" className="text-xs text-destructive">{error}</p>}
      {catalog.length===0 ? <div className="rounded-2xl border border-dashed p-7 text-center text-sm text-muted-foreground">ماكو {kind} مضافة حالياً. راح تظهر هنا من يضيفها صاحب المنشأة.</div> : <div className="grid gap-3 sm:grid-cols-2">{catalog.map(item=><article key={item.id} className="overflow-hidden rounded-2xl border border-border bg-card">
        {item.image_urls?.[0]&&<img src={item.image_urls[0]} alt={item.name} loading="lazy" className="h-44 w-full object-cover"/>}
        <div className="space-y-2 p-4"><h3 className="font-black">{item.name}</h3>{item.description&&<p className="text-xs leading-6 text-muted-foreground">{item.description}</p>}
          <div className="flex items-center justify-between gap-2"><strong className="text-sm text-primary">{Number(item.price_amount).toLocaleString("ar-IQ")} {item.currency==="USD"?"$":"د.ع"}</strong><span className="text-[11px] text-muted-foreground">{item.quantity_available===null?"متاح":item.quantity_available===0?"نفد حالياً":`المتاح: ${item.quantity_available}`}</span></div>
        </div>
      </article>)}</div>}
      <button onClick={()=>void load()} className="inline-flex items-center gap-2 text-xs font-bold text-primary"><RefreshCw className="h-3.5 w-3.5"/> تحديث المحتويات</button>
    </>}
  </main></MobileShell>;
}
