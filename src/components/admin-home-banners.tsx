import { useCallback, useEffect, useState } from "react";
import { ImagePlus, RefreshCw, Trash2, Upload, Power } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type BannerKind = "category" | "poll" | "contest" | "ad" | "top_square"; // top_square retained only for legacy rows
type Category = "restaurant" | "hotel" | "store";
type Campaign = { id: string; title: string; campaign_type: "poll" | "contest"; status: string };
type Banner = { id: string; image_url: string; storage_path: string | null; target_category: Category; banner_type: BannerKind; target_campaign_id: string | null; is_active: boolean; scroll_speed: number; display_order: number; badge_text: string | null; banner_title?: string | null; banner_description?: string | null; motion_axis: "horizontal" | "vertical"; motion_direction: "left" | "right" | "up" | "down"; motion_style: "slide" | "fade" | "drop" };
const labels = { restaurant: "المطاعم", hotel: "الفنادق", store: "المتاجر" } as const;
const kindLabels: Record<BannerKind,string> = { category: "مطاعم / فنادق / متاجر", poll: "استطلاع رأي", contest: "مسابقة", ad: "الإعلان العلوي الرئيسي", top_square: "البانر المربع أعلى الصفحة" };
const input = "w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm";
export default function AdminHomeBanners() {
  const [rows, setRows] = useState<Banner[]>([]);
  const [category, setCategory] = useState<Category>("restaurant");
  const [bannerType, setBannerType] = useState<BannerKind>("category");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
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
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const { data, error } = await (supabase as any).from("home_carousel_banners").select("*").order("display_order").order("created_at");
    if (error) setMessage("تعذر تحميل البانرات: " + error.message);
    else setRows(data ?? []);
    const { data: campaignRows } = await (supabase as any).from("app_campaigns").select("id,title,campaign_type,status").eq("status","published").order("sort_order").order("created_at",{ascending:false});
    setCampaigns((campaignRows ?? []) as Campaign[]);
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
      image_url: data.publicUrl, storage_path: path, target_category: category, banner_type: bannerType, target_campaign_id: bannerType === "poll" || bannerType === "contest" ? campaignId || null : null, is_active: true,
      scroll_speed: speed, display_order: order, badge_text: badge.trim() || null,
      banner_title: bannerTitle.trim() || null, banner_description: bannerDescription.trim() || null,
      motion_axis: bannerType === "top_square" ? "horizontal" : motionAxis, motion_direction: bannerType === "top_square" ? "left" : motionDirection, motion_style: bannerType === "top_square" ? "slide" : motionStyle,
    });
    if (error) { setMessage("ترتفعت الصورة لكن تعذر حفظ بياناتها: " + error.message); }
    else { setMessage("تم رفع ونشر البانر، وسيظهر بالويب والأندرويد."); setFile(null); setBadge(""); setBannerTitle(""); setBannerDescription(""); await load(); }
    setBusy(false);
  };
  const toggle = async (row: Banner) => {
    const { error } = await (supabase as any).from("home_carousel_banners").update({ is_active: !row.is_active, updated_at: new Date().toISOString() }).eq("id", row.id);
    setMessage(error ? "تعذر تغيير الحالة: " + error.message : "تم تحديث حالة البانر."); if (!error) await load();
  };
  const remove = async (row: Banner) => {
    if (!window.confirm("متأكد تريد حذف هذا البانر نهائياً؟")) return;
    const { error } = await (supabase as any).from("home_carousel_banners").delete().eq("id", row.id);
    if (!error && row.storage_path) await supabase.storage.from("app-visuals").remove([row.storage_path]);
    setMessage(error ? "تعذر حذف البانر: " + error.message : "تم حذف البانر."); if (!error) await load();
  };
  return <div className="space-y-5" dir="rtl">
    <header><h2 className="text-xl font-black">بانرات الصفحة الرئيسية</h2><p className="mt-1 text-sm text-muted-foreground">صور مربعات المطاعم والفنادق والمولات والمحلات ثابتة ولا تتبدل تلقائياً. المطاعم تستخدم أول صورة مطاعم منشورة، والفنادق أول صورة فنادق، وأول صورة من قسم المتاجر للمولات وثاني صورة للمحلات. أما الإعلان العلوي الرئيسي فيدعم الإعلانات والاستطلاعات والمسابقات، وتتحكم باتجاه تمرير الصورة داخل البانر (يمين/يسار/أعلى/أسفل) وسرعتها ونمط الانتقال. وكلاهما يتزامن بين الويب والأندرويد. ارفع صورة جديدة ثم أوقف أو احذف القديمة لتغيير الصورة.</p></header>
    {message && <div className="rounded-xl border border-border bg-muted/40 p-3 text-sm">{message}</div>}
    <section className="grid gap-3 rounded-2xl border border-border bg-card p-4 md:grid-cols-2">
      <label className="text-sm font-bold">نوع البانر<select className={input+" mt-2"} value={bannerType} onChange={e=>{setBannerType(e.target.value as BannerKind);setCampaignId("");}}><option value="category">مطاعم / فنادق / متاجر</option><option value="poll">استطلاع رأي</option><option value="contest">مسابقة</option><option value="ad">الإعلان العلوي الرئيسي</option></select></label>
      {(bannerType === "category") ? <label className="text-sm font-bold">القسم<select className={input+" mt-2"} value={category} onChange={e=>setCategory(e.target.value as Category)}><option value="restaurant">المطاعم</option><option value="hotel">الفنادق</option><option value="store">المتاجر</option></select></label> : null}
      {(bannerType === "poll" || bannerType === "contest") ? <label className="text-sm font-bold">الحملة المرتبطة<select className={input+" mt-2"} value={campaignId} onChange={e=>setCampaignId(e.target.value)}><option value="">اختر حملة منشورة</option>{campaigns.filter(c=>c.campaign_type===bannerType).map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select></label> : null}
      {bannerType === "ad" && <p className="text-xs text-muted-foreground md:col-span-2">هذا هو الإعلان العلوي الرئيسي، مستقل عن البانر المربع.</p>}{bannerType === "top_square" && <p className="text-xs text-muted-foreground md:col-span-2">يبقى مكانه فارغاً بلا صورة افتراضية إذا لم توجد صورة منشورة. الضغط عليه يعرض رسالة «سيتوفر قريباً» ونص الشركاء، ويتوقف السحب التلقائي 5 ثوانٍ بعد اللمس.</p>}
      <label className="text-sm font-bold">مدة عرض الصورة بالثواني (1–60)<input className={input+" mt-2"} type="number" min="1" max="60" value={speed} onChange={e=>setSpeed(Math.max(1,Math.min(60,Number(e.target.value)||5)))}/></label>
      <label className="text-sm font-bold">اتجاه الحركة<select className={input+" mt-2"} value={motionDirection} onChange={e=>{const value=e.target.value as typeof motionDirection;setMotionDirection(value);setMotionAxis(value==="up"||value==="down"?"vertical":"horizontal");}}><option value="left">من اليمين لليسار</option><option value="right">من اليسار لليمين</option><option value="up">من الأسفل للأعلى</option><option value="down">من الأعلى للأسفل</option></select></label>
      <label className="text-sm font-bold">نمط الانتقال<select className={input+" mt-2"} value={motionStyle} onChange={e=>setMotionStyle(e.target.value as typeof motionStyle)}><option value="slide">انزلاق</option><option value="fade">تلاشي</option><option value="drop">هبوط</option></select></label>
      <label className="text-sm font-bold">ترتيب العرض<input className={input+" mt-2"} type="number" value={order} onChange={e=>setOrder(Number(e.target.value)||0)}/></label>
      {bannerType === "ad" && <>
        <label className="text-sm font-bold">عنوان البانر<input className={input+" mt-2"} value={bannerTitle} onChange={e=>setBannerTitle(e.target.value)} placeholder="مثلاً: مشوارك صار أسهل"/></label>
        <label className="text-sm font-bold">تفاصيل البانر<input className={input+" mt-2"} value={bannerDescription} onChange={e=>setBannerDescription(e.target.value)} placeholder="اكتب وصفاً قصيراً للإعلان"/></label>
      </>}
      <label className="text-sm font-bold">شارة قصيرة اختيارية<input className={input+" mt-2"} value={badge} onChange={e=>setBadge(e.target.value)} placeholder="مثلاً: عرض خاص"/></label>
      <label className="md:col-span-2 flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-border p-4"><ImagePlus className="h-6 w-6"/><span className="text-sm">{file?.name || "اختيار صورة البانر (حتى 8 ميغابايت)"}</span><input type="file" accept="image/*" className="hidden" onChange={e=>setFile(e.target.files?.[0] ?? null)}/></label>
      <button disabled={busy || !file} onClick={()=>void upload()} className="md:col-span-2 inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-bold text-primary-foreground disabled:opacity-50"><Upload className="h-4 w-4"/>{busy ? "جارٍ الرفع..." : "رفع ونشر البانر"}</button>
    </section>
    <section className="space-y-3">
      <div className="flex items-center justify-between"><h3 className="font-black">البانرات المضافة ({rows.length})</h3><button onClick={()=>void load()} className="rounded-lg border border-border p-2"><RefreshCw className="h-4 w-4"/></button></div>
      {rows.length===0 && <p className="rounded-xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground">ماكو صور إدارية مرفوعة حالياً؛ تظهر صور افتراضية للفئات إلى أن ترفع صورك الخاصة.</p>}
      {rows.map(row=><article key={row.id} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3">
        <img src={row.image_url} alt="" className="h-20 w-20 rounded-xl object-cover"/>
        <div className="min-w-0 flex-1"><b className="text-sm">{kindLabels[row.banner_type] || labels[row.target_category]}{row.banner_type === "category" ? ` · ${labels[row.target_category]}` : ""}</b><p className="text-xs text-muted-foreground">الترتيب {row.display_order} · كل {row.scroll_speed} ثوانٍ</p>{row.banner_title && <p className="text-xs font-bold">{row.banner_title}</p>}{row.banner_description && <p className="text-xs text-muted-foreground">{row.banner_description}</p>}<p className="text-xs text-muted-foreground">{row.motion_axis === "vertical" ? (row.motion_direction === "up" ? "من الأسفل للأعلى" : "من الأعلى للأسفل") : (row.motion_direction === "left" ? "من اليمين لليسار" : "من اليسار لليمين")} · {row.motion_style === "fade" ? "تلاشي" : row.motion_style === "drop" ? "هبوط" : "انزلاق"}</p><p className="text-xs">{row.is_active ? "منشور" : "متوقف"}</p></div>
        <button title="تفعيل أو إيقاف" onClick={()=>void toggle(row)} className="rounded-lg border border-border p-2"><Power className="h-4 w-4"/></button>
        <button title="حذف" onClick={()=>void remove(row)} className="rounded-lg border border-border p-2 text-destructive"><Trash2 className="h-4 w-4"/></button>
      </article>)}
    </section>
  </div>;
}
