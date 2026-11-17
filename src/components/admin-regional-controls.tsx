import { useCallback, useEffect, useMemo, useState } from "react";
import { BellRing, Check, Globe2, ImagePlus, MapPin, Save, ShieldCheck, ToggleLeft, ToggleRight } from "lucide-react";
import { GOVERNORATES } from "@/lib/governorates";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/lib/toast";

type ControlRow = {
  governorate_key: string;
  services_enabled: boolean;
  message_enabled: boolean;
  message_title: string;
  message_text: string;
  message_animate: boolean;
  rejection_message: string;
  message_image_url: string;
  message_float_enabled: boolean;
  message_width_percent: number;
  message_height_percent: number;
  message_position: 'top-center' | 'top-right' | 'top-left';
  message_top_offset: number;
  message_font_size: number;
  updated_at?: string;
};

const EMPTY: Omit<ControlRow, "governorate_key"> = {
  services_enabled: true,
  message_enabled: false,
  message_title: "تنويه رسمي من إدارة ممنون",
  message_text: "",
  message_animate: true,
  rejection_message: "الخدمة متوقفة مؤقتاً في منطقتك. نعتذر عن ذلك، وسيتم إعلامك عند عودة الخدمة.",
  message_image_url: "",
  message_float_enabled: true,
  message_width_percent: 92,
  message_height_percent: 34,
  message_position: "top-center" as const,
  message_top_offset: 12,
  message_font_size: 14,
};

