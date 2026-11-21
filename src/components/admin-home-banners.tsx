import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, RefreshCw, Trash2, Upload, Power } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type BannerKind = "category" | "poll" | "contest" | "ad" | "top_square"; // top_square retained only for legacy rows
type Category = "restaurant" | "hotel" | "store";
type Campaign = { id: string; placement_key?: string; title: string; campaign_type: "poll" | "contest"; status: string; starts_at: string | null; ends_at: string | null; result_visibility: string; participation_mode?: "options"|"text"|"image"|"both"; rules?: string|null; prize_description?: string|null; app_campaign_options: { id: string; label: string; sort_order: number }[]; app_campaign_option_results: { option_id: string; vote_count: number }[] };
type Banner = { id: string; display_location?: "top_panorama" | "restaurant_section"; image_url: string; storage_path: string | null; target_category: Category; banner_type: BannerKind; target_campaign_id: string | null; is_active: boolean; scroll_speed: number; display_order: number; badge_text: string | null; banner_title?: string | null; banner_description?: string | null; motion_axis: "horizontal" | "vertical"; motion_direction: "left" | "right" | "up" | "down"; motion_style: "slide" | "fade" | "drop"; display_config?: Record<string, any> };
type ContestEntry = { id:string; campaign_id:string; user_id:string; text_content:string|null; storage_path:string|null; image_url:string|null; status:string; created_at:string };
const labels = { restaurant: "المطاعم", hotel: "الفنادق", store: "المتاجر" } as const;
const kindLabels: Record<BannerKind,string> = { category: "مطاعم / فنادق / متاجر", poll: "استطلاع رأي", contest: "مسابقة", ad: "الإعلان العلوي الرئيسي", top_square: "البانر المربع أعلى الصفحة" };
const input = "w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm";
export default function AdminHomeBanners() {
  const [rows, setRows] = useState<Banner[]>([]);
  const [category, setCategory] = useState<Category>("restaurant");
  const [bannerType, setBannerType] = useState<BannerKind>("category");
  const [displayLocation, setDisplayLocation] = useState<"top_panorama" | "restaurant_section">("top_panorama");
  const [newCampaignPlacement, setNewCampaignPlacement] = useState<"home.customer.content" | "home.restaurant.content">("home.customer.content");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [entries, setEntries] = useState<ContestEntry[]>([]);
  const [newCampaignType,setNewCampaignType]=useState<"poll"|"contest">("contest");
  const [newCampaignTitle,setNewCampaignTitle]=useState("");
  const [newCampaignDescription,setNewCampaignDescription]=useState("");
  const [newCampaignMode,setNewCampaignMode]=useState<"options"|"text"|"image"|"both">("both");
  const [newCampaignOptions,setNewCampaignOptions]=useState("");
  const [newCampaignRules,setNewCampaignRules]=useState("");
  const [newCampaignPrize,setNewCampaignPrize]=useState("");
  const [campaignId, setCampaignId] = useState("");
  const [speed, setSpeed] = useState(5);
  const [motionAxis, setMotionAxis] = useState<"horizontal" | "vertical">("horizontal");
  const [motionDirection, setMotionDirection] = useState<"left" | "right" | "up" | "down">("left");
  const [motionStyle, setMotionStyle] = useState<"slide" | "fade" | "drop">("slide");
  const [order, setOrder] = useState(0);
  const [badge, setBadge] = useState("");
  const [bannerTitle, setBannerTitle] = useState("");
  const [bannerDescription, setBannerDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const { data, error } = await (supabase as any).from("home_carousel_banners").select("*").order("display_order").order("created_at");
    if (error) setMessage("تعذر تحميل البانرات: " + error.message);
    else setRows((data ?? []).filter((row: Banner) => row.banner_type !== "top_square"));
    const { data: campaignRows } = await (supabase as any).from("app_campaigns").select("id,title,placement_key,campaign_type,status,starts_at,ends_at,result_visibility,participation_mode,rules,prize_description,app_campaign_options(id,label,sort_order),app_campaign_option_results(option_id,vote_count)").order("sort_order").order("created_at",{ascending:false});
    setCampaigns((campaignRows ?? []) as Campaign[]);
    const { data: entryRows, error: entryError } = await (supabase as any).from("app_campaign_entries").select("id,campaign_id,user_id,text_content,storage_path,status,created_at").order("created_at",{ascending:false});
    if (!entryError) { const withImages = await Promise.all((entryRows ?? []).map(async (entry: any) => { let image_url: string|null = null; if (entry.storage_path) { const signed = await supabase.storage.from("campaign-entries").createSignedUrl(entry.storage_path,3600); image_url = signed.data?.signedUrl ?? null; } return { ...entry, image_url }; })); setEntries(withImages as ContestEntry[]); }
  }, []);
  useEffect(() => {
    void load();
    const channel = supabase.channel("admin-home-banners")
      .on("postgres_changes", { event: "*", schema: "public", table: "home_carousel_banners" }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [load]);
  const upload = async () => {
    if (!file) { setMessage("اختار صورة أولاً."); return; }
    if ((bannerType === "poll" || bannerType === "contest") && !campaignId) { setMessage("اختار الاستطلاع أو المسابقة المرتبطة بالبانر."); return; }
    if ((bannerType === "poll" || bannerType === "contest") && !campaigns.some(c => c.id === campaignId && c.campaign_type === bannerType)) { setMessage("نوع الحملة المختارة لا يطابق نوع البانر."); return; }
    if (!file.type.startsWith("image/") || file.size > 8 * 1024 * 1024) { setMessage("الصورة لازم تكون بصيغة صورة وحجمها أقل من 8 ميغابايت."); return; }
    setBusy(true); setMessage("");
    const path = `home-banners/${category}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
    const stored = await supabase.storage.from("app-visuals").upload(path, file, { upsert: false, contentType: file.type });
    if (stored.error) { setMessage("فشل رفع الصورة: " + stored.error.message); setBusy(false); return; }
    const { data } = supabase.storage.from("app-visuals").getPublicUrl(path);
    const { error } = await (supabase as any).from("home_carousel_banners").insert({
      image_url: data.publicUrl, storage_path: path, target_category: category, banner_type: bannerType, display_location: displayLocation, target_campaign_id: bannerType === "poll" || bannerType === "contest" ? campaignId || null : null, is_active: true,
      scroll_speed: speed, display_order: order, badge_text: badge.trim() || null,
      banner_title: bannerTitle.trim() || null, banner_description: bannerDescription.trim() || null,
      motion_axis: bannerType === "top_square" ? "horizontal" : motionAxis, motion_direction: bannerType === "top_square" ? "left" : motionDirection, motion_style: bannerType === "top_square" ? "slide" : motionStyle,
    });
    if (error) { setMessage("ترتفعت الصورة لكن تعذر حفظ بياناتها: " + error.message); }
    else {
      let campaignImageWarning = false;
      if ((bannerType === "poll" || bannerType === "contest") && campaignId) {
        const { error: campaignImageError } = await (supabase as any).from("app_campaigns").update({ image_url: data.publicUrl, updated_at: new Date().toISOString() }).eq("id", campaignId);
        campaignImageWarning = Boolean(campaignImageError);
      }
      setMessage(campaignImageWarning ? "تم نشر البانر، لكن تعذر تحديث صورة الحملة نفسها." : "تم رفع ونشر البانر وصورة الحملة، وسيظهر بالويب والأندرويد.");
      setFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; setBadge(""); setBannerTitle(""); setBannerDescription(""); await load();
    }
    setBusy(false);
  };
  const toggle = async (row: Banner) => {
    const { error } = await (supabase as any).from("home_carousel_banners").update({ is_active: !row.is_active, updated_at: new Date().toISOString() }).eq("id", row.id);
    setMessage(error ? "تعذر تغيير الحالة: " + error.message : "تم تحديث حالة البانر."); if (!error) await load();
  };
  const updateBanner = async (row: Banner, patch: Record<string, unknown>) => {
    setBusy(true);
    const { error } = await (supabase as any).from("home_carousel_banners")
      .update({ ...patch, updated_at: new Date().toISOString() }).eq("id", row.id);
    setMessage(error ? "تعذر حفظ إعدادات البانر: " + error.message : "تم حفظ إعدادات البانر ونشرها.");
    if (!error) await load();
    setBusy(false);
  };
  const replaceBannerImage = async (row: Banner, nextFile?: File) => {
    if (!nextFile) return;
    if (!nextFile.type.startsWith("image/") || nextFile.size > 8 * 1024 * 1024) {
      setMessage("الصورة لازم تكون بصيغة صورة وحجمها أقل من 8 ميغابايت."); return;
    }
    setBusy(true);
    const path = `home-banners/${row.target_category}/${Date.now()}-${nextFile.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
    const stored = await supabase.storage.from("app-visuals").upload(path, nextFile, { upsert: false, contentType: nextFile.type });
    if (stored.error) { setMessage("فشل رفع الصورة: " + stored.error.message); setBusy(false); return; }
    const url = supabase.storage.from("app-visuals").getPublicUrl(path).data.publicUrl;
    const { error } = await (supabase as any).from("home_carousel_banners")
      .update({ image_url: url, storage_path: path, updated_at: new Date().toISOString() }).eq("id", row.id);
    if (error) {
      await supabase.storage.from("app-visuals").remove([path]);
      setMessage("تعذر ربط الصورة الجديدة بالبانر: " + error.message);
    } else {
      if (row.storage_path) await supabase.storage.from("app-visuals").remove([row.storage_path]);
      setMessage("تم تبديل صورة البانر.");
      await load();
    }
    setBusy(false);
  };
  const createCampaign = async () => {
    const title = newCampaignTitle.trim();
    const options = newCampaignOptions.split(String.fromCharCode(10)).map(value=>value.trim()).filter(Boolean);
    const mode = newCampaignType === "poll" ? "options" : newCampaignMode;
    if (!title) { setMessage("اكتب عنوان الحملة أولاً."); return; }
    if (mode === "options" && options.length < 2) { setMessage("أضف خيارين على الأقل للاستطلاع أو التصويت."); return; }
    setBusy(true); setMessage("");
    const { data, error } = await (supabase as any).from("app_campaigns").insert({campaign_type:newCampaignType,title,placement_key:newCampaignPlacement,description:newCampaignDescription.trim()||null,status:"draft",placement_key:newCampaignPlacement,participation_mode:mode,rules:newCampaignRules.trim()||null,prize_description:newCampaignType==="contest"?(newCampaignPrize.trim()||null):null}).select("id").single();
    if (error || !data) { setMessage("تعذر إنشاء الحملة: "+(error?.message??"خطأ غير معروف")); setBusy(false); return; }
    if (options.length && mode === "options") {
      const { error: optionsError } = await (supabase as any).from("app_campaign_options").insert(options.map((label,index)=>({campaign_id:data.id,label,sort_order:index})));
      if (optionsError) { await (supabase as any).from("app_campaigns").delete().eq("id",data.id); setMessage("تعذر حفظ خيارات الحملة: "+optionsError.message); setBusy(false); return; }
    }
    setNewCampaignTitle("");setNewCampaignDescription("");setNewCampaignOptions("");setNewCampaignRules("");setNewCampaignPrize("");
    setMessage("تم إنشاء الحملة كمسودة. راجعها ثم اضغط نشر.");await load();setBusy(false);
  };
  const updateCampaign = async (campaign: Campaign, patch: Record<string, unknown>) => {
    const { error } = await (supabase as any).from("app_campaigns").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", campaign.id);
    setMessage(error ? "تعذر حفظ إعدادات المسابقة: " + error.message : "تم حفظ إعدادات الحملة."); if (!error) await load();
  };
  const reviewEntry = async (entry: ContestEntry, status: "approved"|"rejected") => {
    const { error } = await (supabase as any).from("app_campaign_entries").update({ status, reviewed_at: new Date().toISOString() }).eq("id", entry.id);
    setMessage(error ? "تعذر تحديث المشاركة: " + error.message : status === "approved" ? "تم قبول المشاركة." : "تم رفض المشاركة."); if (!error) await load();
  };
  const toggleCampaignStatus = async (campaign: Campaign) => {
    const nextStatus = campaign.status === "published" ? "draft" : "published";
    const { error } = await (supabase as any).from("app_campaigns").update({ status: nextStatus, updated_at: new Date().toISOString() }).eq("id", campaign.id);
    setMessage(error ? "تعذر تحديث حالة الحملة: " + error.message : nextStatus === "published" ? "تم نشر الحملة." : "تم إيقاف نشر الحملة.");
    if (!error) await load();
  };
  const remove = async (row: Banner) => {
    if (!window.confirm("متأكد تريد حذف هذا البانر نهائياً؟")) return;
    const { error } = await (supabase as any).from("home_carousel_banners").delete().eq("id", row.id);
    if (!error && row.storage_path) await supabase.storage.from("app-visuals").remove([row.storage_path]);
    setMessage(error ? "تعذر حذف البانر: " + error.message : "تم حذف البانر."); if (!error) await load();
  };
  return <div className="space-y-5" dir="rtl">
    <header><h2 className="text-xl font-black">بانرات الصفحة الرئيسية</h2><p className="mt-1 text-sm text-muted-foreground">بانور واحد كبير للفنادق والمطاعم والمتاجر يعرض الصور بالتتابع. تحكم بمدة كل صورة واتجاه الحركة ونمط الانتقال من هنا. والمستطيل العلوي «مجاناً بلا عمولة» مخصص للإعلانات والاستطلاعات والمسابقات. التغييرات تتزامن بين الويب والأندرويد.</p></header>
    {message && <div className="rounded-xl border border-border bg-muted/40 p-3 text-sm">{message}</div>}
    <section className="grid gap-3 rounded-2xl border border-border bg-card p-4 md:grid-cols-2">
      <label className="text-sm font-bold">نوع البانر<select className={input+" mt-2"} value={bannerType} onChange={e=>{const next=e.target.value as BannerKind;setBannerType(next);setCampaignId("");setDisplayLocation(next==="category"?"top_panorama":"restaurant_section");}}><option value="category">مطاعم / فنادق / متاجر</option><option value="poll">استطلاع رأي</option><option value="contest">مسابقة</option><option value="ad">الإعلان العلوي الرئيسي</option></select></label>
      {bannerType !== "top_square" ? <label className="text-sm font-bold">مكان النشر<select className={input+" mt-2"} value={displayLocation} onChange={e=>setDisplayLocation(e.target.value as typeof displayLocation)}><option value="top_panorama" disabled={bannerType!=="category"}>البانوراما العلوية (للفئات فقط)</option><option value="restaurant_section">قسم المطاعم المستقل</option></select></label> : null}
      {(bannerType === "category") ? <label className="text-sm font-bold">القسم<select className={input+" mt-2"} value={category} onChange={e=>setCategory(e.target.value as Category)}><option value="restaurant">المطاعم</option><option value="hotel">الفنادق</option><option value="store">المتاجر</option></select></label> : null}
      {(bannerType === "poll" || bannerType === "contest") ? <label className="text-sm font-bold">الحملة المرتبطة<select className={input+" mt-2"} value={campaignId} onChange={e=>setCampaignId(e.target.value)}><option value="">اختر حملة منشورة</option>{campaigns.filter(c=>c.campaign_type===bannerType && c.status==="published").map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select></label> : null}
      {bannerType === "ad" && <p className="text-xs text-muted-foreground md:col-span-2">هذا هو المستطيل العلوي الرئيسي «مجاناً بلا عمولة»؛ أضف صورة الإعلان وعنوانه ووصفه.</p>}
      <label className="text-sm font-bold">مدة عرض الصورة بالثواني (1–60)<input className={input+" mt-2"} type="number" min="1" max="60" value={speed} onChange={e=>setSpeed(Math.max(1,Math.min(60,Number(e.target.value)||5)))}/></label>
      <label className="text-sm font-bold">اتجاه الحركة<select className={input+" mt-2"} value={motionDirection} onChange={e=>{const value=e.target.value as typeof motionDirection;setMotionDirection(value);setMotionAxis(value==="up"||value==="down"?"vertical":"horizontal");}}><option value="left">من اليمين لليسار</option><option value="right">من اليسار لليمين</option><option value="up">من الأسفل للأعلى</option><option value="down">من الأعلى للأسفل</option></select></label>
      <label className="text-sm font-bold">نمط الانتقال<select className={input+" mt-2"} value={motionStyle} onChange={e=>setMotionStyle(e.target.value as typeof motionStyle)}><option value="slide">انزلاق</option><option value="fade">تلاشي</option><option value="drop">هبوط</option></select></label>
      <label className="text-sm font-bold">ترتيب العرض<input className={input+" mt-2"} type="number" value={order} onChange={e=>setOrder(Number(e.target.value)||0)}/></label>
      <label className="text-sm font-bold">النص الظاهر على الصورة<input className={input+" mt-2"} value={bannerTitle} onChange={e=>setBannerTitle(e.target.value)} placeholder="مثلاً: قريباً"/></label>
      <label className="text-sm font-bold">وصف إضافي اختياري<input className={input+" mt-2"} value={bannerDescription} onChange={e=>setBannerDescription(e.target.value)} placeholder="اكتب وصفاً قصيراً يظهر تحت العنوان"/></label>
      <label className="text-sm font-bold">شارة قصيرة اختيارية<input className={input+" mt-2"} value={badge} onChange={e=>setBadge(e.target.value)} placeholder="مثلاً: عرض خاص"/></label>
      <div className="md:col-span-2 space-y-2 rounded-xl border border-dashed border-border p-4">
        <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" onChange={e=>setFile(e.target.files?.[0] ?? null)}/>
        <button type="button" disabled={busy} onClick={()=>fileInputRef.current?.click()} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-3 text-sm font-bold disabled:opacity-50"><ImagePlus className="h-5 w-5"/>{file ? "تغيير الصورة المختارة" : "اضغط هنا لاختيار صورة من جهازك"}</button>
        <p className="text-xs text-muted-foreground">{file ? file.name+" · "+(file.size/1024/1024).toFixed(2)+" MB" : "JPG أو PNG أو WEBP أو GIF · حتى 8 ميغابايت"}</p>
        {file && <img src={URL.createObjectURL(file)} alt="معاينة صورة البانر" className="max-h-44 w-full rounded-xl object-contain bg-muted/30"/>}
      </div>
      <button disabled={busy || !file} onClick={()=>void upload()} className="md:col-span-2 inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-bold text-primary-foreground disabled:opacity-50"><Upload className="h-4 w-4"/>{busy ? "جارٍ الرفع..." : "رفع ونشر البانر"}</button>
    </section>
    <section className="space-y-3">
      <div className="flex items-center justify-between"><h3 className="font-black">البانرات المضافة ({rows.length})</h3><button onClick={()=>void load()} className="rounded-lg border border-border p-2"><RefreshCw className="h-4 w-4"/></button></div>
      {rows.length===0 && <p className="rounded-xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground">ماكو صور إدارية مرفوعة حالياً؛ تظهر صور افتراضية للفئات إلى أن ترفع صورك الخاصة.</p>}
      {rows.map(row=><article key={row.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-3">
        <img src={row.image_url} alt="" className="h-20 w-20 rounded-xl object-cover"/>
        <div className="min-w-0 flex-1"><b className="text-sm">{kindLabels[row.banner_type] || labels[row.target_category]}{row.banner_type === "category" ? ` · ${labels[row.target_category]}` : ""}</b><p className="text-xs text-muted-foreground">الترتيب {row.display_order} · كل {row.scroll_speed} ثوانٍ</p><p className="text-xs text-muted-foreground">مكان النشر: {row.display_location === "restaurant_section" ? "قسم المطاعم المستقل" : "البانوراما العلوية"}</p>{row.banner_title && <p className="text-xs font-bold">{row.banner_title}</p>}{row.banner_description && <p className="text-xs text-muted-foreground">{row.banner_description}</p>}<p className="text-xs text-muted-foreground">{row.motion_axis === "vertical" ? (row.motion_direction === "up" ? "من الأسفل للأعلى" : "من الأعلى للأسفل") : (row.motion_direction === "left" ? "من اليمين لليسار" : "من اليسار لليمين")} · {row.motion_style === "fade" ? "تلاشي" : row.motion_style === "drop" ? "هبوط" : "انزلاق"}</p><p className="text-xs">{row.is_active ? "منشور" : "متوقف"}</p></div>
        <details className="min-w-0 basis-full rounded-xl border border-border p-3">
          <summary className="cursor-pointer text-xs font-black text-primary">تعديل البانر المنشور بالكامل</summary><label className="mt-3 block text-xs font-bold">مكان النشر<select className={input+" mt-1"} defaultValue={row.display_location ?? "top_panorama"} onChange={e=>void updateBanner(row,{display_location:e.target.value})}><option value="top_panorama" disabled={row.banner_type!=="category"}>البانوراما العلوية</option><option value="restaurant_section">قسم المطاعم المستقل</option></select></label>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="text-xs font-bold">النص الظاهر على الصورة<input className={input+" mt-1"} defaultValue={row.banner_title ?? ""} placeholder="مثلاً: قريباً" onBlur={e=>{if(e.target.value!==(row.banner_title??""))void updateBanner(row,{banner_title:e.target.value.trim()||null});}} /></label>
            <label className="text-xs font-bold">وصف إضافي<input className={input+" mt-1"} defaultValue={row.banner_description ?? ""} placeholder="وصف قصير تحت العنوان" onBlur={e=>{if(e.target.value!==(row.banner_description??""))void updateBanner(row,{banner_description:e.target.value.trim()||null});}} /></label>
            <label className="text-xs font-bold">شارة قصيرة<input className={input+" mt-1"} defaultValue={row.badge_text ?? ""} onBlur={e=>{if(e.target.value!==(row.badge_text??""))void updateBanner(row,{badge_text:e.target.value.trim()||null});}} /></label>
            <label className="text-xs font-bold">مدة عرض الصورة (1–60 ثانية)<input type="number" min="1" max="60" className={input+" mt-1"} defaultValue={row.scroll_speed} onBlur={e=>void updateBanner(row,{scroll_speed:Math.max(1,Math.min(60,Number(e.target.value)||5))})} /></label>
            <label className="text-xs font-bold">ترتيب العرض<input type="number" className={input+" mt-1"} defaultValue={row.display_order} onBlur={e=>void updateBanner(row,{display_order:Number(e.target.value)||0})} /></label>
            <label className="text-xs font-bold">اتجاه الحركة<select className={input+" mt-1"} defaultValue={row.motion_direction} onChange={e=>void updateBanner(row,{motion_direction:e.target.value,motion_axis:["up","down"].includes(e.target.value)?"vertical":"horizontal"})}><option value="left">يمين ← يسار</option><option value="right">يسار ← يمين</option><option value="up">أسفل ← أعلى</option><option value="down">أعلى ← أسفل</option></select></label>
            <label className="text-xs font-bold">نمط الانتقال<select className={input+" mt-1"} defaultValue={row.motion_style} onChange={e=>void updateBanner(row,{motion_style:e.target.value})}><option value="slide">انزلاق</option><option value="fade">تلاشي</option><option value="drop">هبوط</option></select></label>
            <label className="text-xs font-bold sm:col-span-2">تبديل الصورة<input type="file" accept="image/*" className={input+" mt-1"} disabled={busy} onChange={e=>void replaceBannerImage(row,e.target.files?.[0])} /></label>
            <div className="sm:col-span-2 mt-2 rounded-lg bg-muted/40 p-3">
              <b className="text-xs">تحكم بشكل المستطيل العلوي</b>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {([{key:"height_px",label:"الارتفاع",fallback:142,min:100,max:300},{key:"padding_px",label:"الحشوة",fallback:12,min:8,max:32},{key:"border_radius_px",label:"استدارة الزوايا",fallback:20,min:8,max:40},{key:"title_size_px",label:"حجم العنوان",fallback:20,min:12,max:30},{key:"subtitle_size_px",label:"حجم الوصف",fallback:11,min:8,max:20}] as const).map(field=><label key={field.key} className="text-[11px] font-bold">{field.label}<input type="number" min={field.min} max={field.max} className={input+" mt-1"} defaultValue={row.display_config?.[field.key] ?? field.fallback} onBlur={e=>void updateBanner(row,{display_config:{...(row.display_config??{}),[field.key]:Math.max(field.min,Math.min(field.max,Number(e.target.value)||field.fallback))}})}/></label>)}
                <label className="text-[11px] font-bold">شفافية الصورة<input type="number" min="0.05" max="1" step="0.05" className={input+" mt-1"} defaultValue={row.display_config?.image_opacity ?? 0.4} onBlur={e=>void updateBanner(row,{display_config:{...(row.display_config??{}),image_opacity:Math.max(.05,Math.min(1,Number(e.target.value)||.4))}})}/></label>
                <label className="text-[11px] font-bold">نص زر الطلب<input className={input+" mt-1"} defaultValue={row.display_config?.cta_text ?? "اطلب الآن"} onBlur={e=>void updateBanner(row,{display_config:{...(row.display_config??{}),cta_text:e.target.value.trim()||"اطلب الآن"}})}/></label>
                <label className="text-[11px] font-bold">محاذاة النص<select className={input+" mt-1"} defaultValue={row.display_config?.text_alignment ?? "right"} onChange={e=>void updateBanner(row,{display_config:{...(row.display_config??{}),text_alignment:e.target.value}})}><option value="right">يمين</option><option value="center">وسط</option><option value="left">يسار</option></select></label>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {([{key:"title_color",label:"لون العنوان"},{key:"description_color",label:"لون الوصف"},{key:"background_color",label:"خلفية المستطيل"},{key:"cta_background_color",label:"خلفية زر الطلب"},{key:"cta_text_color",label:"لون نص زر الطلب"}] as const).map(field=><label key={field.key} className="text-[11px] font-bold">{field.label}<input dir="ltr" className={input+" mt-1"} placeholder="#FFFFFF" defaultValue={row.display_config?.[field.key] ?? ""} onBlur={e=>void updateBanner(row,{display_config:{...(row.display_config??{}),[field.key]:e.target.value.trim()||null}})}/></label>)}
              </div>
              <button type="button" className="mt-2 rounded-lg border border-border px-3 py-2 text-xs font-bold" onClick={()=>void updateBanner(row,{display_config:{...(row.display_config??{}),cta_visible:row.display_config?.cta_visible===false}})}>{row.display_config?.cta_visible===false?"إظهار زر اطلب الآن":"إخفاء زر اطلب الآن"}</button>
            </div>
          </div>
        </details>
        <button title="تفعيل أو إيقاف" onClick={()=>void toggle(row)} className="rounded-lg border border-border p-2"><Power className="h-4 w-4"/></button>
        <button title="حذف" onClick={()=>void remove(row)} className="rounded-lg border border-border p-2 text-destructive"><Trash2 className="h-4 w-4"/></button>
      </article>)}
    </section>
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <h3 className="font-black">إنشاء استطلاع أو مسابقة جديدة</h3>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm font-bold">نوع الحملة<select className={input} value={newCampaignType} onChange={e=>setNewCampaignType(e.target.value as "poll"|"contest")}><option value="contest">مسابقة</option><option value="poll">استطلاع رأي</option></select></label>
        {newCampaignType==="contest"&&<label className="text-sm font-bold">طريقة المشاركة<select className={input} value={newCampaignMode} onChange={e=>setNewCampaignMode(e.target.value as typeof newCampaignMode)}><option value="text">نص فقط</option><option value="image">صورة فقط</option><option value="both">نص وصورة معاً</option><option value="options">اختيارات وتصويت</option></select></label>}
        <label className="text-sm font-bold">مكان نشر الحملة<select className={input} value={newCampaignPlacement} onChange={e=>setNewCampaignPlacement(e.target.value as typeof newCampaignPlacement)}><option value="home.customer.content">المحتوى العام للرئيسية</option><option value="home.restaurant.content">قسم المطاعم المستقل</option></select></label>
        <label className="text-sm font-bold md:col-span-2">عنوان الحملة<input className={input} value={newCampaignTitle} onChange={e=>setNewCampaignTitle(e.target.value)} placeholder="عنوان المسابقة أو الاستطلاع"/></label>
        <label className="text-sm font-bold md:col-span-2">الوصف<textarea className={input} rows={2} value={newCampaignDescription} onChange={e=>setNewCampaignDescription(e.target.value)}/></label>
        {(newCampaignType==="poll"||newCampaignMode==="options")&&<label className="text-sm font-bold md:col-span-2">الخيارات (كل خيار بسطر مستقل)<textarea className={input} rows={3} value={newCampaignOptions} onChange={e=>setNewCampaignOptions(e.target.value)} placeholder="الخيار الأول ثم الخيار الثاني بسطر جديد"/></label>}
        {newCampaignType==="contest"&&<><label className="text-sm font-bold md:col-span-2">الشروط والتعليمات<textarea className={input} rows={3} value={newCampaignRules} onChange={e=>setNewCampaignRules(e.target.value)}/></label><label className="text-sm font-bold md:col-span-2">الجائزة<textarea className={input} rows={2} value={newCampaignPrize} onChange={e=>setNewCampaignPrize(e.target.value)}/></label></>}
        <button disabled={busy} onClick={()=>void createCampaign()} className="md:col-span-2 rounded-xl bg-primary px-4 py-3 font-bold text-primary-foreground disabled:opacity-50">{busy?"جارٍ إنشاء الحملة...":"إنشاء كمسودة"}</button>
      </div>
    </section>
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2"><h3 className="font-black">إدارة الاستطلاعات والمسابقات والنتائج ({campaigns.length})</h3><button onClick={()=>void load()} className="rounded-lg border border-border px-3 py-2 text-xs font-bold">تحديث النتائج</button></div>
      {campaigns.length===0 ? <p className="text-sm text-muted-foreground">ماكو حملات مسجلة حالياً.</p> : campaigns.map(campaign=>{
        const results = campaign.app_campaign_option_results || [];
        const total = results.reduce((sum,item)=>sum+Number(item.vote_count||0),0);
        return <article key={campaign.id} className="space-y-2 rounded-xl border border-border p-3">
          <div className="flex items-start justify-between gap-2"><div><b className="text-sm">{campaign.campaign_type==="poll"?"استطلاع رأي":"مسابقة"} · {campaign.title}</b><p className="text-xs text-muted-foreground mt-1">المشاركات المسجلة: {total} · الحالة: {campaign.status==="published"?"منشورة":campaign.status}</p><select className={input+" mt-2"} value={campaign.placement_key ?? "home.customer.content"} onChange={e=>void updateCampaign(campaign,{placement_key:e.target.value})}><option value="home.customer.content">المحتوى العام للرئيسية</option><option value="home.restaurant.content">قسم المطاعم المستقل</option></select></div><button onClick={()=>void toggleCampaignStatus(campaign)} className="rounded-lg border border-border px-3 py-2 text-xs font-bold">{campaign.status==="published"?"إيقاف":"نشر"}</button></div>
          <div className="space-y-1">{[...(campaign.app_campaign_options||[])].sort((a,b)=>a.sort_order-b.sort_order).map(option=>{const count=Number(results.find(item=>item.option_id===option.id)?.vote_count||0);return <div key={option.id} className="flex justify-between rounded-lg bg-muted/40 px-3 py-2 text-xs"><span>{option.label}</span><b className="tabular-nums">{count}</b></div>;})}</div>
          {campaign.campaign_type === "contest" && <div className="space-y-2 border-t border-border pt-3">
            <b className="text-xs">طريقة المشاركة بهذه المسابقة</b>
            <select className={input} value={campaign.participation_mode ?? "options"} onChange={e=>void updateCampaign(campaign,{participation_mode:e.target.value})}>
              <option value="text">نص فقط</option><option value="image">صورة فقط</option><option value="both">نص وصورة معاً</option><option value="options">اختيارات وتصويت</option>
            </select>
            <label className="block space-y-1 text-xs font-bold">الشروط والتعليمات<textarea className={input} rows={3} defaultValue={campaign.rules ?? ""} onBlur={e=>{if(e.target.value!==(campaign.rules??""))void updateCampaign(campaign,{rules:e.target.value.trim()||null});}} placeholder="شروط المشاركة..."/></label>
            <label className="block space-y-1 text-xs font-bold">الجائزة<textarea className={input} rows={2} defaultValue={campaign.prize_description ?? ""} onBlur={e=>{if(e.target.value!==(campaign.prize_description??""))void updateCampaign(campaign,{prize_description:e.target.value.trim()||null});}} placeholder="وصف الجائزة..."/></label>
            <b className="text-xs">مشاركات المتسابقين ({entries.filter(entry=>entry.campaign_id===campaign.id).length})</b>
            {entries.filter(entry=>entry.campaign_id===campaign.id).map(entry=><div key={entry.id} className="space-y-2 rounded-lg border border-border p-3 text-xs">
              <p>المستخدم: {entry.user_id.slice(0,8)}… · {new Date(entry.created_at).toLocaleString("ar-IQ")}</p>
              {entry.text_content&&<p className="whitespace-pre-wrap">{entry.text_content}</p>}
              {entry.image_url&&<a href={entry.image_url} target="_blank" rel="noreferrer"><img src={entry.image_url} alt="مشاركة المتسابق" className="max-h-56 rounded-lg object-contain"/></a>}
              <p>الحالة: {entry.status==="approved"?"مقبولة":entry.status==="rejected"?"مرفوضة":"قيد المراجعة"}</p>
              {entry.status==="pending"&&<div className="flex gap-2"><button onClick={()=>void reviewEntry(entry,"approved")} className="rounded-lg bg-primary px-3 py-2 font-bold text-primary-foreground">قبول</button><button onClick={()=>void reviewEntry(entry,"rejected")} className="rounded-lg border border-destructive px-3 py-2 font-bold text-destructive">رفض</button></div>}
            </div>)}
          </div>}
          <p className="text-[10px] text-muted-foreground">النتائج التفصيلية محمية وتُعرض هنا للمدير فقط.</p>
        </article>;
      })}
    </section>
  </div>;
}
