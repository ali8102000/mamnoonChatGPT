import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { GOVERNORATES } from "@/lib/governorates";
import { toast } from "@/lib/toast";

type ProviderType = "driver" | "large_driver" | "worker";
type Mission = {
  mission_id: string; title: string; provider_type: ProviderType; service_slug: string | null;
  target_governorates: string[]; location_scope: string; target_count: number;
  reward_amount_iqd: number; starts_at: string; ends_at: string; status: string;
  participant_count: number; eligible_count: number; approved_count: number; rejected_count: number;
};
type Reward = {
  participant_id: string; mission_id: string; mission_title: string; provider_id: string;
  provider_name: string | null; provider_phone: string | null; governorate_key: string | null;
  provider_type: ProviderType; progress_count: number; target_count: number;
  reward_amount_iqd: number; eligible_at: string | null; reward_status: string;
};
type Detail = {
  request_id: string; request_type: string; request_created_at: string; request_completed_at: string;
  duration_minutes: number | null; customer_name: string | null; customer_phone: string | null;
  origin_governorate: string | null; destination_governorate: string | null;
  pickup_text: string | null; dest_text: string | null;
};
const TYPES: {value:ProviderType;label:string}[] = [
  {value:"driver",label:"كباتن التكسي"},
  {value:"large_driver",label:"سائقو السيارات الكبيرة"},
  {value:"worker",label:"الفنيون"},
];
const SCOPE_LABELS: Record<string,string> = {
  any:"داخل وخارج المحافظة",inside_governorate:"داخل المحافظة فقط",outside_governorate:"خارج المحافظة فقط",
};
const GOV_LABELS = Object.fromEntries(GOVERNORATES.map(g=>[g.key,g.name])) as Record<string,string>;
const money = (n:number) => new Intl.NumberFormat("ar-IQ").format(Number(n)||0)+" د.ع";
const date = (v:string|null) => v ? new Date(v).toLocaleString("ar-IQ") : "—";

