import { useCallback,useEffect,useState } from "react";
import { createFileRoute,Link } from "@tanstack/react-router";
import { ArrowRight,MapPin,RefreshCw,Store } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { MobileShell } from "@/components/mobile-shell";

type PartnerType="hotel"|"restaurant"|"store"|"mall";
type Business={id:string;partner_type:PartnerType;business_name:string;city:string;address:string;description:string|null;phone:string};
type Product={id:string;name:string;description:string|null;price_amount:number;currency:string;image_urls:string[];profile:{id:string;business_name:string;city:string;address:string}};
export const Route=createFileRoute("/discover/$category")({ssr:false,component:DiscoverCategoryPage});
function DiscoverCategoryPage(){
 const {category:raw}=Route.useParams();
 const isStore=raw.startsWith("store-"),isRestaurant=raw.startsWith("restaurant-"),isGrocery=raw==="grocery";
 const categoryKey=isStore?raw.slice(6):isRestaurant?raw.slice(11):isGrocery?"grocery":null;
 const [title,setTitle]=useState(isGrocery?"بقالة وخضروات":isStore?"المتاجر":isRestaurant?"المطاعم":raw==="store"?"المتاجر":raw==="restaurant"?"المطاعم":raw==="hotel"?"الفنادق":"اكتشاف");
 const [items,setItems]=useState<Business[]>([]);const [products,setProducts]=useState<Product[]>([]);
 const [loading,setLoading]=useState(true);const [error,setError]=useState("");
 const load=useCallback(async()=>{
  setLoading(true);setError("");
  if(categoryKey){
   const [cat,rows]=await Promise.all([
    (supabase as any).from("partner_catalog_categories").select("title").eq("category_key",categoryKey).maybeSingle(),
    (supabase as any).from("partner_catalog_items").select("id,name,description,price_amount,currency,image_urls,profile:partner_business_profiles!inner(id,business_name,city,address)").eq("category_key",categoryKey).eq("is_active",true).eq("profile.is_published",true).order("created_at",{ascending:false})
   ]);
   if(cat.data?.title)setTitle(cat.data.title);
   if(rows.error)setError("تعذر تحميل المنتجات حالياً.");
   setProducts((rows.data??[]) as Product[]);setItems([]);setLoading(false);return;
  }
  const types:PartnerType[]=raw==="restaurant"?["restaurant"]:raw==="hotel"?["hotel"]:raw==="store"?["store","mall"]:[];
  if(!types.length){setError("هذا القسم غير متاح.");setLoading(false);return;}
  let query=(supabase as any).from("partner_business_profiles").select("id,partner_type,business_name,city,address,description,phone").eq("is_published",true).in("partner_type",types);
  if(raw==="store")query=query.eq("business_vertical","store");
  const {data,error:queryError}=await query.order("business_name");
  if(queryError)setError("تعذر تحميل المنشآت حالياً.");
  setItems((data??[]) as Business[]);setProducts([]);setLoading(false);
 },[raw,categoryKey]);
 useEffect(()=>{void load();},[load]);
 return <MobileShell><main dir="rtl" className="mx-auto min-h-[75vh] max-w-3xl space-y-5 px-4 pb-12 pt-6">
  <Link to="/home" className="inline-flex items-center gap-2 text-sm font-black text-primary"><ArrowRight className="h-4 w-4"/> رجوع للرئيسية</Link>
  <section className="rounded-3xl bg-gradient-to-br from-primary to-primary-glow p-6 text-primary-foreground"><div className="flex items-center gap-3"><Store className="h-8 w-8"/><div><h1 className="text-2xl font-black">{title}</h1><p className="mt-1 text-sm opacity-90">{categoryKey?"المنتجات المنشورة ضمن هذه الفئة فقط":"تصفح المنشآت والمحتويات المتاحة."}</p></div></div><p className="mt-4 text-xs opacity-80">{categoryKey?products.length:items.length} {categoryKey?"منتج":"منشأة"}</p></section>
  {loading?<div className="rounded-2xl border p-8 text-center text-sm">جارٍ التحميل...</div>:error?<div role="alert" className="rounded-2xl border border-destructive/30 p-5 text-sm text-destructive">{error}<button onClick={()=>void load()} className="mr-3 inline-flex items-center gap-1 font-bold"><RefreshCw className="h-3.5 w-3.5"/> إعادة المحاولة</button></div>:categoryKey?(products.length===0?<div className="rounded-2xl border border-dashed p-8 text-center"><h2 className="font-black">ماكو منتجات منشورة بهذه الفئة حالياً</h2></div>:<div className="grid gap-3 sm:grid-cols-2">{products.map(p=><Link key={p.id} to="/partner/$id" params={{id:p.profile.id}} className="overflow-hidden rounded-2xl border bg-card">{p.image_urls?.[0]?<img src={p.image_urls[0]} alt={p.name} loading="lazy" className="h-44 w-full object-cover"/>:<div className="h-24 bg-muted"/>}<div className="space-y-2 p-4"><h2 className="font-black">{p.name}</h2>{p.description&&<p className="line-clamp-2 text-xs text-muted-foreground">{p.description}</p>}<strong className="text-sm text-primary">{Number(p.price_amount).toLocaleString("ar-IQ")} {p.currency==="USD"?"$":"د.ع"}</strong><p className="text-[11px] text-muted-foreground">{p.profile.business_name} · {p.profile.city}</p></div></Link>)}</div>):items.length===0?<div className="rounded-2xl border border-dashed p-8 text-center"><h2 className="font-black">ماكو منشآت منشورة حالياً</h2></div>:<div className="grid gap-3 sm:grid-cols-2">{items.map(item=><Link key={item.id} to="/partner/$id" params={{id:item.id}} className="rounded-2xl border bg-card p-4"><div className="flex items-center justify-between gap-2"><span className="rounded-full bg-primary/10 px-3 py-1 text-[10px] font-black text-primary">{item.partner_type==="hotel"?"فندق":item.partner_type==="restaurant"?"مطعم":item.partner_type==="mall"?"مول":"متجر"}</span><h2 className="text-base font-black">{item.business_name}</h2></div><p className="mt-3 flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3.5 w-3.5"/>{item.city} · {item.address}</p>{item.description&&<p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{item.description}</p>}<p className="mt-3 text-xs font-black text-primary">عرض المحتويات ←</p></Link>)}</div>}
 </main></MobileShell>;
}
