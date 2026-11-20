import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

type CategoryBanner = { id: string; image_url: string; target_category: "restaurant" | "hotel" | "store"; banner_type: string; display_order: number; is_active: boolean };

const FALLBACK_IMAGES = {
  restaurant: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=640&q=85",
  hotel: "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=640&q=85",
  mall: "https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=640&q=85",
  shop: "https://images.unsplash.com/photo-1472851294608-062f824d29cc?auto=format&fit=crop&w=640&q=85",
};

const cards = [
  { key: "restaurant", title: "المطاعم", subtitle: "مطاعم وكافيهات", category: "restaurant" as const, fallback: FALLBACK_IMAGES.restaurant },
  { key: "hotel", title: "الفنادق", subtitle: "فنادق وشقق فندقية", category: "hotel" as const, fallback: FALLBACK_IMAGES.hotel },
  { key: "mall", title: "المولات", subtitle: "مراكز تسوق وترفيه", category: "store" as const, fallback: FALLBACK_IMAGES.mall },
  { key: "shop", title: "المحلات", subtitle: "متاجر ومحلات قريبة", category: "store" as const, fallback: FALLBACK_IMAGES.shop },
];

export function HomeCategoryCarousel() {
  const navigate = useNavigate();
  const [banners, setBanners] = useState<CategoryBanner[]>([]);
  const [failedImages, setFailedImages] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const { data, error } = await (supabase as any)
        .from("home_carousel_banners")
        .select("id,image_url,target_category,banner_type,display_order,is_active")
        .eq("is_active", true)
        .eq("banner_type", "category")
        .order("display_order")
        .order("created_at");
      if (active && !error) {
        setBanners(data ?? []);
        setFailedImages([]);
      }
    };
    void refresh();
    const channel = supabase.channel("home-fixed-category-tiles-web")
      .on("postgres_changes", { event: "*", schema: "public", table: "home_carousel_banners" }, () => void refresh())
      .subscribe();
    return () => { active = false; void supabase.removeChannel(channel); };
  }, []);

  const storeBanners = banners.filter((item) => item.target_category === "store");
  return (
    <div className="grid h-full w-full grid-cols-2 grid-rows-2 gap-1.5" dir="rtl">
      {cards.map((card) => {
        const match = card.key === "mall" ? storeBanners[0] : card.key === "shop" ? storeBanners[1] : banners.find((item) => item.target_category === card.category);
        const image = match?.image_url || card.fallback;
        const imageKey = match?.id || card.key;
        return (
          <button
            key={card.key}
            type="button"
            onClick={() => void navigate({ to: "/discover/$category", params: { category: card.category } })}
            className="group relative min-h-0 overflow-hidden rounded-xl border border-white/20 bg-[#173F35] text-right shadow-sm transition-transform active:scale-[0.98]"
            aria-label={`فتح قسم ${card.title}`}
          >
            {!failedImages.includes(imageKey) && (
              <img
                src={failedImages.includes(imageKey) ? card.fallback : image}
                alt=""
                loading="lazy"
                draggable={false}
                onError={() => setFailedImages((current) => current.includes(imageKey) ? current : [...current, imageKey])}
                className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-black/5" />
            <div className="absolute inset-x-2 bottom-2 text-white">
              <div className="text-xs font-black leading-tight drop-shadow">{card.title}</div>
              <div className="mt-0.5 text-[9px] font-bold text-white/85">{card.subtitle}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
