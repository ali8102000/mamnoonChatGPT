import { useCallback, useEffect, useState } from "react";
import { CloudRain, Save, RefreshCw, ShieldCheck, ThermometerSun } from "lucide-react";
import { GOVERNORATES } from "@/lib/governorates";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/lib/toast";

type Settings = {
  governorate_key: string; mode: "auto" | "notify" | "off"; enabled: boolean;
  rain_threshold_mm: number; heat_threshold_c: number; max_surcharge_percent: number;
  min_pending_requests: number; max_active_drivers: number;
  weather_max_age_minutes: number; gps_max_age_minutes: number; cooldown_minutes: number;
  last_decision?: string | null; last_reason?: string | null; last_checked_at?: string | null;
};
const DEFAULT: Settings = {
  governorate_key: "all", mode: "off", enabled: false, rain_threshold_mm: 1,
  heat_threshold_c: 42, max_surcharge_percent: 15, min_pending_requests: 5,
  max_active_drivers: 20, weather_max_age_minutes: 15, gps_max_age_minutes: 3,
  cooldown_minutes: 20, last_decision: null, last_reason: null, last_checked_at: null,
};

export default function AdminPeakWeatherControl() {
  const [key, setKey] = useState("all");
  const [settings, setSettings] = useState<Settings>(DEFAULT);
  const [weather, setWeather] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    const scopeType = key === "all" ? "global" : "governorate";
    const scope = key === "all" ? null : key;
    const [permission, config, observation, history] = await Promise.all([
      (supabase as any).rpc("admin_has_permission", { p_permission_key: "pricing.peak.edit", p_scope_type: scopeType, p_scope_governorate: scope }),
      (supabase as any).from("taxi_peak_weather_settings").select("*").eq("governorate_key", key).maybeSingle(),
      (supabase as any).from("taxi_peak_weather_observations").select("*").eq("governorate_key", key).maybeSingle(),
      (supabase as any).from("taxi_peak_weather_decisions").select("id,mode,decision,reason,surcharge_percent,created_at").eq("governorate_key", key).order("created_at", { ascending: false }).limit(8),
    ]);
    setAllowed(!permission.error && permission.data === true);
    if (config.error && !/does not exist|schema cache/i.test(config.error.message)) toast.error("تعذّر تحميل إعدادات طقس الذروة: " + config.error.message);
    setSettings({ ...DEFAULT, ...(config.data ?? {}), governorate_key: key });
    setWeather(observation.data ?? null);
    setLogs(history.data ?? []);
    setLoading(false);
  }, [key]);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (settings.mode === "off" && settings.enabled) {
      toast.error("وضع الإيقاف لا يمكن أن يكون مفعّلاً."); return;
    }
    setSaving(true);
    const { error } = await (supabase as any).rpc("admin_save_taxi_peak_weather_settings", {
      p_governorate_key: key, p_mode: settings.mode, p_enabled: settings.enabled,
      p_rain_threshold_mm: Number(settings.rain_threshold_mm), p_heat_threshold_c: Number(settings.heat_threshold_c),
      p_max_surcharge_percent: Number(settings.max_surcharge_percent),
      p_min_pending_requests: Number(settings.min_pending_requests), p_max_active_drivers: Number(settings.max_active_drivers),
      p_weather_max_age_minutes: Number(settings.weather_max_age_minutes), p_gps_max_age_minutes: Number(settings.gps_max_age_minutes),
      p_cooldown_minutes: Number(settings.cooldown_minutes),
    });
    setSaving(false);
    if (error) { toast.error("تعذّر حفظ إعدادات الذروة المناخية: " + error.message); return; }
    toast.success("تم حفظ إعدادات الذروة من لوحة الإدارة.");
    await load();
  }
  const field = (name: keyof Settings, label: string, min: number, max: number, step = 1) => (
    <label className="block space-y-1 text-xs font-bold" key={name}>
      <span>{label}</span>
      <input className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm" type="number" min={min} max={max} step={step}
        value={Number(settings[name] ?? 0)} onChange={(e) => setSettings(v => ({ ...v, [name]: Number(e.target.value) }))} />
    </label>
  );
  if (loading) return <div className="p-4 text-sm text-muted-foreground">جارٍ تحميل تحكم الذروة المناخية…</div>;
  if (!allowed) return <div className="rounded-xl border p-4 text-sm text-muted-foreground">لا تملك صلاحية إدارة الذروة المناخية في هذا النطاق.</div>;
  return (
    <section dir="rtl" className="rounded-2xl border border-border bg-card p-4 space-y-4">
      <header className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-sky-500/10 text-sky-600"><CloudRain className="h-5 w-5" /></div>
        <div><h3 className="font-black">الذروة حسب الطقس والطلب</h3><p className="text-xs text-muted-foreground">جميع أوضاع التشغيل والتفعيل من لوحة الإدارة فقط</p></div>
      </header>
      <label className="block space-y-1 text-sm font-bold"><span>النطاق الجغرافي</span>
        <select className="w-full rounded-xl border border-border bg-background px-3 py-2.5" value={key} onChange={e => setKey(e.target.value)}>
          <option value="all">كل العراق</option>{GOVERNORATES.map((g: any) => <option key={g.key} value={g.key}>{g.name}</option>)}
        </select>
      </label>
      <div className="rounded-xl border border-border p-3 space-y-3">
        <div className="font-black flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> وضع التشغيل</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {([{value:"auto",label:"تلقائي",desc:"يفعّل ويوقف حسب الشروط"},{value:"notify",label:"إخباري",desc:"يرسل توصية للأدمن فقط"},{value:"off",label:"إيقاف",desc:"يعطّل الأتمتة"}] as const).map(option =>
            <button key={option.value} type="button" onClick={() => setSettings(v => ({...v,mode:option.value,enabled:option.value!=="off"}))}
              className={`rounded-xl border p-3 text-right ${settings.mode===option.value ? "border-primary bg-primary/5" : "border-border"}`}>
              <b className="block text-sm">{option.label}</b><span className="text-[11px] text-muted-foreground">{option.desc}</span>
            </button>)}
        </div>
        <label className="flex items-center justify-between gap-3 text-sm font-bold">
          <span>السماح بتشغيل هذا الوضع على النطاق المحدد</span>
          <input type="checkbox" checked={settings.enabled && settings.mode!=="off"} disabled={settings.mode==="off"}
            onChange={e=>setSettings(v=>({...v,enabled:e.target.checked}))} className="h-5 w-5 accent-primary"/>
        </label>
      </div>
      <div className="rounded-xl border border-border p-3 space-y-3">
        <div className="font-black flex items-center gap-2"><ThermometerSun className="h-4 w-4"/> شروط المراقبة وحدود السعر</div>
        <div className="grid grid-cols-2 gap-3">
          {field("rain_threshold_mm","حد المطر (ملم)",0,100,0.1)}
          {field("heat_threshold_c","حد الحرارة (°م)",0,60)}
          {field("max_surcharge_percent","أقصى زيادة مسموحة (%)",0,100)}
          {field("min_pending_requests","أقل طلبات منتظرة",0,10000)}
          {field("max_active_drivers","أقصى سائقين متاحين",0,100000)}
          {field("weather_max_age_minutes","عمر قراءة الطقس الأقصى (دقيقة)",5,120)}
          {field("gps_max_age_minutes","عمر GPS الأقصى (دقيقة)",1,30)}
          {field("cooldown_minutes","فترة منع التذبذب (دقيقة)",5,240)}
        </div>
      </div>
      <div className="rounded-xl border border-border p-3 space-y-2">
        <div className="font-black">حالة القراءات</div>
        <p className="text-xs text-muted-foreground">الطقس: {weather?.is_fresh ? "قراءة حديثة" : "لا توجد قراءة حديثة موثوقة"}{weather?.observed_at ? " · " + new Date(weather.observed_at).toLocaleString("ar-IQ") : ""}</p>
        {weather && <p className="text-xs">الحرارة: {weather.temperature_c ?? "—"}° · المطر: {weather.rain_mm ?? "—"} ملم · {weather.condition_text ?? ""}</p>}
        {weather?.error && <p className="text-xs text-destructive">{weather.error}</p>}
        <p className="text-xs text-muted-foreground">آخر قرار: {settings.last_decision ?? "لا يوجد"} — {settings.last_reason ?? "بانتظار المراقبة"}</p>
        <p className="text-[11px] text-muted-foreground">آخر فحص: {settings.last_checked_at ? new Date(settings.last_checked_at).toLocaleString("ar-IQ") : "لم يبدأ بعد"}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={saving} onClick={() => void save()} className="rounded-xl bg-primary px-4 py-2.5 text-sm font-black text-primary-foreground disabled:opacity-50"><Save className="ml-2 inline h-4 w-4"/> حفظ إعدادات الذروة</button>
        <button type="button" onClick={() => void load()} className="rounded-xl border border-border px-4 py-2.5 text-sm font-bold"><RefreshCw className="ml-2 inline h-4 w-4"/> تحديث الحالة</button>
      </div>
      <div className="space-y-2"><b className="text-sm">سجل آخر القرارات</b>
        {logs.length ? logs.map(item => <div key={item.id} className="rounded-lg bg-muted/40 p-2 text-xs"><b>{item.decision}</b> · {item.reason}<div className="text-muted-foreground">{new Date(item.created_at).toLocaleString("ar-IQ")} · زيادة {item.surcharge_percent}%</div></div>) : <p className="text-xs text-muted-foreground">لا توجد قرارات مسجلة بعد.</p>}
      </div>
      <p className="text-[11px] text-muted-foreground">لن تُفعّل زيادة سعر بمجرد حفظ الإعدادات. يلزم نشر وفحص مراقب الطقس أولاً، والقراءات القديمة أو غير الموثوقة تمنع أي قرار تلقائي.</p>
    </section>
  );
}
