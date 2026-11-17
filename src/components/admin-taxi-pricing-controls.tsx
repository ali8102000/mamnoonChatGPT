import { useCallback, useEffect, useState } from "react";
import { Save, ShieldCheck, Zap, TrendingUp, RefreshCw } from "lucide-react";
import { GOVERNORATES } from "@/lib/governorates";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/lib/toast";

type TaxiTariff = { id: string; service_type: string; is_intercity: boolean; base_fare: number; per_km_rate: number; per_min_rate: number; min_fare: number };

type TaxiControl = {
  governorate_key: string;
  peak_enabled: boolean;
  peak_percent: number;
  urgency_enabled: boolean;
  urgency_max_percent: number;
};

const DEFAULT: TaxiControl = {
  governorate_key: "all",
  peak_enabled: false,
  peak_percent: 0,
  urgency_enabled: false,
  urgency_max_percent: 10,
};

export default function AdminTaxiPricingControls() {
  const [rows, setRows] = useState<TaxiControl[]>([]);
  const [tariffs, setTariffs] = useState<TaxiTariff[]>([]);
  const [canTariff, setCanTariff] = useState(false);
  const [canGlobalPeak, setCanGlobalPeak] = useState(false);
  const [canRegionalPeak, setCanRegionalPeak] = useState(false);
  const [governorateKey, setGovernorateKey] = useState("all");
  const [global, setGlobal] = useState<TaxiControl>(DEFAULT);
  const [regional, setRegional] = useState<TaxiControl>(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("taxi_pricing_controls")
      .select("governorate_key,peak_enabled,peak_percent,urgency_enabled,urgency_max_percent")
      .order("governorate_key");
    if (error) {
      toast.error("تعذّر تحميل إعدادات تسعير التاكسي: " + error.message);
      setRows([]);
    } else {
      const list = (data ?? []) as TaxiControl[];
      setRows(list);
      setGlobal(list.find((row) => row.governorate_key === "all") ?? DEFAULT);
      setRegional(list.find((row) => row.governorate_key === governorateKey) ?? { ...DEFAULT, governorate_key: governorateKey });
    }
    const [tariffPermission,globalPeakPermission,regionalPeakPermission] = await Promise.all([
      (supabase as any).rpc("admin_has_permission",{p_permission_key:"pricing.taxi.edit",p_scope_type:"global",p_scope_governorate:null}),
      (supabase as any).rpc("admin_has_permission",{p_permission_key:"pricing.peak.edit",p_scope_type:"global",p_scope_governorate:null}),
      governorateKey==="all" ? Promise.resolve({data:false,error:null}) :
        (supabase as any).rpc("admin_has_permission",{p_permission_key:"pricing.peak.edit",p_scope_type:"governorate",p_scope_governorate:governorateKey}),
    ]);
    setCanTariff(!tariffPermission.error && tariffPermission.data===true);
    setCanGlobalPeak(!globalPeakPermission.error && globalPeakPermission.data===true);
    setCanRegionalPeak(!regionalPeakPermission.error && regionalPeakPermission.data===true);
    const { data: tariffRows, error: tariffError } = await (supabase as any)
      .from("pricing_settings")
      .select("id,service_type,is_intercity,base_fare,per_km_rate,per_min_rate,min_fare")
      .order("is_intercity").order("service_type");
    if (tariffError) toast.error("تعذّر تحميل التعرفة الأساسية: " + tariffError.message);
    else setTariffs((tariffRows ?? []).map((row: any) => ({
      ...row, base_fare: Number(row.base_fare) || 0, per_km_rate: Number(row.per_km_rate) || 0,
      per_min_rate: Number(row.per_min_rate) || 0, min_fare: Math.max(1000, Number(row.min_fare) || 0),
    })));
    setLoading(false);
  }, [governorateKey]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    setRegional(rows.find((row) => row.governorate_key === governorateKey) ?? { ...DEFAULT, governorate_key: governorateKey });
  }, [rows, governorateKey]);

  async function saveGlobal() {
    if (!Number.isFinite(global.urgency_max_percent) || global.urgency_max_percent < 0 || global.urgency_max_percent > 100) {
      toast.error("سقف الاستعجال لازم يكون بين 0 و100 بالمئة."); return;
    }
    setSaving(true);
    const { error } = await (supabase as any).rpc("admin_update_taxi_pricing_control", {
      p_governorate_key: "all",
      p_peak_enabled: global.peak_enabled,
      p_peak_percent: Math.max(0, Math.min(200, Number(global.peak_percent) || 0)),
      p_urgency_enabled: global.urgency_enabled,
      p_urgency_max_percent: Number(global.urgency_max_percent),
    });
    setSaving(false);
    if (error) { toast.error("تعذّر حفظ الإعدادات العامة: " + error.message); return; }
    toast.success("انحفظت إعدادات الاستعجال العامة.");
    await load();
  }

  async function saveRegional() {
    if (governorateKey === "all") { await saveGlobal(); return; }
    if (!Number.isFinite(regional.peak_percent) || regional.peak_percent < 0 || regional.peak_percent > 200) {
      toast.error("نسبة الذروة لازم تكون بين 0 و200 بالمئة."); return;
    }
    setSaving(true);
    const { error } = await (supabase as any).rpc("admin_update_taxi_pricing_control", {
      p_governorate_key: governorateKey,
      p_peak_enabled: regional.peak_enabled,
      p_peak_percent: Number(regional.peak_percent),
      p_urgency_enabled: false,
      p_urgency_max_percent: Number(global.urgency_max_percent),
    });
    setSaving(false);
    if (error) { toast.error("تعذّر حفظ ذروة المحافظة: " + error.message); return; }
    toast.success("انحفظت إعدادات الذروة للمحافظة.");
    await load();
  }

  async function saveTariff(row: TaxiTariff) {
    const values = [row.base_fare,row.per_km_rate,row.per_min_rate,row.min_fare].map(Number);
    if (values.some((value) => !Number.isFinite(value) || value < 0) || row.min_fare < 1000) {
      toast.error("تحقق من الأرقام؛ الحد الأدنى للرحلة لا يقل عن 1,000 دينار."); return;
    }
    setSaving(true);
    const { error } = await (supabase as any).rpc("admin_update_taxi_pricing_settings", {
      p_service_type: row.service_type, p_is_intercity: row.is_intercity,
      p_base_fare: row.base_fare, p_per_km_rate: row.per_km_rate,
      p_per_min_rate: row.per_min_rate, p_min_fare: row.min_fare,
    });
    setSaving(false);
    if (error) { toast.error("تعذّر حفظ التعرفة: " + error.message); return; }
    toast.success("تم حفظ التعرفة وتسجيل التغيير بسجل التدقيق.");
    await load();
  }

  const inputClass = "w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm font-bold";
  if (loading) return <div className="p-6 text-center text-sm text-muted-foreground">جارٍ تحميل إعدادات التسعير…</div>;
  if (!canTariff && !canGlobalPeak && !canRegionalPeak) return <div className="rounded-xl border p-4 text-sm text-muted-foreground">ما عندك صلاحية تعديل التعرفة أو الذروة ضمن نطاقك.</div>;

  return (
    <section className="mt-6 space-y-4 rounded-2xl border border-border bg-card p-4 md:p-5" dir="rtl">
      <div className="flex items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-2xl bg-amber-500/15 text-amber-600"><TrendingUp className="h-5 w-5" /></div>
        <div>
          <h3 className="text-lg font-black">التحكم بالأسعار والاستعجال والذروة</h3>
          <p className="text-xs text-muted-foreground">تُطبّق الإعدادات على تسعير سيارات الاقتصاد والمتميز والفاخرة فقط.</p>
        </div>
      </div>

      {canGlobalPeak && <div className="rounded-xl border border-border p-3 space-y-3">
        <div className="flex items-center gap-2 font-black"><Zap className="h-4 w-4 text-amber-500" /> الاستعجال — إعداد عام لكل العراق</div>
        <label className="flex items-center justify-between gap-3 text-sm font-bold">
          <span>السماح للزبون بتفعيل الاستعجال</span>
          <input type="checkbox" checked={global.urgency_enabled} onChange={(e) => setGlobal((v) => ({ ...v, urgency_enabled: e.target.checked }))} className="h-5 w-5 accent-amber-500" />
        </label>
        <label className="block space-y-1 text-sm font-bold">
          <span>أعلى زيادة للاستعجال (%)</span>
          <input className={inputClass} type="number" min="0" max="100" step="1" value={global.urgency_max_percent} onChange={(e) => setGlobal((v) => ({ ...v, urgency_max_percent: Number(e.target.value) }))} />
        </label>
        <button type="button" disabled={saving} onClick={saveGlobal} className="rounded-xl bg-primary px-4 py-2.5 text-sm font-black text-primary-foreground disabled:opacity-50"><Save className="ml-2 inline h-4 w-4" /> حفظ إعداد الاستعجال</button>
      </div>}

      {(canGlobalPeak || canRegionalPeak) && <div className="rounded-xl border border-border p-3 space-y-3">
        <div className="flex items-center gap-2 font-black"><ShieldCheck className="h-4 w-4 text-emerald-600" /> الذروة حسب المحافظة</div>
        <label className="block space-y-1 text-sm font-bold">
          <span>المحافظة</span>
          <select className={inputClass} value={governorateKey} onChange={(e) => setGovernorateKey(e.target.value)}>
            <option value="all">كل العراق (افتراضي)</option>
            {GOVERNORATES.map((g: any) => <option key={g.key} value={g.key}>{g.name}</option>)}
          </select>
        </label>
        {canRegionalPeak ? <>
          <label className="flex items-center justify-between gap-3 text-sm font-bold">
            <span>تفعيل تسعير الذروة لهذه المنطقة</span>
            <input type="checkbox" checked={regional.peak_enabled} onChange={(e) => setRegional((v) => ({ ...v, peak_enabled: e.target.checked }))} className="h-5 w-5 accent-emerald-600" />
          </label>
          <label className="block space-y-1 text-sm font-bold">
            <span>نسبة زيادة الذروة (%)</span>
            <input className={inputClass} type="number" min="0" max="200" step="1" value={regional.peak_percent} onChange={(e) => setRegional((v) => ({ ...v, peak_percent: Number(e.target.value) }))} />
          </label>
          <p className="text-xs text-muted-foreground">إذا ماكو إعداد خاص لمحافظة، تعتمد إعدادات «كل العراق».</p>
          <button type="button" disabled={saving} onClick={saveRegional} className="rounded-xl bg-primary px-4 py-2.5 text-sm font-black text-primary-foreground disabled:opacity-50"><Save className="ml-2 inline h-4 w-4" /> حفظ الذروة</button>
        </> : <p className="text-xs text-muted-foreground">اختر محافظة ضمن نطاق صلاحيتك حتى تظهر إعدادات الذروة المتاحة لك.</p>}
        <button type="button" disabled={saving} onClick={() => void load()} className="mr-2 rounded-xl border border-border px-4 py-2.5 text-sm font-bold disabled:opacity-50"><RefreshCw className="ml-2 inline h-4 w-4" /> تحديث</button>
      </div>}
      {canTariff && <div className="rounded-xl border border-border p-3 space-y-3">
        <div className="font-black">التعرفة الأساسية للتاكسي</div>
        <p className="text-xs text-muted-foreground">تعرفة الاقتصاد هي أساس حساب كل الفئات؛ المتميز والفاخر يطبّق عليهما فرق الفئة المتفق عليه، مع حد أدنى مستقل فقط. كل حفظ موثق بسجل التدقيق.</p>
        {tariffs.map((row) => <div key={row.id} className="rounded-xl border border-border p-3 space-y-2">
          <div className="font-bold text-sm">{row.service_type === "economy" ? "اقتصادي" : row.service_type === "premium" ? "متميز" : "فاخر"} · {row.is_intercity ? "بين المحافظات" : "داخل المدينة"}</div>
          <div className="grid grid-cols-2 gap-2">
            {(row.service_type === "economy" ? [["base_fare","أجرة الانطلاق"],["per_km_rate","سعر الكيلومتر"],["per_min_rate","سعر الدقيقة"],["min_fare","الحد الأدنى"]] : [["min_fare","الحد الأدنى للفئة"]]).map(([key,label]) => <label key={key} className="block space-y-1 text-xs font-bold"><span>{label} (د.ع)</span><input className={inputClass} type="number" min={key==="min_fare"?1000:0} value={row[key as keyof TaxiTariff] as number} onChange={(e)=>setTariffs((current)=>current.map((item)=>item.id===row.id?{...item,[key]:Number(e.target.value)}:item))}/></label>)}
          </div>
          <button type="button" disabled={saving} onClick={()=>void saveTariff(row)} className="rounded-xl bg-primary px-4 py-2 text-xs font-black text-primary-foreground disabled:opacity-50">حفظ هذه التعرفة</button>
        </div>)}
        {!tariffs.length && <p className="text-xs text-muted-foreground">لا توجد صفوف تعرفة للعرض.</p>}
      </div>}
      <p className="text-xs text-muted-foreground">نسب الفئات ثابتة حسب الاتفاق: أقل من 10,000 د.ع: المتميز +20% والفاخر +40%. من 10,000 إلى 50,000: +15% و+25%. أكثر من 50,000: +5% و+10%. التقريب لأقرب 250 دينار.</p>
    </section>
  );
}
