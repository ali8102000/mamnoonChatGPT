import { useCallback, useEffect, useState } from "react";
import { Save, ShieldCheck, Zap, TrendingUp, RefreshCw } from "lucide-react";
import { GOVERNORATES } from "@/lib/governorates";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/lib/toast";

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
  urgency_enabled: true,
  urgency_max_percent: 10,
};

export default function AdminTaxiPricingControls() {
  const [rows, setRows] = useState<TaxiControl[]>([]);
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
    const { error } = await (supabase as any).from("taxi_pricing_controls").upsert({
      ...global, governorate_key: "all", peak_percent: Math.max(0, Math.min(200, Number(global.peak_percent) || 0)),
      urgency_max_percent: Number(global.urgency_max_percent), updated_at: new Date().toISOString(),
    }, { onConflict: "governorate_key" });
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
    const { error } = await (supabase as any).from("taxi_pricing_controls").upsert({
      governorate_key: governorateKey,
      peak_enabled: regional.peak_enabled,
      peak_percent: Number(regional.peak_percent),
      urgency_enabled: true,
      urgency_max_percent: Number(global.urgency_max_percent),
      updated_at: new Date().toISOString(),
    }, { onConflict: "governorate_key" });
    setSaving(false);
    if (error) { toast.error("تعذّر حفظ ذروة المحافظة: " + error.message); return; }
    toast.success("انحفظت إعدادات الذروة للمحافظة.");
    await load();
  }

  const inputClass = "w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm font-bold";
  if (loading) return <div className="p-6 text-center text-sm text-muted-foreground">جارٍ تحميل إعدادات التسعير…</div>;

  return (
    <section className="mt-6 space-y-4 rounded-2xl border border-border bg-card p-4 md:p-5" dir="rtl">
      <div className="flex items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-2xl bg-amber-500/15 text-amber-600"><TrendingUp className="h-5 w-5" /></div>
        <div>
          <h3 className="text-lg font-black">التحكم بالأسعار والاستعجال والذروة</h3>
          <p className="text-xs text-muted-foreground">تُطبّق الإعدادات على تسعير سيارات الاقتصاد والمتميز والفاخرة فقط.</p>
        </div>
      </div>

      <div className="rounded-xl border border-border p-3 space-y-3">
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
      </div>

      <div className="rounded-xl border border-border p-3 space-y-3">
        <div className="flex items-center gap-2 font-black"><ShieldCheck className="h-4 w-4 text-emerald-600" /> الذروة حسب المحافظة</div>
        <label className="block space-y-1 text-sm font-bold">
          <span>المحافظة</span>
          <select className={inputClass} value={governorateKey} onChange={(e) => setGovernorateKey(e.target.value)}>
            <option value="all">كل العراق (افتراضي)</option>
            {GOVERNORATES.map((g: any) => <option key={g.key} value={g.key}>{g.name}</option>)}
          </select>
        </label>
        <label className="flex items-center justify-between gap-3 text-sm font-bold">
          <span>تفعيل تسعير الذروة لهذه المنطقة</span>
          <input type="checkbox" checked={governorateKey === "all" ? global.peak_enabled : regional.peak_enabled} onChange={(e) => governorateKey === "all" ? setGlobal((v) => ({ ...v, peak_enabled: e.target.checked })) : setRegional((v) => ({ ...v, peak_enabled: e.target.checked }))} className="h-5 w-5 accent-emerald-600" />
        </label>
        <label className="block space-y-1 text-sm font-bold">
          <span>نسبة زيادة الذروة (%)</span>
          <input className={inputClass} type="number" min="0" max="200" step="1" value={governorateKey === "all" ? global.peak_percent : regional.peak_percent} onChange={(e) => governorateKey === "all" ? setGlobal((v) => ({ ...v, peak_percent: Number(e.target.value) })) : setRegional((v) => ({ ...v, peak_percent: Number(e.target.value) }))} />
        </label>
        <p className="text-xs text-muted-foreground">إذا ماكو إعداد خاص لمحافظة، تعتمد إعدادات «كل العراق». الاستعجال ينضاف بعد الذروة ويزيد السعر فوقها.</p>
        <button type="button" disabled={saving} onClick={saveRegional} className="rounded-xl bg-primary px-4 py-2.5 text-sm font-black text-primary-foreground disabled:opacity-50"><Save className="ml-2 inline h-4 w-4" /> حفظ الذروة</button>
        <button type="button" disabled={saving} onClick={() => void load()} className="mr-2 rounded-xl border border-border px-4 py-2.5 text-sm font-bold disabled:opacity-50"><RefreshCw className="ml-2 inline h-4 w-4" /> تحديث</button>
      </div>
      <p className="text-xs text-muted-foreground">نسب الفئات ثابتة حسب الاتفاق: أقل من 10,000 د.ع: المتميز +20% والفاخر +40%. من 10,000 إلى 50,000: +15% و+25%. أكثر من 50,000: +5% و+10%. التقريب لأقرب 250 دينار.</p>
    </section>
  );
}
