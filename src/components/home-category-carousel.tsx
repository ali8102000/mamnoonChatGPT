import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

type Banner = { id: string; image_url: string; target_category: "restaurant" | "hotel" | "store"; banner_type: "category" | "poll" | "contest" | "ad"; target_campaign_id: string | null; is_active: boolean; scroll_speed: number; badge_text: string | null; display_order: number; motion_axis: "horizontal" | "vertical"; motion_direction: "left" | "right" | "up" | "down"; motion_style: "slide" | "fade" | "drop" };
const categoryCopy: Record<Banner["target_category"], { title: string }> = {
  restaurant: { title: "المطاعم" },
  hotel: { title: "الفنادق" },
  store: { title: "المولات والمحلات" },
};

export function HomeCategoryCarousel() {
  const navigate = useNavigate();
  const [banners, setBanners] = useState<Banner[]>([]);
  const [index, setIndex] = useState(0);
  const resumeAt = useRef(0);
  const touchStartX = useRef<number | null>(null);
  const movedBySwipe = useRef(false);
  const pause = () => { resumeAt.current = Date.now() + 5000; };

  const refresh = useCallback(async () => {
    const { data, error } = await (supabase as any)
      .from("home_carousel_banners")
      .select("id,image_url,target_category,banner_type,target_campaign_id,is_active,scroll_speed,badge_text,display_order,motion_axis,motion_direction,motion_style")
      .eq("is_active", true).order("display_order").order("created_at");
    if (!error) { setBanners(data ?? []); setIndex(0); resumeAt.current = 0; }
  }, []);

  useEffect(() => {
    void refresh();
    const channel = supabase.channel("home-category-banners-web")
      .on("postgres_changes", { event: "*", schema: "public", table: "home_carousel_banners" }, () => void refresh())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [refresh]);

  useEffect(() => {
    if (banners.length < 2) return;
    const delay = Math.max(1, Math.min(60, Number(banners[index]?.scroll_speed) || 5)) * 1000;
    const timer = window.setInterval(() => {
      if (Date.now() >= resumeAt.current) { const step = banners[index]?.motion_direction === "right" || banners[index]?.motion_direction === "down" ? -1 : 1; setIndex((value) => (value + step + banners.length) % banners.length); }
    }, delay);
    return () => window.clearInterval(timer);
  }, [banners, index]);

  if (!banners.length) {
    return (
      <>
          <div className="flex h-[188px] w-full items-center justify-center rounded-[20px] bg-[#173F35] p-4 text-center text-white">
          <div><div className="text-base font-black">اكتشف شركاء ممنون</div><p className="mt-2 text-xs font-bold opacity-90">المطاعم والفنادق والمولات والمتاجر المنشورة تظهر هنا</p></div>
        </div>
      </>
    );
  }

  const current = banners[Math.min(index, banners.length - 1)];
  const motionAxis = current.motion_axis || "horizontal";
  const motionDirection = current.motion_direction || "left";
  const motionStyle = current.motion_style || "slide";
  const openContent = () => {
    if (movedBySwipe.current || current.banner_type === "ad") { movedBySwipe.current = false; return; }
    if ((current.banner_type === "poll" || current.banner_type === "contest") && current.target_campaign_id) {
      void navigate({ to: "/campaign/$id", params: { id: current.target_campaign_id } });
      return;
    }
    if (current.banner_type === "category") void navigate({ to: "/discover/$category", params: { category: current.target_category } });
  };
  const image = current.image_url ? (
    <img
      src={current.image_url}
      alt={current.banner_type === "ad" ? "إعلان" : current.banner_type === "poll" ? "استطلاع رأي" : current.banner_type === "contest" ? "مسابقة" : categoryCopy[current.target_category].title}
      draggable={false}
      className={`h-full w-full object-cover transition-all duration-500 ${motionStyle === "fade" ? "opacity-95" : motionStyle === "drop" ? "translate-y-0" : ""}`}
    />
  ) : null;

  return (
    <>
      <div
        className="relative h-[188px] w-full overflow-hidden rounded-[20px] border border-border bg-[#173F35] shadow-sm"
        onPointerDown={(event) => { pause(); touchStartX.current = event.clientX; movedBySwipe.current = false; }}
        onPointerUp={(event) => {
          if (touchStartX.current !== null) {
            const delta = event.clientX - touchStartX.current;
            if (Math.abs(delta) > 35 && banners.length > 1) {
              movedBySwipe.current = true;
              setIndex((value) => (value + (delta < 0 ? 1 : -1) + banners.length) % banners.length);
            }
          }
          touchStartX.current = null;
          pause();
        }}
        onTouchStart={pause}
        onTouchEnd={pause}
        onMouseEnter={pause}
        data-motion-axis={motionAxis}
        data-motion-direction={motionDirection}
        data-motion-style={motionStyle}
      >
        {current.banner_type === "ad" ? (
          <div role="img" aria-label="إعلان" className="absolute inset-0 h-full w-full">{image}</div>
        ) : (
          <button
            type="button"
            aria-label={current.banner_type === "poll" ? "المشاركة في الاستطلاع" : current.banner_type === "contest" ? "فتح المسابقة" : "عرض " + categoryCopy[current.target_category].title}
            onClick={openContent}
            className="absolute inset-0 h-full w-full touch-pan-y"
          >
            {image}
            <span className="absolute bottom-3 right-3 rounded-full bg-black/60 px-3 py-2 text-xs font-black text-white">
              {current.banner_type === "poll" ? "شارك برأيك ←" : current.banner_type === "contest" ? "شاهد المسابقة وشارك ←" : "استعراض المحتويات والخدمات ←"}
            </span>
          </button>
        )}
        {current.badge_text && <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/55 px-3 py-1 text-xs font-bold text-white">{current.badge_text}</span>}
        {banners.length > 1 && (
          <div className="pointer-events-none absolute bottom-3 left-0 right-0 flex justify-center gap-1.5">
            {banners.map((banner, i) => <span key={banner.id} className={`h-1.5 rounded-full ${i === index ? "w-5 bg-white" : "w-1.5 bg-white/60"}`} />)}
          </div>
        )}
      </div>
    </>
  );
}
