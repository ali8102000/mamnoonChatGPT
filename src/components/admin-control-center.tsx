import { useCallback, useEffect, useState } from "react";
import { Check, Eye, Image, LayoutGrid, PanelsTopLeft, Save, Shapes, Store } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import AdminVisualBuilder from "@/components/admin-visual-builder";
import AdminHomeBanners from "@/components/admin-home-banners";
import AdminBusinessCategories from "@/components/admin-business-categories";
import AdminCompanySettings from "@/components/admin-company-settings";

type GridConfig = {
  grid_gap_px: number;
  first_row_height_px: number;
  second_row_height_px: number;
  top_banner_height_px: number;
  wide_column_ratio: number;
  card_radius_px: number;
  taxi_icon_size_px: number;
  service_icon_size_px: number;
  large_icon_size_px: number;
  carousel_height_px: number;
};
const defaults: GridConfig = { grid_gap_px: 12, first_row_height_px: 145, second_row_height_px: 188, top_banner_height_px: 130, wide_column_ratio: 2, card_radius_px: 20, taxi_icon_size_px: 56, service_icon_size_px: 64, large_icon_size_px: 56, carousel_height_px: 188 };
const tabs = [
  { id: "layout", label: "مقاسات وتخطيط الرئيسية", icon: LayoutGrid },
  { id: "elements", label: "الأيقونات والصور", icon: Shapes },
  { id: "banners", label: "البانرات والسلايدر", icon: PanelsTopLeft },
  { id: "categories", label: "الفئات", icon: Store },
  { id: "identity", label: "هوية ممنون", icon: Image },
] as const;
type Tab = typeof tabs[number]["id"];

