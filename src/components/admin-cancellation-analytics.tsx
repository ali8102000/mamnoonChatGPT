import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, RefreshCw, BarChart3 } from "lucide-react";

type Row = {
  cancellation_reason: string;
  cancelled_by_role: "customer" | "provider" | "system";
  cancellation_count: number;
  percentage: number;
};

const ROLE_LABEL: Record<string, string> = {
  customer: "الزبون",
  provider: "السائق / مقدم الخدمة",
  system: "النظام",
};

export default function AdminCancellationAnalytics() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error: rpcError } = await (supabase as any).rpc("admin_cancellation_analytics");
    if (rpcError) {
      setError(rpcError.message || "تعذر تحميل إحصائيات الإلغاء");
      setRows([]);
    } else {
      setRows((data ?? []) as Row[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const total = useMemo(() => rows.reduce((sum, row) => sum + Number(row.cancellation_count || 0), 0), [rows]);
  const byRole = useMemo(() => (["customer", "provider", "system"] as const).map((role) => ({
    role,
    count: rows.filter((row) => row.cancelled_by_role === role)
      .reduce((sum, row) => sum + Number(row.cancellation_count || 0), 0),
  })), [rows]);

  return (
    <section dir="rtl" className="glass mb-4 space-y-4 rounded-2xl p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-black"><BarChart3 className="h-5 w-5 text-primary"/> إحصائيات أسباب الإلغاء</div>
          <p className="mt-1 text-[11px] text-muted-foreground">توزيع الإلغاءات حسب السبب والطرف الذي نفّذ الإلغاء</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="rounded-xl border border-border p-2" aria-label="تحديث الإحصائيات"><RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"}/></button>
      </div>
      {loading ? <div className="grid place-items-center py-6"><Loader2 className="h-5 w-5 animate-spin"/></div> : error ? (
        <div className="rounded-xl bg-red-500/10 p-3 text-xs text-red-700">{error}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-xl bg-primary/10 p-3"><div className="text-2xl font-black text-primary">{total.toLocaleString("ar-IQ")}</div><div className="text-[10px] text-muted-foreground">إجمالي الإلغاءات المسجلة</div></div>
            {byRole.map((item) => <div key={item.role} className="rounded-xl border border-border p-3"><div className="text-xl font-black">{item.count.toLocaleString("ar-IQ")}</div><div className="text-[10px] text-muted-foreground">{ROLE_LABEL[item.role]}</div></div>)}
          </div>
          {rows.length === 0 ? <p className="py-4 text-center text-xs text-muted-foreground">لا توجد إلغاءات مسجلة بأسباب حتى الآن.</p> : (
            <div className="space-y-3">
              {rows.map((row) => {
                const count = Number(row.cancellation_count || 0);
                const percent = Math.max(0, Math.min(100, Number(row.percentage || 0)));
                return <div key={row.cancelled_by_role + ":" + row.cancellation_reason} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <div className="min-w-0"><b>{row.cancellation_reason}</b><span className="mr-2 text-[10px] text-muted-foreground">· {ROLE_LABEL[row.cancelled_by_role] || row.cancelled_by_role}</span></div>
                    <b className="shrink-0 tabular-nums">{count.toLocaleString("ar-IQ")} · {percent.toLocaleString("ar-IQ")}%</b>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: percent + "%" }}/></div>
                </div>;
              })}
            </div>
          )}
          <p className="text-[10px] text-muted-foreground">النسب محسوبة من الإلغاءات التي سُجّل لها سبب، ولا تشمل الإنهاء التلقائي لعدم توفر مقدم خدمة.</p>
        </>
      )}
    </section>
  );
}
