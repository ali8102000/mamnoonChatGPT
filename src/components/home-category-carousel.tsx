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
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const settleDirection = useRef<1 | -1 | 0>(0);

  useEffect(() => {
    if (slides.length < 2 || dragging || settleDirection.current !== 0) return;
    const seconds = Math.max(1, Math.min(60, Number(current?.scroll_speed) || 5));
    const timer = window.setTimeout(() => setIndex((value) => (value + 1) % slides.length), seconds * 1000);
    return (
    <div className="relative h-full w-full" dir="rtl">
      <div
        ref={viewportRef}
        className="absolute inset-x-0 top-0 bottom-5 overflow-hidden rounded-[18px] bg-[#173F35] select-none"
        style={{ touchAction: "pan-y", cursor: dragging ? "grabbing" : "grab" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => { touchStart.current = null; setDragOffset(0); setDragging(false); }}
        onLostPointerCapture={() => { if (settleDirection.current === 0) { touchStart.current = null; setDragOffset(0); setDragging(false); } }}
        onClickCapture={(event) => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); } }}
      >
        <div
          className="flex h-full w-[300%] flex-row"
          onTransitionEnd={handleTrackTransitionEnd}
          style={{
            transform: `translate3d(calc(-33.333333% + ${dragOffset}px), 0, 0)`,
            transition: dragging ? "none" : "transform 320ms cubic-bezier(0.22, 1, 0.36, 1)",
            willChange: "transform",
          }}
        >
          {visibleSlides.map((slide, slotIndex) => (
            <button
              key={`${slide.id}-${slotIndex}-${index}`}
              type="button"
              onClick={() => { if (!suppressClick.current) void navigate({ to: "/discover/$category", params: { category: slide.category } }); }}
              aria-label={`فتح قسم ${slide.title}`}
              className="relative h-full w-1/3 shrink-0 overflow-hidden text-right"
              style={{ touchAction: "pan-y" }}
            >
              {slide.image_url && <img src={slide.image_url} alt="" draggable={false} onError={() => { if (slotIndex === 1) setImageFailed(true); }} className="absolute inset-0 h-full w-full object-cover" /> }
              {slotIndex === 1 && imageFailed && <div className="absolute inset-0 bg-gradient-to-br from-[#24594b] to-[#102d27]" /> }
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-black/5" />
              <div className="absolute right-4 bottom-4 left-4 text-white">
                <div className="text-lg font-black drop-shadow">{slide.title}</div>
                <div className="mt-1 text-xs font-bold text-white/90">{slide.subtitle}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
      {slides.length > 1 && (
        <div className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-center gap-1.5" dir="ltr" aria-label="التنقل بين صور البانوراما">
          {slides.map((slide, slideIndex) => (
            <button key={slide.id} type="button" aria-label={`عرض الشريحة ${slideIndex + 1}`} aria-current={slideIndex === index ? "true" : undefined}
              onClick={() => { if (settleDirection.current !== 0) return; setIndex(slideIndex); setDragOffset(0); }}
              className={`h-1.5 rounded-full transition-all duration-300 ${slideIndex === index ? "w-5 bg-white shadow" : "w-1.5 bg-white/55 hover:bg-white/80"}`} />
          ))}
        </div>
      )}
    </div>
  );
}