import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/lib/toast";
type DispatchType = "taxi" | "large_driver" | "technician";
type Row = { dispatch_type: DispatchType; ring1_min_km: number; ring1_max_km: number; ring2_min_km: number; ring2_max_km: number; ring3_min_km: number; ring3_max_km: number };
const LABELS: Record<DispatchType,string> = { taxi: "سائقو التكسي الاعتيادي", large_driver: "الكيات والباصات والسيارات الكبيرة", technician: "الفنيون ومقدمو الخدمات" };
const DEFAULTS: Row[] = [{dispatch_type:"taxi",ring1_min_km:0,ring1_max_km:1,ring2_min_km:1,ring2_max_km:3,ring3_min_km:3,ring3_max_km:5},{dispatch_type:"large_driver",ring1_min_km:0,ring1_max_km:5,ring2_min_km:5,ring2_max_km:25,ring3_min_km:25,ring3_max_km:55},{dispatch_type:"technician",ring1_min_km:0,ring1_max_km:5,ring2_min_km:5,ring2_max_km:25,ring3_min_km:25,ring3_max_km:55}];
export default function AdminDispatchZones() {
 const [rows,setRows]=useState<Row[]>(DEFAULTS); const [loading,setLoading]=useState(true); const [saving,setSaving]=useState<DispatchType|null>(null);
 const load=useCallback(async()=>{setLoading(true);const {data,error}=await (supabase as any).rpc("admin_get_dispatch_zone_settings");if(error)toast.error("تعذر تحميل نطاقات التوزيع");else setRows((data??[]) as Row[]);setLoading(false);},[]);
 useEffect(()=>{void load();},[load]);
 const update=(type:DispatchType,key:"ring1_max_km"|"ring2_max_km"|"ring3_max_km",value:string)=>setRows(old=>old.map(r=>r.dispatch_type===type?{...r,[key]:value===""?0:Number(value)}:r));
 const save=async(row:Row)=>{const a=Number(row.ring1_max_km),b=Number(row.ring2_max_km),c=Number(row.ring3_max_km);if(!(a>0&&b>a&&c>b&&c<=55)){toast.error("رتّب المسافات تصاعدياً، والحد الأعلى 55 كم");return;}setSaving(row.dispatch_type);const {error}=await (supabase as any).rpc("admin_update_dispatch_zone_settings",{p_dispatch_type:row.dispatch_type,p_ring1_max_km:a,p_ring2_max_km:b,p_ring3_max_km:c});setSaving(null);if(error)toast.error(error.message);else{toast.success("تم تحديث النطاقات وسيُستخدم الإعداد الجديد في التوزيع القادم");await load();}};
 return <div className="space-y-4">
  <div className="rounded-2xl border bg-card p-4"><h2 className="text-xl font-black">التحكم بنطاقات توزيع الطلبات</h2><p className="text-sm text-muted-foreground mt-2 leading-6">كل نطاق يستقبل الطلب لمدة دقيقة واحدة، ثم ينتقل تلقائياً للنطاق التالي. بعد النطاق الثالث يعيد المحاولة من الأول ثم الثاني ثم الثالث. إذا لم يقبل أحد بعد ست مراحل يُلغى الطلب ويستطيع الزبون إعادة المحاولة.</p></div>
  {loading?<div className="text-sm text-muted-foreground">جارٍ تحميل إعدادات Supabase...</div>:rows.map(row=><div key={row.dispatch_type} className="rounded-2xl border bg-card p-4 space-y-3">
   <h3 className="font-black">{LABELS[row.dispatch_type]}</h3>
   {[{key:"ring1_max_km" as const,label:"النطاق الأول — قريب"},{key:"ring2_max_km" as const,label:"النطاق الثاني — متوسط"},{key:"ring3_max_km" as const,label:"النطاق الثالث — بعيد"}].map((field,i)=><label key={field.key} className="block text-sm font-semibold">{field.label}<div className="mt-1 flex items-center gap-2"><input type="number" max="55" step="0.5" value={row[field.key]} onChange={e=>update(row.dispatch_type,field.key,e.target.value)} className="w-full rounded-xl border bg-background p-3" /><span className="text-xs text-muted-foreground">كم</span></div><span className="text-[11px] text-muted-foreground">{i===0?"من 0":i===1?"من "+row.ring1_max_km:"من "+row.ring2_max_km} كم إلى الحد المحدد</span></label>)}
   <button disabled={saving===row.dispatch_type} onClick={()=>void save(row)} className="w-full rounded-xl bg-primary text-primary-foreground py-3 font-bold disabled:opacity-50">{saving===row.dispatch_type?"جارٍ الحفظ...":"حفظ نطاقات هذه الفئة"}</button>
  </div>)}
  <p className="text-xs text-muted-foreground">التغييرات محفوظة في Supabase، ولا تحتاج تحديث التطبيق. الحد الأقصى 55 كم مع بقاء حدود اشتراك كل مقدم خدمة نافذة.</p>
 </div>;
}