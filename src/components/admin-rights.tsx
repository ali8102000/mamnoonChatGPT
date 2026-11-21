import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/lib/toast";
import { Wallet, Search, PlusCircle, MinusCircle, ShieldCheck, Settings2, Receipt, RefreshCw } from "lucide-react";

type User = { id:string; full_name:string|null; phone:string|null; email:string|null; governorate_key:string|null; roles:string[]; partner?:any; balance_iqd:number };
type Policy = { id:string; scope_type:string; scope_key:string|null; commission_rate_percent:number; commission_charge_percent:number; collection_event:string; free_trial_enabled:boolean; free_trial_days:number; new_users_only:boolean; is_enabled:boolean; starts_at:string|null; ends_at:string|null };
type Override = { id:string; user_id:string; commission_charge_percent:number; ends_at:string|null; created_at:string; profile?:{full_name?:string|null;phone?:string|null}|null };
type Collection = { id:string; payment_id:string; amount_iqd:number; provider_reference:string; created_at:string };
type Revenue = { id:string; user_id:string; revenue_type:string; assessed_iqd:number; collected_iqd:number; waived_iqd:number; status:string; created_at:string; profile?:{full_name?:string|null;phone?:string|null}|null };

const durations = [{value:"1",label:"يوم"},{value:"7",label:"أسبوع"},{value:"30",label:"شهر"},{value:"90",label:"٣ أشهر"},{value:"180",label:"٦ أشهر"},{value:"365",label:"سنة"},{value:"permanent",label:"دائم"}];
const roles = [{value:"driver",label:"أصحاب التكسي"},{value:"large_driver",label:"التكسي الكبير"},{value:"worker",label:"الفنيون"},{value:"restaurant",label:"المطاعم"},{value:"hotel",label:"الفنادق"},{value:"store",label:"المتاجر"}];
const governorates = ["baghdad","basra","nineveh","erbil","sulaymaniyah","duhok","kirkuk","najaf","karbala","babil","anbar","diyala","saladin","wasit","dhiqar","maysan","muthanna","qadisiyah"];
const govLabels:Record<string,string>={baghdad:"بغداد",basra:"البصرة",nineveh:"نينوى",erbil:"أربيل",sulaymaniyah:"السليمانية",duhok:"دهوك",kirkuk:"كركوك",najaf:"النجف",karbala:"كربلاء",babil:"بابل",anbar:"الأنبار",diyala:"ديالى",saladin:"صلاح الدين",wasit:"واسط",dhiqar:"ذي قار",maysan:"ميسان",muthanna:"المثنى",qadisiyah:"القادسية"};