export default function AdminControlCenter() {
  const [tab, setTab] = useState<Tab>("layout");
  const [config, setConfig] = useState<GridConfig>(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [exists, setExists] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await (supabase as any).from("app_ui_elements").select("config,published_config").eq("element_key", "home_customer_grid_layout").maybeSingle();
    if (error) setMessage("تعذر تحميل إعدادات الشبكة: " + error.message);
    else if (data) {
      setExists(true);
      setConfig({ ...defaults, ...(data.published_config ?? {}), ...(data.config ?? {}) });
    } else {
      setExists(false);
      setMessage("إعدادات الشبكة غير مسجلة بعد. يلزم تطبيق ترحيل home grid قبل الحفظ.");
    }
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const update = (key: keyof GridConfig, value: number) => setConfig((current) => ({ ...current, [key]: value }));
  const save = async (publish: boolean) => {
    if (!exists) return;
    const safe: GridConfig = {
      grid_gap_px: Math.max(4, Math.min(28, Number(config.grid_gap_px) || 12)),
      first_row_height_px: Math.max(100, Math.min(260, Number(config.first_row_height_px) || 145)),
      second_row_height_px: Math.max(120, Math.min(300, Number(config.second_row_height_px) || 188)),
      top_banner_height_px: Math.max(100, Math.min(240, Number(config.top_banner_height_px) || 130)),
      wide_column_ratio: Math.max(1.4, Math.min(2.8, Number(config.wide_column_ratio) || 2)),
      card_radius_px: Math.max(8, Math.min(32, Number(config.card_radius_px) || 20)),
      taxi_icon_size_px: Math.max(32, Math.min(96, Number(config.taxi_icon_size_px) || 56)),
      service_icon_size_px: Math.max(32, Math.min(120, Number(config.service_icon_size_px) || 64)),
      large_icon_size_px: Math.max(32, Math.min(96, Number(config.large_icon_size_px) || 56)),
      carousel_height_px: Math.max(120, Math.min(300, Number(config.carousel_height_px) || 188)),
    };
    setSaving(true);
    const patch = publish
      ? { config: safe, published_config: safe, is_enabled: true, is_published: true, updated_at: new Date().toISOString() }
      : { config: safe, updated_at: new Date().toISOString() };
    const { error } = await (supabase as any).from("app_ui_elements").update(patch).eq("element_key", "home_customer_grid_layout");
    setSaving(false);
    if (error) setMessage("تعذر الحفظ: " + error.message);
    else { setConfig(safe); setMessage(publish ? "تم نشر مقاسات الصفحة الرئيسية للويب والأندرويد." : "تم حفظ المسودة فقط؛ المستخدمون لا يشاهدونها بعد."); await load(); }
  };

  const field = (key: keyof GridConfig, label: string, min: number, max: number, step = 1) => (
    <label key={key} className="block rounded-xl border border-slate-200 bg-white p-3 text-xs font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
      <span className="mb-2 block">{label}</span>
      <input type="range" min={min} max={max} step={step} value={config[key]} onChange={(event) => update(key, Number(event.target.value))} className="w-full accent-cyan-600"/>
      <span className="mt-1 block text-left font-black tabular-nums text-cyan-700 dark:text-cyan-300">{key === "wide_column_ratio" ? `${config[key].toFixed(1)} : 1` : `${config[key]} px`}</span>
    </label>
  );

  return <div dir="rtl" className="space-y-5">
    <header className="overflow-hidden rounded-[28px] bg-gradient-to-l from-[#071b34] via-[#123d61] to-[#087e8b] p-5 text-white shadow-xl sm:p-7">
      <div className="flex items-center gap-3"><div className="grid h-14 w-14 place-items-center rounded-2xl border border-white/20 bg-white/10"><LayoutGrid className="h-7 w-7"/></div><div><div className="text-[10px] font-black tracking-widest text-cyan-100">MAMNOON ADMIN CONTROL</div><h2 className="mt-1 text-2xl font-black">مركز التحكم الشامل</h2></div></div>
      <p className="mt-4 max-w-3xl text-sm leading-7 text-sky-50/90">من هنا تدير واجهة ممنون: المقاسات، الصور، الأيقونات، البانرات، الفئات وهوية التطبيق. التعديل يبقى مسودة إلى أن تنشره، ولا يغيّر وظائف الأزرار أو صلاحيات الحسابات.</p>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[["الأبعاد","تغيير عرض وارتفاع البطاقات"],["الصور","رفع وقص وتبديل الصور"],["الحركة","سحب السلايدر بالإصبع"],["النشر","معاينة قبل اعتماد التغيير"]].map(([a,b])=><div key={a} className="rounded-xl border border-white/15 bg-white/10 p-3"><b className="block text-xs">{a}</b><span className="mt-1 block text-[10px] text-sky-100/80">{b}</span></div>)}
      </div>
    </header>
    <nav className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {tabs.map((item) => { const Icon = item.icon; return <button key={item.id} onClick={() => setTab(item.id)} className={`flex min-h-14 items-center gap-2 rounded-2xl border p-3 text-right text-xs font-black transition ${tab === item.id ? "border-cyan-600 bg-gradient-to-l from-cyan-600 to-blue-600 text-white shadow-lg" : "border-slate-200 bg-white text-slate-700 hover:border-cyan-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"}`}><Icon className="h-5 w-5 shrink-0"/><span>{item.label}</span></button>; })}
    </nav>
    {tab === "layout" && <section className="space-y-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-black">شبكة الصفحة الرئيسية — المقاسات الابتدائية</h3><p className="mt-1 text-xs text-slate-500">معاينة متجاوبة مبنية على عرض شبكة 336px، وتتغير مباشرة أثناء السحب.</p></div><button onClick={() => void load()} className="rounded-xl border px-3 py-2 text-xs font-bold">تحديث</button></div>
      {loading ? <p className="py-8 text-center text-sm">جاري تحميل الإعدادات…</p> : <>
        <div className="mx-auto w-full max-w-[336px] rounded-[26px] border-[7px] border-slate-900 bg-slate-50 p-2 shadow-xl">
          <div className="mb-2 grid place-items-center rounded-xl bg-gradient-to-l from-amber-500 to-orange-500 px-3 text-center text-xs font-black text-white" style={{height:config.top_banner_height_px,borderRadius:config.card_radius_px}}>اطلب الآن — ممنون</div>
          <div className="space-y-2">
            <div dir="ltr" className="flex" style={{gap:config.grid_gap_px}}>
              <div className="grid place-items-center bg-amber-500 text-white font-black" style={{flex:config.wide_column_ratio,height:config.first_row_height_px,borderRadius:config.card_radius_px}}>طلب تكسي</div>
              <div className="grid place-items-center bg-emerald-500 text-white font-black" style={{flex:1,height:config.first_row_height_px,borderRadius:config.card_radius_px}}>طلب فني</div>
            </div>
            <div dir="ltr" className="flex flex-row-reverse" style={{gap:config.grid_gap_px}}>
              <div className="grid place-items-center bg-orange-600 text-white font-black" style={{flex:config.wide_column_ratio,height:config.second_row_height_px,borderRadius:config.card_radius_px}}>البانر التالي</div>
              <div className="grid place-items-center bg-amber-700 text-white font-black" style={{flex:1,height:config.second_row_height_px,borderRadius:config.card_radius_px}}>سيارة كبيرة</div>
            </div>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {field("top_banner_height_px","ارتفاع بانر اطلب الآن",100,240)}
          {field("grid_gap_px","المسافة بين البطاقات",4,28)}
          {field("first_row_height_px","ارتفاع الصف الأول",100,260)}
          {field("second_row_height_px","ارتفاع الصف الثاني",120,300)}
          {field("wide_column_ratio","نسبة عرض البطاقة الكبيرة",1.4,2.8,.1)}
          {field("carousel_height_px","ارتفاع سلايدر الصور",120,300)}
          {field("card_radius_px","استدارة زوايا البطاقات",8,32)}
          {field("taxi_icon_size_px","حجم أيقونة التكسي",32,96)}
          {field("service_icon_size_px","حجم صورة الفني",32,120)}
          {field("large_icon_size_px","حجم أيقونة السيارة الكبيرة",32,96)}
        </div>
        <div className="flex flex-wrap gap-2"><button disabled={!exists||saving} onClick={()=>void save(false)} className="inline-flex items-center gap-2 rounded-xl border px-4 py-3 text-xs font-black disabled:opacity-50"><Save className="h-4 w-4"/>حفظ مسودة</button><button disabled={!exists||saving} onClick={()=>void save(true)} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-3 text-xs font-black text-primary-foreground disabled:opacity-50"><Check className="h-4 w-4"/>نشر المقاسات</button><span className="inline-flex items-center gap-2 text-xs text-slate-500"><Eye className="h-4 w-4"/>المعاينة لا تغيّر التطبيق قبل النشر</span></div>
        {message && <p role="status" className="rounded-xl bg-slate-100 p-3 text-xs font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-100">{message}</p>}
      </>}
    </section>}
    {tab === "elements" && <AdminVisualBuilder/>}
    {tab === "banners" && <AdminHomeBanners/>}
    {tab === "categories" && <AdminBusinessCategories/>}
    {tab === "identity" && <AdminCompanySettings/>}
  </div>;
}
