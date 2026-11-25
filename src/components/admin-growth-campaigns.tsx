import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { GOVERNORATES } from "@/lib/governorates";
import { toast } from "@/lib/toast";

type Campaign = {
  campaign_id: string; campaign_type: string; title: string; provider_type: string | null;
  service_slug: string | null; target_governorates: string[]; amount_iqd: number; budget_iqd: number; spent_iqd: number;
  delay_days: number; coupon_valid_days: number; max_awards: number; issued_count: number;
  starts_at: string; ends_at: string; active: boolean; created_at: string;
  coupon_request_types: string[]; coupon_vehicle_categories: string[]; coupon_service_slugs: string[];
};
type Award = {
  award_id: string; campaign_title: string; full_name: string | null; phone: string | null;
  governorate_key: string | null; award_type: string; amount_iqd: number; coupon_code: string | null;
  created_at: string;
};
const PROVIDER_TYPES = [
  { value: "all", label: "كل مزوّدي الخدمة" },
  { value: "driver", label: "التكسي" },
  { value: "large_driver", label: "السيارات الكبيرة" },
  { value: "worker", label: "الفنيون" },
];
const GOV_LABELS = Object.fromEntries(GOVERNORATES.map(g => [g.key,g.name])) as Record<string,string>;
const money = (n:number) => new Intl.NumberFormat("ar-IQ").format(Number(n)||0)+" د.ع";
const localInput = (date:Date) => {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime()-offset*60000).toISOString().slice(0,16);
};