export default function AdminRights() {
  const [tab,setTab]=useState<"wallet"|"special"|"policies"|"revenue">("wallet");
  const [query,setQuery]=useState(""); const [users,setUsers]=useState<User[]>([]); const [selected,setSelected]=useState<User|null>(null);
  const [amount,setAmount]=useState(""); const [note,setNote]=useState(""); const [kind,setKind]=useState<"debit"|"credit">("debit");
  const [chargePercent,setChargePercent]=useState("0"); const [duration,setDuration]=useState("30"); const [overrideReason,setOverrideReason]=useState("إعفاء أو تخفيض عمولة بموافقة الإدارة");
  const [policies,setPolicies]=useState<Policy[]>([]); const [overrides,setOverrides]=useState<Override[]>([]); const [revenue,setRevenue]=useState<Revenue[]>([]); const [collections,setCollections]=useState<Collection[]>([]); const [summary,setSummary]=useState<any>({});
  const [scope,setScope]=useState("global"); const [scopeKey,setScopeKey]=useState("");
  const [commissionRate,setCommissionRate]=useState("0"); const [commissionCharge,setCommissionCharge]=useState("100");
  const [event,setEvent]=useState("taxi_acceptance"); const [trialEnabled,setTrialEnabled]=useState(false); const [trialDays,setTrialDays]=useState("30"); const [policyEnabled,setPolicyEnabled]=useState(false);
  const [busy,setBusy]=useState(false); const [loading,setLoading]=useState(false); const [error,setError]=useState("");

  const invoke=useCallback(async(body:Record<string,unknown>)=>{
    const {data,error:callError}=await supabase.functions.invoke("admin-rights",{body});
    if(callError) throw new Error(callError.message||"تعذر الاتصال بحقوق ممنون");
    if(data?.error) throw new Error(data.error);
    return data;
  },[]);

  const load=useCallback(async()=>{
    setLoading(true);setError("");
    try{const data=await invoke({action:"list"});setPolicies(data.policies??[]);setOverrides(data.overrides??[]);setRevenue(data.revenue??[]);setCollections(data.collections??[]);setSummary(data.summary??{});}
    catch(e:any){setError(String(e?.message||"تعذر تحميل إعدادات الحقوق"));}finally{setLoading(false);}
  },[invoke]);
  useEffect(()=>{if(tab==="policies"||tab==="revenue"||tab==="special") void load();},[tab,load]);

  const searchUsers=async()=>{
    if(query.trim().length<2){toast.error("اكتب حرفين أو أكثر للبحث");return;}
    setBusy(true);
    try{const data=await invoke({action:"search_users",query:query.trim()});setUsers(data.users??[]);setSelected(null);}
    catch(e:any){toast.error(String(e?.message||"تعذر البحث"));}finally{setBusy(false);}
  };

  const adjustWallet=async()=>{
    if(!selected||!/^\d+$/.test(amount)||Number(amount)<=0||!note.trim()){toast.error("اختار مستخدماً واكتب مبلغاً وسبباً صحيحاً");return;}
    setBusy(true);
    try{
      const idempotency=globalThis.crypto?.randomUUID?.()||("admin-"+Date.now()+"-"+selected.id);
      const result=await invoke({action:"wallet_adjust",user_id:selected.id,amount_iqd:Number(amount),type:kind,note:note.trim(),idempotency_key:idempotency});
      toast.success("تم تسجيل الحركة. الرصيد الجديد: "+Number(result.result?.balance_iqd??0).toLocaleString("ar-IQ")+" د.ع");
      setAmount("");setNote("");await searchUsers();
    }catch(e:any){toast.error(String(e?.message||"تعذر تعديل المحفظة"));}finally{setBusy(false);}
  };

  const saveOverride=async()=>{
    if(!selected||!Number.isFinite(Number(chargePercent))||Number(chargePercent)<0||Number(chargePercent)>100||!overrideReason.trim()){toast.error("تحقق من المستخدم والنسبة والسبب");return;}
    const end=duration==="permanent"?null:new Date(Date.now()+Number(duration)*86400000).toISOString();
    setBusy(true);
    try{await invoke({action:"save_override",user_id:selected.id,charge_percent:Number(chargePercent),starts_at:new Date().toISOString(),ends_at:end,reason:overrideReason.trim()});toast.success("تم حفظ الميزة الخاصة");await load();}
    catch(e:any){toast.error(String(e?.message||"تعذر حفظ الميزة"));}finally{setBusy(false);}
  };

  const revokeOverride=async(id:string)=>{
    if(!confirm("تأكيد إلغاء الميزة الخاصة؟")) return;
    try{await invoke({action:"revoke_override",override_id:id});toast.success("تم إلغاء الميزة");await load();}
    catch(e:any){toast.error(String(e?.message||"تعذر إلغاء الميزة"));}
  };

  const savePolicy=async()=>{
    const key=scope==="global"?null:scopeKey.trim();
    if(scope!=="global"&&!key){toast.error("حدد المحافظة أو الفئة");return;}
    const rate=Number(commissionRate),charge=Number(commissionCharge),days=Number(trialDays);
    if(![rate,charge,days].every(Number.isFinite)||rate<0||rate>100||charge<0||charge>100||days<0||days>365){toast.error("تحقق من النسب ومدة التجربة");return;}
    setBusy(true);
    try{await invoke({action:"save_policy",scope_type:scope,scope_key:key,commission_rate_percent:rate,commission_charge_percent:charge,collection_event:event,free_trial_enabled:trialEnabled,free_trial_days:days,new_users_only:true,is_enabled:policyEnabled,starts_at:new Date().toISOString(),ends_at:null});toast.success(policyEnabled?"تم تفعيل سياسة العمولة":"تم إيقاف السياسة الجديدة وإغلاق السابقة");await load();}
    catch(e:any){toast.error(String(e?.message||"تعذر حفظ سياسة العمولة"));}finally{setBusy(false);}
  };

  const revenueLabel:Record<string,string>={taxi_commission:"عمولة التكسي",service_commission:"عمولة الفني",order_commission:"عمولة طلب شريك",complaint_deduction:"استقطاع شكوى",wallet_debt_collection:"تحصيل دين المحفظة",admin_credit_reversal:"تسوية إدارية"};
  const statusLabel:Record<string,string>={accrued:"مستحق",partially_collected:"محصل جزئياً",collected:"محصل",void:"ملغى",partially_waived:"معفى جزئياً",waived:"مغلق بالإعفاء"};
  const scopeLabel:Record<string,string>={global:"كل العراق",governorate:"محافظة",role:"فئة",governorate_role:"فئة داخل محافظة"};
  const eventLabel:Record<string,string>={taxi_acceptance:"قبول رحلة تكسي",service_acceptance:"قبول طلب فني",order_acceptance:"قبول طلب شريك",all_acceptance:"كل العمليات"};
  const formatScopeKey=(p:Policy)=>{
    if(p.scope_type==="global")return "كل العراق";
    const roleLabels:Record<string,string>={driver:"أصحاب التكسي",large_driver:"التكسي الكبير",worker:"الفنيون",restaurant:"المطاعم",hotel:"الفنادق",store:"المتاجر"};
    if(p.scope_type==="governorate")return govLabels[p.scope_key||""]||p.scope_key||"";
    if(p.scope_type==="role")return roleLabels[p.scope_key||""]||p.scope_key||"";
    const [gov,role]=(p.scope_key||"").split(":");
    return (govLabels[gov]||gov)+" · "+(roleLabels[role]||role);
  };
  const categoryLabel=(u:User)=>{
    const value=String(u.partner?.partner_type||u.partner?.business_vertical||"").toLowerCase();
    if(value.includes("restaurant")||value.includes("food"))return "مطعم";
    if(value.includes("hotel")||value.includes("hospitality"))return "فندق";
    if(value.includes("store")||value.includes("shop")||value.includes("grocery"))return "متجر";
    const labels:Record<string,string>={driver:"صاحب تكسي",large_driver:"تكسي كبير",worker:"فني",customer:"زبون",restaurant:"مطعم",hotel:"فندق",store:"متجر"};
    return (u.roles??[]).map(r=>labels[r]||r).join("، ")||"مستخدم";
  };
  return <section dir="rtl" className="space-y-4">
    <header><h2 className="text-xl font-black flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary"/> حقوق ممنون</h2><p className="text-xs text-muted-foreground mt-1">المحافظ والعمولات والإعفاءات وسجل إيرادات ممنون.</p></header>
    <div className="flex flex-wrap gap-2">{[
      ["wallet","استقطاع الشكاوي وإضافة الرصيد",Wallet],["special","مستخدمون بميزات خاصة",ShieldCheck],["policies","إعدادات الاستقطاع",Settings2],["revenue","الإيرادات",Receipt]
    ].map(([key,label,Icon]:any)=><button key={key} onClick={()=>setTab(key)} className={`rounded-xl px-3 py-2 text-xs font-bold flex items-center gap-2 ${tab===key?"bg-primary text-primary-foreground":"glass text-muted-foreground"}`}><Icon className="h-4 w-4"/>{label}</button>)}</div>
    {(tab==="wallet"||tab==="special")&&<div className="glass rounded-2xl p-4 space-y-3">
      <h3 className="font-black text-sm">البحث عن مستخدم</h3>
      <div className="flex gap-2"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="الاسم أو رقم الهاتف أو البريد" className="min-w-0 flex-1 rounded-xl border border-border bg-background p-3 text-xs"/><button onClick={()=>void searchUsers()} disabled={busy} className="rounded-xl bg-primary text-primary-foreground px-4"><Search className="h-4 w-4"/></button></div>
      <div className="space-y-2 max-h-64 overflow-y-auto">{users.map(u=><button key={u.id} onClick={()=>setSelected(u)} className={`w-full text-right rounded-xl border p-3 ${selected?.id===u.id?"border-primary bg-primary/5":"border-border bg-card"}`}><div className="font-black text-xs">{u.full_name||"مستخدم ممنون"}</div><div className="text-[10px] text-muted-foreground">{u.phone||u.email||u.id} · {categoryLabel(u)} · {govLabels[u.governorate_key||""]||u.governorate_key||"بلا محافظة"}</div><div className="text-[10px] mt-1">رصيد المحفظة: <b>{Number(u.balance_iqd).toLocaleString("ar-IQ")} د.ع</b></div></button>)}</div>
      {selected&&<div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-3">
        <div className="font-black text-sm">{selected.full_name||selected.phone}</div>
        {tab==="wallet"?<>
          <div className="flex gap-2"><button onClick={()=>setKind("debit")} className={`flex-1 rounded-xl p-2 text-xs font-bold ${kind==="debit"?"bg-destructive text-white":"bg-muted"}`}><MinusCircle className="inline h-4 w-4 ml-1"/>استقطاع شكوى</button><button onClick={()=>setKind("credit")} className={`flex-1 rounded-xl p-2 text-xs font-bold ${kind==="credit"?"bg-emerald-600 text-white":"bg-muted"}`}><PlusCircle className="inline h-4 w-4 ml-1"/>إضافة رصيد</button></div>
          <input value={amount} onChange={e=>setAmount(e.target.value)} inputMode="numeric" placeholder="المبلغ بالدينار العراقي" className="w-full rounded-xl border border-border bg-background p-3 text-xs"/>
          <input value={note} onChange={e=>setNote(e.target.value)} placeholder="سبب العملية (إلزامي)" className="w-full rounded-xl border border-border bg-background p-3 text-xs"/>
          <button disabled={busy} onClick={()=>void adjustWallet()} className="w-full rounded-xl bg-primary text-primary-foreground p-3 text-xs font-black">{busy?"جارٍ التنفيذ...":kind==="debit"?"تأكيد الاستقطاع":"تأكيد إضافة الرصيد"}</button>
        </>:<>
          <label className="block text-xs font-bold">نسبة تحصيل عمولة ممنون</label>
          <input value={chargePercent} onChange={e=>setChargePercent(e.target.value)} inputMode="decimal" className="w-full rounded-xl border border-border bg-background p-3 text-xs" placeholder="من 0 إلى 100"/>
          <label className="block text-xs font-bold">مدة الميزة</label>
          <select value={duration} onChange={e=>setDuration(e.target.value)} className="w-full rounded-xl border border-border bg-background p-3 text-xs">{durations.map(d=><option key={d.value} value={d.value}>{d.label}</option>)}</select>
          <input value={overrideReason} onChange={e=>setOverrideReason(e.target.value)} className="w-full rounded-xl border border-border bg-background p-3 text-xs" placeholder="سبب الميزة"/>
          <button disabled={busy} onClick={()=>void saveOverride()} className="w-full rounded-xl bg-primary text-primary-foreground p-3 text-xs font-black">حفظ الميزة الخاصة</button>
        </>}
      </div>}
      {tab==="special"&&<div className="border-t border-border pt-3 space-y-2"><h4 className="font-black text-xs">الإعفاءات والميزات السارية</h4>{overrides.map(o=><div key={o.id} className="rounded-xl bg-card border border-border p-3 flex items-center justify-between gap-2"><div className="min-w-0"><b className="text-xs">{o.profile?.full_name||o.profile?.phone||"مستخدم"}</b><p className="text-[10px] text-muted-foreground">تحصيل {o.commission_charge_percent}% · {o.ends_at?new Date(o.ends_at).toLocaleDateString("ar-IQ"):"دائم"}</p></div><button onClick={()=>void revokeOverride(o.id)} className="rounded-lg bg-destructive/10 text-destructive px-3 py-2 text-[10px] font-bold">إلغاء</button></div>)}{!overrides.length&&<p className="text-[10px] text-muted-foreground">لا توجد ميزات خاصة سارية</p>}</div>}
    </div>}
    {tab==="policies"&&<div className="glass rounded-2xl p-4 space-y-3">
      <div className="flex justify-between items-center"><h3 className="font-black text-sm">سياسة العمولة والتجربة المجانية</h3><button onClick={()=>void load()} className="text-xs text-primary"><RefreshCw className="inline h-3.5 w-3.5 ml-1"/>تحديث</button></div>
      <label className="block text-xs font-bold">نطاق السياسة</label>
      <select value={scope} onChange={e=>{setScope(e.target.value);setScopeKey("");}} className="w-full rounded-xl border border-border bg-background p-3 text-xs"><option value="global">كل العراق</option><option value="governorate">محافظة</option><option value="role">فئة مستخدمين</option><option value="governorate_role">فئة داخل محافظة</option></select>
      {scope==="governorate"&&<select value={scopeKey} onChange={e=>setScopeKey(e.target.value)} className="w-full rounded-xl border border-border bg-background p-3 text-xs"><option value="">اختر المحافظة</option>{governorates.map(g=><option key={g} value={g}>{govLabels[g]}</option>)}</select>}
      {scope==="role"&&<select value={scopeKey} onChange={e=>setScopeKey(e.target.value)} className="w-full rounded-xl border border-border bg-background p-3 text-xs"><option value="">اختر الفئة</option>{roles.map(r=><option key={r.value} value={r.value}>{r.label}</option>)}</select>}
      {scope==="governorate_role"&&<div className="grid grid-cols-2 gap-2"><select value={scopeKey.split(":")[0]||""} onChange={e=>setScopeKey(e.target.value+":"+(scopeKey.split(":")[1]||""))} className="rounded-xl border border-border bg-background p-3 text-xs"><option value="">المحافظة</option>{governorates.map(g=><option key={g} value={g}>{govLabels[g]}</option>)}</select><select value={scopeKey.split(":")[1]||""} onChange={e=>setScopeKey((scopeKey.split(":")[0]||"")+":"+e.target.value)} className="rounded-xl border border-border bg-background p-3 text-xs"><option value="">الفئة</option>{roles.map(r=><option key={r.value} value={r.value}>{r.label}</option>)}</select></div>}
      <div className="grid grid-cols-2 gap-2"><div><label className="text-xs font-bold">نسبة عمولة ممنون من الأجرة %</label><input value={commissionRate} onChange={e=>setCommissionRate(e.target.value)} inputMode="decimal" className="mt-1 w-full rounded-xl border border-border bg-background p-3 text-xs"/></div><div><label className="text-xs font-bold">نسبة تحصيل العمولة %</label><input value={commissionCharge} onChange={e=>setCommissionCharge(e.target.value)} inputMode="decimal" className="mt-1 w-full rounded-xl border border-border bg-background p-3 text-xs"/></div></div>
      <label className="block text-xs font-bold">متى يُستقطع؟</label><select value={event} onChange={e=>setEvent(e.target.value)} className="w-full rounded-xl border border-border bg-background p-3 text-xs"><option value="taxi_acceptance">عند قبول رحلة التكسي</option><option value="service_acceptance">عند قبول طلب فني</option><option value="order_acceptance">عند قبول طلب مطعم أو متجر</option></select>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={trialEnabled} onChange={e=>setTrialEnabled(e.target.checked)}/> تفعيل التجربة المجانية</label>
      <label className="block text-xs font-bold">مدة التجربة بالأيام</label><input value={trialDays} onChange={e=>setTrialDays(e.target.value)} inputMode="numeric" className="w-full rounded-xl border border-border bg-background p-3 text-xs"/>
      <p className="text-[10px] text-muted-foreground">تبدأ الفترة المجانية من تاريخ تسجيل المستخدم الجديد، وتبقى المدة الخاصة به ثابتة حتى لو أوقفت العرض لاحقاً.</p>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={policyEnabled} onChange={e=>setPolicyEnabled(e.target.checked)}/> تفعيل سياسة الاستقطاع (نسبة التحصيل 0٪ تعني مجاني)</label>
      <button disabled={busy} onClick={()=>void savePolicy()} className="w-full rounded-xl bg-primary text-primary-foreground p-3 text-xs font-black">{busy?"جارٍ الحفظ...":"حفظ سياسة العمولة"}</button>
      <div className="border-t border-border pt-3 space-y-2"><h4 className="font-black text-xs">السياسات المحفوظة</h4>{policies.map(p=><div key={p.id} className="rounded-xl bg-card border border-border p-3 text-[10px]"><b>{scopeLabel[p.scope_type]||p.scope_type} · {formatScopeKey(p)}</b><div>عمولة {p.commission_rate_percent}% · تحصيل {p.commission_charge_percent}% · {eventLabel[p.collection_event]||p.collection_event} · {p.is_enabled?"فعالة":"متوقفة"}</div><div>تجربة {p.free_trial_enabled?p.free_trial_days+" يوم":"متوقفة"} · {p.new_users_only?"جدد فقط":"غير مقيد"}</div></div>)}</div>
    </div>}
    {tab==="revenue"&&<div className="glass rounded-2xl p-4 space-y-3"><div className="flex justify-between items-center"><h3 className="font-black text-sm">دفتر إيرادات ممنون</h3><button onClick={()=>void load()} className="text-xs text-primary">تحديث</button></div><div className="grid grid-cols-1 sm:grid-cols-2 gap-2"><div className="rounded-xl bg-primary/10 p-3"><p className="text-[10px] text-muted-foreground">إجمالي إيرادات ممنون المحصلة</p><b className="text-lg">{Number(summary.collected_iqd||0).toLocaleString("ar-IQ")} د.ع</b></div><div className="rounded-xl bg-muted p-3"><p className="text-[10px] text-muted-foreground">منها تحصيل ديون جديدة عبر زين كاش</p><b className="text-lg">{Number(summary.zaincash_debt_collected_iqd||0).toLocaleString("ar-IQ")} د.ع</b></div></div><h4 className="font-black text-xs">تحصيلات زين كاش المؤكدة</h4>{collections.map(x=><div key={x.id} className="rounded-xl bg-card border border-border p-3"><b className="text-xs">{Number(x.amount_iqd).toLocaleString("ar-IQ")} د.ع</b><p className="text-[10px] text-muted-foreground">مرجع زين كاش: {x.provider_reference} · {new Date(x.created_at).toLocaleString("ar-IQ")}</p></div>)}<h4 className="font-black text-xs pt-2">العمولات والاستقطاعات</h4>{revenue.map(r=><div key={r.id} className="rounded-xl bg-card border border-border p-3"><div className="font-black text-xs">{r.profile?.full_name||r.profile?.phone||"مستخدم"}</div><div className="text-[10px] text-muted-foreground">{revenueLabel[r.revenue_type]||r.revenue_type} · {new Date(r.created_at).toLocaleString("ar-IQ")}</div><div className="text-xs mt-1">مستحق {Number(r.assessed_iqd).toLocaleString("ar-IQ")} د.ع · محصل {Number(r.collected_iqd).toLocaleString("ar-IQ")} د.ع · معفى {Number(r.waived_iqd).toLocaleString("ar-IQ")} د.ع</div><div className="text-[10px] mt-1">{statusLabel[r.status]||r.status}</div></div>)}{!revenue.length&&<p className="text-xs text-muted-foreground">لا توجد إيرادات مسجلة حالياً</p>}</div>}
    {!!error&&<p className="text-xs text-destructive">{error}</p>}
    {loading&&<p className="text-xs text-muted-foreground">جارٍ تحديث البيانات...</p>}
  </section>;
}