export default function RegionalControlsSection() {
  const [rows, setRows] = useState<ControlRow[]>([]);
  const [targetMode, setTargetMode] = useState<"all" | "selected">("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [settings, setSettings] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("regional_service_controls")
      .select("governorate_key,services_enabled,message_enabled,message_title,message_text,message_animate,rejection_message,message_image_url,message_float_enabled,message_width_percent,message_height_percent,message_position,message_top_offset,message_font_size,updated_at")
      .order("governorate_key");
    if (error) {
      toast.error("تعذّر تحميل إعدادات المحافظات: " + error.message);
      setRows([]);
    } else {
      setRows((data ?? []) as ControlRow[]);
      const global = (data ?? []).find((row: ControlRow) => row.governorate_key === "all");
      if (global && targetMode === "all") setSettings({
        services_enabled: global.services_enabled,
        message_enabled: global.message_enabled,
        message_title: global.message_title,
        message_text: global.message_text,
        message_animate: global.message_animate,
        rejection_message: global.rejection_message || EMPTY.rejection_message,
        message_image_url: global.message_image_url || "",
        message_float_enabled: global.message_float_enabled ?? true,
        message_width_percent: global.message_width_percent ?? 92,
        message_height_percent: global.message_height_percent ?? 34,
        message_position: global.message_position ?? "top-center",
        message_top_offset: global.message_top_offset ?? 12,
        message_font_size: global.message_font_size ?? 14,
      });
    }
    setLoading(false);
  }, [targetMode]);

  useEffect(() => { void load(); }, [load]);

  const targetKeys = useMemo(
    () => targetMode === "all" ? ["all"] : selected,
    [targetMode, selected],
  );

  function selectProvince(key: string) {
    setSelected((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
    const row = rows.find((item) => item.governorate_key === key);
    setSettings(row ? {
      services_enabled: row.services_enabled,
      message_enabled: row.message_enabled,
      message_title: row.message_title,
      message_text: row.message_text,
      message_animate: row.message_animate,
      rejection_message: row.rejection_message || EMPTY.rejection_message,
      message_image_url: row.message_image_url || "",
      message_float_enabled: row.message_float_enabled ?? true,
      message_width_percent: row.message_width_percent ?? 92,
      message_height_percent: row.message_height_percent ?? 34,
      message_position: row.message_position ?? "top-center",
      message_top_offset: row.message_top_offset ?? 12,
      message_font_size: row.message_font_size ?? 14,
    } : { ...EMPTY });
    setSaved(false);
  }

  async function uploadNoticeImage(file: File) {
    if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) { toast.error("اختَر صورة لا يتجاوز حجمها 5 ميغابايت."); return; }
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { toast.error("سجّل الدخول أولاً."); return; }
    setImageUploading(true);
    const path = `${auth.user.id}/${Date.now()}-${file.name.replace(/[^\w.-]/g, "_")}`;
    const { error } = await supabase.storage.from("regional-notices").upload(path, file, { contentType: file.type, upsert: false });
    setImageUploading(false);
    if (error) { toast.error("تعذّر رفع الصورة: " + error.message); return; }
    const { data } = supabase.storage.from("regional-notices").getPublicUrl(path);
    setSettings((s) => ({ ...s, message_image_url: data.publicUrl }));
    setSaved(false);
    toast.success("تم إرفاق الصورة. احفظ الإعدادات لتطبيقها.");
  }

  async function toggleAndSave(field: "services_enabled" | "message_enabled") {
    if (field === "message_enabled" && !settings.message_enabled && settings.message_text.trim().length < 2) { toast.error("اكتب نص التنويه أولاً قبل تفعيل الرسائل."); return; }
    if (!targetKeys.length) { toast.error("اختَر محافظة واحدة على الأقل."); return; }
    const next = { ...settings, [field]: !settings[field] };
    setSettings(next);
    setSaved(false);
    const { error } = await (supabase as any).from("regional_service_controls").upsert(
      targetKeys.map((governorate_key) => ({ governorate_key, ...next, updated_at: new Date().toISOString() })),
      { onConflict: "governorate_key" },
    );
    if (error) { setSettings(settings); toast.error("تعذّر تطبيق الحالة: " + error.message); }
    else { setRows((current) => [...current.filter((r) => !targetKeys.includes(r.governorate_key)), ...targetKeys.map((governorate_key) => ({ governorate_key, ...next }))]); toast.success(field === "services_enabled" ? (next.services_enabled ? "الخدمات مفعّلة" : "الخدمات متوقفة") : (next.message_enabled ? "الرسائل مفعّلة" : "الرسائل متوقفة")); }
  }

  async function save() {
    if (!targetKeys.length) {
      toast.error("اختَر محافظة واحدة على الأقل.");
      return;
    }
    if (settings.message_enabled && settings.message_text.trim().length < 2) {
      toast.error("اكتب نص الرسالة قبل تفعيلها.");
      return;
    }
    setSaving(true);
    const payload = targetKeys.map((governorate_key) => ({
      governorate_key,
      ...settings,
      message_title: settings.message_title.trim() || "تنويه رسمي من إدارة ممنون",
      message_text: settings.message_text.trim(),
      updated_at: new Date().toISOString(),
    }));
    const { error } = await (supabase as any)
      .from("regional_service_controls")
      .upsert(payload, { onConflict: "governorate_key" });
    setSaving(false);
    if (error) {
      toast.error("تعذّر حفظ التحكم: " + error.message);
      return;
    }
    setSaved(true);
    toast.success(targetMode === "all" ? "تم حفظ إعدادات كل العراق" : "تم حفظ إعدادات المحافظات المحددة");
    await load();
  }

  async function removeOverrides() {
    if (!selected.length) {
      toast.error("اختَر المحافظات التي تريد إزالة استثناءاتها.");
      return;
    }
    setSaving(true);
    const { error } = await (supabase as any)
      .from("regional_service_controls")
      .delete()
      .in("governorate_key", selected);
    setSaving(false);
    if (error) toast.error("تعذّرت إزالة الاستثناءات: " + error.message);
    else {
      toast.success("رجعت المحافظات المحددة إلى إعداد كل العراق.");
      setSelected([]);
      await load();
    }
  }

  const blockedCount = rows.filter((row) => row.governorate_key !== "all" && !row.services_enabled).length;

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-2xl bg-amber-500/15 text-amber-500 grid place-items-center"><Globe2 className="h-5 w-5" /></div>
        <div>
          <h2 className="text-xl font-black">التحكم بالخدمات حسب المحافظات</h2>
          <p className="text-xs text-muted-foreground mt-1">إعداد واحد مشترك للويب والأندرويد، ويُطبّق من قاعدة البيانات.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="glass rounded-2xl p-4"><div className="text-xs text-muted-foreground">محافظات لها إعدادات خاصة</div><div className="text-2xl font-black mt-1">{rows.filter((row) => row.governorate_key !== "all").length}</div></div>
        <div className="glass rounded-2xl p-4"><div className="text-xs text-muted-foreground">محافظات موقوفة صراحةً</div><div className="text-2xl font-black mt-1 text-rose-500">{blockedCount}</div></div>
      </div>

      <section className="glass rounded-2xl p-4 space-y-4">
        <div>
          <h3 className="font-black text-sm">نطاق التطبيق</h3>
          <p className="text-[11px] text-muted-foreground mt-1">إيقاف «كل العراق» يوقف الجميع دائماً. عند تشغيله، تگدر توقف محافظات منفردة بإعداد خاص.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setTargetMode("all")} className={`rounded-xl px-4 py-2 text-xs font-black border ${targetMode === "all" ? "bg-amber-500 text-black border-amber-500" : "border-border"}`}><Globe2 className="inline h-4 w-4 ml-1" /> كل العراق</button>
          <button onClick={() => { setTargetMode("selected"); setSelected([]); setSettings({ ...EMPTY }); setSaved(false); }} className={`rounded-xl px-4 py-2 text-xs font-black border ${targetMode === "selected" ? "bg-amber-500 text-black border-amber-500" : "border-border"}`}><MapPin className="inline h-4 w-4 ml-1" /> محافظات محددة</button>
        </div>
        {targetMode === "selected" && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {GOVERNORATES.map((gov) => (
              <label key={gov.key} className={`flex items-center gap-2 rounded-xl border p-2.5 text-xs font-bold cursor-pointer ${selected.includes(gov.key) ? "border-amber-500 bg-amber-500/10" : "border-border"}`}>
                <input type="checkbox" checked={selected.includes(gov.key)} onChange={() => selectProvince(gov.key)} />
                {gov.name}
              </label>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-xl border border-border p-3">
            <div className="flex items-center justify-between gap-2"><span className="text-sm font-black">الخدمات في النطاق</span>{settings.services_enabled ? <ToggleRight className="text-emerald-500" /> : <ToggleLeft className="text-rose-500" />}</div>
            <p className="text-[11px] text-muted-foreground mt-1">{settings.services_enabled ? "الخدمات تعمل ويمكن إنشاء طلبات جديدة." : "الخدمات متوقفة ولن تُقبل طلبات جديدة أو عروض في هذا النطاق."}</p>
            <button onClick={() => void toggleAndSave("services_enabled")} className={`mt-3 w-full rounded-xl py-2 text-xs font-black ${settings.services_enabled ? "bg-rose-500/10 text-rose-600" : "bg-emerald-500/10 text-emerald-600"}`}>{settings.services_enabled ? "الخدمات مفعّلة" : "الخدمات متوقفة"}</button>
          </div>
          <div className="rounded-xl border border-border p-3">
            <div className="flex items-center justify-between gap-2"><span className="text-sm font-black">الرسالة الرسمية</span>{settings.message_enabled ? <BellRing className="text-amber-500" /> : <BellRing className="text-muted-foreground" />}</div>
            <p className="text-[11px] text-muted-foreground mt-1">{settings.message_enabled ? "الرسالة تظهر للمستخدمين في النطاق المحدد." : "الرسالة متوقفة بشكل مستقل عن الخدمات."}</p>
            <button onClick={() => void toggleAndSave("message_enabled")} className={`mt-3 w-full rounded-xl py-2 text-xs font-black ${settings.message_enabled ? "bg-rose-500/10 text-rose-600" : "bg-amber-500/10 text-amber-700"}`}>{settings.message_enabled ? "الرسائل مفعّلة" : "الرسائل متوقفة"}</button>
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-bold">عنوان الختم الرسمي</label>
          <input value={settings.message_title} onChange={(e) => setSettings((s) => ({ ...s, message_title: e.target.value }))} maxLength={100} className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm" />
          <label className="block text-xs font-bold">نص الرسالة المتحركة</label>
          <textarea value={settings.message_text} onChange={(e) => setSettings((s) => ({ ...s, message_text: e.target.value }))} maxLength={1200} rows={3} placeholder="اكتب التنويه الذي تريد إظهاره للمستخدمين..." className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm" />
          <label className="block text-xs font-bold">الرسالة التي تظهر عند رفض الطلب</label>
          <textarea value={settings.rejection_message} onChange={(e) => setSettings((s) => ({ ...s, rejection_message: e.target.value }))} maxLength={1000} rows={3} className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm" placeholder="اكتب سبب الرفض الذي سيظهر للعميل..." />
          <label className="block text-xs font-bold">رابط صورة اختيارية للتنويه</label>
          <input value={settings.message_image_url} onChange={(e) => setSettings((s) => ({ ...s, message_image_url: e.target.value }))} type="url" placeholder="https://..." className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm" />
          <label className="flex items-center gap-2 text-xs font-bold"><input type="checkbox" checked={settings.message_animate} onChange={(e) => setSettings((s) => ({ ...s, message_animate: e.target.checked }))} /> تحريك الرسالة بشكل مستمر</label>
        </div>

        <div className="rounded-2xl border border-border bg-muted/20 p-4 space-y-3">
          <div className="font-black text-sm">إعدادات النافذة العائمة</div>
          <label className="flex items-center justify-between gap-3 text-xs font-bold"><span>إظهار التنويه كنافذة عائمة</span><input type="checkbox" checked={settings.message_float_enabled} onChange={(e) => setSettings((s) => ({ ...s, message_float_enabled: e.target.checked }))} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-bold">عرض النافذة · {settings.message_width_percent}%<input type="range" min="60" max="100" value={settings.message_width_percent} onChange={(e) => setSettings((s) => ({ ...s, message_width_percent: Number(e.target.value) }))} className="w-full" /></label>
            <label className="text-xs font-bold">ارتفاع النافذة · {settings.message_height_percent}%<input type="range" min="12" max="60" value={settings.message_height_percent} onChange={(e) => setSettings((s) => ({ ...s, message_height_percent: Number(e.target.value) }))} className="w-full" /></label>
            <label className="text-xs font-bold">حجم الخط · {settings.message_font_size}px<input type="range" min="11" max="22" value={settings.message_font_size} onChange={(e) => setSettings((s) => ({ ...s, message_font_size: Number(e.target.value) }))} className="w-full" /></label>
            <label className="text-xs font-bold">المسافة من الأعلى · {settings.message_top_offset}px<input type="range" min="0" max="160" value={settings.message_top_offset} onChange={(e) => setSettings((s) => ({ ...s, message_top_offset: Number(e.target.value) }))} className="w-full" /></label>
          </div>
          <label className="block text-xs font-bold">موقع النافذة</label>
          <select value={settings.message_position} onChange={(e) => setSettings((s) => ({ ...s, message_position: e.target.value as typeof s.message_position }))} className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm">
            <option value="top-center">أعلى الوسط</option><option value="top-right">أعلى اليمين</option><option value="top-left">أعلى اليسار</option>
          </select>
          <p className="text-[11px] text-muted-foreground">المعاينة التالية تتغير مباشرة، والحدود تمنع النافذة من تجاوز الشاشة.</p>
        </div>
        <div className="rounded-2xl border border-amber-500/40 bg-[#080808] p-4 text-right text-amber-300 overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b border-amber-500/25 pb-2">
            <span className="text-[10px] tracking-wide text-amber-200">✦ ختم الإدارة الرسمي · موثّق ✦</span>
            <ShieldCheck className="h-4 w-4 text-amber-400" />
          </div>
          <div className="text-sm font-black mt-3 bg-gradient-to-l from-yellow-200 via-amber-400 to-yellow-700 bg-clip-text text-transparent">{settings.message_title || "تنويه رسمي من إدارة ممنون"}</div>
          <div className="mt-2 text-xs leading-6 text-amber-100 whitespace-pre-wrap">{settings.message_text || "ستظهر رسالتك هنا بعد كتابتها..."}</div><div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3"><div className="text-[10px] font-black text-amber-300">معاينة رسالة رفض الطلب · إدارة ممنون الموثّقة</div><div className="mt-1 text-sm font-black leading-7 text-amber-100">{settings.rejection_message}</div></div>
          {settings.message_image_url && <img src={settings.message_image_url} alt="صورة التنويه" className="mt-3 max-h-44 w-full rounded-xl object-contain" />}
          <div className="mt-3 text-[9px] text-amber-500/80">إدارة ممنون · الحساب الرسمي الموثّق</div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button onClick={save} disabled={saving || loading || !targetKeys.length} className="flex-1 rounded-xl bg-amber-500 text-black py-3 text-sm font-black disabled:opacity-50"><Save className="inline h-4 w-4 ml-1" />{saving ? "جاري الحفظ..." : "حفظ وتطبيق الإعدادات"}</button>
          {targetMode === "selected" && <button onClick={removeOverrides} disabled={saving || !selected.length} className="rounded-xl border border-border px-3 py-3 text-xs font-bold disabled:opacity-50">إزالة الاستثناءات المحددة</button>}
        </div>
        {saved && <p className="text-xs text-emerald-600 flex items-center gap-1"><Check className="h-4 w-4" /> تم الحفظ. التغيير مشترك بين الويب والأندرويد.</p>}
      </section>

      <section className="glass rounded-2xl p-4">
        <h3 className="font-black text-sm mb-3">الإعدادات الحالية</h3>
        {loading ? <p className="text-xs text-muted-foreground">جاري التحميل...</p> : rows.length === 0 ? <p className="text-xs text-muted-foreground">لا توجد استثناءات؛ الخدمات تعمل افتراضياً في كل العراق.</p> : (
          <div className="space-y-2">
            {rows.map((row) => <div key={row.governorate_key} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3 text-xs"><span className="font-black">{row.governorate_key === "all" ? "كل العراق" : GOVERNORATES.find((g) => g.key === row.governorate_key)?.name ?? row.governorate_key}</span><span className={row.services_enabled ? "text-emerald-600 font-bold" : "text-rose-500 font-bold"}>{row.services_enabled ? "الخدمات تعمل" : "الخدمات متوقفة"}</span><span className={row.message_enabled ? "text-amber-600 font-bold" : "text-muted-foreground"}>{row.message_enabled ? "الرسالة مفعّلة" : "الرسالة متوقفة"}</span></div>)}
          </div>
        )}
      </section>
    </div>
  );
}
