import { useCallback, useEffect, useState } from "react";
import { Save, RefreshCw, Gauge } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/lib/toast";

type Row = {
  category_key: string;
  category_label_ar: string;
  min_surcharge_percent: number;
  max_surcharge_percent: number;
  mode: "auto" | "notify" | "off";
  enabled: boolean;
  auto_calculated_percent?: number;
  active_providers?: number;
  observed_providers?: number;
  pending_requests?: number;
  demand_per_provider?: number;
  last_reason?: string | null;
  last_calculated_at?: string | null;
};
const TAXI = [
  ["taxi:economy", "تكسي اقتصادي"],
  ["taxi:premium", "تكسي متميز"],
  ["taxi:luxury", "تكسي فاخر"],
  ["taxi:large", "مركبة كبيرة"],
] as const;

export default function AdminCategoryPeakPricing() {
  const [rows, setRows] = useState<Row[]>([]);
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [permission, categories, settings] = await Promise.all([
      (supabase as any).rpc("admin_has_permission", {
        p_permission_key: "pricing.peak.edit",
        p_scope_type: "global",
        p_scope_governorate: null,
      }),
      (supabase as any).from("services").select("id,slug,name_ar").order("sort_order"),
      (supabase as any).from("category_peak_pricing_settings").select("*").order("category_label_ar"),
    ]);
    setAllowed(!permission.error && permission.data === true);
    if (categories.error) toast.error("تعذّر تحميل فئات الخدمات: " + categories.error.message);
    if (settings.error) toast.error("تعذّر تحميل إعدادات الذروة: " + settings.error.message);
    const saved = new Map<string, Row>((settings.data ?? []).map((r: any) => [r.category_key, r]));
    const all: Row[] = [
      ...TAXI.map(([category_key, category_label_ar]) => saved.get(category_key) ?? ({
        category_key, category_label_ar, min_surcharge_percent: 0, max_surcharge_percent: 0, mode: "off" as const, enabled: false,
      })),
      ...(categories.data ?? []).map((s: any) => {
        const category_key = "service:" + s.slug;
        return saved.get(category_key) ?? {
          category_key, category_label_ar: s.name_ar, min_surcharge_percent: 0,
          max_surcharge_percent: 0, mode: "off" as const, enabled: false,
        };
      }),
    ];
    setRows(all);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const edit = (key: string, patch: Partial<Row>) =>
    setRows(current => current.map(row => row.category_key === key ? { ...row, ...patch } : row));

  async function save(row: Row) {
    const min = Number(row.min_surcharge_percent);
    const max = Number(row.max_surcharge_percent);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max > 100 || min > max) {
      toast.error("تأكد أن الحد الأدنى لا يتجاوز الأعلى وأن النسب بين 0 و100.");
      return;
    }
    if (row.category_key.startsWith("service:") && row.enabled) {
      toast.error("تسعير الخدمات النهائي لم يُربط بعد؛ أبقِ هذه الفئة متوقفة."); return;
    }
    if (row.mode === "off" && row.enabled) {
      toast.error("لا يمكن تفعيل فئة بوضع الإيقاف.");
      return;
    }
    setSaving(row.category_key);
    const { error } = await (supabase as any).rpc("admin_save_category_peak_pricing_settings", {
      p_category_key: row.category_key,
      p_min_surcharge_percent: min,
      p_max_surcharge_percent: max,
      p_mode: row.mode,
      p_enabled: row.enabled,
    });
    setSaving(null);
    if (error) toast.error("تعذّر حفظ إعدادات الفئة: " + error.message);
    else { toast.success("تم حفظ حدود الذروة لهذه الفئة."); await load(); }
  }

  if (loading) return <div className="p-4 text-sm text-muted-foreground">جارٍ تحميل حدود الذروة لكل الفئات…</div>;
  if (!allowed) return <div className="rounded-xl border p-4 text-sm text-muted-foreground">تحتاج صلاحية إدارة الذروة على مستوى كل العراق.</div>;

  return <section dir="rtl" className="rounded-2xl border border-border bg-card p-4 space-y-4">
    <header className="flex items-center gap-3">
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary"><Gauge className="h-5 w-5" /></div>
      <div><h3 className="font-black">مراقبة الطلب والتوفر حسب الفئة</h3><p className="text-xs text-muted-foreground">عرض مؤشرات التشغيل فقط؛ لا توجد إشعارات أو تغييرات على أجرة الزبون في هذه النسخة.</p></div>
    </header>
    <div className="rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground">الحدود الرقمية محفوظة للمستقبل فقط. مراقبة الطلب والتوفر لا تغيّر الأجرة، وكل أوضاع التشغيل متوقفة.</div>
    {rows.map(row => <div key={row.category_key} className="rounded-xl border border-border p-3 space-y-3">
      <div className="flex items-center justify-between gap-2"><b className="text-sm">{row.category_label_ar}</b><span className="text-[10px] text-muted-foreground">{row.category_key}</span></div>
      <div className="rounded-lg bg-muted/40 p-3 text-xs space-y-1">
        <div className="flex justify-between"><span>نسبة الزيادة المحسوبة (غير مطبقة)</span><b>{Number(row.auto_calculated_percent ?? 0).toFixed(2)}%</b></div>
        <div className="flex justify-between"><span>مقدمو الخدمة المتاحون / المرصودون</span><b>{row.active_providers ?? 0} / {row.observed_providers ?? 0}</b></div>
        <div className="flex justify-between"><span>الطلبات المعلّقة</span><b>{row.pending_requests ?? 0}</b></div>
        <p className="text-muted-foreground">{row.last_reason ?? "بانتظار أول دورة مراقبة."}</p>
        <p className="text-[10px] text-muted-foreground">{row.last_calculated_at ? "آخر تحديث: " + new Date(row.last_calculated_at).toLocaleString("ar-IQ") : "لم تُحسب بعد"}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs font-bold space-y-1"><span>الحد المستقبلي الأدنى (%)</span><input type="number" min="0" max="100" value={row.min_surcharge_percent} onChange={e=>edit(row.category_key,{min_surcharge_percent:Number(e.target.value)})} className="w-full rounded-lg border bg-background p-2.5"/></label>
        <label className="text-xs font-bold space-y-1"><span>الحد المستقبلي الأعلى (%)</span><input type="number" min="0" max="100" value={row.max_surcharge_percent} onChange={e=>edit(row.category_key,{max_surcharge_percent:Number(e.target.value)})} className="w-full rounded-lg border bg-background p-2.5"/></label>
      </div>
      <p className="rounded-lg bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">التوصيات والإشعارات وزيادات الأجرة غير مفعّلة حالياً. هذه الشاشة تعرض مؤشرات الطلب والتوفر فقط.</p>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs font-bold space-y-1"><span>وضع التشغيل</span><select value={row.mode} onChange={e=>edit(row.category_key,{mode:e.target.value as Row["mode"],enabled:e.target.value!=="off"})} className="w-full rounded-lg border bg-background p-2.5"><option value="off">إيقاف</option><option value="auto" disabled>تلقائي (موقوف بقرار الإدارة)</option><option value="notify" disabled>إخباري (غير مفعّل حالياً)</option></select></label>
        <label className="flex items-center gap-2 text-xs font-bold pt-5"><input type="checkbox" checked={false} disabled onChange={()=>{}}/> تفعيل الفئة</label>
      </div>
      <button disabled={saving===row.category_key} onClick={()=>void save(row)} className="w-full rounded-lg bg-primary px-3 py-2.5 text-xs font-black text-primary-foreground disabled:opacity-50"><Save className="ml-1 inline h-4 w-4"/> {saving===row.category_key?"جارٍ الحفظ…":"حفظ حدود هذه الفئة"}</button>
    </div>)}
    <button onClick={()=>void load()} className="w-full rounded-lg border border-border px-3 py-2.5 text-xs font-bold"><RefreshCw className="ml-1 inline h-4 w-4"/> تحديث الفئات</button>
  </section>;
}
