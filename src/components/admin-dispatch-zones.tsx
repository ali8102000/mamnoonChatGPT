import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { GOVERNORATES } from "@/lib/governorates";
import { toast } from "@/lib/toast";

type DispatchType = "taxi" | "large_driver" | "technician";
type Row = {
  governorate_key: string;
  dispatch_type: DispatchType;
  ring1_min_km: number;
  ring1_max_km: number;
  ring2_min_km: number;
  ring2_max_km: number;
  ring3_min_km: number;
  ring3_max_km: number;
  updated_at?: string;
  inherited?: boolean;
};

const TYPES: DispatchType[] = ["taxi", "large_driver", "technician"];
const LABELS: Record<DispatchType, string> = {
  taxi: "سائقو التكسي الاعتيادي",
  large_driver: "الكيات والباصات والسيارات الكبيرة",
  technician: "الفنيون ومقدمو الخدمات",
};
const DEFAULTS: Omit<Row, "governorate_key">[] = [
  { dispatch_type: "taxi", ring1_min_km: 0, ring1_max_km: 1, ring2_min_km: 1, ring2_max_km: 3, ring3_min_km: 3, ring3_max_km: 5 },
  { dispatch_type: "large_driver", ring1_min_km: 0, ring1_max_km: 5, ring2_min_km: 5, ring2_max_km: 25, ring3_min_km: 25, ring3_max_km: 55 },
  { dispatch_type: "technician", ring1_min_km: 0, ring1_max_km: 5, ring2_min_km: 5, ring2_max_km: 25, ring3_min_km: 25, ring3_max_km: 55 },
];

export default function AdminDispatchZones() {
  const [governorate, setGovernorate] = useState("all");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<DispatchType | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await (supabase as any).rpc("admin_get_dispatch_zone_settings");
    if (error) {
      toast.error("تعذر تحميل نطاقات التوزيع: " + error.message);
      setRows([]);
    } else {
      const allRows = (data ?? []) as Row[];
      const selectedRows = TYPES.map((type) => {
        const exact = allRows.find((r) => r.governorate_key === governorate && r.dispatch_type === type);
        const fallback = allRows.find((r) => r.governorate_key === "all" && r.dispatch_type === type);
        const defaults = DEFAULTS.find((r) => r.dispatch_type === type)!;
        return { governorate_key: governorate, ...(exact ?? fallback ?? defaults), inherited: governorate !== "all" && !exact };
      });
      setRows(selectedRows);
    }
    setLoading(false);
  }, [governorate]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel("admin-regional-dispatch-settings")
      .on("postgres_changes", { event: "*", schema: "public", table: "regional_dispatch_zone_settings" }, () => { void load(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [load]);

  const update = (type: DispatchType, key: "ring1_max_km" | "ring2_max_km" | "ring3_max_km", value: string) => {
    setRows((old) => old.map((r) => r.dispatch_type === type ? { ...r, [key]: value === "" ? 0 : Number(value), inherited: false } : r));
  };

  const save = async (row: Row) => {
    const a = Number(row.ring1_max_km);
    const b = Number(row.ring2_max_km);
    const c = Number(row.ring3_max_km);
    if (!(a > 0 && b > a && c > b && c <= 55)) {
      toast.error("رتّب المسافات تصاعدياً: الأول ثم الثاني ثم الثالث، والحد الأعلى 55 كم");
      return;
    }
    setSaving(row.dispatch_type);
    const { error } = await (supabase as any).rpc("admin_update_dispatch_zone_settings", {
      p_governorate_key: governorate,
      p_dispatch_type: row.dispatch_type,
      p_ring1_max_km: a,
      p_ring2_max_km: b,
      p_ring3_max_km: c,
    });
    setSaving(null);
    if (error) toast.error(error.message);
    else {
      toast.success("تم حفظ النطاق. سيُقرأ مباشرة من Supabase في مرحلة التوزيع القادمة.");
      await load();
    }
  };

  const governorateName = governorate === "all" ? "كل العراق" : GOVERNORATES.find((g) => g.key === governorate)?.name ?? governorate;

  return (
    <div className="space-y-4" dir="rtl">
      <div className="rounded-2xl border bg-card p-4">
        <h2 className="text-xl font-black">التحكم بنطاقات توزيع الطلبات</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          كل مرحلة لها حد أقصى محسوب من موقع الزبون نفسه. مثال: 3 كم ثم 5 كم ثم 10 كم تعني إرسالاً أولاً من 0 إلى 3، ثم من أكثر من 3 إلى 5، ثم من أكثر من 5 إلى 10 كم. لا ينتقل الطلب خارج الحد الذي تحدده الإدارة.
        </p>
      </div>

      <div className="rounded-2xl border bg-card p-4 space-y-2">
        <label className="block text-sm font-bold">المحافظة التي تريد ضبط نطاقاتها</label>
        <select value={governorate} onChange={(e) => setGovernorate(e.target.value)} className="w-full rounded-xl border bg-background p-3">
          <option value="all">كل العراق — الإعداد العام</option>
          {GOVERNORATES.map((g) => <option key={g.key} value={g.key}>{g.name}</option>)}
        </select>
        <p className="text-xs text-muted-foreground">
          المحافظة المحددة: {governorateName}. المحافظة التي لا تملك إعداداً خاصاً ترث إعداد «كل العراق»، وأي تعديل خاص بها لا يؤثر على المحافظات الأخرى.
        </p>
      </div>

      {loading ? <div className="text-sm text-muted-foreground">جارٍ تحميل إعدادات Supabase...</div> : rows.map((row) => (
        <div key={row.dispatch_type} className="rounded-2xl border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-black">{LABELS[row.dispatch_type]}</h3>
            {row.inherited && <span className="rounded-full bg-muted px-2 py-1 text-[10px]">يرث إعداد كل العراق</span>}
          </div>
          {([
            { key: "ring1_max_km", label: "الإرسال الأول — قريب" },
            { key: "ring2_max_km", label: "الإرسال الثاني — متوسط" },
            { key: "ring3_max_km", label: "الإرسال الثالث — بعيد" },
          ] as const).map((field, i) => (
            <label key={field.key} className="block text-sm font-semibold">
              {field.label}
              <div className="mt-1 flex items-center gap-2">
                <input type="number" min={0.5} max={55} step="0.5" value={row[field.key]} onChange={(e) => update(row.dispatch_type, field.key, e.target.value)} className="w-full rounded-xl border bg-background p-3" />
                <span className="text-xs text-muted-foreground">كم</span>
              </div>
              <span className="text-[11px] text-muted-foreground">
                {i === 0 ? "من موقع الزبون إلى هذا الحد" : i === 1 ? "من بعد " + row.ring1_max_km + " إلى هذا الحد" : "من بعد " + row.ring2_max_km + " إلى هذا الحد"} كم
              </span>
            </label>
          ))}
          <button disabled={saving === row.dispatch_type} onClick={() => void save(row)} className="w-full rounded-xl bg-primary py-3 font-bold text-primary-foreground disabled:opacity-50">
            {saving === row.dispatch_type ? "جارٍ الحفظ..." : "حفظ نطاقات هذه الفئة"}
          </button>
        </div>
      ))}

      <p className="text-xs text-muted-foreground">
        التغييرات محفوظة في Supabase. محرك التوزيع يقرأ الإعداد حسب محافظة الطلب ونوعه عند كل مرحلة، مع بقاء نطاق اشتراك ومجال عمل مقدم الخدمة كحد إضافي لا يمكن تجاوزه. الحد الأعلى الحالي 55 كم.
      </p>
    </div>
  );
}