export default function AdminProviderMissions() {
  const [title,setTitle]=useState("");
  const [description,setDescription]=useState("");
  const [providerType,setProviderType]=useState<ProviderType>("driver");
  const [serviceSlug,setServiceSlug]=useState("all");
  const [services,setServices]=useState<{slug:string;name_ar:string}[]>([]);
  const [governorates,setGovernorates]=useState<string[]>([]);
  const [locationScope,setLocationScope]=useState("any");
  const [targetCount,setTargetCount]=useState("10");
  const [reward,setReward]=useState("10000");
  const [duration,setDuration]=useState("24");
  const [maxJobHours,setMaxJobHours]=useState("");
  const [saving,setSaving]=useState(false);
  const [missions,setMissions]=useState<Mission[]>([]);
  const [rewards,setRewards]=useState<Reward[]>([]);
  const [selected,setSelected]=useState<string[]>([]);
  const [note,setNote]=useState("");
  const [busy,setBusy]=useState(false);
  const [details,setDetails]=useState<{reward:Reward;rows:Detail[]}|null>(null);
  const [loading,setLoading]=useState(true);

  const load=useCallback(async()=>{
    setLoading(true);
    const [m,r,s]=await Promise.all([
      (supabase as any).rpc("admin_list_provider_missions"),
      (supabase as any).rpc("admin_list_provider_mission_rewards"),
      (supabase as any).from("services").select("slug,name_ar").order("sort_order"),
    ]);
    if(m.error) toast.error("تعذر تحميل المهمات: "+m.error.message); else setMissions((m.data??[]) as Mission[]);
    if(r.error) toast.error("تعذر تحميل المكافآت: "+r.error.message); else setRewards((r.data??[]) as Reward[]);
    if(!s.error) setServices((s.data??[]) as {slug:string;name_ar:string}[]);
    setSelected([]);
    setLoading(false);
  },[]);
  useEffect(()=>{void load();},[load]);

  const eligible=rewards.filter(r=>r.reward_status==="eligible");
  const allEligibleSelected=eligible.length>0&&eligible.every(r=>selected.includes(r.participant_id));
  const selectedEligible=useMemo(()=>selected.filter(id=>eligible.some(r=>r.participant_id===id)),[selected,eligible]);

  const createMission=async()=>{
    const count=Number(targetCount),amount=Number(reward),hours=Number(duration);
    const jobHours=maxJobHours.trim()?Number(maxJobHours):null;
    if(title.trim().length<3||!Number.isInteger(count)||count<1||!Number.isSafeInteger(amount)||amount<1||!Number.isInteger(hours)||hours<1||
      (jobHours!==null&&(!Number.isFinite(jobHours)||jobHours<=0))){
      toast.error("راجع عنوان المهمة والعدد والمكافأة والمدة");return;
    }
    setSaving(true);
    const {error}=await (supabase as any).rpc("admin_create_provider_mission",{
      p_title:title.trim(),p_description:description.trim(),p_provider_type:providerType,
      p_service_slug:providerType==="worker"&&serviceSlug!=="all"?serviceSlug:null,
      p_target_governorates:governorates,p_location_scope:locationScope,
      p_target_count:count,p_reward_amount_iqd:amount,p_duration_hours:hours,
      p_max_job_duration_hours:jobHours,
    });
    setSaving(false);
    if(error){toast.error("فشل إنشاء المهمة: "+error.message);return;}
    toast.success("تم نشر المهمة وإرسال إشعارات للمستهدفين");
    setTitle("");setDescription("");setGovernorates([]);await load();
  };

  const openDetails=async(reward:Reward)=>{
    const {data,error}=await (supabase as any).rpc("admin_get_provider_mission_reward_details",{p_participant_id:reward.participant_id});
    if(error){toast.error("تعذر تحميل تفاصيل الإنجاز: "+error.message);return;}
    setDetails({reward,rows:(data??[]) as Detail[]});
  };

  const decide=async(decision:"approve"|"reject",ids=selectedEligible)=>{
    if(ids.length===0)return;
    if(decision==="reject"&&!note.trim()){toast.error("اكتب سبب الرفض حتى يظهر للمستخدم");return;}
    setBusy(true);
    const {data,error}=await (supabase as any).rpc("admin_decide_provider_mission_rewards",{
      p_participant_ids:ids,p_decision:decision,p_note:note.trim()||null,
    });
    setBusy(false);
    if(error){toast.error("تعذر تنفيذ القرار: "+error.message);return;}
    toast.success(decision==="approve"?"تم اعتماد المكافآت وإضافة الرصيد للمحافظ":"تم رفض طلبات المكافآت");
    setNote("");setSelected([]);await load();
  };

  const toggleGovernorate=(key:string)=>setGovernorates(old=>old.includes(key)?old.filter(x=>x!==key):[...old,key]);
  const toggleReward=(id:string)=>setSelected(old=>old.includes(id)?old.filter(x=>x!==id):[...old,id]);

  return <div className="space-y-5" dir="rtl">
    <section className="rounded-3xl border bg-card p-5 space-y-4">
      <div><h2 className="text-xl font-black">إنشاء مهمة جديدة</h2><p className="mt-1 text-sm text-muted-foreground">تُرسل للمستهدفين فقط، ويُحسب الإنجاز من الطلبات المكتملة المسجلة في قاعدة البيانات.</p></div>
      <label className="block text-sm font-bold">عنوان المهمة<input value={title} onChange={e=>setTitle(e.target.value)} maxLength={120} placeholder="مثلاً: أنجز 10 رحلات واحصل على 10 آلاف" className="mt-1 w-full rounded-xl border bg-background p-3"/></label>
      <label className="block text-sm font-bold">تفاصيل وشروط المهمة<textarea value={description} onChange={e=>setDescription(e.target.value)} maxLength={1000} rows={3} placeholder="اكتب الشروط التي ستظهر للكابتن أو الفني" className="mt-1 w-full rounded-xl border bg-background p-3"/></label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-sm font-bold">الفئة المستهدفة<select value={providerType} onChange={e=>setProviderType(e.target.value as ProviderType)} className="mt-1 w-full rounded-xl border bg-background p-3">{TYPES.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}</select></label>
        {providerType==="worker"&&<label className="text-sm font-bold">تخصص الفني<select value={serviceSlug} onChange={e=>setServiceSlug(e.target.value)} className="mt-1 w-full rounded-xl border bg-background p-3"><option value="all">كل تخصصات الفنيين</option>{services.map(s=><option key={s.slug} value={s.slug}>{s.name_ar}</option>)}</select></label>}
        <label className="text-sm font-bold">شرط مكان الإنجاز<select value={locationScope} onChange={e=>setLocationScope(e.target.value)} className="mt-1 w-full rounded-xl border bg-background p-3"><option value="any">داخل وخارج المحافظة</option><option value="inside_governorate">داخل المحافظة فقط</option><option value="outside_governorate">خارج المحافظة فقط</option></select></label>
        <label className="text-sm font-bold">عدد الرحلات / الأعمال المطلوبة<input type="number" min="1" max="1000" value={targetCount} onChange={e=>setTargetCount(e.target.value)} className="mt-1 w-full rounded-xl border bg-background p-3"/></label>
        <label className="text-sm font-bold">المكافأة لكل مستخدم (دينار)<input type="number" min="1" max="100000000" value={reward} onChange={e=>setReward(e.target.value)} className="mt-1 w-full rounded-xl border bg-background p-3"/></label>
        <label className="text-sm font-bold">مدة المهمة بالساعات<input type="number" min="1" max="720" value={duration} onChange={e=>setDuration(e.target.value)} className="mt-1 w-full rounded-xl border bg-background p-3"/></label>
        <label className="text-sm font-bold">الحد الأقصى لمدة الرحلة / العمل (اختياري — ساعة)<input type="number" min="0.1" max="720" step="0.1" value={maxJobHours} onChange={e=>setMaxJobHours(e.target.value)} placeholder="مثلاً 2" className="mt-1 w-full rounded-xl border bg-background p-3"/></label>
      </div>
      <div className="space-y-2"><div className="text-sm font-bold">المحافظات المستهدفة</div><p className="text-xs text-muted-foreground">عدم اختيار أي محافظة يعني كل العراق.</p><div className="grid grid-cols-2 sm:grid-cols-3 gap-2">{GOVERNORATES.map(g=><label key={g.key} className="flex items-center gap-2 rounded-xl border p-2 text-sm"><input type="checkbox" checked={governorates.includes(g.key)} onChange={()=>toggleGovernorate(g.key)}/>{g.name}</label>)}</div></div>
      <button onClick={()=>void createMission()} disabled={saving} className="w-full rounded-xl bg-primary px-4 py-3 font-black text-primary-foreground disabled:opacity-50">{saving?"جارٍ نشر المهمة...":"نشر المهمة وإرسال الإشعارات"}</button>
    </section>

    <section className="rounded-3xl border bg-card p-5 space-y-3">
      <div className="flex items-center justify-between gap-2"><h2 className="text-lg font-black">المهمات المنشورة</h2><button onClick={()=>void load()} className="rounded-xl border px-3 py-2 text-xs font-bold">تحديث</button></div>
      {loading?"جارٍ التحميل...":missions.length===0?<p className="text-sm text-muted-foreground">لا توجد مهمات منشورة.</p>:missions.map(m=><div key={m.mission_id} className="rounded-2xl border p-3 space-y-1"><div className="flex flex-wrap justify-between gap-2"><b>{m.title}</b><span className="text-xs text-muted-foreground">{m.status==="active"?"نشطة":m.status}</span></div><div className="text-xs text-muted-foreground">{TYPES.find(t=>t.value===m.provider_type)?.label} · {SCOPE_LABELS[m.location_scope]} · {m.target_governorates.length?m.target_governorates.map(g=>GOV_LABELS[g]??g).join("، "):"كل العراق"}</div><div className="text-sm">الهدف {m.target_count} · المكافأة {money(m.reward_amount_iqd)} · المشاركون {m.participant_count}</div><div className="text-xs text-muted-foreground">بانتظار الموافقة: {m.eligible_count} · معتمدة: {m.approved_count} · مرفوضة: {m.rejected_count} · تنتهي {date(m.ends_at)}</div></div>)}
    </section>

    <section className="rounded-3xl border bg-card p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-lg font-black">مراجعة إنجازات المكافآت</h2><p className="text-xs text-muted-foreground">لا تُضاف أي مكافأة إلى المحفظة إلا بعد اعتمادها.</p></div><button onClick={()=>void load()} className="rounded-xl border px-3 py-2 text-xs font-bold">تحديث القائمة</button></div>
      {eligible.length>0&&<div className="flex flex-wrap items-center gap-2"><button onClick={()=>setSelected(allEligibleSelected?[]:eligible.map(r=>r.participant_id))} className="rounded-xl border px-3 py-2 text-xs font-bold">{allEligibleSelected?"إلغاء تحديد الكل":"تحديد كل المستحقين"}</button><span className="text-xs text-muted-foreground">المحدد: {selectedEligible.length}</span><button disabled={busy||selectedEligible.length===0} onClick={()=>void decide("approve")} className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50">موافقة وإيداع</button><button disabled={busy||selectedEligible.length===0} onClick={()=>void decide("reject")} className="rounded-xl bg-red-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50">رفض</button></div>}
      {eligible.length>0&&<textarea value={note} onChange={e=>setNote(e.target.value)} rows={2} placeholder="سبب الرفض (مطلوب عند الرفض) أو ملاحظة القرار" className="w-full rounded-xl border bg-background p-3 text-sm"/>}
      {loading?"جارٍ تحميل المطالبات...":rewards.length===0?<p className="text-sm text-muted-foreground">لا توجد مطالبات مكافآت حتى الآن.</p>:rewards.map(r=><div key={r.participant_id} className="rounded-2xl border p-3 space-y-2"><div className="flex items-start gap-2"><input type="checkbox" checked={selected.includes(r.participant_id)} disabled={r.reward_status!=="eligible"} onChange={()=>toggleReward(r.participant_id)} className="mt-1"/><div className="min-w-0 flex-1"><div className="font-bold">{r.provider_name??"مقدم خدمة"} · {r.mission_title}</div><div className="text-xs text-muted-foreground">{TYPES.find(t=>t.value===r.provider_type)?.label} · {GOV_LABELS[r.governorate_key??""]??r.governorate_key??"—"} · {r.provider_phone??"—"}</div><div className="text-sm">أنجز {r.progress_count} من {r.target_count} · المكافأة {money(r.reward_amount_iqd)}</div><div className="text-xs text-muted-foreground">الحالة: {r.reward_status==="eligible"?"بانتظار القرار":r.reward_status==="approved"?"تم الإيداع":"مرفوضة"} · {date(r.eligible_at)}</div></div><button onClick={()=>void openDetails(r)} className="rounded-xl border px-3 py-2 text-xs font-bold shrink-0">التفاصيل</button></div>{r.reward_status==="eligible"&&<div className="flex gap-2"><button disabled={busy} onClick={()=>void decide("approve",[r.participant_id])} className="flex-1 rounded-xl bg-emerald-600 py-2 text-xs font-black text-white">موافقة</button><button disabled={busy} onClick={()=>{setSelected([r.participant_id]);toast.info("اكتب سبب الرفض ثم اضغط زر الرفض أعلاه");}} className="flex-1 rounded-xl bg-red-600 py-2 text-xs font-black text-white">رفض</button></div>}</div>)}
    </section>

    {details&&<div className="fixed inset-0 z-[100] grid place-items-center bg-black/60 p-3" onClick={()=>setDetails(null)}><div className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-3xl bg-background p-5 space-y-3" onClick={e=>e.stopPropagation()}><div className="flex justify-between gap-3"><div><h3 className="font-black text-lg">{details.reward.provider_name??"مقدم الخدمة"}</h3><p className="text-xs text-muted-foreground">{details.reward.mission_title} · {details.reward.provider_phone??"—"}</p></div><button onClick={()=>setDetails(null)} className="text-2xl">×</button></div>{details.rows.length===0?<p className="text-sm text-muted-foreground">لا توجد تفاصيل إنجاز مسجلة.</p>:details.rows.map(row=><div key={row.request_id} className="rounded-xl border p-3 text-sm space-y-1"><b>{row.request_type==="taxi"?"رحلة سيارة":"عمل خدمة"}</b><div>وقت الطلب: {date(row.request_created_at)}</div><div>وقت الإكمال: {date(row.request_completed_at)}</div><div>المدة: {row.duration_minutes??"—"} دقيقة</div><div>العميل: {row.customer_name??"—"} · {row.customer_phone??"—"}</div><div>من: {row.pickup_text??"—"} ({GOV_LABELS[row.origin_governorate??""]??row.origin_governorate??"—"})</div><div>إلى: {row.dest_text??"—"} ({GOV_LABELS[row.destination_governorate??""]??row.destination_governorate??"—"})</div></div>)}</div></div>}
  </div>;
}