export default function AdminGrowthCampaigns() {
  const [kind,setKind] = useState<"provider_wallet_signup"|"customer_delayed_coupon">("provider_wallet_signup");
  const [editingId,setEditingId] = useState<string|null>(null);
  const [title,setTitle] = useState("مكافأة التسجيل الجديدة");
  const [providerType,setProviderType] = useState("driver");
  const [serviceSlug,setServiceSlug] = useState("");
  const [amount,setAmount] = useState("50000");
  const [budget,setBudget] = useState("100000000");
  const [delay,setDelay] = useState("3");
  const [couponDays,setCouponDays] = useState("7");
  const [maxAwards,setMaxAwards] = useState("100000");
  const [startsAt,setStartsAt] = useState(localInput(new Date()));
  const [endsAt,setEndsAt] = useState(localInput(new Date(Date.now()+30*86400000)));
  const [governorates,setGovernorates] = useState<string[]>([]);
  const [couponRequestTypes,setCouponRequestTypes] = useState<string[]>(["taxi"]);
  const [couponVehicleCategories,setCouponVehicleCategories] = useState<string[]>(["economy","premium","luxury","large"]);
  const [couponServicesText,setCouponServicesText] = useState("");
  const [active,setActive] = useState(false);
  const [campaigns,setCampaigns] = useState<Campaign[]>([]);
  const [awards,setAwards] = useState<Award[]>([]);
  const [loading,setLoading] = useState(true);
  const [saving,setSaving] = useState(false);
  const [error,setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [c,a] = await Promise.all([
      (supabase as any).rpc("admin_list_growth_campaigns_v2"),
      (supabase as any).rpc("admin_list_growth_awards",{p_limit:100}),
    ]);
    if(c.error || a.error) setError(c.error?.message || a.error?.message || "تعذّر تحميل الحملات");
    else { setCampaigns(c.data??[]); setAwards(a.data??[]); setError(""); }
    setLoading(false);
  },[]);
  useEffect(()=>{ void load(); },[load]);

  const isCustomer = kind==="customer_delayed_coupon";
  const selectedGovs = useMemo(()=>governorates.length===0?"كل العراق":governorates.map(g=>GOV_LABELS[g]??g).join("، "),[governorates]);
  const save = async () => {
    const amountN=Number(amount), delayN=Number(delay), maxN=Number(maxAwards), couponN=Number(couponDays);
    if(!title.trim() || !Number.isSafeInteger(amountN) || amountN<1 || !Number.isSafeInteger(Number(budget)) || Number(budget)<amountN || !Number.isInteger(maxN) || maxN<1) {
      setError("تأكد من اسم الحملة والمبلغ والعدد الأقصى.");
      return;
    }
    if(isCustomer && (!Number.isInteger(delayN) || delayN<1 || delayN>3650)) {
      setError("مدة انتظار الزبون يجب أن تكون يوماً واحداً أو أكثر.");
      return;
    }
    if(isCustomer && (!Number.isInteger(couponN) || couponN<0 || couponN>3650)) {
      setError("مدة صلاحية الكوبون يجب أن تكون صفراً أو أكثر.");
      return;
    }
    if(new Date(endsAt)<=new Date(startsAt)) { setError("تاريخ نهاية الحملة يجب أن يكون بعد بدايتها."); return; }
    setSaving(true); setError("");
    const {error:saveError}=await (supabase as any).rpc("admin_save_growth_campaign_v2",{
      p_campaign_id:editingId,p_campaign_type:kind,p_title:title.trim(),
      p_provider_type:isCustomer?null:providerType,p_service_slug:isCustomer?null:(serviceSlug.trim()||null),
      p_target_governorates:governorates,p_amount_iqd:amountN,p_budget_iqd:Number(budget),p_delay_days:isCustomer?delayN:0,
      p_coupon_valid_days:isCustomer?couponN:0,p_max_awards:maxN,
      p_starts_at:new Date(startsAt).toISOString(),p_ends_at:new Date(endsAt).toISOString(),p_active:active,
      p_coupon_request_types:couponRequestTypes,
      p_coupon_vehicle_categories:couponVehicleCategories,
      p_coupon_service_slugs:couponServicesText.split(",").map(x=>x.trim()).filter(Boolean)
    });
    setSaving(false);
    if(saveError) setError(saveError.message);
    else { toast.success(editingId?"تم تحديث الحملة":active?"تم إنشاء الحملة وتفعيلها":"تم حفظ الحملة كمسودة"); setEditingId(null); await load(); }
  };
  const editCampaign = (c:Campaign) => {
    setEditingId(c.campaign_id); setKind(c.campaign_type as any); setTitle(c.title);
    setProviderType(c.provider_type??"driver"); setServiceSlug(c.service_slug??"");
    setCouponRequestTypes(c.coupon_request_types??["taxi"]);
    setCouponVehicleCategories(c.coupon_vehicle_categories??["economy","premium","luxury","large"]);
    setCouponServicesText((c.coupon_service_slugs??[]).join(","));
    setAmount(String(c.amount_iqd)); setBudget(String(c.budget_iqd)); setDelay(String(c.delay_days)); setCouponDays(String(c.coupon_valid_days));
    setMaxAwards(String(c.max_awards)); setStartsAt(localInput(new Date(c.starts_at)));
    setEndsAt(localInput(new Date(c.ends_at))); setGovernorates(c.target_governorates??[]); setActive(c.active);
    setError(""); window.scrollTo({top:0,behavior:"smooth"});
  };
  const toggleCampaign = async (c:Campaign) => {
    const {error:e}=await (supabase as any).rpc("admin_save_growth_campaign_v2",{
      p_campaign_id:c.campaign_id,p_campaign_type:c.campaign_type,p_title:c.title,
      p_provider_type:c.provider_type,p_service_slug:c.service_slug,p_target_governorates:c.target_governorates,
      p_amount_iqd:c.amount_iqd,p_budget_iqd:c.budget_iqd,p_delay_days:c.delay_days,p_coupon_valid_days:c.coupon_valid_days,
      p_max_awards:c.max_awards,p_starts_at:c.starts_at,p_ends_at:c.ends_at,p_active:!c.active,
      p_coupon_request_types:c.coupon_request_types??["taxi"],p_coupon_vehicle_categories:c.coupon_vehicle_categories??["economy","premium","luxury","large"],p_coupon_service_slugs:c.coupon_service_slugs??[]
    });
    if(e) toast.error(e.message); else { toast.success(c.active?"تم إيقاف الحملة":"تم تفعيل الحملة"); await load(); }
  };

  return <div className="space-y-4" dir="rtl">
    <div className="glass rounded-2xl p-4 space-y-2">
      <h2 className="text-xl font-black">عروض التسجيل والمكافآت التلقائية</h2>
      <p className="text-xs leading-6 text-muted-foreground">أنشئ مكافآت لمحافظ مزوّدي الخدمة، أو كوبونات للزبائن بعد مدة تختارها. كل حملة لها ميزانية عددية ونطاق جغرافي وتاريخ بداية ونهاية. الحملات الجديدة تبدأ متوقفة حتى تفعّلها بنفسك.</p>
      <div className="grid grid-cols-2 gap-2">
        <button onClick={()=>{setKind("provider_wallet_signup");setAmount("50000");}} className={`rounded-xl p-3 text-sm font-black border ${!isCustomer?"bg-primary text-primary-foreground":"bg-background"}`}>مكافأة مزوّد الخدمة</button>
        <button onClick={()=>{setKind("customer_delayed_coupon");setAmount("3500");}} className={`rounded-xl p-3 text-sm font-black border ${isCustomer?"bg-primary text-primary-foreground":"bg-background"}`}>خصم الزبون بعد مدة</button>
      </div>
    </div>
    <div className="glass rounded-2xl p-4 space-y-3">
      <label className="block text-xs font-bold">اسم الحملة<input value={title} onChange={e=>setTitle(e.target.value)} className="mt-1 w-full rounded-xl border bg-background p-3" maxLength={120}/></label>
      {!isCustomer&&<label className="block text-xs font-bold">الفئة المستفيدة<select value={providerType} onChange={e=>setProviderType(e.target.value)} className="mt-1 w-full rounded-xl border bg-background p-3">{PROVIDER_TYPES.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}</select></label>}
      {!isCustomer&&providerType==="worker"&&<label className="block text-xs font-bold">رمز تخصص الفني (اختياري)<input value={serviceSlug} onChange={e=>setServiceSlug(e.target.value)} placeholder="اتركه فارغاً لكل التخصصات" className="mt-1 w-full rounded-xl border bg-background p-3" /></label>}
      <label className="block text-xs font-bold">{isCustomer?"قيمة الخصم الثابت":"مبلغ الإيداع في محفظة المزود"} (دينار عراقي)<input type="number" min="1" value={amount} onChange={e=>setAmount(e.target.value)} className="mt-1 w-full rounded-xl border bg-background p-3" /></label>
      {isCustomer&&<div className="rounded-xl border p-3 space-y-2">
        <div className="text-xs font-black">الخدمات التي يقبلها الكوبون</div>
        <div className="flex flex-wrap gap-2">
          {[["taxi","التكسي"],["service","خدمات الفنيين"]].map(([v,l])=><label key={v} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={couponRequestTypes.includes(v)} onChange={e=>setCouponRequestTypes(old=>e.target.checked?[...old,v]:old.filter(x=>x!==v))}/>{l}</label>)}
        </div>
        {couponRequestTypes.includes("taxi")&&<div className="space-y-1"><div className="text-xs font-bold">فئات التكسي</div><div className="flex flex-wrap gap-2">{[["economy","اقتصادي"],["premium","مميز"],["luxury","فاخر"],["large","سيارات كبيرة"]].map(([v,l])=><label key={v} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={couponVehicleCategories.includes(v)} onChange={e=>setCouponVehicleCategories(old=>e.target.checked?[...old,v]:old.filter(x=>x!==v))}/>{l}</label>)}</div></div>}
        {couponRequestTypes.includes("service")&&<label className="block text-xs font-bold">تخصصات الفنيين (رموز الخدمات مفصولة بفواصل، واتركه فارغاً لكل التخصصات)<input value={couponServicesText} onChange={e=>setCouponServicesText(e.target.value)} placeholder="electrician,plumbing" className="mt-1 w-full rounded-xl border bg-background p-3"/></label>}
      </div>}
      {isCustomer&&<div className="grid grid-cols-2 gap-2">
        <label className="block text-xs font-bold">بعد كم يوم من التسجيل؟<input type="number" min="1" max="3650" value={delay} onChange={e=>setDelay(e.target.value)} className="mt-1 w-full rounded-xl border bg-background p-3"/></label>
        <label className="block text-xs font-bold">صلاحية الكوبون بالأيام (0 بلا انتهاء)<input type="number" min="0" max="3650" value={couponDays} onChange={e=>setCouponDays(e.target.value)} className="mt-1 w-full rounded-xl border bg-background p-3"/></label>
      </div>}
      <label className="block text-xs font-bold">الميزانية الإجمالية للحملة (دينار عراقي)<input type="number" min={amount} value={budget} onChange={e=>setBudget(e.target.value)} className="mt-1 w-full rounded-xl border bg-background p-3" /></label>
      <label className="block text-xs font-bold">الحد الأقصى للمستفيدين<input type="number" min="1" max="1000000" value={maxAwards} onChange={e=>setMaxAwards(e.target.value)} className="mt-1 w-full rounded-xl border bg-background p-3"/></label>
      <div className="space-y-2"><div className="text-xs font-black">المحافظات المستهدفة</div><p className="text-[11px] text-muted-foreground">عدم اختيار أي محافظة يعني كل العراق.</p>
        <div className="flex flex-wrap gap-2">{GOVERNORATES.map(g=><label key={g.key} className="flex items-center gap-1 rounded-lg border px-2 py-1.5 text-xs"><input type="checkbox" checked={governorates.includes(g.key)} onChange={e=>setGovernorates(v=>e.target.checked?[...v,g.key]:v.filter(x=>x!==g.key))}/>{g.name}</label>)}</div>
        <div className="text-[11px] text-muted-foreground">النطاق الحالي: {selectedGovs}</div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs font-bold">تبدأ<input type="datetime-local" value={startsAt} onChange={e=>setStartsAt(e.target.value)} className="mt-1 w-full rounded-xl border bg-background p-3"/></label>
        <label className="block text-xs font-bold">تنتهي<input type="datetime-local" value={endsAt} onChange={e=>setEndsAt(e.target.value)} className="mt-1 w-full rounded-xl border bg-background p-3"/></label>
      </div>
      <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)}/> تفعيل الحملة فور الحفظ</label>
      <button disabled={saving} onClick={()=>void save()} className="w-full rounded-xl bg-primary py-3 font-black text-primary-foreground disabled:opacity-50">{saving?"جارٍ الحفظ...":editingId?"حفظ التعديلات":"حفظ الحملة"}</button>
      {editingId&&<button onClick={()=>setEditingId(null)} className="w-full rounded-xl border py-2 text-xs font-bold">إلغاء التعديل</button>}
      {error&&<div role="alert" className="rounded-xl bg-red-50 p-3 text-xs text-red-700">{error}</div>}
    </div>
    <div className="glass rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between"><h3 className="font-black">الحملات المسجلة</h3><button onClick={()=>void load()} className="text-xs font-bold text-primary">تحديث</button></div>
      {loading?<div className="text-sm text-muted-foreground">جارٍ التحميل...</div>:campaigns.length===0?<div className="text-sm text-muted-foreground">ماكو حملات بعد.</div>:campaigns.map(c=><div key={c.campaign_id} className="rounded-xl border p-3 space-y-2">
        <div className="flex items-start justify-between gap-2"><div><div className="font-black text-sm">{c.title}</div><div className="text-[11px] text-muted-foreground">{c.campaign_type==="provider_wallet_signup"?"مكافأة محفظة مزود":"كوبون زبون مؤجل"} · {c.provider_type?PROVIDER_TYPES.find(x=>x.value===c.provider_type)?.label??c.provider_type:"الزبائن"} · {c.target_governorates.length?c.target_governorates.map(g=>GOV_LABELS[g]??g).join("، "):"كل العراق"}</div></div><span className={`rounded-full px-2 py-1 text-[10px] ${c.active?"bg-emerald-100 text-emerald-700":"bg-muted text-muted-foreground"}`}>{c.active?"فعّالة":"متوقفة"}</span></div>
        <div className="text-xs">القيمة: {money(c.amount_iqd)} · {c.campaign_type==="customer_delayed_coupon"?`بعد ${c.delay_days} يوم`:"عند التسجيل"} · المستفيدون: {c.issued_count}/{c.max_awards} · المصروف: {money(c.spent_iqd)}/{money(c.budget_iqd)}</div>
        <div className="text-[10px] text-muted-foreground">{new Date(c.starts_at).toLocaleString("ar-IQ")} — {new Date(c.ends_at).toLocaleString("ar-IQ")}</div>
        <div className="grid grid-cols-2 gap-2"><button onClick={()=>editCampaign(c)} className="rounded-lg border py-2 text-xs font-bold">تعديل</button><button onClick={()=>void toggleCampaign(c)} className="rounded-lg border py-2 text-xs font-bold">{c.active?"إيقاف الحملة":"تفعيل الحملة"}</button></div>
      </div>)}
    </div>
    <div className="glass rounded-2xl p-4 space-y-3">
      <h3 className="font-black">آخر المكافآت والخصومات الممنوحة</h3>
      {awards.length===0?<div className="text-sm text-muted-foreground">ماكو عمليات صرف مسجلة.</div>:awards.slice(0,30).map(a=><div key={a.award_id} className="flex items-start justify-between gap-3 border-b pb-2 text-xs"><div><div className="font-bold">{a.full_name??"مستخدم"} · {a.phone??"—"}</div><div className="text-muted-foreground">{a.campaign_title} · {a.governorate_key?GOV_LABELS[a.governorate_key]??a.governorate_key:"—"}</div>{a.coupon_code&&<div>كوبون: {a.coupon_code}</div>}</div><div className="shrink-0 font-black">{money(a.amount_iqd)}<div className="font-normal text-muted-foreground">{new Date(a.created_at).toLocaleDateString("ar-IQ")}</div></div></div>)}
    </div>
  </div>;
}
