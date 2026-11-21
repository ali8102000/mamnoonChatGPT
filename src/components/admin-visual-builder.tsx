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
  { id: "visual", label: "محرر الأيقونات والواجهة", icon: LayoutTemplate },
  { id: "sections", label: "الأقسام والجداول", icon: Table2 },
  { id: "campaigns", label: "الاستطلاعات والمسابقات", icon: Trophy },
  { id: "legal", label: "الخصوصية والشروط", icon: Check },
] as const;

export default function AdminVisualBuilder() {
  const [tab, setTab] = useState<(typeof tabs)[number]["id"]>("visual");
  const [elements, setElements] = useState<UiElement[]>([]);
  const [sections, setSections] = useState<ContentSection[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [legalPages, setLegalPages] = useState<any[]>([]);
  const [legalDrafts, setLegalDrafts] = useState<Record<string, { title: string; body: string; is_published: boolean }>>({});
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
  const [campaignImageFile, setCampaignImageFile] = useState<File | null>(null);
  const [campaignPopupSeconds, setCampaignPopupSeconds] = useState(5);
  const [resultRows, setResultRows] = useState<Record<string, any[]>>({});
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragState = useRef<{ key: string; pointerX: number; pointerY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const suppressPreviewClick = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [ui, content, campaign, legal] = await Promise.all([
      (supabase as any).from("app_ui_elements").select("*").order("sort_order"),
      (supabase as any).from("app_content_sections").select("*").order("sort_order"),
      (supabase as any).from("app_campaigns").select("*, app_campaign_options(id,label,sort_order)").order("sort_order").order("created_at", { ascending: false }),
      (supabase as any).from("app_legal_pages").select("slug,title,body,is_published").order("slug"),
    ]);
    if (ui.error) setMessage("تعذر تحميل عناصر الواجهة: " + ui.error.message);
    else setElements((ui.data ?? []) as UiElement[]);
    if (!content.error) setSections((content.data ?? []) as ContentSection[]);
    if (!campaign.error) setCampaigns((campaign.data ?? []) as Campaign[]);
    if (!legal.error) {
      const pages = legal.data ?? [];
      setLegalPages(pages);
      setLegalDrafts(Object.fromEntries(pages.map((page: any) => [page.slug, { title: page.title, body: page.body ?? "", is_published: Boolean(page.is_published) }])));
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const saveLegalPage = async (slug: "privacy" | "terms") => {
    const draft = legalDrafts[slug];
    if (!draft?.title.trim() || !draft.body.trim()) {
      setMessage("اكتب عنوان ومحتوى الصفحة قبل الحفظ."); return;
    }
    setSaving(true);
    const { error } = await (supabase as any).from("app_legal_pages").upsert({
      slug, title: draft.title.trim(), body: draft.body.trim(),
      is_published: draft.is_published, updated_at: new Date().toISOString(),
    }, { onConflict: "slug" });
    setMessage(error ? "تعذر حفظ الصفحة القانونية: " + error.message : "تم حفظ الصفحة القانونية ونشر إعدادها.");
    if (!error) await load();
    setSaving(false);
  };

  const startHold = (element: UiElement) => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(() => openEditor(element), 550);
  };
  const clearHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };
  const beginPreviewDrag = (event: React.PointerEvent<HTMLButtonElement>, element: UiElement) => {
    openEditor(element);
    const config = element.published_config ?? {};
    dragState.current = {
      key: element.element_key,
      pointerX: event.clientX,
      pointerY: event.clientY,
      originX: Number(config.position_x_px) || 0,
      originY: Number(config.position_y_px) || 0,
      moved: false,
    };
    suppressPreviewClick.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const movePreviewDrag = (event: React.PointerEvent<HTMLButtonElement>, element: UiElement) => {
    const drag = dragState.current;
    if (!drag || drag.key !== element.element_key) return;
    const dx = event.clientX - drag.pointerX;
    const dy = event.clientY - drag.pointerY;
    if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
    if (!drag.moved) return;
    setDraft((current) => ({
      ...current,
      position_x_px: Math.round(Math.max(-140, Math.min(140, drag.originX + dx))),
      position_y_px: Math.round(Math.max(-180, Math.min(180, drag.originY + dy))),
    }));
  };
  const endPreviewDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (dragState.current?.moved) suppressPreviewClick.current = true;
    dragState.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const openEditor = (element: UiElement) => {
    setSelected(element);
    setDraft({ ...(element.config ?? {}), title: element.config?.title ?? element.title ?? "", subtitle: element.config?.subtitle ?? element.subtitle ?? "",
      image_url: element.config?.image_url ?? element.image_url ?? "",
      icon_name: element.config?.icon_name ?? element.icon_name ?? "",
      width_px: element.config?.width_px ?? element.width_px ?? 64,
      height_px: element.config?.height_px ?? element.height_px ?? 64,
      image_scale: element.config?.image_scale ?? element.published_config?.image_scale ?? 1,
      content_scale: element.config?.content_scale ?? element.published_config?.content_scale ?? 1,
      content_position_x_px: element.config?.content_position_x_px ?? element.published_config?.content_position_x_px ?? 0,
      content_position_y_px: element.config?.content_position_y_px ?? element.published_config?.content_position_y_px ?? 0,
      element_scale: element.config?.element_scale ?? element.published_config?.element_scale ?? 1,
      card_height_px: element.config?.card_height_px ?? element.published_config?.card_height_px ?? 145,
      card_padding_px: element.config?.card_padding_px ?? element.published_config?.card_padding_px ?? 10,
      border_radius_px: element.config?.border_radius_px ?? element.published_config?.border_radius_px ?? 20,
      title_size_px: element.config?.title_size_px ?? element.published_config?.title_size_px ?? 16,
      subtitle_size_px: element.config?.subtitle_size_px ?? element.published_config?.subtitle_size_px ?? 11,
      title_color: element.config?.title_color ?? element.published_config?.title_color ?? "",
      subtitle_color: element.config?.subtitle_color ?? element.published_config?.subtitle_color ?? "",
      background_color: element.config?.background_color ?? element.published_config?.background_color ?? "",
      content_alignment: element.config?.content_alignment ?? element.published_config?.content_alignment ?? "right",
      content_direction: element.config?.content_direction ?? element.published_config?.content_direction ?? "column",
      icon_scale: element.config?.icon_scale ?? element.published_config?.icon_scale ?? 1,
      is_hidden: element.config?.is_hidden ?? element.published_config?.is_hidden ?? false,
      sort_order: element.config?.sort_order ?? element.sort_order ?? 0,
      position_x_px: element.config?.position_x_px ?? element.published_config?.position_x_px ?? 0,
      position_y_px: element.config?.position_y_px ?? element.published_config?.position_y_px ?? 0,
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
      config: published, published_config: published, updated_at: new Date().toISOString(),
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
      setDraft((current) => ({ ...current, image_url: data.publicUrl, icon_name: "" }));
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
    let campaignImageUrl: string | null = null;
    let campaignImagePath: string | null = null;
    if (campaignImageFile) {
      if (!campaignImageFile.type.startsWith("image/") || campaignImageFile.size > 8 * 1024 * 1024) { setMessage("صورة الاستطلاع لازم تكون صورة وحجمها أقل من 8 ميغابايت."); setSaving(false); return; }
      campaignImagePath = `campaign-popups/${Date.now()}-${campaignImageFile.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
      const upload = await supabase.storage.from("app-visuals").upload(campaignImagePath, campaignImageFile, { upsert: false, contentType: campaignImageFile.type });
      if (upload.error) { setMessage("تعذر رفع صورة الاستطلاع: " + upload.error.message); setSaving(false); return; }
      campaignImageUrl = supabase.storage.from("app-visuals").getPublicUrl(campaignImagePath).data.publicUrl;
    }
    const { data, error } = await (supabase as any).from("app_campaigns").insert({
      campaign_type: campaignType, title: campaignTitle.trim(),
      description: campaignDescription.trim() || null, placement_key: campaignPlacement,
      image_url: campaignImageUrl, popup_display_seconds: Math.max(1, Math.min(60, Number(campaignPopupSeconds) || 5)),
      starts_at: campaignStarts ? new Date(campaignStarts).toISOString() : null,
      ends_at: campaignEnds ? new Date(campaignEnds).toISOString() : null,
      sort_order: Number(campaignSortOrder) || 0,
      status: "draft", result_visibility: "public",
    }).select("id").single();
    if (error || !data?.id) { if (campaignImagePath) await supabase.storage.from("app-visuals").remove([campaignImagePath]); setMessage("تعذر إنشاء الاستطلاع: " + (error?.message ?? "خطأ غير معروف")); }
    else {
      const { error: optionError } = await (supabase as any).from("app_campaign_options").insert(
        options.map((label, index) => ({ campaign_id: data.id, label, sort_order: index + 1 })),
      );
      if (optionError) setMessage("تم إنشاء الحملة لكن تعذر حفظ الخيارات: " + optionError.message);
      else {
        setCampaignTitle(""); setCampaignDescription(""); setCampaignSortOrder(0); setCampaignImageFile(null);
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

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
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
              <div><h3 className="font-black">معاينة شاشة الزبون</h3><p className="text-xs text-muted-foreground">اختار أيقونة السيارة أو أي عنصر لتعديل صورته وحجمه ونشر التغيير.</p></div>
              <span className="flex items-center gap-1 text-xs text-muted-foreground"><Smartphone className="h-4 w-4" /> Android / Web</span>
            </div>
            <div className="mx-auto max-w-md rounded-[30px] border-[7px] border-slate-800 bg-background p-4 shadow-xl">
              <div className="mb-4 rounded-2xl bg-primary/10 p-4 text-center"><b>ممنون</b><p className="mt-1 text-xs text-muted-foreground">اطلب الآن، ادفع للمزوّد مباشرة</p></div>
              <p className="mb-2 text-[11px] text-muted-foreground">اسحب البطاقة داخل المعاينة لتغيير مكانها، أو اضبط الإزاحة بالأرقام. المعاينة تتحدث فورياً قبل الحفظ والنشر.</p>
              <div className="grid grid-cols-2 gap-3">
                {elements.filter((item) => item.placement_key === "home.customer.actions").map((item) => {
                  const visual = item.element_key === selected?.element_key ? draft : item.published_config ?? {};
                  const image = visual.image_url || item.image_url;
                  const width = Number(visual.width_px ?? item.width_px ?? 48);
                  const height = Number(visual.height_px ?? item.height_px ?? 48);
                  return <button key={item.element_key} onContextMenu={(event) => { event.preventDefault(); openEditor(item); }}
                    onPointerDown={(event) => { clearHold(); beginPreviewDrag(event, item); }}
                    onPointerMove={(event) => movePreviewDrag(event, item)}
                    onPointerUp={endPreviewDrag}
                    onPointerCancel={endPreviewDrag}
                    onClick={() => { if (suppressPreviewClick.current) { suppressPreviewClick.current = false; return; } openEditor(item); }}
                    style={{ touchAction: "none", cursor: "grab", translate: `${Number(visual.position_x_px) || 0}px ${Number(visual.position_y_px) || 0}px`, transform: `scale(${Math.max(0.6, Math.min(1.6, Number(visual.element_scale) || 1))})` }}
                    className={`relative min-h-32 rounded-2xl border-2 p-3 text-right transition ${selected?.element_key === item.element_key ? "border-primary bg-primary/5" : "border-border bg-card"}`}>
                    <div className={`mb-2 grid h-16 place-items-center overflow-hidden bg-muted ${item.element_key === "home_customer_service" ? "rounded-none p-0" : "rounded-xl"}`}>
                      {image ? <img src={image} alt="" style={item.element_key === "home_customer_service"
                        ? { width: "100%", height: "100%", objectFit: "cover", transform: `translate(${Number(visual.content_position_x_px) || 0}px, ${Number(visual.content_position_y_px) || 0}px) scale(${(Number(visual.image_scale) || 1) * (Number(visual.content_scale) || 1)})` }
                        : { width, height, objectFit: "contain", transform: `translate(${Number(visual.content_position_x_px) || 0}px, ${Number(visual.content_position_y_px) || 0}px) scale(${Number(visual.content_scale) || 1})` }} /> : <ImagePlus className="h-8 w-8 text-muted-foreground" />}
                    </div>
                    <b className="block text-sm">{visual.title ?? item.title ?? item.label}</b>
                    <span className="mt-1 block text-[11px] text-muted-foreground">{visual.subtitle ?? item.subtitle}</span>
                    <span className="absolute left-2 top-2 rounded-full bg-background/90 px-2 py-1 text-[9px]">تعديل</span>
                  </button>;
                })}
              </div>
              <div className="mt-5">
                <h4 className="mb-2 text-sm font-black">محرر أيقونات فئات السيارات</h4><p className="mb-2 text-[11px] text-muted-foreground">فئات التكسي: اقتصادي، متميز، فاخر. افتح أي فئة وارفع صورة سيارة واقعية من جهازك أو ضع رابطها، واضبط العرض والارتفاع ثم احفظ وانشر؛ الصورة المنشورة تظهر في الويب والأندرويد.</p>
                <div className="grid grid-cols-3 gap-2">
                  {elements.filter((item) => item.element_type === "vehicle").map((item) => {
                    const visual = item.element_key === selected?.element_key ? draft : item.published_config ?? {};
                    return <button key={item.element_key} onContextMenu={(event) => { event.preventDefault(); openEditor(item); }}
                      onPointerDown={() => startHold(item)} onPointerUp={clearHold} onPointerLeave={clearHold}
                      onClick={() => openEditor(item)}
                      className={`rounded-xl border-2 p-2 text-center ${selected?.element_key === item.element_key ? "border-primary bg-primary/5" : "border-border"}`}>
                      <div className="grid h-14 place-items-center rounded-lg bg-muted">
                        {visual.image_url ? <img src={visual.image_url} alt="" style={{ width: Number(visual.width_px) || 52, height: Number(visual.height_px) || 52, objectFit: "contain" }} /> : <span className="text-2xl">{visual.icon_name || "🚘"}</span>}
                      </div>
                      <span className="mt-1 block text-[10px] font-bold">{visual.title || item.title || item.label}</span>
                    </button>;
                  })}
                </div>
              </div>
              <div className="mt-4 rounded-xl border border-dashed border-border p-3 text-center text-xs text-muted-foreground">المعاينة توضح الشكل فقط؛ وظيفة الزر الأصلية تبقى مرتبطة بهويته الثابتة.</div>
              <div className="mt-4 space-y-2">
                <h3 className="font-black text-sm">باقي عناصر التطبيق المسجلة</h3>
                <p className="text-[11px] text-muted-foreground">تگدر تختار أيقونات وأنواع السيارات من هنا وتعدّل صورتها واسمها وحجمها وترتيبها.</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {elements.filter((item) => item.placement_key !== "home.customer.actions").map((item) => <button key={item.element_key} type="button" onClick={() => openEditor(item)} className={buttonClass + " justify-between border border-border bg-background text-right"}>
                    <span className="min-w-0"><b className="block text-xs">{item.label}</b><span className="block text-[10px] text-muted-foreground">{item.screen_key} · {item.element_key}</span></span>
                    <span className="text-primary">تعديل ←</span>
                  </button>)}
                </div>
              </div>
            </div>
          </section>

          <aside className="rounded-2xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between"><h3 className="font-black">خصائص العنصر</h3>
              {selected && <button onClick={() => setSelected(null)} aria-label="إغلاق"><X className="h-4 w-4" /></button>}</div>
            {!selected ? <p className="text-sm text-muted-foreground">اختار أي عنصر من المعاينة أو قائمة العناصر حتى تبدّل صورته واسمه وحجمه وإعداداته ثم تنشرها.</p> : <>
              <div className="mb-3 rounded-xl bg-muted p-3"><b className="text-sm">{selected.label}</b><p className="mt-1 text-[11px] text-muted-foreground">المعرّف الوظيفي: {selected.action_key}</p></div>
              <label className="mb-1 block text-xs font-bold">النص الرئيسي</label><input className={inputClass + " mb-3"} value={draft.title ?? ""} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              <label className="mb-1 block text-xs font-bold">النص الثانوي</label><input className={inputClass + " mb-3"} value={draft.subtitle ?? ""} onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })} />
              <label className="mb-1 block text-xs font-bold">رابط الصورة</label><input className={inputClass + " mb-2"} dir="ltr" value={draft.image_url ?? ""} onChange={(e) => setDraft({ ...draft, image_url: e.target.value, icon_name: e.target.value ? "" : draft.icon_name })} placeholder="https://..." />
              <label className={buttonClass + " mb-3 w-full cursor-pointer border border-border"}><ImagePlus className="h-4 w-4" />{uploading ? "جاري رفع الصورة..." : "اختيار صورة من الجهاز"}<input type="file" accept="image/*" className="hidden" disabled={uploading} onChange={(e) => void uploadImage(e.target.files?.[0])} /></label>
              <label className="mb-1 block text-xs font-bold">رمز تعبيري بديل (اختياري)</label><input className={inputClass + " mb-3"} value={draft.icon_name ?? ""} onChange={(e) => setDraft({ ...draft, icon_name: e.target.value, image_url: e.target.value ? "" : draft.image_url })} placeholder="🚗" />
              <div className="mb-3 grid grid-cols-2 gap-2">
                <div><label className="mb-1 block text-xs font-bold">عرض الحاوية px</label><input type="number" min="16" max="600" className={inputClass} value={draft.width_px ?? 64} onChange={(e) => setDraft({ ...draft, width_px: Number(e.target.value) })} /></div>
                <div><label className="mb-1 block text-xs font-bold">ارتفاع الحاوية px</label><input type="number" min="16" max="600" className={inputClass} value={draft.height_px ?? 64} onChange={(e) => setDraft({ ...draft, height_px: Number(e.target.value) })} /></div>
              </div>
              <label className="mb-1 block text-xs font-bold">تكبير / تصغير الصورة داخل الحاوية</label>
              <input type="range" min="0.65" max="1.8" step="0.05" className="mb-1 w-full accent-primary" value={Number(draft.image_scale) || 1} onChange={(e) => setDraft({ ...draft, image_scale: Number(e.target.value) })} />
              <div className="mb-3 flex justify-between text-[11px] text-muted-foreground"><span>تصغير</span><b>{Math.round((Number(draft.image_scale) || 1) * 100)}%</b><span>تكبير</span></div>
              <label className="mb-1 block text-xs font-bold">حجم ومكان المحتوى داخل المربع</label>
              <input type="range" min="0.5" max="2.5" step="0.05" className="mb-1 w-full accent-primary" value={Number(draft.content_scale) || 1} onChange={(e) => setDraft({ ...draft, content_scale: Number(e.target.value) })} />
              <div className="mb-2 flex justify-between text-[11px] text-muted-foreground"><span>أصغر</span><b>{Math.round((Number(draft.content_scale) || 1) * 100)}%</b><span>أكبر</span></div>
              <div className="mb-3 grid grid-cols-2 gap-2">
                <label className="text-xs font-bold">تحريك المحتوى يمين / يسار px<input type="number" min="-100" max="100" className={inputClass + " mt-1"} value={draft.content_position_x_px ?? 0} onChange={(e) => setDraft({ ...draft, content_position_x_px: Math.max(-100, Math.min(100, Number(e.target.value) || 0)) })} /></label>
                <label className="text-xs font-bold">تحريك المحتوى أعلى / أسفل px<input type="number" min="-100" max="100" className={inputClass + " mt-1"} value={draft.content_position_y_px ?? 0} onChange={(e) => setDraft({ ...draft, content_position_y_px: Math.max(-100, Math.min(100, Number(e.target.value) || 0)) })} /></label>
              </div>
              <label className="mb-1 block text-xs font-bold">تكبير / تصغير العنصر بالكامل</label>
              <input type="range" min="0.6" max="1.6" step="0.05" className="mb-1 w-full accent-primary" value={Number(draft.element_scale) || 1} onChange={(e) => setDraft({ ...draft, element_scale: Number(e.target.value) })} />
              <div className="mb-3 flex justify-between text-[11px] text-muted-foreground"><span>60%</span><b>{Math.round((Number(draft.element_scale) || 1) * 100)}%</b><span>160%</span></div>
              <div className="mb-3 grid grid-cols-2 gap-2">
                <label className="text-xs font-bold">إزاحة المكان أفقياً px<input type="number" min="-140" max="140" className={inputClass + " mt-1"} value={draft.position_x_px ?? 0} onChange={(e) => setDraft({ ...draft, position_x_px: Math.max(-140, Math.min(140, Number(e.target.value) || 0)) })} /></label>
                <label className="text-xs font-bold">إزاحة المكان عمودياً px<input type="number" min="-180" max="180" className={inputClass + " mt-1"} value={draft.position_y_px ?? 0} onChange={(e) => setDraft({ ...draft, position_y_px: Math.max(-180, Math.min(180, Number(e.target.value) || 0)) })} /></label>
              </div>
              <label className="mb-1 block text-xs font-bold">ترتيب الظهور</label><input type="number" className={inputClass + " mb-3"} value={draft.sort_order ?? 0} onChange={(e) => setDraft({ ...draft, sort_order: Number(e.target.value) })} />
              <div className="mb-3 grid grid-cols-2 gap-2">
                <label className="text-xs font-bold">ارتفاع البطاقة px<input type="number" min="96" max="360" className={inputClass+" mt-1"} value={draft.card_height_px ?? 145} onChange={e=>setDraft({...draft,card_height_px:Number(e.target.value)})}/></label>
                <label className="text-xs font-bold">حشوة البطاقة px<input type="number" min="4" max="32" className={inputClass+" mt-1"} value={draft.card_padding_px ?? 10} onChange={e=>setDraft({...draft,card_padding_px:Number(e.target.value)})}/></label>
                <label className="text-xs font-bold">استدارة الزوايا px<input type="number" min="8" max="40" className={inputClass+" mt-1"} value={draft.border_radius_px ?? 20} onChange={e=>setDraft({...draft,border_radius_px:Number(e.target.value)})}/></label>
                <label className="text-xs font-bold">حجم عنوان الزر px<input type="number" min="10" max="28" className={inputClass+" mt-1"} value={draft.title_size_px ?? 16} onChange={e=>setDraft({...draft,title_size_px:Number(e.target.value)})}/></label>
                <label className="text-xs font-bold">حجم الوصف px<input type="number" min="8" max="20" className={inputClass+" mt-1"} value={draft.subtitle_size_px ?? 11} onChange={e=>setDraft({...draft,subtitle_size_px:Number(e.target.value)})}/></label>
                <label className="text-xs font-bold">تكبير الأيقونة<input type="number" min="0.5" max="2" step="0.05" className={inputClass+" mt-1"} value={draft.icon_scale ?? 1} onChange={e=>setDraft({...draft,icon_scale:Number(e.target.value)})}/></label>
              </div>
              <div className="mb-3 grid grid-cols-2 gap-2">
                <label className="text-xs font-bold">لون العنوان<input type="text" dir="ltr" placeholder="#222222" className={inputClass+" mt-1"} value={draft.title_color ?? ""} onChange={e=>setDraft({...draft,title_color:e.target.value})}/></label>
                <label className="text-xs font-bold">لون الوصف<input type="text" dir="ltr" placeholder="#777777" className={inputClass+" mt-1"} value={draft.subtitle_color ?? ""} onChange={e=>setDraft({...draft,subtitle_color:e.target.value})}/></label>
                <label className="text-xs font-bold col-span-2">لون خلفية البطاقة<input type="text" dir="ltr" placeholder="اتركه فارغاً للخلفية الافتراضية" className={inputClass+" mt-1"} value={draft.background_color ?? ""} onChange={e=>setDraft({...draft,background_color:e.target.value})}/></label>
              </div>
              <div className="mb-3 grid grid-cols-2 gap-2">
                <label className="text-xs font-bold">محاذاة المحتوى<select className={inputClass+" mt-1"} value={draft.content_alignment ?? "right"} onChange={e=>setDraft({...draft,content_alignment:e.target.value})}><option value="right">يمين</option><option value="center">وسط</option><option value="left">يسار</option></select></label>
                <label className="text-xs font-bold">اتجاه ترتيب العناصر<select className={inputClass+" mt-1"} value={draft.content_direction ?? "column"} onChange={e=>setDraft({...draft,content_direction:e.target.value})}><option value="column">عمودي</option><option value="row">أفقي</option></select></label>
              </div>
              <label className="mb-3 flex items-center gap-2 text-xs font-bold"><input type="checkbox" checked={Boolean(draft.is_hidden)} onChange={e=>setDraft({...draft,is_hidden:e.target.checked})}/> إخفاء هذا العنصر من واجهة المستخدم</label>
              <div className="mb-3 rounded-xl bg-muted p-3 text-xs"><b>المعاينة الفورية</b><div className="mt-2 flex items-center gap-3"><div className="grid h-20 w-20 place-items-center overflow-hidden rounded-none bg-background">{draft.image_url ? <img src={draft.image_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${(Number(draft.image_scale) || 1) * Math.max(0.6, Math.min(1.6, Number(draft.element_scale) || 1))})` }} /> : <ImagePlus className="h-7 w-7" />}</div><div><b>{draft.title || selected.label}</b><p className="text-muted-foreground">{draft.subtitle}</p></div></div></div>
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

      {tab === "legal" && (
        <div className="grid gap-4 lg:grid-cols-2">
          {(["privacy", "terms"] as const).map((slug) => {
            const draft = legalDrafts[slug] ?? { title: slug === "privacy" ? "سياسة الخصوصية" : "الشروط والأحكام", body: "", is_published: true };
            return <section key={slug} className="space-y-3 rounded-2xl border border-border bg-card p-4">
              <h3 className="font-black">{slug === "privacy" ? "سياسة الخصوصية" : "الشروط والأحكام"}</h3>
              <label className="block text-xs font-bold">عنوان الصفحة</label>
              <input className={inputClass} value={draft.title} onChange={(e) => setLegalDrafts((old) => ({ ...old, [slug]: { ...draft, title: e.target.value } }))} />
              <label className="block text-xs font-bold">نص الصفحة (اكتب فقراتك، وافصل بينها بسطر فارغ)</label>
              <textarea className={inputClass + " min-h-72"} value={draft.body} onChange={(e) => setLegalDrafts((old) => ({ ...old, [slug]: { ...draft, body: e.target.value } }))} placeholder="اكتب سياسة الخصوصية أو الشروط والأحكام هنا..." />
              <label className="flex items-center gap-2 text-xs font-bold"><input type="checkbox" checked={draft.is_published} onChange={(e) => setLegalDrafts((old) => ({ ...old, [slug]: { ...draft, is_published: e.target.checked } }))} /> الصفحة منشورة ومتاحة للمستخدمين</label>
              <button disabled={saving} onClick={() => void saveLegalPage(slug)} className={buttonClass + " w-full bg-primary text-primary-foreground"}><Save className="h-4 w-4" />حفظ ونشر الصفحة</button>
              <p className="text-[11px] leading-5 text-muted-foreground">التغييرات تظهر على الويب والأندرويد بعد تفعيل تحديث قاعدة البيانات والبناء الجديد. يُفضّل مراجعة النص قانونياً قبل نشره.</p>
            </section>;
          })}
        </div>
      )}

      {tab === "campaigns" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
            <h3 className="font-black">إنشاء استطلاع أو مسابقة</h3>
            <select className={inputClass} value={campaignType} onChange={(e) => setCampaignType(e.target.value as any)}><option value="poll">استطلاع رأي</option><option value="contest">مسابقة تصويت</option></select>
            <input className={inputClass} placeholder="عنوان الاستطلاع أو المسابقة" value={campaignTitle} onChange={(e) => setCampaignTitle(e.target.value)} />
            <textarea className={inputClass} placeholder="وصف مختصر" value={campaignDescription} onChange={(e) => setCampaignDescription(e.target.value)} />
            <label className="text-xs font-bold">صورة منبثقة للاستبيان أو السؤال (اختياري)</label>
            <input type="file" accept="image/*" className={inputClass} onChange={(e) => setCampaignImageFile(e.target.files?.[0] ?? null)} />
            {campaignImageFile && <p className="text-xs text-muted-foreground">الصورة المختارة: {campaignImageFile.name}</p>}
            <label className="text-xs font-bold">مدة ظهور الصورة المنبثقة (من ثانية إلى دقيقة)</label>
            <input type="number" min={1} max={60} className={inputClass} value={campaignPopupSeconds} onChange={(e) => setCampaignPopupSeconds(Math.max(1, Math.min(60, Number(e.target.value) || 1)))} />
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
