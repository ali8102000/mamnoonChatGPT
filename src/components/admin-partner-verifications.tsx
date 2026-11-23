import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/lib/toast";
import { CheckCircle2, RefreshCw, XCircle, MapPin, FileText, Phone } from "lucide-react";

type Application = {
  id:string; user_id:string; partner_type:string; business_name:string; license_number:string;
  contact_phone:string; governorate:string; city:string; business_address:string; latitude:number; longitude:number;
  status:string; review_notes:string|null; created_at:string; profile:any;
  documents:{license:string|null;id_front:string|null;id_back:string|null};
};
const typeLabels:Record<string,string>={hotel:"فندق",store:"متجر",mall:"مول",company:"شركة",other:"نشاط آخر"};

export default function AdminPartnerVerifications(){
  const [rows,setRows]=useState<Application[]>([]);
  const [filter,setFilter]=useState("pending");
  const [notes,setNotes]=useState<Record<string,string>>({});
  const [busy,setBusy]=useState<string|null>(null);
  const [loading,setLoading]=useState(true);
  const load=useCallback(async()=>{
    setLoading(true);
    try{
      const {data,error}=await supabase.functions.invoke("admin-users",{body:{action:"list_partner_applications",status:filter,limit:200}});
      if(error||data?.error)throw new Error(data?.error||error?.message||"تعذر تحميل الطلبات");
      setRows(data?.applications||[]);
    }catch(e:any){toast.error(e?.message||"تعذر تحميل طلبات الشركاء");}
    finally{setLoading(false);}
  },[filter]);
  useEffect(()=>{void load();},[load]);
  async function review(row:Application,status:"approved"|"rejected"){
    const review_notes=(notes[row.id]||"").trim();
    if(status==="rejected"&&!review_notes){toast.error("اكتب سبب الرفض حتى يعرف الشريك المطلوب تعديله");return;}
    setBusy(row.id);
    try{
      const {data,error}=await supabase.functions.invoke("admin-users",{body:{action:"review_partner_application",application_id:row.id,status,review_notes}});
      if(error||data?.error)throw new Error(data?.error||error?.message||"تعذر حفظ القرار");
      toast.success(status==="approved"?"تم اعتماد الشريك":"تم رفض الطلب وإرسال سبب الرفض");
      await load();
    }catch(e:any){toast.error(e?.message||"تعذر تنفيذ المراجعة");}
    finally{setBusy(null);}
  }
  return <section dir="rtl" className="space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-black">اعتماد الشركاء والمنشآت</h2><p className="mt-1 text-xs text-muted-foreground">مراجعة إجازات العمل والهويات ومواقع الفنادق والمتاجر والمولات قبل اعتمادها.</p></div><button onClick={()=>void load()} className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-bold"><RefreshCw size={15}/> تحديث</button></header>
    <div className="flex gap-2 overflow-x-auto">{[["pending","بانتظار المراجعة"],["approved","معتمد"],["rejected","مرفوض"],["all","الكل"]].map(([value,label])=><button key={value} onClick={()=>setFilter(value)} className={"whitespace-nowrap rounded-xl px-4 py-2 text-xs font-bold "+(filter===value?"bg-primary text-primary-foreground":"border border-border")}>{label}</button>)}</div>
    {loading?<div className="py-10 text-center text-sm">جارٍ تحميل طلبات الشركاء...</div>:rows.length===0?<div className="rounded-2xl border border-border p-8 text-center text-sm text-muted-foreground">ماكو طلبات بهذا التصنيف.</div>:<div className="space-y-4">{rows.map(row=><article key={row.id} className="rounded-2xl border border-border bg-card p-4 shadow-sm space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-black">{row.business_name}</h3><p className="text-xs text-muted-foreground">{typeLabels[row.partner_type]||row.partner_type} · {row.governorate} / {row.city}</p></div><span className={"rounded-full px-3 py-1 text-xs font-black "+(row.status==="approved"?"bg-emerald-500/10 text-emerald-700":row.status==="rejected"?"bg-red-500/10 text-red-700":"bg-amber-500/10 text-amber-700")}>{row.status==="pending"?"بانتظار":row.status==="approved"?"معتمد":"مرفوض"}</span></div>
      <div className="grid gap-2 text-xs sm:grid-cols-2"><div>صاحب الحساب: <b>{row.profile?.full_name||"—"}</b></div><div className="inline-flex items-center gap-1"><Phone size={13}/>{row.contact_phone} · {row.profile?.phone||""}</div><div>رقم الإجازة: <b>{row.license_number}</b></div><div>تاريخ التقديم: {new Date(row.created_at).toLocaleString("ar-IQ")}</div><div className="sm:col-span-2">العنوان: {row.business_address}</div></div>
      <a href={"https://www.google.com/maps?q="+row.latitude+","+row.longitude} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-xs font-bold text-primary"><MapPin size={15}/> فتح دبوس موقع المنشأة بالخريطة</a>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">{[["إجازة العمل",row.documents?.license],["الهوية - أمام",row.documents?.id_front],["الهوية - خلف",row.documents?.id_back]].map(([label,url])=><div key={String(label)} className="rounded-xl border border-border p-2"><div className="mb-2 flex items-center gap-1 text-xs font-bold"><FileText size={14}/>{label}</div>{url?<a href={String(url)} target="_blank" rel="noreferrer"><img src={String(url)} alt={String(label)} className="h-40 w-full rounded-lg object-contain bg-muted"/><span className="mt-1 block text-center text-[10px] text-primary">فتح المستند</span></a>:<div className="grid h-40 place-items-center text-xs text-muted-foreground">المستند غير متاح</div>}</div>)}</div>
      {row.status==="pending"&&<div className="space-y-2 border-t border-border pt-3"><label className="block text-xs font-bold">ملاحظات الإدارة / سبب الرفض</label><textarea value={notes[row.id]||""} onChange={e=>setNotes(old=>({...old,[row.id]:e.target.value}))} rows={2} maxLength={1000} placeholder="اكتب ملاحظة للشريك عند الحاجة..." className="w-full rounded-xl border border-border bg-background p-3 text-sm"/><div className="flex flex-wrap gap-2"><button disabled={busy===row.id} onClick={()=>void review(row,"approved")} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white"><CheckCircle2 size={15}/>{busy===row.id?"جارٍ الحفظ":"اعتماد الشريك"}</button><button disabled={busy===row.id} onClick={()=>void review(row,"rejected")} className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-xs font-black text-white"><XCircle size={15}/>رفض مع السبب</button></div></div>}
      {row.status!=="pending"&&row.review_notes&&<div className="rounded-xl bg-muted p-3 text-xs">ملاحظات المراجعة: {row.review_notes}</div>}
    </article>)}</div>}
  </section>;
}
