import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

type Category = "restaurant" | "hotel" | "store";
type CategoryBanner = {
  id: string;
  image_url: string;
  target_category: Category;
  display_order: number;
  is_active: boolean;
  scroll_speed?: number | null;
  motion_direction?: "left" | "right" | "up" | "down" | null;
  motion_style?: "slide" | "fade" | "drop" | null;
  banner_title?: string | null;
  banner_description?: string | null;
};

const fallbackSlides = [
  { id: "restaurant", title: "المطاعم", subtitle: "مطاعم وكافيهات", category: "restaurant" as const, image_url: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1200&q=85" },
  { id: "hotel", title: "الفنادق", subtitle: "فنادق وشقق فندقية", category: "hotel" as const, image_url: "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=85" },
  { id: "mall", title: "المولات", subtitle: "مراكز تسوق وترفيه", category: "store" as const, image_url: "https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=1200&q=85" },
  { id: "shop", title: "المتاجر", subtitle: "محلات ومتاجر قريبة", category: "store" as const, image_url: "https://images.unsplash.com/photo-1472851294608-062f824d29cc?auto=format&fit=crop&w=1200&q=85" },
];

export function HomeCategoryCarousel() {
  const navigate = useNavigate();
  const [banners, setBanners] = useState<CategoryBanner[]>([]);
  const [index, setIndex] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const { data, error } = await (supabase as any)
        .from("home_carousel_banners")
        .select("id,image_url,target_category,display_order,is_active,scroll_speed,motion_direction,motion_style,banner_title,banner_description")
        .eq("is_active", true)
        .eq("banner_type", "category")
        .order("display_order")
        .order("created_at");
      if (active && !error) {
        setBanners(data ?? []);
        setIndex(0);
        setImageFailed(false);
      }
    };
    void refresh();
    const channel = supabase.channel("home-category-panorama-web")
      .on("postgres_changes", { event: "*", schema: "public", table: "home_carousel_banners" }, () => void refresh())
      .subscribe();
    return () => { active = false; void supabase.removeChannel(channel); };
  }, []);

  const slides = useMemo(() => banners.length ? banners.map((item) => ({
    id: item.id,
    image_url: item.image_url,
    category: item.target_category,
    title: item.banner_title || (item.target_category === "restaurant" ? "المطاعم" : item.target_category === "hotel" ? "الفنادق" : "المتاجر"),
    subtitle: item.banner_description || "اكتشف الأماكن والخدمات القريبة",
    scroll_speed: item.scroll_speed,
    motion_direction: item.motion_direction || "left",
    motion_style: item.motion_style || "slide",
  })) : fallbackSlides.map((item) => ({ ...item, scroll_speed: 5, motion_direction: "left" as const, motion_style: "slide" as const })), [banners]);

  const current = slides[index % Math.max(1, slides.length)];

  useEffect(() => {
    if (slides.length < 2) return;
    const seconds = Math.max(1, Math.min(60, Number(current?.scroll_speed) || 5));
    const timer = window.setTimeout(() => setIndex((value) => (value + 1) % slides.length), seconds * 1000);
    return () => window.clearTimeout(timer);
  }, [slides, index, current?.scroll_speed]);

  useEffect(() => { setImageFailed(false); }, [current?.id]);

  const animation = current?.motion_style === "fade"
    ? "mamnoon-category-fade .55s ease both"
    : current?.motion_style === "drop"
      ? "mamnoon-category-drop .55s ease both"
      : current?.motion_direction === "right"
        ? "mamnoon-category-right .55s ease both"
        : current?.motion_direction === "up"
          ? "mamnoon-category-up .55s ease both"
          : current?.motion_direction === "down"
            ? "mamnoon-category-down .55s ease both"
            : "mamnoon-category-left .55s ease both";

  return (
    <div className="relative h-full w-full overflow-hidden rounded-[18px] bg-[#173F35]" dir="rtl" style={{ touchAction: "pan-y" }}
      onPointerDown={(event) => { touchStart.current = { x: event.clientX, y: event.clientY }; try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* capture may be unavailable in embedded webviews */ } }}
      onPointerUp={(event) => { const start = touchStart.current; touchStart.current = null; if (!start || slides.length < 2) return; const dx = event.clientX - start.x; const dy = event.clientY - start.y; if (Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dy) * 1.15) { suppressClick.current = true; setIndex((value) => (value + (dx < 0 ? 1 : -1) + slides.length) % slides.length); window.setTimeout(() => { suppressClick.current = false; }, 450); } }}
      onPointerCancel={() => { touchStart.current = null; }}
      onLostPointerCapture={() => { touchStart.current = null; }}>
      <style>{`
        @keyframes mamnoon-category-fade { from { opacity: .2 } to { opacity: 1 } }
        @keyframes mamnoon-category-drop { from { opacity: .4; transform: translateY(-16px) scale(.99) } to { opacity: 1; transform: translateY(0) scale(1) } }
        @keyframes mamnoon-category-left { from { opacity: .6; transform: translateX(18px) } to { opacity: 1; transform: translateX(0) } }
        @keyframes mamnoon-category-right { from { opacity: .6; transform: translateX(-18px) } to { opacity: 1; transform: translateX(0) } }
        @keyframes mamnoon-category-up { from { opacity: .6; transform: translateY(18px) } to { opacity: 1; transform: translateY(0) } }
        @keyframes mamnoon-category-down { from { opacity: .6; transform: translateY(-18px) } to { opacity: 1; transform: translateY(0) } }
      `}</style>
      {current ? <button type="button" onClick={(event) => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); return; } void navigate({ to: "/discover/$category", params: { category: current.category } }); }} aria-label={`فتح قسم ${current.title}`} className="absolute inset-0 h-full w-full text-right">
        {!imageFailed && <img key={current.id} src={current.image_url} alt="" onError={() => setImageFailed(true)} className="absolute inset-0 h-full w-full object-cover" style={{ animation }} />}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-black/5" />
        <div className="absolute right-4 bottom-4 left-4 text-white">
          <div className="text-lg font-black drop-shadow">{current.title}</div>
          <div className="mt-1 text-xs font-bold text-white/90">{current.subtitle}</div>
        </div>
        <div className="absolute inset-x-0 bottom-2 flex items-center justify-center gap-1.5" aria-label={`الشريحة ${index + 1} من ${slides.length}`}>{slides.map((slide, dotIndex) => <button key={slide.id} type="button" onClick={(event) => { event.stopPropagation(); setIndex(dotIndex); }} aria-label={`عرض الشريحة ${dotIndex + 1}`} aria-current={dotIndex === index ? "true" : undefined} className={`h-1.5 rounded-full transition-all ${dotIndex === index ? "w-5 bg-white" : "w-1.5 bg-white/60"}`} />)}</div>
      </button> : null}
    </div>
  );
}
