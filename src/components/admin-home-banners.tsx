import { useCallback, useEffect, useState } from "react";
import { ImagePlus, RefreshCw, Trash2, Upload, Power } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Banner = { id: string; image_url: string; storage_path: string | null; target_category: "restaurant" | "hotel" | "store"; is_active: boolean; scroll_speed: number; display_order: number; badge_text: string | null };
const labels = { restaurant: "المطاعم", hotel: "الفنادق", store: "المتاجر" } as const;
const input = "w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm";
export default function AdminHomeBanners() {
  const [rows, setRows] = useState<Banner[]>([]);
  const [category, setCategory] = useState<Banner["target_category"]>("restaurant");
  const [speed, setSpeed] = useState(5);
  const [order, setOrder] = useState(0);
  const [badge, setBadge] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const { data, error } = await (supabase as any).from("home_carousel_banners").select("*").order("display_order").order("created_at");
    if (error) setMessage("تعذر تحميل البانرات: " + error.message);
    else setRows(data ?? []);
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
    if (!file.type.startsWith("image/") || file.size > 8 * 1024 * 1024) { setMessage("الصورة لازم تكون بصيغة صورة وحجمها أقل من 8 ميغابايت."); return; }
    setBusy(true); setMessage("");
    const path = `home-banners/${category}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
    const stored = await supabase.storage.from("app-visuals").upload(path, file, { upsert: false, contentType: file.type });
    if (stored.error) { setMessage("فشل رفع الصورة: " + stored.error.message); setBusy(false); return; }
    const { data } = supabase.storage.from("app-visuals").getPublicUrl(path);
    const { error } = await (supabase as any).from("home_carousel_banners").insert({
      image_url: data.publicUrl, storage_path: path, target_category: category, is_active: true,
      scroll_speed: speed, display_order: order, badge_text: badge.trim() || null,
    });
    if (error) { setMessage("ترتفعت الصورة لكن تعذر حفظ بياناتها: " + error.message); }
    else { setMessage("تم رفع ونشر البانر، وسيظهر بالويب والأندرويد."); setFile(null); setBadge(""); await load(); }
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
    <header><h2 className="text-xl font-black">بانرات الصفحة الرئيسية</h2><p className="mt-1 text-sm text-muted-foreground">ارفع صور المطاعم والفنادق والمتاجر. لا توجد صور تجريبية؛ لا يظهر إلا ما تنشره الإدارة.</p></header>
    {message && <div className="rounded-xl border border-border bg-muted/40 p-3 text-sm">{message}</div>}
    <section className="grid gap-3 rounded-2xl border border-border bg-card p-4 md:grid-cols-2">
      <label className="text-sm font-bold">القسم<select className={input+" mt-2"} value={category} onChange={e=>setCategory(e.target.value as any)}><option value="restaurant">المطاعم</option><option value="hotel">الفنادق</option><option value="store">المتاجر</option></select></label>
      <label className="text-sm font-bold">سرعة التبديل بالثواني<input className={input+" mt-2"} type="number" min="2" max="30" value={speed} onChange={e=>setSpeed(Math.max(2,Math.min(30,Number(e.target.value)||5)))}/></label>
      <label className="text-sm font-bold">ترتيب العرض<input className={input+" mt-2"} type="number" value={order} onChange={e=>setOrder(Number(e.target.value)||0)}/></label>
      <label className="text-sm font-bold">شارة اختيارية<input className={input+" mt-2"} value={badge} onChange={e=>setBadge(e.target.value)} placeholder="مثلاً: قريباً"/></label>
      <label className="md:col-span-2 flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-border p-4"><ImagePlus className="h-6 w-6"/><span className="text-sm">{file?.name || "اختيار صورة البانر (حتى 8 ميغابايت)"}</span><input type="file" accept="image/*" className="hidden" onChange={e=>setFile(e.target.files?.[0] ?? null)}/></label>
      <button disabled={busy || !file} onClick={()=>void upload()} className="md:col-span-2 inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-bold text-primary-foreground disabled:opacity-50"><Upload className="h-4 w-4"/>{busy ? "جارٍ الرفع..." : "رفع ونشر البانر"}</button>
    </section>
    <section className="space-y-3">
      <div className="flex items-center justify-between"><h3 className="font-black">البانرات المضافة ({rows.length})</h3><button onClick={()=>void load()} className="rounded-lg border border-border p-2"><RefreshCw className="h-4 w-4"/></button></div>
      {rows.length===0 && <p className="rounded-xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground">ماكو صور مرفوعة حالياً. مكان البانر يبقى فارغاً للمستخدمين.</p>}
      {rows.map(row=><article key={row.id} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3">
        <img src={row.image_url} alt="" className="h-20 w-20 rounded-xl object-cover"/>
        <div className="min-w-0 flex-1"><b className="text-sm">{labels[row.target_category]}</b><p className="text-xs text-muted-foreground">الترتيب {row.display_order} · كل {row.scroll_speed} ثوانٍ</p><p className="text-xs">{row.is_active ? "منشور" : "متوقف"}</p></div>
        <button title="تفعيل أو إيقاف" onClick={()=>void toggle(row)} className="rounded-lg border border-border p-2"><Power className="h-4 w-4"/></button>
        <button title="حذف" onClick={()=>void remove(row)} className="rounded-lg border border-border p-2 text-destructive"><Trash2 className="h-4 w-4"/></button>
      </article>)}
    </section>
  </div>;
}
