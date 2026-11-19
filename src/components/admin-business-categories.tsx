import { useCallback, useEffect, useState } from "react";
import { ImagePlus, Save, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Category = { category_key:string; vertical:"store"|"restaurant"|"grocery"|"hotel"; title:string; image_url:string; is_active:boolean; sort_order:number; tile_width_px:number; tile_height_px:number; auto_scroll_seconds:number };
const verticalLabel = (v:Category["vertical"]) => v==="restaurant"?"المطاعم":v==="grocery"?"البقالة المستقلة":v==="hotel"?"الفنادق":"المحلات والمتاجر";

export default function AdminBusinessCategories() {
  const [items,setItems]=useState<Category[]>([]);
  const [busy,setBusy]=useState(true);
  const [saving,setSaving]=useState<string|null>(null);
  const [message,setMessage]=useState("");\n  const [newVertical,setNewVertical]=useState<Category["vertical"]>("restaurant"); const [newTitle,setNewTitle]=useState(""); const [newKey,setNewKey]=useState(""); const [newFile,setNewFile]=useState<File|null>(null); const [creating,setCreating]=useState(false);
  const load=useCallback(async()=>{
    setBusy(true);
    const {data,error}=await (supabase as any).from("partner_catalog_categories").select("*").order("sort_order");
    if(error)setMessage("تعذر تحميل الفئات: "+error.message);
    else setItems((data??[]) as Category[]);
    setBusy(false);
  },[]);
  useEffect(()=>{void load();},[load]);
  const patch=(key:string,changes:Partial<Category>)=>setItems(current=>current.map(item=>item.category_key===key?{...item,...changes}:item));
  const save=async(item:Category)=>{
    setSaving(item.category_key);setMessage("");
    const {error}=await (supabase as any).from("partner_catalog_categories").update({
      title:item.title.trim(),image_url:item.image_url.trim(),is_active:item.is_active,
      sort_order:Number(item.sort_order)||0,tile_width_px:Number(item.tile_width_px)||72,
      tile_height_px:Number(item.tile_height_px)||72,auto_scroll_seconds:Number(item.auto_scroll_seconds)||5,
      updated_at:new Date().toISOString()
    }).eq("category_key",item.category_key);
    setSaving(null);
    setMessage(error?"تعذر الحفظ: "+error.message:"تم حفظ إعدادات الفئة.");
  };
  const create=async()=>{const title=newTitle.trim();const key=(newKey.trim()||title).toLowerCase().replace(/[^\\p{L}\\p{N}]+/gu,"-").replace(/^-|-$/g,"").slice(0,48);if(title.length<2||!key||!newFile){setMessage("اكتب اسم الفئة واختر صورتها.");return;}if(!newFile.type.startsWith("image/")||newFile.size>8*1024*1024){setMessage("الصورة يجب أن تكون أقل من 8 ميغابايت.");return;}setCreating(true);const path="business-categories/"+key+"/"+Date.now()+"-"+newFile.name.replace(/[^a-zA-Z0-9._-]/g,"-");const up=await supabase.storage.from("app-visuals").upload(path,newFile,{upsert:false,contentType:newFile.type});if(up.error){setMessage(up.error.message);setCreating(false);return;}const image_url=supabase.storage.from("app-visuals").getPublicUrl(path).data.publicUrl;const {error}=await(supabase as any).from("partner_catalog_categories").insert({category_key:key,vertical:newVertical,title,image_url,is_active:true,sort_order:Math.max(0,...items.filter(x=>x.vertical===newVertical).map(x=>x.sort_order))+10,tile_width_px:72,tile_height_px:72,auto_scroll_seconds:5});setCreating(false);if(error){setMessage(error.message);return;}setNewTitle("");setNewKey("");setNewFile(null);setMessage("تمت إضافة الفئة وصورتها.");await load();};\n  const upload=async(item:Category,file?:File)=>{
    if(!file)return;
    if(!file.type.startsWith("image/")||file.size>8*1024*1024){setMessage("اختار صورة أقل من 8 ميغابايت.");return;}
    setSaving(item.category_key);
    const path="business-categories/"+item.category_key+"/"+Date.now()+"-"+file.name.replace(/[^a-zA-Z0-9._-]/g,"-");
    const {error}=await supabase.storage.from("app-visuals").upload(path,file,{upsert:true,contentType:file.type});
    if(error)setMessage("فشل رفع الصورة: "+error.message);
    else {const {data}=supabase.storage.from("app-visuals").getPublicUrl(path);patch(item.category_key,{image_url:data.publicUrl});setMessage("ترفعَت الصورة؛ اضغط حفظ حتى تعتمد.");}
    setSaving(null);
  };
  return <section dir="rtl" className="mt-6 space-y-4 rounded-2xl border border-border bg-card p-4">
    <div className="flex items-center justify-between gap-3"><div><h3 className="text-lg font-black">محرر أيقونات وفئات المحلات والمطاعم</h3><p className="mt-1 text-xs text-muted-foreground">تغيير الصور والأحجام وسرعة الحركة وترتيب الفئات الظاهرة أعلى الشاشة.</p></div><button onClick={()=>void load()} className="inline-flex items-center gap-1 text-xs font-bold text-primary"><RefreshCw className="h-4 w-4"/> تحديث</button></div>
    {message&&<p role="status" className="rounded-xl bg-muted p-3 text-xs">{message}</p>}\n    <div className="grid gap-2 rounded-xl border border-border p-3 md:grid-cols-2"><label className="text-xs font-bold">القسم<select value={newVertical} onChange={e=>setNewVertical(e.target.value as Category["vertical"])} className="mt-1 w-full rounded-lg border bg-background p-2"><option value="restaurant">المطاعم</option><option value="store">المحلات والمتاجر</option><option value="grocery">البقالة</option><option value="hotel">الفنادق</option></select></label><label className="text-xs font-bold">اسم الفئة<input value={newTitle} onChange={e=>setNewTitle(e.target.value)} placeholder="مثلاً: مشاوي على الفحم" className="mt-1 w-full rounded-lg border bg-background p-2"/></label><label className="text-xs font-bold">معرّف اختياري<input value={newKey} onChange={e=>setNewKey(e.target.value)} dir="ltr" className="mt-1 w-full rounded-lg border bg-background p-2 text-left"/></label><label className="text-xs font-bold">صورة الفئة<input type="file" accept="image/*" onChange={e=>setNewFile(e.target.files?.[0]??null)} className="mt-1 block w-full"/></label><button disabled={creating} onClick={()=>void create()} className="md:col-span-2 rounded-xl bg-primary p-3 text-sm font-black text-primary-foreground">{creating?"جارٍ الإضافة...":"إضافة الفئة والصورة"}</button></div>
    {busy?<p className="p-5 text-center text-sm">جارٍ تحميل الفئات...</p>:<div className="grid gap-3 md:grid-cols-2">{items.map(item=><article key={item.category_key} className="space-y-3 rounded-xl border border-border p-3">
      <div className="flex items-center gap-3"><img src={item.image_url} alt="" className="h-16 w-16 rounded-xl object-cover"/><div className="min-w-0 flex-1"><p className="font-black">{item.title}</p><p className="text-[10px] text-muted-foreground">{verticalLabel(item.vertical)} · {item.category_key}</p></div><label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={item.is_active} onChange={e=>patch(item.category_key,{is_active:e.target.checked})}/> مفعلة</label></div>
      <label className="block text-xs font-bold">اسم الفئة<input value={item.title} onChange={e=>patch(item.category_key,{title:e.target.value})} className="mt-1 w-full rounded-lg border bg-background p-2"/></label>
      <label className="block text-xs font-bold">رابط الصورة<input value={item.image_url} onChange={e=>patch(item.category_key,{image_url:e.target.value})} dir="ltr" className="mt-1 w-full rounded-lg border bg-background p-2 text-left"/></label>
      <label className="flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-xs font-bold"><ImagePlus className="h-4 w-4"/> رفع صورة واقعية<input type="file" accept="image/*" className="max-w-[170px] text-[10px]" onChange={e=>void upload(item,e.target.files?.[0])}/></label>
      <div className="grid grid-cols-3 gap-2">
        <label className="text-[10px] font-bold">العرض px<input type="number" min="48" max="160" value={item.tile_width_px} onChange={e=>patch(item.category_key,{tile_width_px:Number(e.target.value)})} className="mt-1 w-full rounded-lg border bg-background p-2"/></label>
        <label className="text-[10px] font-bold">الارتفاع px<input type="number" min="48" max="160" value={item.tile_height_px} onChange={e=>patch(item.category_key,{tile_height_px:Number(e.target.value)})} className="mt-1 w-full rounded-lg border bg-background p-2"/></label>
        <label className="text-[10px] font-bold">سرعة الحركة ثانية<input type="number" min="1" max="30" value={item.auto_scroll_seconds} onChange={e=>patch(item.category_key,{auto_scroll_seconds:Number(e.target.value)})} className="mt-1 w-full rounded-lg border bg-background p-2"/></label>
      </div>
      <div className="flex items-center gap-2"><label className="flex-1 text-xs font-bold">الترتيب<input type="number" value={item.sort_order} onChange={e=>patch(item.category_key,{sort_order:Number(e.target.value)})} className="mt-1 w-full rounded-lg border bg-background p-2"/></label><button disabled={saving===item.category_key} onClick={()=>void save(item)} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-black text-primary-foreground disabled:opacity-50"><Save className="h-4 w-4"/>{saving===item.category_key?"جارٍ الحفظ":"حفظ"}</button></div>
    </article>)}</div>}
  </section>;
}
