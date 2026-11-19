import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

type Banner = { id: string; image_url: string; target_category: "restaurant" | "hotel" | "store"; is_active: boolean; scroll_speed: number; badge_text: string | null; display_order: number };
const categoryCopy: Record<Banner["target_category"], { title: string; body: string }> = {
  restaurant: { title: "المطاعم", body: "تصفح المطاعم وقوائم الطعام والخدمات المتاحة." },
  hotel: { title: "الفنادق", body: "اكتشف الفنادق والغرف والخدمات المتاحة." },
  store: { title: "المتاجر", body: "تصفح المتاجر والمنتجات المعروضة." },
};

export function HomeCategoryCarousel() {
  const navigate = useNavigate();
  const [banners, setBanners] = useState<Banner[]>([]);
  const [index, setIndex] = useState(0);
  const resumeAt = useRef(0);
  const touchStartX = useRef<number | null>(null);
  const movedBySwipe = useRef(false);
  const refresh = useCallback(async () => {
    const { data, error } = await (supabase as any).from("home_carousel_banners")
      .select("id,image_url,target_category,is_active,scroll_speed,badge_text,display_order")
      .eq("is_active", true).order("display_order").order("created_at");
    if (!error) {
      setBanners(data ?? []);
      setIndex(0);
      resumeAt.current = 0;
    }
  }, []);
  useEffect(() => {
    void refresh();
    const channel = supabase.channel("home-category-banners")
      .on("postgres_changes", { event: "*", schema: "public", table: "home_carousel_banners" }, () => void refresh())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [refresh]);
  useEffect(() => {
    if (banners.length < 2 || index >= banners.length - 1) return;
    const delay = Math.max(1, Math.min(60, Number(banners[index]?.scroll_speed) || 5)) * 1000;
    const timer = window.setInterval(() => {
      if (Date.now() >= resumeAt.current) {
        setIndex(current => Math.min(current + 1, banners.length - 1));
      }
    }, delay);
    return () => window.clearInterval(timer);
  }, [banners, index]);
  if (!banners.length) return (
    <div className="flex aspect-[1.13/1] w-full items-center justify-center rounded-[24px] bg-[#173F35] p-4 text-center text-white">
      <div><div className="text-base font-black">اكتشف شركاء ممنون</div><p className="mt-2 text-xs font-bold opacity-90">المطاعم والفنادق والمتاجر المنشورة تظهر هنا</p></div>
    </div>
  );
  const current = banners[index];
  const openContent = () => {
    if (movedBySwipe.current) { movedBySwipe.current = false; return; }
    void navigate({ to: "/discover/$category", params: { category: current.target_category } });
  };
  const pause = () => { resumeAt.current = Date.now() + 5000; };
  return (
    <div className="relative aspect-[1.13/1] w-full overflow-hidden rounded-[24px] border border-border bg-transparent shadow-sm"
      onPointerDown={(event) => { pause(); touchStartX.current = event.clientX; movedBySwipe.current = false; }}
      onPointerUp={(event) => { if (touchStartX.current !== null) { const delta = event.clientX - touchStartX.current; if (Math.abs(delta) > 35 && banners.length > 1) { movedBySwipe.current = true; setIndex(currentIndex => Math.max(0, Math.min(banners.length - 1, currentIndex + (delta < 0 ? 1 : -1)))); } } touchStartX.current = null; pause(); }}
      onTouchStart={pause} onTouchEnd={pause} onMouseEnter={pause}>
      <button type="button" aria-label={`عرض ${categoryCopy[current.target_category].title}`} onClick={openContent} className="absolute inset-0 h-full w-full touch-pan-y">
        <img src={current.image_url} alt={categoryCopy[current.target_category].title} draggable={false} className="h-full w-full object-cover" />
        <span className="absolute bottom-3 right-3 rounded-full bg-black/60 px-3 py-2 text-xs font-black text-white">استعراض المحتويات والخدمات ←</span>
        {current.badge_text && <span className="absolute right-3 top-3 rounded-full bg-black/55 px-3 py-1 text-xs font-bold text-white">{current.badge_text}</span>}
      </button>
      {banners.length > 1 && <div className="pointer-events-none absolute bottom-3 left-0 right-0 flex justify-center gap-1.5">
        {banners.map((item, i) => <span key={item.id} className={`h-1.5 rounded-full ${i === index ? "w-5 bg-white" : "w-1.5 bg-white/60"}`} />)}
      </div>}
    </div>
  );
}
