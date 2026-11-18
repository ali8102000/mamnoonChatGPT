import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye, ImagePlus, LayoutTemplate, Plus, Save, Smartphone, Table2, Trophy, Vote, X, Check, ChevronUp, ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type UiElement = {
  element_key: string; label: string; screen_key: string; placement_key: string;
  element_type: string; action_key: string; title: string | null; subtitle: string | null;
  image_url: string | null; icon_name: string | null; width_px: number | null;
  height_px: number | null; sort_order: number; is_enabled: boolean; is_published: boolean;
  config: Record<string, any>; published_config: Record<string, any>;
};
type ContentSection = {
  id: string; title: string; section_type: "table" | "banner"; placement_key: string;
  sort_order: number; is_enabled: boolean; is_published: boolean; config: Record<string, any>;
  published_config: Record<string, any>;
};
type Campaign = {
  id: string; campaign_type: "poll" | "contest"; title: string; description: string | null;
  placement_key: string; starts_at: string | null; ends_at: string | null; status: string;
  result_visibility: string; sort_order: number; app_campaign_options?: { id: string; label: string; sort_order: number }[];
};

const inputClass = "w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary";
const buttonClass = "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition disabled:opacity-50";
const tabs = [
  { id: "visual", label: "محرر الواجهة", icon: LayoutTemplate },
  { id: "sections", label: "الأقسام والجداول", icon: Table2 },
  { id: "campaigns", label: "الاستطلاعات والمسابقات", icon: Trophy },
] as const;

