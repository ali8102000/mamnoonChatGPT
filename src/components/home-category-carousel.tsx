import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type Banner = { id: string; image_url: string; target_category: "restaurant" | "hotel" | "store"; is_active: boolean; scroll_speed: number; badge_text: string | null; display_order: number };
const categoryCopy: Record<Banner["target_category"], { title: string; body: string }> = {
  restaurant: { title: "قريباً", body: "أنت صاحب مطعم؟ سجل ويانه وانتظر طلباتك" },
  hotel: { title: "قريباً", body: "أنت صاحب فندق؟ سجل ويانه وخليك ويانه" },
  store: { title: "قريباً", body: "أنت صاحب محل أو مول؟ انضم الآن وعرض منتجاتك" },
};

export function HomeCategoryCarousel() {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [index, setIndex] = useState(0);
  const [popup, setPopup] = useState<Banner["target_category"] | "disabled" | null>(null);
  const resumeAt = useRef(0);
  const touchStartX = useRef<number | null>(null);
  const movedBySwipe = useRef(false);
  const refresh = useCallback(async () => {
    const { data, error } = await (supabase as any).from("home_carousel_banners")
      .select("id,image_url,target_category,is_active,scroll_speed,badge_text,display_order")
      .order("display_order").order("created_at");
    if (!error) { setBanners(data ?? []); setIndex(0); }
  }, []);
  useEffect(() => {
    void refresh();
    const channel = supabase.channel("home-category-banners")
      .on("postgres_changes", { event: "*", schema: "public", table: "home_carousel_banners" }, () => void refresh())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [refresh]);
  useEffect(() => {
    if (banners.length < 2) return;
    const delay = Math.max(2, Math.min(30, Number(banners[index]?.scroll_speed) || 5)) * 1000;
    const timer = window.setInterval(() => {
      if (Date.now() >= resumeAt.current) setIndex((current) => (current + 1) % banners.length);
    }, delay);
    return () => window.clearInterval(timer);
  }, [banners, index]);
  if (!banners.length) return (
    <>
      <button type="button" aria-label="إعلان الشركاء - سيتوفر قريباً" onClick={() => setPopup("disabled")} className="block w-full aspect-[16/9] rounded-[24px] border border-border bg-transparent" />
      {popup === "disabled" && <div role="dialog" aria-modal="true" className="fixed inset-0 z-[100] grid place-items-center bg-black/55 p-5" onClick={() => setPopup(null)}>
        <div className="w-full max-w-sm rounded-3xl bg-card p-6 text-center shadow-2xl" onClick={(event) => event.stopPropagation()}>
          <div className="text-2xl font-black text-primary">سيتوفر قريباً</div>
          <p className="mt-3 text-base font-bold leading-8">أنت شريك؟ سجل ويانه وانتظر طلباتك</p>
          <button type="button" onClick={() => setPopup(null)} className="mt-5 rounded-xl bg-primary px-6 py-2.5 font-bold text-primary-foreground">حسناً</button>
        </div>
      </div>}
    </>
  );
  const pause = () => { resumeAt.current = Date.now() + 5000; };
  const current = banners[index];
  return (
    <>
      <div className="relative w-full aspect-[16/9] overflow-hidden rounded-[24px] border border-border bg-transparent shadow-sm"
        onPointerDown={(event) => { pause(); touchStartX.current = event.clientX; movedBySwipe.current = false; }}
        onPointerUp={(event) => { if (touchStartX.current !== null) { const delta = event.clientX - touchStartX.current; if (Math.abs(delta) > 35 && banners.length > 1) { movedBySwipe.current = true; setIndex((current) => (current + (delta < 0 ? 1 : -1) + banners.length) % banners.length); } } touchStartX.current = null; pause(); }}
        onTouchStart={pause} onTouchEnd={pause} onMouseEnter={pause}>
        <button type="button" aria-label="عرض الإعلان" onClick={() => { if (movedBySwipe.current) { movedBySwipe.current = false; return; } setPopup(current.is_active ? current.target_category : "disabled"); }}
          className="absolute inset-0 h-full w-full touch-pan-y">
          {current.is_active && <img src={current.image_url} alt="" draggable={false} className="h-full w-full object-cover" />}
          {current.badge_text && <span className="absolute right-3 top-3 rounded-full bg-black/55 px-3 py-1 text-xs font-bold text-white">{current.badge_text}</span>}
        </button>
        {banners.length > 1 && <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5 pointer-events-none">
          {banners.map((item, i) => <span key={item.id} className={`h-1.5 rounded-full ${i === index ? "w-5 bg-white" : "w-1.5 bg-white/60"}`} />)}
        </div>}
      </div>
      {popup && <div role="dialog" aria-modal="true" className="fixed inset-0 z-[100] grid place-items-center bg-black/55 p-5" onClick={() => setPopup(null)}>
        <div className="w-full max-w-sm rounded-3xl bg-card p-6 text-center shadow-2xl" onClick={(event) => event.stopPropagation()}>
          <div className="text-2xl font-black text-primary">{popup === "disabled" ? "سيتوفر قريباً" : categoryCopy[popup].title}</div>
          <p className="mt-3 text-base font-bold leading-8">{popup === "disabled" ? "أنت شريك؟ سجل ويانه وانتظر طلباتك" : categoryCopy[popup].body}</p>
          <button type="button" onClick={() => setPopup(null)} className="mt-5 rounded-xl bg-primary px-6 py-2.5 font-bold text-primary-foreground">حسناً</button>
        </div>
      </div>}
    </>
  );
}
