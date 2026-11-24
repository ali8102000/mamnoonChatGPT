import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type Mission = {
  mission_id: string;
  title: string;
  description: string;
  provider_type: string;
  service_slug: string | null;
  location_scope: string;
  target_count: number;
  reward_amount_iqd: number;
  progress_count: number;
  reward_status: string;
  starts_at: string;
  ends_at: string;
  max_job_duration_hours: number | null;
};

const money = (n: number) => new Intl.NumberFormat("ar-IQ").format(Number(n) || 0) + " د.ع";
const scopeText = (s: string) =>
  s === "inside_governorate" ? "داخل المحافظة فقط" :
  s === "outside_governorate" ? "خارج المحافظة فقط" : "داخل وخارج المحافظة";
const statusText = (s: string, endsAt: string) =>
  s === "eligible" ? "اكتملت المهمة — بانتظار مراجعة الإدارة" :
  s === "approved" ? "تم اعتماد المكافأة وإيداعها" :
  s === "rejected" ? "لم تعتمد الإدارة المكافأة" :
  new Date(endsAt).getTime() <= Date.now() ? "انتهت المهلة" : "مستمرة";

export default function ProviderMissions() {
  const [items, setItems] = useState<Mission[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data, error } = await (supabase as any).rpc("provider_get_missions");
    if (!error) setItems((data ?? []) as Mission[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30000);
    const channel = supabase.channel("provider-missions-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, () => void load())
      .subscribe();
    return () => {
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [load]);

  if (loading && !items.length) {
    return <div className="glass rounded-2xl p-4 text-sm text-muted-foreground">جارٍ تحميل المهمات...</div>;
  }

  if (!items.length) {
    return (
      <div className="glass rounded-2xl p-4">
        <div className="font-black">مهماتي ومكافآتي</div>
        <p className="mt-1 text-xs text-muted-foreground">إذا أرسلت الإدارة مهمة جديدة راح تظهر هنا وتوصلك رسالة.</p>
      </div>
    );
  }

  return (
    <section className="space-y-3" dir="rtl">
      <div className="flex items-center justify-between">
        <h3 className="font-black">مهماتي ومكافآتي</h3>
        <button onClick={() => void load()} className="text-xs font-bold text-primary">تحديث</button>
      </div>
      <div className="space-y-0">
        {items.map((m, index) => {
          const progress = Math.min(100, Math.round(m.progress_count / Math.max(1, m.target_count) * 100));
          const completed = progress >= 100 || m.reward_status === "eligible" || m.reward_status === "approved";
          const progressColor = completed ? "bg-emerald-500" : progress > 0 ? "bg-amber-500" : "bg-slate-300";
          const textColor = completed ? "text-emerald-600" : progress > 0 ? "text-amber-600" : "text-muted-foreground";

          return (
            <div key={m.mission_id} className="flex items-stretch gap-3">
              <div className="flex w-7 shrink-0 flex-col items-center">
                <div className={`relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 border-background text-[11px] font-black text-white shadow-sm ${progressColor}`}>
                  {completed ? "✓" : index + 1}
                </div>
                {index < items.length - 1 && (
                  <div className={`my-1 min-h-8 w-0.5 flex-1 rounded-full ${completed ? "bg-emerald-400" : "bg-border"}`} />
                )}
              </div>

              <article className="mb-4 min-w-0 flex-1 space-y-2 rounded-2xl border border-border glass p-4">
                <div className="flex items-start justify-between gap-2">
                  <h4 className="min-w-0 font-black">{m.title}</h4>
                  <span className={`shrink-0 text-sm font-black tabular-nums ${textColor}`}>{progress}%</span>
                </div>
                <div className={`text-[11px] font-bold ${textColor}`}>{statusText(m.reward_status, m.ends_at)}</div>
                {m.description && <p className="text-xs leading-5 text-muted-foreground">{m.description}</p>}
                <div className="flex justify-between gap-2 text-xs font-bold">
                  <span>التقدم: {m.progress_count} / {m.target_count}</span>
                  <span className={textColor}>{completed ? "مكتملة" : progress > 0 ? "قيد التقدم" : "لم تبدأ"}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div className={`h-full rounded-full transition-all ${progressColor}`} style={{ width: `${progress}%` }} />
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-xl bg-background/70 p-2">
                    <span className="text-muted-foreground">المكافأة</span>
                    <div className="mt-1 font-black text-emerald-600">{money(m.reward_amount_iqd)}</div>
                  </div>
                  <div className="rounded-xl bg-background/70 p-2">
                    <span className="text-muted-foreground">شرط المكان</span>
                    <div className="mt-1 font-bold">{scopeText(m.location_scope)}</div>
                  </div>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  تنتهي: {new Date(m.ends_at).toLocaleString("ar-IQ")}
                  {m.max_job_duration_hours ? " · أقصى مدة للعمل الواحد: " + m.max_job_duration_hours + " ساعة" : ""}
                </div>
              </article>
            </div>
          );
        })}
      </div>
    </section>
  );
}
