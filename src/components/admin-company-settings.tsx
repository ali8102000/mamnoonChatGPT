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
  const [welcomeVisualUrl, setWelcomeVisualUrl] = useState("");
  const [welcomeVisualFile, setWelcomeVisualFile] = useState<File | null>(null);
  const [welcomeVisualPreview, setWelcomeVisualPreview] = useState("");
  const [welcomeVisualAnimated, setWelcomeVisualAnimated] = useState(false);
  const [welcomeVisualSizePx, setWelcomeVisualSizePx] = useState(180);
  const [removeWelcomeVisual, setRemoveWelcomeVisual] = useState(false);
  const [homeVisualUrl, setHomeVisualUrl] = useState("");
  const [homeVisualFile, setHomeVisualFile] = useState<File | null>(null);
  const [homeVisualPreview, setHomeVisualPreview] = useState("");
  const [homeVisualAnimated, setHomeVisualAnimated] = useState(true);
  const [homeVisualEnabled, setHomeVisualEnabled] = useState(true);
  const [homeVisualSizePx, setHomeVisualSizePx] = useState(180);
  const [homeVisualWidthPx, setHomeVisualWidthPx] = useState(320);
  const [homeVisualHeightPx, setHomeVisualHeightPx] = useState(180);
  const [homeVisualPosition, setHomeVisualPosition] = useState("below_banner");
  const [homeVisualLinkUrl, setHomeVisualLinkUrl] = useState("");
  const [removeHomeVisual, setRemoveHomeVisual] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!welcomeVisualFile) { setWelcomeVisualPreview(""); return; }
    const previewUrl = URL.createObjectURL(welcomeVisualFile);
    setWelcomeVisualPreview(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [welcomeVisualFile]);

  useEffect(() => {
    if (!homeVisualFile) { setHomeVisualPreview(""); return; }
    const previewUrl = URL.createObjectURL(homeVisualFile);
    setHomeVisualPreview(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [homeVisualFile]);

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
      const { data, error } = await (supabase as any).from("company_settings").select("company_name,company_logo_url,welcome_message,company_welcome_visual_url,company_welcome_visual_animated,company_welcome_visual_size_px,home_visual_url,home_visual_animated,home_visual_enabled,home_visual_size_px,driver_video_max_duration_seconds,service_icon_display_seconds,service_icon_image_size_px").eq("id", 1).maybeSingle();
      if (active) {
        if (error) setMessage("تعذر تحميل اسم الشركة: " + error.message);
        else { setName(data?.company_name ?? "شركة ممنون"); setLogoUrl(data?.company_logo_url ?? ""); setWelcomeMessage(data?.welcome_message ?? "مشوارك وخدمات بيتك، بمكان واحد."); setWelcomeVisualUrl(data?.company_welcome_visual_url ?? ""); setWelcomeVisualAnimated(data?.company_welcome_visual_animated === true); setWelcomeVisualSizePx(Number.isInteger(data?.company_welcome_visual_size_px) ? Math.max(80, Math.min(320, data.company_welcome_visual_size_px)) : 180); setHomeVisualUrl(data?.home_visual_url ?? ""); setHomeVisualAnimated(data?.home_visual_animated !== false); setHomeVisualEnabled(data?.home_visual_enabled !== false); setHomeVisualSizePx(Number.isInteger(data?.home_visual_size_px) ? Math.max(80, Math.min(320, data.home_visual_size_px)) : 180); setHomeVisualWidthPx(Number.isInteger(data?.home_visual_width_px) ? Math.max(80, Math.min(600, data.home_visual_width_px)) : 320); setHomeVisualHeightPx(Number.isInteger(data?.home_visual_height_px) ? Math.max(80, Math.min(600, data.home_visual_height_px)) : 180); setHomeVisualPosition(["above_banner","below_banner","below_custom_content"].includes(data?.home_visual_position) ? data.home_visual_position : "below_banner"); setHomeVisualLinkUrl(data?.home_visual_link_url ?? ""); setDriverVideoMaxDurationSeconds(Number.isInteger(data?.driver_video_max_duration_seconds) ? data.driver_video_max_duration_seconds : 10); setServiceIconDisplaySeconds(Number.isInteger(data?.service_icon_display_seconds) ? data.service_icon_display_seconds : 2); setServiceIconImageSizePx(Number.isInteger(data?.service_icon_image_size_px) ? data.service_icon_image_size_px : 40); }
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
    if (homeVisualLinkUrl.trim() && !(homeVisualLinkUrl.trim().startsWith("https://") || homeVisualLinkUrl.trim().startsWith("http://"))) { setMessage("رابط الصورة لازم يبدأ بـ https:// أو http://."); return; }
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
    let nextWelcomeVisualUrl = removeWelcomeVisual ? "" : welcomeVisualUrl;
    if (welcomeVisualFile) {
      if (!welcomeVisualFile.type.startsWith("image/") || welcomeVisualFile.size > 12 * 1024 * 1024) { setMessage("الصورة الرئيسية لازم تكون صورة وحجمها أقل من 12 ميغابايت."); setSaving(false); return; }
      const visualPath = `company-branding/welcome-${Date.now()}-${welcomeVisualFile.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
      const visualUpload = await supabase.storage.from("app-visuals").upload(visualPath, welcomeVisualFile, { upsert: false, contentType: welcomeVisualFile.type });
      if (visualUpload.error) { setMessage("تعذر رفع الصورة الرئيسية: " + visualUpload.error.message); setSaving(false); return; }
      nextWelcomeVisualUrl = supabase.storage.from("app-visuals").getPublicUrl(visualPath).data.publicUrl;
    }
    let nextHomeVisualUrl = removeHomeVisual ? "" : homeVisualUrl;
    if (homeVisualFile) {
      if (!homeVisualFile.type.startsWith("image/") || homeVisualFile.size > 12 * 1024 * 1024) { setMessage("GIF الصفحة الرئيسية لازم يكون صورة أو GIF وحجمه أقل من 12 ميغابايت."); setSaving(false); return; }
      const path = `company-branding/home-${Date.now()}-${homeVisualFile.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
      const uploaded = await supabase.storage.from("app-visuals").upload(path, homeVisualFile, { upsert: false, contentType: homeVisualFile.type });
      if (uploaded.error) { setMessage("تعذر رفع GIF الصفحة الرئيسية: " + uploaded.error.message); setSaving(false); return; }
      nextHomeVisualUrl = supabase.storage.from("app-visuals").getPublicUrl(path).data.publicUrl;
    }
    const { error } = await (supabase as any).from("company_settings").upsert({ id: 1, company_name: value, company_logo_url: nextLogoUrl || null, welcome_message: welcome, company_welcome_visual_url: nextWelcomeVisualUrl || null, company_welcome_visual_animated: welcomeVisualAnimated, company_welcome_visual_size_px: welcomeVisualSizePx, home_visual_url: nextHomeVisualUrl || null, home_visual_animated: homeVisualAnimated, home_visual_enabled: homeVisualEnabled, home_visual_size_px: homeVisualSizePx, home_visual_width_px: homeVisualWidthPx, home_visual_height_px: homeVisualHeightPx, home_visual_position: homeVisualPosition, home_visual_link_url: homeVisualLinkUrl.trim() || null, driver_video_max_duration_seconds: driverVideoMaxDurationSeconds, service_icon_display_seconds: serviceIconDisplaySeconds, service_icon_image_size_px: serviceIconImageSizePx, updated_by: auth.user.id, updated_at: new Date().toISOString() }, { onConflict: "id" });
    if (!error) {
      if (welcomeVisualUrl && nextWelcomeVisualUrl !== welcomeVisualUrl) {
        const marker = "/storage/v1/object/public/app-visuals/";
        const storedPath = welcomeVisualUrl.split(marker)[1]?.split("?")[0];
        if (storedPath) await supabase.storage.from("app-visuals").remove([decodeURIComponent(storedPath)]);
      }
      if (homeVisualUrl && nextHomeVisualUrl !== homeVisualUrl) { const marker = "/storage/v1/object/public/app-visuals/"; const storedPath = homeVisualUrl.split(marker)[1]?.split("?")[0]; if (storedPath) await supabase.storage.from("app-visuals").remove([decodeURIComponent(storedPath)]); }
      setLogoUrl(nextLogoUrl); setLogoFile(null); setWelcomeVisualUrl(nextWelcomeVisualUrl); setWelcomeVisualFile(null); setRemoveWelcomeVisual(false); setHomeVisualUrl(nextHomeVisualUrl); setHomeVisualFile(null); setRemoveHomeVisual(false);
    }
    setMessage(error ? "فشل الحفظ: " + error.message : "تم حفظ إعدادات هوية ممنون ورسالة الترحيب.");
    setSaving(false);
  };

  if (loading) return <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /> جاري تحميل إعدادات الشركة...</div>;
  return <section className="max-w-2xl">
    <div className="flex items-center gap-3 mb-5"><Building2 className="h-6 w-6 text-primary" /><div><h2 className="text-xl font-black">إعدادات شركة ممنون</h2><p className="text-sm text-muted-foreground">إدارة اسم الشركة وشعار التطبيق ورسالة الترحيب والصورة الرئيسية</p></div></div>
    <div className="glass rounded-2xl p-5 space-y-4">
      <label className="block text-sm font-bold" htmlFor="company-name">اسم الشركة</label>
      <input id="company-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="w-full rounded-xl border border-border bg-background px-4 py-3 text-base outline-none focus:ring-2 focus:ring-primary" placeholder="مثلاً: شركة ممنون" />
      <label className="block text-sm font-bold" htmlFor="company-logo-upload">شعار الشركة الظاهر بالتطبيق</label>
      <div className="flex flex-wrap items-center gap-3">
        <img src={logoPreview || logoUrl || "/mamnoon-logo.png"} alt={`معاينة شعار ${name || "الشركة"}`} className="h-20 w-20 rounded-2xl border border-border bg-background object-contain p-2" />
        <div className="flex flex-col gap-2">
          <label htmlFor="company-logo-upload" className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:opacity-90">
            {logoFile ? "اختيار صورة أخرى" : "اختيار صورة الشعار"}
          </label>
          <input id="company-logo-upload" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)} className="sr-only" />
          <span className="text-[11px] text-muted-foreground">PNG أو JPG أو WEBP · الحد الأعلى 8 ميغابايت</span>
        </div>
      </div>
      {logoFile && <p className="text-xs text-muted-foreground">الصورة المختارة: {logoFile.name}</p>}
      <label className="block text-sm font-bold" htmlFor="company-welcome-visual">الصورة الرئيسية لشاشة بداية التطبيق ومناطق الهوية</label>
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border p-3">
        {(!removeWelcomeVisual && (welcomeVisualPreview || welcomeVisualUrl)) ? <img src={welcomeVisualPreview || welcomeVisualUrl} alt="معاينة صورة بداية التطبيق" style={{ width: welcomeVisualSizePx, height: welcomeVisualSizePx }} className="max-w-full rounded-3xl bg-slate-950 object-cover" /> : <div style={{ width: welcomeVisualSizePx, height: welcomeVisualSizePx }} className="grid max-w-full place-items-center rounded-3xl bg-slate-100 text-xs font-bold text-slate-600">بدون صورة بداية</div>}
        <div className="flex flex-col gap-2"><label htmlFor="company-welcome-visual" className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">{welcomeVisualFile ? "اختيار صورة أخرى" : "اختيار أو تبديل الصورة"}</label><input id="company-welcome-visual" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => { setWelcomeVisualFile(e.target.files?.[0] ?? null); setRemoveWelcomeVisual(false); }} className="sr-only" /><span className="text-[11px] text-muted-foreground">PNG أو JPG أو WEBP أو GIF متحرك · الحد الأعلى 12 ميغابايت</span>
          {welcomeVisualUrl && !removeWelcomeVisual && <button type="button" onClick={() => { setWelcomeVisualFile(null); setRemoveWelcomeVisual(true); }} className="min-h-10 rounded-xl border border-red-300 bg-red-50 px-4 py-2 text-sm font-bold text-red-700">حذف صورة البداية</button>}
          {welcomeVisualFile && <><span className="text-xs text-muted-foreground">الصورة الجديدة: {welcomeVisualFile.name}</span><button type="button" onClick={() => setWelcomeVisualFile(null)} className="min-h-10 rounded-xl border border-border px-4 py-2 text-sm font-bold">إلغاء الصورة المختارة</button></>}
        </div>
      </div>
      <label className="block text-sm font-bold" htmlFor="company-welcome-visual-size">حجم صورة البداية (80–320 بكسل)</label>
      <div className="flex items-center gap-3"><input id="company-welcome-visual-size" type="range" min={80} max={320} step={10} value={welcomeVisualSizePx} onChange={(e) => setWelcomeVisualSizePx(Number(e.target.value))} className="w-full accent-primary" /><span className="min-w-16 text-sm font-bold tabular-nums">{welcomeVisualSizePx}px</span></div>
      <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-border p-3 text-sm font-bold"><input type="checkbox" checked={welcomeVisualAnimated} onChange={(e) => setWelcomeVisualAnimated(e.target.checked)} className="h-5 w-5 accent-primary" /> تفعيل حركة تفاعلية ناعمة للشعار وصورة البداية عند فتح التطبيق</label>
      <div className="rounded-2xl border border-primary/20 p-4 space-y-3">
        <h3 className="font-black">GIF الصفحة الرئيسية (مستقل عن صورة البداية)</h3>
        {(!removeHomeVisual && (homeVisualPreview || homeVisualUrl)) ? <img src={homeVisualPreview || homeVisualUrl} alt="معاينة GIF الصفحة الرئيسية" style={{ width: homeVisualWidthPx, height: homeVisualHeightPx }} className="max-w-full rounded-[22px] object-cover" /> : <p className="text-xs text-muted-foreground">ماكو صورة للصفحة الرئيسية حالياً</p>}
        <label htmlFor="home-visual-upload" className="inline-flex min-h-10 cursor-pointer items-center rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">اختيار أو تبديل صورة / GIF</label>
        <input id="home-visual-upload" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => { setHomeVisualFile(e.target.files?.[0] ?? null); setRemoveHomeVisual(false); }} className="sr-only" />
        {homeVisualUrl && !removeHomeVisual && <button type="button" onClick={() => { setHomeVisualFile(null); setRemoveHomeVisual(true); }} className="min-h-10 rounded-xl border border-red-300 px-4 py-2 text-sm font-bold text-red-700">حذف GIF الصفحة الرئيسية</button>}
        <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={homeVisualEnabled} onChange={(e) => setHomeVisualEnabled(e.target.checked)} /> إظهار GIF الصفحة الرئيسية</label>
        <label className="block text-sm font-bold" htmlFor="home-visual-position">مكان ظهور الصورة</label>
        <select id="home-visual-position" value={homeVisualPosition} onChange={(e) => setHomeVisualPosition(e.target.value)} className="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm"><option value="above_banner">فوق البانر العلوي</option><option value="below_banner">تحت البانر العلوي</option><option value="below_custom_content">بعد محتوى الصفحة وقبل أزرار الطلب</option></select>
        <div className="grid grid-cols-2 gap-3"><label className="block text-sm font-bold">العرض بالبكسل<input type="number" min={80} max={600} value={homeVisualWidthPx} onChange={(e) => setHomeVisualWidthPx(Math.max(80,Math.min(600,Number(e.target.value)||80)))} className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-3" /></label><label className="block text-sm font-bold">الارتفاع بالبكسل<input type="number" min={80} max={600} value={homeVisualHeightPx} onChange={(e) => setHomeVisualHeightPx(Math.max(80,Math.min(600,Number(e.target.value)||80)))} className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-3" /></label></div>
        <label className="block text-sm font-bold" htmlFor="home-visual-link">رابط عند الضغط على الصورة (اختياري)</label><input id="home-visual-link" type="url" value={homeVisualLinkUrl} onChange={(e) => setHomeVisualLinkUrl(e.target.value)} placeholder="https://example.com" className="w-full rounded-xl border border-border bg-background px-3 py-3" />
      </div>
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
      <textarea id="company-welcome" value={welcomeMessage} onChange={(e) => setWelcomeMessage(e.target.value)} maxLength={180} rows={4} className="w-full min-h-28 whitespace-pre-wrap break-words leading-7 rounded-xl border border-border bg-background px-4 py-3 text-base outline-none focus:ring-2 focus:ring-primary" placeholder="مشوارك وخدمات بيتك، بمكان واحد." />
      <button type="button" onClick={save} disabled={saving || !name.trim()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-bold text-primary-foreground disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} حفظ إعدادات الشركة</button>
      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    </div>
  </section>;
}
