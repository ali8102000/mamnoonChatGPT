import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Trash2, RefreshCw, Package } from "lucide-react";

type PartnerType="hotel"|"restaurant"|"store"|"mall";
type Category={category_key:string;title:string;vertical:string};
type CatalogItem={id:string;name:string;description:string|null;price_amount:number;currency:"IQD"|"USD";quantity_available:number|null;is_active:boolean;category_key:string|null;image_urls:string[]};
type Draft={name:string;description:string;price_amount:string;currency:"IQD"|"USD";quantity_available:string};
const emptyDraft:Draft={name:"",description:"",price_amount:"",currency:"IQD",quantity_available:""};
export function PartnerCatalogManager({profileId,partnerType,businessVertical="store"}:{profileId:string;partnerType:PartnerType;businessVertical?:"store"|"grocery"|"restaurant"}) {
 const itemType=useMemo(()=>partnerType==="hotel"?"room":partnerType==="restaurant"?"menu_item":"product",[partnerType]);
 const vertical=partnerType==="restaurant"?"restaurant":partnerType==="hotel"?"hotel":businessVertical;
 const grocery=vertical==="grocery";
 const [categories,setCategories]=useState<Category[]>([]);
 const [categoryKey,setCategoryKey]=useState("");
 const [items,setItems]=useState<CatalogItem[]>([]);
 const [draft,setDraft]=useState<Draft>(emptyDraft);
 const [imageFile,setImageFile]=useState<File|null>(null);
 const [loading,setLoading]=useState(true);const [saving,setSaving]=useState(false);const [error,setError]=useState("");
 const load=useCallback(async()=>{
  setLoading(true);setError("");
  const [catRes,itemRes]=await Promise.all([
   vertical?(supabase as any).from("partner_catalog_categories").select("category_key,title,vertical").eq("vertical",vertical).eq("is_active",true).order("sort_order"):Promise.resolve({data:[],error:null}),
   (supabase as any).from("partner_catalog_items").select("id,name,description,price_amount,currency,quantity_available,is_active,category_key,image_urls").eq("business_profile_id",profileId).eq("item_type",itemType).order("sort_order").order("created_at",{ascending:false})
  ]);
  if(catRes.error)setError(catRes.error.message);else {setCategories(catRes.data??[]);if(catRes.data?.length)setCategoryKey(current=>current||catRes.data[0].category_key);}
  if(itemRes.error)setError(itemRes.error.message);
  setItems((itemRes.data??[]) as CatalogItem[]);setLoading(false);
 },[profileId,itemType,vertical]);
 useEffect(()=>{void load();},[load]);
 const add=async()=>{
  const selectedCategory=grocery?"grocery":itemType==="room"&&categories.length===0?null:categoryKey;
  if(draft.name.trim().length<2||draft.price_amount.trim()===""||!Number.isFinite(Number(draft.price_amount))||Number(draft.price_amount)<0||(!selectedCategory&&!(itemType==="room"&&categories.length===0))){setError("اكتب الاسم والسعر وحدد الفئة الصحيحة.");return;}
  setSaving(true);setError("");
  let imageUrls:string[]=[];
  if(imageFile){
   const safe=imageFile.name.replace(/[^a-zA-Z0-9._-]/g,"-");
   const storagePath=profileId+"/"+Date.now()+"-"+safe;
   const uploaded=await supabase.storage.from("partner-catalog").upload(storagePath,imageFile,{upsert:false,contentType:imageFile.type});
   if(uploaded.error){setSaving(false);setError("تعذر رفع الصورة: "+uploaded.error.message);return;}
   imageUrls=[supabase.storage.from("partner-catalog").getPublicUrl(storagePath).data.publicUrl];
  }
  const {error}=await (supabase as any).from("partner_catalog_items").insert({business_profile_id:profileId,item_type:itemType,category_key:selectedCategory,name:draft.name.trim(),description:draft.description.trim()||null,price_amount:Number(draft.price_amount),currency:draft.currency,quantity_available:draft.quantity_available.trim()===""?null:Number(draft.quantity_available),image_urls:imageUrls,is_active:true});
  setSaving(false);if(error){setError(error.message);return;}setDraft(emptyDraft);setImageFile(null);await load();
 };
 const remove=async(item:CatalogItem)=>{if(!window.confirm("تأكيد حذف هذا العنصر؟"))return;const {error}=await (supabase as any).from("partner_catalog_items").delete().eq("id",item.id).eq("business_profile_id",profileId);if(error){setError(error.message);return;}await load();};
 const categoryName=(key:string|null)=>categories.find(c=>c.category_key===key)?.title??(key==="grocery"?"بقالة وخضروات":"بدون تصنيف");
 return <section className="rounded-2xl border border-border bg-card p-4 space-y-3">
  <div className="flex items-center justify-between gap-2"><h4 className="font-black flex items-center gap-2"><Package className="h-4 w-4"/> إدارة {itemType==="room"?"الغرف":itemType==="menu_item"?"قائمة الطعام":"المنتجات"}</h4><button type="button" onClick={()=>void load()} className="text-xs text-primary"><RefreshCw className="inline h-3.5 w-3.5 ml-1"/>تحديث</button></div>
  {(itemType!=="room"||partnerType==="hotel")&&<div className="rounded-xl bg-primary/5 p-3"><p className="mb-2 text-xs font-black">{grocery?"قسم البقالة المستقل":itemType==="room"?"تصنيف الغرفة":"وين تحب نعرض ونروّج هذا المنتج؟"}</p>{grocery?<p className="text-xs text-muted-foreground">منتجاتك تظهر بقسم البقالة فقط، وما تدخل باقتراحات الملابس أو المطاعم.</p>:itemType==="room"&&categories.length===0?<p className="text-xs text-muted-foreground">لا توجد فئات فندقية مفعلة حالياً؛ ستُضاف الغرفة بدون تصنيف مؤقتاً.</p>:<select value={categoryKey} onChange={e=>setCategoryKey(e.target.value)} className="w-full rounded-xl border bg-background p-3 text-sm">{categories.map(c=><option key={c.category_key} value={c.category_key}>{c.title}</option>)}</select>}</div>}
  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
   <label className="text-xs font-bold">اسم {itemType==="menu_item"?"الوجبة":"المنتج"}<input value={draft.name} onChange={e=>setDraft(v=>({...v,name:e.target.value}))} maxLength={140} className="input-base mt-1 w-full rounded-xl"/></label>
   <label className="text-xs font-bold">السعر<input type="number" min="0" step="0.01" value={draft.price_amount} onChange={e=>setDraft(v=>({...v,price_amount:e.target.value}))} className="input-base mt-1 w-full rounded-xl"/></label>
   <label className="text-xs font-bold">العملة<select value={draft.currency} onChange={e=>setDraft(v=>({...v,currency:e.target.value as "IQD"|"USD"}))} className="input-base mt-1 w-full rounded-xl"><option value="IQD">دينار عراقي</option><option value="USD">دولار</option></select></label>
   <label className="text-xs font-bold">الكمية المتاحة<input type="number" min="0" step="1" value={draft.quantity_available} onChange={e=>setDraft(v=>({...v,quantity_available:e.target.value}))} className="input-base mt-1 w-full rounded-xl"/></label>
   <label className="text-xs font-bold sm:col-span-2">الوصف<textarea value={draft.description} onChange={e=>setDraft(v=>({...v,description:e.target.value}))} maxLength={1000} className="input-base mt-1 min-h-16 w-full rounded-xl"/></label>
   <label className="text-xs font-bold sm:col-span-2">صورة المنتج<input type="file" accept="image/*" onChange={e=>setImageFile(e.target.files?.[0]??null)} className="mt-1 block w-full text-xs"/>{imageFile&&<span className="mt-1 block text-[10px] text-muted-foreground">{imageFile.name}</span>}</label>
  </div>
  <button type="button" disabled={saving} onClick={()=>void add()} className="w-full rounded-xl bg-primary p-3 text-sm font-black text-primary-foreground disabled:opacity-50"><Plus className="ml-1 inline h-4 w-4"/>{saving?"جارٍ الإضافة...":"إضافة إلى الكتالوج"}</button>
  {error&&<p role="alert" className="rounded-lg bg-red-500/10 p-2 text-xs text-red-700">{error}</p>}
  {loading?<p className="text-center text-xs text-muted-foreground">جارٍ تحميل العناصر...</p>:items.length===0?<p className="py-3 text-center text-xs text-muted-foreground">ماكو عناصر مضافة لحد الآن.</p>:<div className="space-y-2">{items.map(item=><article key={item.id} className="flex items-center gap-2 rounded-xl border border-border p-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{item.name}</p><p className="text-xs text-muted-foreground">{categoryName(item.category_key)} · {Number(item.price_amount).toLocaleString("en-US")} {item.currency}</p></div><button type="button" onClick={async()=>{const {error}=await (supabase as any).from("partner_catalog_items").update({is_active:!item.is_active,updated_at:new Date().toISOString()}).eq("id",item.id);if(error)setError(error.message);else await load();}} className="rounded-lg border px-2 py-2 text-[11px] font-bold">{item.is_active?"إيقاف":"تفعيل"}</button><button type="button" onClick={()=>void remove(item)} aria-label="حذف العنصر" className="p-2 text-red-600"><Trash2 className="h-4 w-4"/></button></article>)}</div>}
 </section>;
}
