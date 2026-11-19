import { useEffect, useState } from "react";
import { Save, Building2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";


export default function AdminCompanySettings() {
  const [name, setName] = useState("");
  const [welcomeMessage, setWelcomeMessage] = useState("مشوارك وخدمات بيتك، بمكان واحد.");
  const [driverVideoMaxDurationSeconds, setDriverVideoMaxDurationSeconds] = useState(10);
  const [serviceIconDisplaySeconds, setServiceIconDisplaySeconds] = useState(2);
  const [serviceIconImageSizePx, setServiceIconImageSizePx] = useState(40);
  const [logoUrl, setLogoUrl] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!logoFile) { setLogoPreview(""); return; }
    const previewUrl = URL.createObjectURL(logoFile);
    setLogoPreview(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [logoFile]);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        if (active) { setMessage("سجّل الدخول أولاً."); setLoading(false); }
        return;
      }
      const { data: allowed, error: permissionError } = await (supabase as any).rpc("is_super_admin", { p_user_id: auth.user.id });
      if (permissionError || allowed !== true) {
        if (active) { setMessage("لا توجد صلاحية المدير الأعلى لهذا الحساب."); setLoading(false); }
        return;
      }
      const { data, error } = await (supabase as any).from("company_settings").select("company_name,company_logo_url,welcome_message,driver_video_max_duration_seconds,service_icon_display_seconds,service_icon_image_size_px").eq("id", 1).maybeSingle();
      if (active) {
        if (error) setMessage("تعذر تحميل اسم الشركة: " + error.message);
        else { setName(data?.company_name ?? "شركة ممنون"); setLogoUrl(data?.company_logo_url ?? ""); setWelcomeMessage(data?.welcome_message ?? "مشوارك وخدمات بيتك، بمكان واحد."); setDriverVideoMaxDurationSeconds(Number.isInteger(data?.driver_video_max_duration_seconds) ? data.driver_video_max_duration_seconds : 10); setServiceIconDisplaySeconds(Number.isInteger(data?.service_icon_display_seconds) ? data.service_icon_display_seconds : 2); setServiceIconImageSizePx(Number.isInteger(data?.service_icon_image_size_px) ? data.service_icon_image_size_px : 40); }
        setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const save = async () => {
    const value = name.trim();
    if (value.length < 2 || value.length > 80) { setMessage("اكتب اسماً من حرفين إلى 80 حرفاً."); return; }
    const welcome = welcomeMessage.trim();
    if (welcome.length < 2 || welcome.length > 180) { setMessage("رسالة الترحيب لازم تكون بين حرفين و180 حرفاً."); return; }
    if (!Number.isInteger(driverVideoMaxDurationSeconds) || driverVideoMaxDurationSeconds < 1 || driverVideoMaxDurationSeconds > 60) { setMessage("مدة فيديو السيارة لازم تكون بين 1 و60 ثانية."); return; }
    if (!Number.isInteger(serviceIconDisplaySeconds) || serviceIconDisplaySeconds < 1 || serviceIconDisplaySeconds > 10) { setMessage("مدة عرض أيقونات الفنيين لازم تكون بين 1 و10 ثوانٍ."); return; }
    if (!Number.isInteger(serviceIconImageSizePx) || serviceIconImageSizePx < 24 || serviceIconImageSizePx > 64) { setMessage("حجم صورة أيقونة الفني لازم يكون بين 24 و64 بكسل."); return; }
    setSaving(true); setMessage("");
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { setMessage("سجّل الدخول أولاً."); setSaving(false); return; }
    const { data: allowed } = await (supabase as any).rpc("is_super_admin", { p_user_id: auth.user.id });
    if (allowed !== true) { setMessage("لا توجد صلاحية المدير الأعلى."); setSaving(false); return; }
    let nextLogoUrl = logoUrl;
    if (logoFile) {
      if (!logoFile.type.startsWith("image/") || logoFile.size > 8 * 1024 * 1024) { setMessage("الشعار لازم يكون صورة وحجمه أقل من 8 ميغابايت."); setSaving(false); return; }
      const path = `company-branding/logo-${Date.now()}-${logoFile.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
      const uploaded = await supabase.storage.from("app-visuals").upload(path, logoFile, { upsert: false, contentType: logoFile.type });
      if (uploaded.error) { setMessage("تعذر رفع الشعار: " + uploaded.error.message); setSaving(false); return; }
      nextLogoUrl = supabase.storage.from("app-visuals").getPublicUrl(path).data.publicUrl;
    }
    const { error } = await (supabase as any).from("company_settings").upsert({ id: 1, company_name: value, company_logo_url: nextLogoUrl || null, welcome_message: welcome, driver_video_max_duration_seconds: driverVideoMaxDurationSeconds, service_icon_display_seconds: serviceIconDisplaySeconds, service_icon_image_size_px: serviceIconImageSizePx, updated_by: auth.user.id, updated_at: new Date().toISOString() }, { onConflict: "id" });
    if (!error) { setLogoUrl(nextLogoUrl); setLogoFile(null); }
    setMessage(error ? "فشل الحفظ: " + error.message : "تم حفظ إعدادات هوية ممنون ورسالة الترحيب.");
    setSaving(false);
  };

  if (loading) return <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /> جاري تحميل إعدادات الشركة...</div>;
  return <section className="max-w-2xl">
    <div className="flex items-center gap-3 mb-5"><Building2 className="h-6 w-6 text-primary" /><div><h2 className="text-xl font-black">إعدادات شركة ممنون</h2><p className="text-sm text-muted-foreground">إدارة اسم الشركة وشعار التطبيق ورسالة الترحيب</p></div></div>
    <div className="glass rounded-2xl p-5 space-y-4">
      <label className="block text-sm font-bold" htmlFor="company-name">اسم الشركة</label>
      <input id="company-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="w-full rounded-xl border border-border bg-background px-4 py-3 text-base outline-none focus:ring-2 focus:ring-primary" placeholder="مثلاً: شركة ممنون" />
      <label className="block text-sm font-bold" htmlFor="company-logo-upload">شعار الشركة الظاهر بالتطبيق</label>
      <div className="flex flex-wrap items-center gap-3">
        {logoPreview || logoUrl ? <img src={logoPreview || logoUrl} alt={`معاينة شعار ${name || "الشركة"}`} className="h-20 w-20 rounded-2xl border border-border bg-background object-contain p-2" /> : <div className="grid h-20 w-20 place-items-center rounded-2xl bg-primary text-3xl font-black text-primary-foreground">م</div>}
        <div className="flex flex-col gap-2">
          <label htmlFor="company-logo-upload" className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:opacity-90">
            {logoFile ? "اختيار صورة أخرى" : "اختيار صورة الشعار"}
          </label>
          <input id="company-logo-upload" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)} className="sr-only" />
          <span className="text-[11px] text-muted-foreground">PNG أو JPG أو WEBP · الحد الأعلى 8 ميغابايت</span>
        </div>
      </div>
      {logoFile && <p className="text-xs text-muted-foreground">الصورة المختارة: {logoFile.name}</p>}
      <label className="block text-sm font-bold" htmlFor="driver-video-max-duration">الحد الأعلى لمدة فيديو توثيق السيارة (ثانية)</label>
      <div className="flex items-center gap-3">
        <input id="driver-video-max-duration" type="number" min={1} max={60} step={1} value={driverVideoMaxDurationSeconds} onChange={(e) => setDriverVideoMaxDurationSeconds(Number(e.target.value))} className="w-28 rounded-xl border border-border bg-background px-4 py-3 text-base outline-none focus:ring-2 focus:ring-primary" />
        <span className="text-xs text-muted-foreground">الإعداد الافتراضي 10 ثوانٍ. يطبّق على تسجيل السائقين وسائقي المركبات الكبيرة في الويب والأندرويد.</span>
      </div>
      <label className="block text-sm font-bold" htmlFor="service-icon-display-seconds">مدة عرض كل أيقونة فني (ثانية)</label>
      <div className="flex items-center gap-3">
        <input id="service-icon-display-seconds" type="number" min={1} max={10} step={1} value={serviceIconDisplaySeconds} onChange={(e) => setServiceIconDisplaySeconds(Number(e.target.value))} className="w-28 rounded-xl border border-border bg-background px-4 py-3 text-base outline-none focus:ring-2 focus:ring-primary" />
        <span className="text-xs text-muted-foreground">تتحكم بسرعة انتقال الأيقونات في الشريط البانورامي للفنيين على الويب والأندرويد (1–10 ثوانٍ).</span>
      </div>
      <label className="block text-sm font-bold" htmlFor="service-icon-image-size">حجم صور أيقونات بانوراما الفنيين (بكسل)</label>
      <div className="flex items-center gap-3">
        <input id="service-icon-image-size" type="number" min={24} max={64} step={1} value={serviceIconImageSizePx} onChange={(e) => setServiceIconImageSizePx(Number(e.target.value))} className="w-28 rounded-xl border border-border bg-background px-4 py-3 text-base outline-none focus:ring-2 focus:ring-primary" />
        <span className="text-xs text-muted-foreground">من 24 إلى 64 بكسل. الافتراضي 40 بكسل، ويتحدث على الويب والأندرويد بعد الحفظ.</span>
      </div>
      <label className="block text-sm font-bold" htmlFor="company-welcome">رسالة الترحيب الظاهرة بالتطبيق</label>
      <textarea id="company-welcome" value={welcomeMessage} onChange={(e) => setWelcomeMessage(e.target.value)} maxLength={180} rows={3} className="w-full rounded-xl border border-border bg-background px-4 py-3 text-base outline-none focus:ring-2 focus:ring-primary" placeholder="مشوارك وخدمات بيتك، بمكان واحد." />
      <button type="button" onClick={save} disabled={saving || !name.trim()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-bold text-primary-foreground disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} حفظ إعدادات الشركة</button>
      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    </div>
  </section>;
}
