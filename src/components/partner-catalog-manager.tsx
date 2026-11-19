import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Save, Trash2, RefreshCw, Package } from "lucide-react";

type PartnerType = "hotel" | "restaurant" | "store" | "mall";
type CatalogItem = { id:string; business_profile_id:string; item_type:"room"|"menu_item"|"product"; name:string; description:string|null; price_amount:number; currency:"IQD"|"USD"; quantity_available:number|null; is_active:boolean; };
type Draft = { name:string; description:string; price_amount:string; currency:"IQD"|"USD"; quantity_available:string; };
const emptyDraft:Draft={name:"",description:"",price_amount:"",currency:"IQD",quantity_available:""};

export function PartnerCatalogManager({profileId,partnerType}:{profileId:string;partnerType:PartnerType}) {
  const itemType = useMemo(()=>partnerType==="hotel"?"room":partnerType==="restaurant"?"menu_item":"product",[partnerType]);
  const noun = itemType==="room"?"غرفة":itemType==="menu_item"?"وجبة / صنف":"منتج";
  const [items,setItems]=useState<CatalogItem[]>([]);
  const [draft,setDraft]=useState<Draft>(emptyDraft);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");
  const load=useCallback(async()=>{
    setLoading(true);setError("");
    const {data,error}=await (supabase as any).from("partner_catalog_items").select("id,business_profile_id,item_type,name,description,price_amount,currency,quantity_available,is_active").eq("business_profile_id",profileId).eq("item_type",itemType).order("sort_order").order("created_at",{ascending:false});
    if(error)setError(error.message);
    setItems((data??[]) as CatalogItem[]);setLoading(false);
  },[profileId,itemType]);
  useEffect(()=>{void load();},[load]);
  const add=async()=>{
    if(draft.name.trim().length<2||!Number.isFinite(Number(draft.price_amount))||Number(draft.price_amount)<0){setError("اكتب اسماً صحيحاً وسعراً غير سالب.");return;}
    setSaving(true);setError("");
    const {error}=await (supabase as any).from("partner_catalog_items").insert({business_profile_id:profileId,item_type:itemType,name:draft.name.trim(),description:draft.description.trim()||null,price_amount:Number(draft.price_amount),currency:draft.currency,quantity_available:draft.quantity_available.trim()===""?null:Number(draft.quantity_available),is_active:true});
    setSaving(false);
    if(error){setError(error.message);return;}
    setDraft(emptyDraft);await load();
  };
  const patch=async(item:CatalogItem,changes:Partial<CatalogItem>)=>{
    setError("");
    const {error}=await (supabase as any).from("partner_catalog_items").update({...changes,updated_at:new Date().toISOString()}).eq("id",item.id).eq("business_profile_id",profileId);
    if(error){setError(error.message);return;} await load();
  };
  const remove=async(item:CatalogItem)=>{
    if(!window.confirm("تأكيد حذف هذا العنصر؟"))return;
    const {error}=await (supabase as any).from("partner_catalog_items").delete().eq("id",item.id).eq("business_profile_id",profileId);
    if(error){setError(error.message);return;} await load();
  };
  return <section className="rounded-2xl border border-border bg-card p-4 space-y-3">
    <div className="flex items-center justify-between gap-2"><h4 className="font-black flex items-center gap-2"><Package className="h-4 w-4"/> إدارة {itemType==="room"?"الغرف":itemType==="menu_item"?"قائمة الطعام":"المنتجات"}</h4><button type="button" onClick={()=>void load()} className="text-xs text-primary"><RefreshCw className="inline h-3.5 w-3.5 ml-1"/>تحديث</button></div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <label className="text-xs font-bold">اسم {noun}<input value={draft.name} onChange={e=>setDraft(v=>({...v,name:e.target.value}))} maxLength={140} className="input-base mt-1 w-full rounded-xl"/></label>
      <label className="text-xs font-bold">السعر<input type="number" min="0" step="0.01" value={draft.price_amount} onChange={e=>setDraft(v=>({...v,price_amount:e.target.value}))} className="input-base mt-1 w-full rounded-xl"/></label>
      <label className="text-xs font-bold">العملة<select value={draft.currency} onChange={e=>setDraft(v=>({...v,currency:e.target.value as "IQD"|"USD"}))} className="input-base mt-1 w-full rounded-xl"><option value="IQD">دينار عراقي</option><option value="USD">دولار</option></select></label>
      <label className="text-xs font-bold">الكمية المتاحة <span className="font-normal text-muted-foreground">(اتركها فارغة إذا غير محدودة)</span><input type="number" min="0" step="1" value={draft.quantity_available} onChange={e=>setDraft(v=>({...v,quantity_available:e.target.value}))} className="input-base mt-1 w-full rounded-xl"/></label>
      <label className="text-xs font-bold sm:col-span-2">الوصف<textarea value={draft.description} onChange={e=>setDraft(v=>({...v,description:e.target.value}))} maxLength={1000} className="input-base mt-1 w-full rounded-xl min-h-16"/></label>
    </div>
    <button type="button" disabled={saving} onClick={()=>void add()} className="w-full rounded-xl bg-primary text-primary-foreground p-3 text-sm font-black disabled:opacity-50"><Plus className="inline h-4 w-4 ml-1"/>{saving?"جارٍ الإضافة...":"إضافة إلى الكتالوج"}</button>
    {error&&<p role="alert" className="rounded-lg bg-red-500/10 text-red-700 p-2 text-xs">{error}</p>}
    {loading?<p className="text-xs text-muted-foreground text-center">جارٍ تحميل العناصر...</p>:items.length===0?<p className="text-xs text-muted-foreground text-center py-3">ماكو عناصر مضافة لحد الآن.</p>:<div className="space-y-2">{items.map(item=><article key={item.id} className="rounded-xl border border-border p-3 flex items-center gap-2">
      <div className="min-w-0 flex-1"><p className="font-bold text-sm truncate">{item.name}</p><p className="text-xs text-muted-foreground">{Number(item.price_amount).toLocaleString("en-US")} {item.currency} · {item.quantity_available===null?"كمية مفتوحة":`المتاح: ${item.quantity_available}`}</p></div>
      <button type="button" onClick={()=>void patch(item,{is_active:!item.is_active})} className="text-[11px] font-bold rounded-lg border px-2 py-2">{item.is_active?"إيقاف":"تفعيل"}</button>
      <button type="button" onClick={()=>void remove(item)} aria-label="حذف العنصر" className="p-2 text-red-600"><Trash2 className="h-4 w-4"/></button>
    </article>)}</div>}
    <p className="text-[10px] text-muted-foreground">إدارة الصور وتعديل تفاصيل العنصر بعد إضافته وربط الكتالوج بدليل الزبائن ضمن المرحلة التالية.</p>
  </section>;
}
