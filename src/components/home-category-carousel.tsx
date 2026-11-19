import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

type CategoryTile = { category_key:string; vertical:"store"|"restaurant"|"grocery"; title:string; image_url:string; tile_width_px:number; tile_height_px:number; auto_scroll_seconds:number };
type Banner = { id: string; image_url: string; target_category: "restaurant" | "hotel" | "store"; banner_type: "category" | "poll" | "contest" | "ad"; target_campaign_id: string | null; is_active: boolean; scroll_speed: number; badge_text: string | null; display_order: number };
const categoryCopy: Record<Banner["target_category"], { title: string }> = {
  restaurant: { title: "المطاعم" }, hotel: { title: "الفنادق" }, store: { title: "المتاجر" },
};

export function HomeCategoryCarousel() {
  const navigate = useNavigate();
  const [banners, setBanners] = useState<Banner[]>([]);
  const [categoryTiles, setCategoryTiles] = useState<CategoryTile[]>([]);
  const categoryScrollRef = useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = useState(0);
  const resumeAt = useRef(0);
  const touchStartX = useRef<number | null>(null);
  const movedBySwipe = useRef(false);
  const refresh = useCallback(async () => {
    const { data, error } = await (supabase as any).from("home_carousel_banners")
      .select("id,image_url,target_category,banner_type,target_campaign_id,is_active,scroll_speed,badge_text,display_order")
      .eq("is_active", true).order("display_order").order("created_at");
    if (!error) { setBanners(data ?? []); setIndex(0); resumeAt.current = 0; }
  }, []);
  useEffect(() => {
    const loadCategories = async () => {
      const { data, error } = await (supabase as any).from("partner_catalog_categories")
        .select("category_key,vertical,title,image_url,tile_width_px,tile_height_px,auto_scroll_seconds")
        .eq("is_active", true).order("sort_order");
      if (!error) setCategoryTiles((data ?? []) as CategoryTile[]);
    };
    void loadCategories();
    const channel = supabase.channel("partner-category-ribbon")
      .on("postgres_changes", { event: "*", schema: "public", table: "partner_catalog_categories" }, () => void loadCategories()).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, []);
  useEffect(() => {
    if (categoryTiles.length < 2) return;
    const seconds = Math.max(1, Math.min(30, Number(categoryTiles[0]?.auto_scroll_seconds) || 5));
    const timer = window.setInterval(() => {
      const node = categoryScrollRef.current;
      if (!node || Date.now() < resumeAt.current) return;
      if (node.scrollLeft + node.clientWidth >= node.scrollWidth - 4) node.scrollTo({ left: 0, behavior: "smooth" });
      else node.scrollBy({ left: 116, behavior: "smooth" });
    }, seconds * 1000);
    return () => window.clearInterval(timer);
  }, [categoryTiles]);
  useEffect(() => {
    void refresh();
    const channel = supabase.channel("home-category-banners")
      .on("postgres_changes", { event: "*", schema: "public", table: "home_carousel_banners" }, () => void refresh()).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [refresh]);
  useEffect(() => {
    if (banners.length < 2) return;
    const delay = Math.max(1, Math.min(60, Number(banners[index]?.scroll_speed) || 5)) * 1000;
    const timer = window.setInterval(() => {
      if (Date.now() >= resumeAt.current) setIndex(current => (current + 1) % banners.length);
    }, delay);
    return () => window.clearInterval(timer);
  }, [banners, index]);
  const categoryStrip = categoryTiles.length ? <section dir="rtl" className="mb-3 space-y-2">
    <div className="flex items-center justify-between"><h3 className="text-xs font-black text-foreground">تسوّق حسب الفئة</h3><span className="text-[10px] text-muted-foreground">اسحب للتصفح</span></div>
    <div ref={categoryScrollRef} onTouchStart={pause} onMouseDown={pause} className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
      {categoryTiles.map(tile=><button key={tile.category_key} type="button" onClick={()=>void navigate({to:"/discover/$category",params:{category:tile.vertical==="grocery"?"grocery":tile.vertical+"-"+tile.category_key}})} className="shrink-0 flex flex-col items-center gap-1.5 rounded-xl border border-border bg-card p-1.5 shadow-sm" style={{width:Math.max(64,Math.min(150,tile.tile_width_px)),minHeight:Math.max(82,Math.min(170,tile.tile_height_px+28))}}>
        <img src={tile.image_url} alt="" loading="lazy" className="rounded-lg object-cover" style={{width:Math.max(44,Math.min(120,tile.tile_width_px-12)),height:Math.max(44,Math.min(120,tile.tile_height_px-12))}}/>
        <span className="max-w-full truncate text-[10px] font-black">{tile.title}</span>
      </button>)}
    </div>
  </section> : null;
  if (!banners.length) return <>{categoryStrip}<div className="flex aspect-[1.13/1] w-full items-center justify-center rounded-[24px] bg-[#173F35] p-4 text-center text-white"><div><div className="text-base font-black">اكتشف شركاء ممنون</div><p className="mt-2 text-xs font-bold opacity-90">المطاعم والفنادق والمتاجر المنشورة تظهر هنا</p></div></div></>;
  const current = banners[index];
  const openContent = () => {
    if (movedBySwipe.current || current.banner_type === "ad") { movedBySwipe.current = false; return; }
    if ((current.banner_type === "poll" || current.banner_type === "contest") && current.target_campaign_id) {
      void navigate({ to: "/campaign/$id", params: { id: current.target_campaign_id } });
      return;
    }
    if (current.banner_type === "category") void navigate({ to: "/discover/$category", params: { category: current.target_category } });
  };
  const pause = () => { resumeAt.current = Date.now() + 5000; };
  const image = <img src={current.image_url} alt={current.banner_type === "ad" ? "إعلان" : current.banner_type === "poll" ? "استطلاع رأي" : current.banner_type === "contest" ? "مسابقة" : categoryCopy[current.target_category].title} draggable={false} className="h-full w-full object-cover" />;
  return <>{categoryStrip}<div className="relative aspect-[1.13/1] w-full overflow-hidden rounded-[24px] border border-border bg-transparent shadow-sm"
    onPointerDown={event => { pause(); touchStartX.current = event.clientX; movedBySwipe.current = false; }}
    onPointerUp={event => { if (touchStartX.current !== null) { const delta = event.clientX - touchStartX.current; if (Math.abs(delta) > 35 && banners.length > 1) { movedBySwipe.current = true; setIndex(currentIndex => (currentIndex + (delta < 0 ? 1 : -1) + banners.length) % banners.length); } } touchStartX.current = null; pause(); }}
    onTouchStart={pause} onTouchEnd={pause} onMouseEnter={pause}>
    {current.banner_type === "ad"
      ? <div role="img" aria-label="إعلان" className="absolute inset-0 h-full w-full">{image}</div>
      : <button type="button" aria-label={current.banner_type === "poll" ? "المشاركة في الاستطلاع" : current.banner_type === "contest" ? "فتح المسابقة" : `عرض ${categoryCopy[current.target_category].title}`} onClick={openContent} className="absolute inset-0 h-full w-full touch-pan-y">{image}<span className="absolute bottom-3 right-3 rounded-full bg-black/60 px-3 py-2 text-xs font-black text-white">{current.banner_type === "poll" ? "شارك برأيك ←" : current.banner_type === "contest" ? "شاهد المسابقة وشارك ←" : "استعراض المحتويات والخدمات ←"}</span></button>}
    {current.badge_text && <span className="absolute right-3 top-3 rounded-full bg-black/55 px-3 py-1 text-xs font-bold text-white pointer-events-none">{current.badge_text}</span>}
    {banners.length > 1 && <div className="pointer-events-none absolute bottom-3 left-0 right-0 flex justify-center gap-1.5">{banners.map((item,i)=><span key={item.id} className={`h-1.5 rounded-full ${i===index?"w-5 bg-white":"w-1.5 bg-white/60"}`} />)}</div>}
  </div></>;
}