export default function AdminVisualBuilder() {
  const [tab, setTab] = useState<(typeof tabs)[number]["id"]>("visual");
  const [elements, setElements] = useState<UiElement[]>([]);
  const [sections, setSections] = useState<ContentSection[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selected, setSelected] = useState<UiElement | null>(null);
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [sectionTitle, setSectionTitle] = useState("");
  const [sectionType, setSectionType] = useState<"table" | "banner">("table");
  const [sectionPlacement, setSectionPlacement] = useState("home.customer.content");
  const [sectionColumns, setSectionColumns] = useState("العنوان | التفاصيل");
  const [sectionRows, setSectionRows] = useState("مثال | محتوى تجريبي");
  const [sectionSortOrder, setSectionSortOrder] = useState(0);
  const [campaignTitle, setCampaignTitle] = useState("");
  const [campaignDescription, setCampaignDescription] = useState("");
  const [campaignType, setCampaignType] = useState<"poll" | "contest">("poll");
  const [campaignOptions, setCampaignOptions] = useState("الخيار الأول\nالخيار الثاني");
  const [campaignPlacement, setCampaignPlacement] = useState("home.customer.content");
  const [campaignStarts, setCampaignStarts] = useState("");
  const [campaignEnds, setCampaignEnds] = useState("");
  const [campaignSortOrder, setCampaignSortOrder] = useState(0);
  const [resultRows, setResultRows] = useState<Record<string, any[]>>({});
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [ui, content, campaign] = await Promise.all([
      (supabase as any).from("app_ui_elements").select("*").order("sort_order"),
      (supabase as any).from("app_content_sections").select("*").order("sort_order"),
      (supabase as any).from("app_campaigns").select("*, app_campaign_options(id,label,sort_order)").order("sort_order").order("created_at", { ascending: false }),
    ]);
    if (ui.error) setMessage("تعذر تحميل عناصر الواجهة: " + ui.error.message);
    else setElements((ui.data ?? []) as UiElement[]);
    if (!content.error) setSections((content.data ?? []) as ContentSection[]);
    if (!campaign.error) setCampaigns((campaign.data ?? []) as Campaign[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const startHold = (element: UiElement) => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(() => openEditor(element), 550);
  };
  const clearHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };
  const openEditor = (element: UiElement) => {
    setSelected(element);
    setDraft({ ...(element.config ?? {}), title: element.title ?? "", subtitle: element.subtitle ?? "",
      image_url: element.image_url ?? element.config?.image_url ?? "",
      icon_name: element.icon_name ?? element.config?.icon_name ?? "",
      width_px: element.width_px ?? element.config?.width_px ?? 64,
      height_px: element.height_px ?? element.config?.height_px ?? 64,
      sort_order: element.sort_order ?? 0,
    });
    setMessage("");
  };

  const saveDraft = async () => {
    if (!selected) return;
    setSaving(true);
    const { error } = await (supabase as any).from("app_ui_elements")
      .update({ config: draft, updated_at: new Date().toISOString() })
      .eq("element_key", selected.element_key);
    if (error) setMessage("تعذر حفظ المسودة: " + error.message);
    else {
      setMessage("انحفظت المسودة. التغييرات بعد ما ظهرت للمستخدمين.");
      await load();
    }
    setSaving(false);
  };

  const publishElement = async () => {
    if (!selected) return;
    setSaving(true);
    const published = { ...draft };
    const { error } = await (supabase as any).from("app_ui_elements").update({
      title: String(draft.title ?? ""), subtitle: String(draft.subtitle ?? ""),
      image_url: draft.image_url || null, icon_name: draft.icon_name || null,
      width_px: Number(draft.width_px) || 64, height_px: Number(draft.height_px) || 64,
      sort_order: Number(draft.sort_order) || 0, is_enabled: true, is_published: true,
      published_config: published, updated_at: new Date().toISOString(),
    }).eq("element_key", selected.element_key);
    if (error) setMessage("تعذر نشر التغيير: " + error.message);
    else {
      setMessage("تم النشر. سيظهر التغيير في التطبيق بعد تحديث الإعدادات.");
      await load();
      const refreshed = elements.find((item) => item.element_key === selected.element_key);
      if (refreshed) setSelected({ ...refreshed, ...{ is_published: true } });
    }
    setSaving(false);
  };

  const uploadImage = async (file?: File) => {
    if (!file || !selected) return;
    if (!file.type.startsWith("image/")) { setMessage("اختار ملف صورة فقط."); return; }
    if (file.size > 8 * 1024 * 1024) { setMessage("حجم الصورة لازم يكون أقل من 8 ميغابايت."); return; }
    setUploading(true);
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    const path = `${selected.element_key}/${Date.now()}-${safeName}`;
    const { error } = await supabase.storage.from("app-visuals").upload(path, file, { upsert: true, contentType: file.type });
    if (error) setMessage("فشل رفع الصورة: " + error.message);
    else {
      const { data } = supabase.storage.from("app-visuals").getPublicUrl(path);
      setDraft((current) => ({ ...current, image_url: data.publicUrl }));
      setMessage("ترفعَت الصورة. اضغط حفظ المسودة ثم نشر حتى تظهر.");
    }
    setUploading(false);
  };

  const createSection = async () => {
    if (!sectionTitle.trim()) { setMessage("اكتب اسم القسم أولاً."); return; }
    const columns = sectionColumns.split("|").map((value) => value.trim()).filter(Boolean);
    const rows = sectionRows.split(String.fromCharCode(10)).map((line) => line.split("|").map((value) => value.trim())).filter((row) => row.some(Boolean));
    if (sectionType === "table" && columns.length < 1) { setMessage("اكتب اسم عمود واحد على الأقل."); return; }
    const config: Record<string, any> = sectionType === "table" ? { columns, rows } : { description: sectionRows.trim() };
    const { error } = await (supabase as any).from("app_content_sections").insert({
      title: sectionTitle.trim(), section_type: sectionType, placement_key: sectionPlacement,
      config, published_config: config, sort_order: Number(sectionSortOrder) || sections.length + 1,
      is_enabled: true, is_published: false,
    });
    if (error) setMessage("تعذر إنشاء القسم: " + error.message);
    else { setSectionTitle(""); setSectionSortOrder(0); setMessage("انضاف القسم كمسودة. تگدر تراجعه وتنشره."); await load(); }
  };

  const publishSection = async (section: ContentSection) => {
    const { error } = await (supabase as any).from("app_content_sections").update({
      published_config: section.config, is_published: true, is_enabled: true,
      updated_at: new Date().toISOString(),
    }).eq("id", section.id);
    setMessage(error ? "تعذر نشر القسم: " + error.message : "تم نشر القسم.");
    if (!error) await load();
  };

  const createCampaign = async () => {
    const options = campaignOptions.split("\n").map((value) => value.trim()).filter(Boolean);
    if (!campaignTitle.trim() || options.length < 2) { setMessage("اكتب عنواناً وخيارين على الأقل."); return; }
    setSaving(true);
    const { data, error } = await (supabase as any).from("app_campaigns").insert({
      campaign_type: campaignType, title: campaignTitle.trim(),
      description: campaignDescription.trim() || null, placement_key: campaignPlacement,
      starts_at: campaignStarts ? new Date(campaignStarts).toISOString() : null,
      ends_at: campaignEnds ? new Date(campaignEnds).toISOString() : null,
      sort_order: Number(campaignSortOrder) || 0,
      status: "draft", result_visibility: "public",
    }).select("id").single();
    if (error || !data?.id) setMessage("تعذر إنشاء الاستطلاع: " + (error?.message ?? "خطأ غير معروف"));
    else {
      const { error: optionError } = await (supabase as any).from("app_campaign_options").insert(
        options.map((label, index) => ({ campaign_id: data.id, label, sort_order: index + 1 })),
      );
      if (optionError) setMessage("تم إنشاء الحملة لكن تعذر حفظ الخيارات: " + optionError.message);
      else {
        setCampaignTitle(""); setCampaignDescription(""); setCampaignSortOrder(0);
        setMessage("انحفظت كمسودة. راجعها ثم انشرها.");
      }
      await load();
    }
    setSaving(false);
  };

  const moveSection = async (section: ContentSection, delta: number) => {
    const { error } = await (supabase as any).from("app_content_sections")
      .update({ sort_order: section.sort_order + delta }).eq("id", section.id);
    if (error) setMessage("تعذر تغيير ترتيب القسم: " + error.message);
    else await load();
  };

  const moveCampaign = async (campaign: Campaign, delta: number) => {
    const { error } = await (supabase as any).from("app_campaigns")
      .update({ sort_order: campaign.sort_order + delta }).eq("id", campaign.id);
    if (error) setMessage("تعذر تغيير ترتيب الحملة: " + error.message);
    else await load();
  };
  const publishCampaign = async (campaign: Campaign) => {
    const { error } = await (supabase as any).from("app_campaigns")
      .update({ status: "published", updated_at: new Date().toISOString() }).eq("id", campaign.id);
    setMessage(error ? "تعذر نشر الحملة: " + error.message : "تم نشر الحملة.");
    if (!error) await load();
  };

  const loadResults = async (campaign: Campaign) => {
    const { data, error } = await (supabase as any).from("app_campaign_option_results").select("option_id,vote_count").eq("campaign_id", campaign.id);
    if (error) setMessage("تعذر تحميل النتائج: " + error.message);
    else setResultRows((current) => ({ ...current, [campaign.id]: data ?? [] }));
  };

  const selectedPublished = useMemo(() => Boolean(selected?.is_published), [selected]);

  if (loading) return <div className="grid min-h-72 place-items-center text-sm text-muted-foreground">جاري تحميل محرر التطبيق...</div>;

  return (
    <div dir="rtl" className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black">محرر التطبيق والمحتوى</h2>
          <p className="mt-1 text-sm text-muted-foreground">تحكم بالصور والأحجام والأقسام والاستطلاعات مع معاينة قبل النشر.</p>
        </div>
        <button className={buttonClass + " border border-border"} onClick={() => void load()}><Eye className="h-4 w-4" /> تحديث</button>
      </header>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {tabs.map((item) => <button key={item.id} onClick={() => setTab(item.id)}
          className={buttonClass + (tab === item.id ? " bg-primary text-primary-foreground" : " border border-border bg-card")}>
          <item.icon className="h-4 w-4" />{item.label}
        </button>)}
      </div>

      {message && <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">{message}</div>}

      {tab === "visual" && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <section className="rounded-2xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <div><h3 className="font-black">معاينة شاشة الزبون</h3><p className="text-xs text-muted-foreground">اضغط مطولاً على أي عنصر لفتح خيارات التعديل.</p></div>
              <span className="flex items-center gap-1 text-xs text-muted-foreground"><Smartphone className="h-4 w-4" /> Android / Web</span>
            </div>
            <div className="mx-auto max-w-md rounded-[30px] border-[7px] border-slate-800 bg-background p-4 shadow-xl">
              <div className="mb-4 rounded-2xl bg-primary/10 p-4 text-center"><b>ممنون</b><p className="mt-1 text-xs text-muted-foreground">اطلب الآن، ادفع للمزوّد مباشرة</p></div>
              <div className="grid grid-cols-2 gap-3">
                {elements.filter((item) => item.placement_key === "home.customer.actions").map((item) => {
                  const visual = item.element_key === selected?.element_key ? draft : item.published_config ?? {};
                  const image = visual.image_url || item.image_url;
                  const width = Number(visual.width_px ?? item.width_px ?? 48);
                  const height = Number(visual.height_px ?? item.height_px ?? 48);
                  return <button key={item.element_key} onContextMenu={(event) => { event.preventDefault(); openEditor(item); }}
                    onPointerDown={() => startHold(item)} onPointerUp={clearHold} onPointerLeave={clearHold}
                    onClick={() => openEditor(item)}
                    className={`relative min-h-32 rounded-2xl border-2 p-3 text-right transition ${selected?.element_key === item.element_key ? "border-primary bg-primary/5" : "border-border bg-card"}`}>
                    <div className="mb-2 grid h-16 place-items-center overflow-hidden rounded-xl bg-muted">
                      {image ? <img src={image} alt="" style={{ width, height, objectFit: "contain" }} /> : <ImagePlus className="h-8 w-8 text-muted-foreground" />}
                    </div>
                    <b className="block text-sm">{visual.title ?? item.title ?? item.label}</b>
                    <span className="mt-1 block text-[11px] text-muted-foreground">{visual.subtitle ?? item.subtitle}</span>
                    <span className="absolute left-2 top-2 rounded-full bg-background/90 px-2 py-1 text-[9px]">تعديل</span>
                  </button>;
                })}
              </div>
              <div className="mt-4 rounded-xl border border-dashed border-border p-3 text-center text-xs text-muted-foreground">المعاينة توضح الشكل فقط؛ وظيفة الزر الأصلية تبقى مرتبطة بهويته الثابتة.</div>
            </div>
          </section>

          <aside className="rounded-2xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between"><h3 className="font-black">خصائص العنصر</h3>
              {selected && <button onClick={() => setSelected(null)} aria-label="إغلاق"><X className="h-4 w-4" /></button>}</div>
            {!selected ? <p className="text-sm text-muted-foreground">اختار عنصراً من المعاينة أو من القائمة حتى تعدّل صورته وحجمه.</p> : <>
              <div className="mb-3 rounded-xl bg-muted p-3"><b className="text-sm">{selected.label}</b><p className="mt-1 text-[11px] text-muted-foreground">المعرّف الوظيفي: {selected.action_key}</p></div>
              <label className="mb-1 block text-xs font-bold">النص الرئيسي</label><input className={inputClass + " mb-3"} value={draft.title ?? ""} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              <label className="mb-1 block text-xs font-bold">النص الثانوي</label><input className={inputClass + " mb-3"} value={draft.subtitle ?? ""} onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })} />
              <label className="mb-1 block text-xs font-bold">رابط الصورة</label><input className={inputClass + " mb-2"} dir="ltr" value={draft.image_url ?? ""} onChange={(e) => setDraft({ ...draft, image_url: e.target.value })} placeholder="https://..." />
              <label className={buttonClass + " mb-3 w-full cursor-pointer border border-border"}><ImagePlus className="h-4 w-4" />{uploading ? "جاري رفع الصورة..." : "اختيار صورة من الجهاز"}<input type="file" accept="image/*" className="hidden" disabled={uploading} onChange={(e) => void uploadImage(e.target.files?.[0])} /></label>
              <label className="mb-1 block text-xs font-bold">رمز تعبيري بديل (اختياري)</label><input className={inputClass + " mb-3"} value={draft.icon_name ?? ""} onChange={(e) => setDraft({ ...draft, icon_name: e.target.value })} placeholder="🚗" />
              <div className="mb-3 grid grid-cols-2 gap-2">
                <div><label className="mb-1 block text-xs font-bold">العرض px</label><input type="number" min="16" max="600" className={inputClass} value={draft.width_px ?? 64} onChange={(e) => setDraft({ ...draft, width_px: Number(e.target.value) })} /></div>
                <div><label className="mb-1 block text-xs font-bold">الارتفاع px</label><input type="number" min="16" max="600" className={inputClass} value={draft.height_px ?? 64} onChange={(e) => setDraft({ ...draft, height_px: Number(e.target.value) })} /></div>
              </div>
              <label className="mb-1 block text-xs font-bold">ترتيب الظهور</label><input type="number" className={inputClass + " mb-3"} value={draft.sort_order ?? 0} onChange={(e) => setDraft({ ...draft, sort_order: Number(e.target.value) })} />
              <div className="mb-3 rounded-xl bg-muted p-3 text-xs"><b>المعاينة الفورية</b><div className="mt-2 flex items-center gap-3"><div className="grid h-20 w-20 place-items-center rounded-xl bg-background">{draft.image_url ? <img src={draft.image_url} alt="" style={{ width: Number(draft.width_px) || 64, height: Number(draft.height_px) || 64, objectFit: "contain" }} /> : <ImagePlus className="h-7 w-7" />}</div><div><b>{draft.title || selected.label}</b><p className="text-muted-foreground">{draft.subtitle}</p></div></div></div>
              <button disabled={saving} onClick={() => void saveDraft()} className={buttonClass + " mb-2 w-full border border-border"}><Save className="h-4 w-4" />حفظ كمسودة</button>
              <button disabled={saving} onClick={() => void publishElement()} className={buttonClass + " w-full bg-primary text-primary-foreground"}><Check className="h-4 w-4" />{selectedPublished ? "نشر التعديلات" : "نشر العنصر"}</button>
            </>}
          </aside>
        </div>
      )}

      {tab === "sections" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
            <h3 className="font-black">إنشاء قسم أو جدول جديد</h3>
            <input className={inputClass} placeholder="اسم القسم" value={sectionTitle} onChange={(e) => setSectionTitle(e.target.value)} />
            <select className={inputClass} value={sectionType} onChange={(e) => setSectionType(e.target.value as any)}><option value="table">جدول بيانات</option><option value="banner">بطاقة / إعلان</option></select>
            <select className={inputClass} value={sectionPlacement} onChange={(e) => setSectionPlacement(e.target.value)}><option value="home.customer.top">أعلى الصفحة الرئيسية</option><option value="home.customer.content">بعد أزرار الطلب</option><option value="home.customer.after_stats">أسفل الإحصائيات</option></select>
            <label className="text-xs font-bold">أسماء الأعمدة (افصل بينها بعلامة |)</label>
            <input className={inputClass} value={sectionColumns} onChange={(e) => setSectionColumns(e.target.value)} placeholder="العنوان | السعر | التفاصيل" />
            <label className="text-xs font-bold">صفوف الجدول (كل صف بسطر، وافصل الخانات بعلامة |)</label>
            <textarea className={inputClass + " min-h-28"} value={sectionRows} onChange={(e) => setSectionRows(e.target.value)} placeholder={"مثال | 5000 | تفاصيل\nمثال آخر | 7000 | تفاصيل"} />
            <label className="text-xs font-bold">ترتيب القسم</label><input type="number" className={inputClass} value={sectionSortOrder} onChange={(e) => setSectionSortOrder(Number(e.target.value))} />
            <button onClick={() => void createSection()} className={buttonClass + " w-full bg-primary text-primary-foreground"}><Plus className="h-4 w-4" />إنشاء كمسودة</button>
          </section>
          <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
            <h3 className="font-black">الأقسام المنشأة</h3>
            {sections.length === 0 && <p className="text-sm text-muted-foreground">ماكو أقسام مضافة بعد.</p>}
            {sections.map((section) => <div key={section.id} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
              <div className="flex gap-1"><button className={buttonClass + " border border-border px-2"} onClick={() => void moveSection(section, -1)}><ChevronUp className="h-4 w-4" /></button><button className={buttonClass + " border border-border px-2"} onClick={() => void moveSection(section, 1)}><ChevronDown className="h-4 w-4" /></button></div>
              <div><b className="text-sm">{section.title}</b><p className="text-xs text-muted-foreground">{section.section_type} · {section.placement_key} · الترتيب {section.sort_order}</p></div>
              <div className="flex gap-2"><button className={buttonClass + " border border-border"} onClick={() => setMessage(JSON.stringify(section.config, null, 2))}><Eye className="h-4 w-4" />معاينة البيانات</button>
                {!section.is_published && <button className={buttonClass + " bg-primary text-primary-foreground"} onClick={() => void publishSection(section)}>نشر</button>}</div>
            </div>)}
          </section>
        </div>
      )}

      {tab === "campaigns" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
            <h3 className="font-black">إنشاء استطلاع أو مسابقة</h3>
            <select className={inputClass} value={campaignType} onChange={(e) => setCampaignType(e.target.value as any)}><option value="poll">استطلاع رأي</option><option value="contest">مسابقة تصويت</option></select>
            <input className={inputClass} placeholder="عنوان الاستطلاع أو المسابقة" value={campaignTitle} onChange={(e) => setCampaignTitle(e.target.value)} />
            <textarea className={inputClass} placeholder="وصف مختصر" value={campaignDescription} onChange={(e) => setCampaignDescription(e.target.value)} />
            <label className="text-xs font-bold">الخيارات (كل خيار بسطر)</label>
            <textarea className={inputClass + " min-h-28"} value={campaignOptions} onChange={(e) => setCampaignOptions(e.target.value)} />
            <select className={inputClass} value={campaignPlacement} onChange={(e) => setCampaignPlacement(e.target.value)}><option value="home.customer.top">أعلى الصفحة الرئيسية</option><option value="home.customer.content">بعد أزرار الطلب</option><option value="home.customer.after_stats">أسفل الإحصائيات</option></select>
            <label className="text-xs font-bold">ترتيب الاستطلاع أو المسابقة</label><input type="number" className={inputClass} value={campaignSortOrder} onChange={(e) => setCampaignSortOrder(Number(e.target.value))} />
            <div className="grid grid-cols-2 gap-2"><div><label className="text-xs">بداية النشر</label><input type="datetime-local" className={inputClass} value={campaignStarts} onChange={(e) => setCampaignStarts(e.target.value)} /></div><div><label className="text-xs">نهاية المشاركة</label><input type="datetime-local" className={inputClass} value={campaignEnds} onChange={(e) => setCampaignEnds(e.target.value)} /></div></div>
            <button disabled={saving} onClick={() => void createCampaign()} className={buttonClass + " w-full bg-primary text-primary-foreground"}><Plus className="h-4 w-4" />إنشاء كمسودة</button>
          </section>
          <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
            <h3 className="font-black">إدارة النتائج والنشر</h3>
            {campaigns.length === 0 && <p className="text-sm text-muted-foreground">ماكو استطلاعات أو مسابقات حالياً.</p>}
            {campaigns.map((campaign) => <div key={campaign.id} className="space-y-2 rounded-xl border border-border p-3">
              <div className="flex items-center justify-between gap-2"><div className="flex gap-1"><button className={buttonClass + " border border-border px-2"} onClick={() => void moveCampaign(campaign, -1)}><ChevronUp className="h-4 w-4" /></button><button className={buttonClass + " border border-border px-2"} onClick={() => void moveCampaign(campaign, 1)}><ChevronDown className="h-4 w-4" /></button></div><b className="text-sm">{campaign.title}</b><span className="rounded-full bg-muted px-2 py-1 text-[10px]">{campaign.status === "published" ? "منشور" : campaign.status}</span></div>
              <p className="text-xs text-muted-foreground">{campaign.campaign_type === "poll" ? "استطلاع" : "مسابقة"} · {campaign.placement_key}</p>
              <div className="flex flex-wrap gap-2">{campaign.status === "draft" && <button className={buttonClass + " bg-primary text-primary-foreground"} onClick={() => void publishCampaign(campaign)}>نشر الآن</button>}
                <button className={buttonClass + " border border-border"} onClick={() => void loadResults(campaign)}><Vote className="h-4 w-4" />عرض النتائج</button></div>
              {resultRows[campaign.id] && <div className="space-y-1 rounded-lg bg-muted p-2">{(campaign.app_campaign_options ?? []).map((option) => {
                const count = Number(resultRows[campaign.id].find((row) => row.option_id === option.id)?.vote_count ?? 0);
                return <div key={option.id} className="flex justify-between text-xs"><span>{option.label}</span><b>{count} صوت</b></div>;
              })}</div>}
            </div>)}
          </section>
        </div>
      )}
    </div>
  );
}
