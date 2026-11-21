import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type SquareBanner = { id: string; image_url: string; scroll_speed: number; display_order: number };

export function HomeTopSquareBanner() {
  const [banners, setBanners] = useState<SquareBanner[]>([]);
  const [index, setIndex] = useState(0);
  const [showSoon, setShowSoon] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const pauseUntil = useRef(0);
  const suppressPress = useRef(false);
  const current = banners[index] ?? null;

  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data, error } = await (supabase as any)
        .from("home_carousel_banners")
        .select("id,image_url,scroll_speed,display_order")
        .eq("banner_type", "top_square")
        .eq("is_active", true)
        .order("display_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (active && !error) { setBanners(data ?? []); setIndex(0); }
    };
    void load();
    const channel = supabase.channel("home-top-square-banner-web")
      .on("postgres_changes", { event: "*", schema: "public", table: "home_carousel_banners" }, () => void load())
      .subscribe();
    return () => { active = false; void supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    if (banners.length < 2) return;
    const seconds = Math.max(1, Math.min(60, Number(current?.scroll_speed) || 5));
    const timer = window.setInterval(() => {
      if (Date.now() < pauseUntil.current) return;
      setIndex((value) => (value + 1) % banners.length);
    }, seconds * 1000);
    return () => window.clearInterval(timer);
  }, [banners, current?.scroll_speed]);

  const onTouchStart = (event: React.TouchEvent<HTMLButtonElement>) => {
    touchStartX.current = event.touches[0]?.clientX ?? null;
    suppressPress.current = false;
  };
  const onTouchEnd = (event: React.TouchEvent<HTMLButtonElement>) => {
    const endX = event.changedTouches[0]?.clientX;
    const startX = touchStartX.current;
    pauseUntil.current = Date.now() + 5000;
    if (startX != null && endX != null && Math.abs(endX - startX) > 28 && banners.length > 1) {
      suppressPress.current = true;
      setIndex((value) => (value + (endX < startX ? 1 : -1) + banners.length) % banners.length);
    }
    touchStartX.current = null;
  };

  return (
    <>
      <button
        type="button"
        aria-label="بانر الشركاء والعروض، قريباً"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onClick={() => {
          if (suppressPress.current) { suppressPress.current = false; return; }
          setShowSoon(true);
        }}
        className="relative block aspect-square w-full overflow-hidden rounded-[20px] border border-dashed border-border bg-card text-right"
      >
        {current?.image_url ? (
          <img key={current.id} src={current.image_url} alt="" draggable={false}
            className="absolute inset-0 h-full w-full object-cover"
            style={{ animation: "mamnoon-square-slide .45s ease-out both" }} />
        ) : null}
        <style>{"@keyframes mamnoon-square-slide { from { opacity: .45; transform: translateX(14px); } to { opacity: 1; transform: translateX(0); } }"}</style>
      </button>
      {showSoon && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-5" role="presentation" onClick={() => setShowSoon(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="mamnoon-square-title" dir="rtl"
            className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 text-right shadow-2xl"
            onClick={(event) => event.stopPropagation()}>
            <h2 id="mamnoon-square-title" className="text-lg font-black">سيتوفر قريباً</h2>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">أنت شريك؟ سجل ويانه وانتظر طلباتك</p>
            <button type="button" onClick={() => setShowSoon(false)} className="mt-5 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground">حسناً</button>
          </div>
        </div>
      )}
    </>
  );
}
