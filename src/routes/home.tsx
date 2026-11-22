import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import ProviderMissions from "@/components/provider-missions";
import { supabase } from "@/integrations/supabase/client";
import { MobileShell } from "@/components/mobile-shell";
import {
  Car,
  Wrench,
  Power,
  Bell,
  Sun,
  Moon,
  Zap,
  ShieldCheck,
  Sparkles,
  ArrowUpLeft,
  TrendingUp,
  Clock,
  Crown,
} from "lucide-react";
import { NotificationsBell } from "@/components/notifications-bell";
import { toast } from "@/lib/toast";
import { useServerFn } from "@tanstack/react-start";
import { acceptServiceRequest } from "@/lib/dispatch.functions";
import { useTheme } from "@/lib/use-theme";
import { playClick } from "@/lib/click-sound";
import { RegionalServiceBanner } from "@/components/regional-service-banner";
import { HomeCategoryCarousel } from "@/components/home-category-carousel";
import { HomeBannerCampaignDialog } from "@/components/home-banner-campaign-dialog";
import { ServiceIconPanorama } from "@/components/service-icon-panorama";

export const Route = createFileRoute("/home")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "الرئيسية | ممنون" },
      { name: "description", content: "اطلب تاكسي أو خدمات منزلية وتابع طلباتك في ممنون." },
      { property: "og:title", content: "الرئيسية | ممنون" },
      { property: "og:description", content: "اطلب تاكسي أو خدمات منزلية وتابع طلباتك في ممنون." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HomePage,
});

function greetingByHour() {
  const h = new Date().getHours();
  if (h < 5) return "مساء الخير";
  if (h < 12) return "صباح الخير";
  if (h < 18) return "نهارك سعيد";
  return "مساء الخير";
}

function HomePage() {
  const { loading, session, profile, roles, activeRole, isSuperAdmin } = useAuth();
  const { theme, toggle } = useTheme();
  const greet = useMemo(greetingByHour, []);
  const [companyName, setCompanyName] = useState("شركة ممنون");
  const [companyLogoUrl, setCompanyLogoUrl] = useState("");
  const [welcomeMessage, setWelcomeMessage] = useState("مشوارك وخدمات بيتك، بمكان واحد.");

  useEffect(() => {
    (supabase as any).from("company_settings").select("company_name,company_logo_url,welcome_message").eq("id", 1).maybeSingle()
      .then(({ data }: any) => { if (data?.company_name) setCompanyName(data.company_name); if (data?.company_logo_url) setCompanyLogoUrl(data.company_logo_url); if (data?.welcome_message) setWelcomeMessage(data.welcome_message); });
  }, []);

  if (loading) return null;
  if (!session) return <Navigate to="/auth" />;
  if (!roles.length) return <Navigate to="/select-role" />;

  const firstName = (profile?.full_name || "صديقنا").split(" ")[0];
  const roleTitle =
    activeRole === "large_driver"
      ? "سائق سيارات كبيرة 🚚"
      : activeRole === "driver"
      ? "كابتن تكسي 🚗"
      : activeRole === "worker"
        ? "فني خدمات 🛠️"
        : "زبون 👤";

  return (
    <MobileShell>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-96 overflow-hidden">
        <div className="absolute -top-16 -right-16 h-72 w-72 rounded-full bg-primary/20 blur-3xl animate-float" />
        <div
          className="absolute -top-10 -left-24 h-64 w-64 rounded-full bg-accent/20 blur-3xl animate-float"
          style={{ animationDelay: "-3s" }}
        />
      </div>

      <div className="relative px-5 pt-10 pb-6">
        <RegionalServiceBanner />
        {isSuperAdmin && (
          <div className="mb-4 glass rounded-2xl p-3.5 border border-amber-500/40 bg-gradient-to-r from-amber-500/15 via-amber-500/5 to-transparent flex items-center justify-between animate-pop-in shadow-sm">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-500 grid place-items-center shrink-0">
                <Crown className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2 text-xs font-black text-amber-600 dark:text-amber-400">
                  {companyLogoUrl && <img src={companyLogoUrl} alt="" className="h-7 w-7 rounded-lg object-contain bg-white p-0.5" />}
                  إدارة {companyName}
                </div>
                <div className="text-[10px] text-muted-foreground font-medium">
                  اعتماد السائقين والفنيين · حظر الحسابات · توزيع الخصومات · الدعم
                </div>
              </div>
            </div>
            <Link
              to="/admin"
              className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-black flex items-center gap-1 transition shadow-sm shrink-0"
            >
              <span>لوحة الإدارة</span>
              <ArrowUpLeft className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}

        <div className="flex items-center justify-between mb-6 animate-pop-in">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold tracking-wider text-primary/80 uppercase">
                {greet}
              </span>
              <span
                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-bold"
                aria-label="الدور الحالي"
              >
                {roleTitle}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {companyLogoUrl && <img src={companyLogoUrl} alt="" className="h-8 w-8 rounded-lg bg-white object-contain p-1" />}
              <div className="text-2xl font-black leading-tight mt-0.5 text-foreground">
                {firstName} <span className="inline-block animate-float">👋</span>
              </div>
            </div>
            <p className="mt-1 text-xs font-semibold text-muted-foreground">{welcomeMessage}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                playClick("toggle");
                toggle();
              }}
              aria-label="تبديل الوضع"
              className="glass-strong h-11 w-11 rounded-2xl grid place-items-center btn-press tap-highlight-none relative overflow-hidden"
            >
              <Sun
                className={`h-5 w-5 absolute transition-all duration-500 ${theme === "dark" ? "rotate-90 scale-0 opacity-0" : "rotate-0 scale-100 opacity-100"}`}
              />
              <Moon
                className={`h-5 w-5 absolute transition-all duration-500 ${theme === "dark" ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-0 opacity-0"}`}
              />
            </button>
            <NotificationsBell />
          </div>
        </div>


        {(activeRole === "driver" || activeRole === "large_driver") && <ProviderHome type="taxi" largeDriverMode={activeRole === "large_driver"} />}
        {activeRole === "worker" && <ProviderHome type="service" />}
        {activeRole !== "driver" && activeRole !== "large_driver" && activeRole !== "worker" && <CustomerHome />}
      </div>
    </MobileShell>
  );
}

function CustomerHome() {
  const [visuals, setVisuals] = useState<Record<string, any>>({});
  const [topBanners, setTopBanners] = useState<any[]>([]);
  const [topBannerIndex, setTopBannerIndex] = useState(0);
  const [activeBannerCampaignId, setActiveBannerCampaignId] = useState<string | null>(null);
  const closeBannerCampaign = useCallback(() => setActiveBannerCampaignId(null), []);
  const topBanner = topBanners[topBannerIndex] ?? null;
  const topBannerTouchStart = useRef<{ x: number; y: number } | null>(null);
  const suppressTopBannerClick = useRef(false);
  const gridLayout = visuals.home_customer_grid_layout || {};
  const gridGap = Math.max(4, Math.min(28, Number(gridLayout.grid_gap_px) || 12));
  const firstRowHeight = Math.max(100, Math.min(260, Number(gridLayout.first_row_height_px) || 145));
  const secondRowHeight = Math.max(120, Math.min(300, Number(gridLayout.second_row_height_px) || 188));
  const carouselHeight = Math.max(120, Math.min(300, Number(gridLayout.carousel_height_px) || secondRowHeight));
  const wideRatio = Math.max(1.4, Math.min(2.8, Number(gridLayout.wide_column_ratio) || 2));
  const gridRadius = Math.max(8, Math.min(32, Number(gridLayout.card_radius_px) || 20));

  useEffect(() => {
    let active = true;
    (supabase as any).from("app_ui_elements_public")
      .select("element_key,published_config,title,subtitle,sort_order")
      .then(({ data, error }: any) => {
        if (!active || error) return;
        const next: Record<string, any> = {};
        for (const item of data ?? []) next[item.element_key] = { ...(item.published_config ?? {}), title: item.title, subtitle: item.subtitle, sort_order: item.sort_order };
        setVisuals(next);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data, error } = await (supabase as any).from("home_carousel_banners")
        .select("id,image_url,banner_type,target_campaign_id,scroll_speed,motion_direction,motion_style,badge_text,banner_title,banner_description,display_config,is_active")
        .eq("is_active", true).in("banner_type", ["ad", "poll", "contest"]).order("display_order").order("created_at");
      if (active && !error) { setTopBanners(data ?? []); setTopBannerIndex(0); }
    };
    void load();
    const channel = supabase.channel("home-top-banner-web")
      .on("postgres_changes", { event: "*", schema: "public", table: "home_carousel_banners" }, () => void load())
      .subscribe();
    return () => { active = false; void supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    if (topBanners.length < 2) return;
    const seconds = Math.max(1, Math.min(60, Number(topBanner?.scroll_speed) || 5));
    const timer = window.setInterval(() => {
      const reverse = topBanner?.motion_direction === "right" || topBanner?.motion_direction === "down";
      setTopBannerIndex((value) => (value + (reverse ? -1 : 1) + topBanners.length) % topBanners.length);
    }, seconds * 1000);
    return () => window.clearInterval(timer);
  }, [topBanners, topBanner?.scroll_speed, topBanner?.motion_direction]);

  return (
    <div className="-mx-2 space-y-3 pt-4">
      <style>{`
        @keyframes mamnoonBannerPanLeft { from { transform: translate3d(0,0,0) scale(1.2); } to { transform: translate3d(-9%,0,0) scale(1.2); } }
        @keyframes mamnoonBannerPanRight { from { transform: translate3d(0,0,0) scale(1.2); } to { transform: translate3d(9%,0,0) scale(1.2); } }
        @keyframes mamnoonBannerPanUp { from { transform: translate3d(0,0,0) scale(1.2); } to { transform: translate3d(0,-9%,0) scale(1.2); } }
        @keyframes mamnoonBannerPanDown { from { transform: translate3d(0,0,0) scale(1.2); } to { transform: translate3d(0,9%,0) scale(1.2); } }
        @keyframes mamnoonBannerFadeIn { from { opacity: 0; } to { opacity: .4; } }
        @keyframes mamnoonBannerDropIn { from { opacity: 0; transform: translateY(-18px) scale(.985); } to { opacity: .4; transform: translateY(0) scale(1); } }
        @media (prefers-reduced-motion: reduce) { .mamnoon-top-banner-image { animation: none !important; opacity: .4; transform: scale(1.2); } }
      `}</style>
      <div role={topBanner?.target_campaign_id ? "button" : undefined} tabIndex={topBanner?.target_campaign_id ? 0 : undefined} aria-label={topBanner?.target_campaign_id ? "فتح الاستطلاع أو المسابقة" : "ممنون مجاناً بلا عمولة"} onClick={() => { if (suppressTopBannerClick.current) { suppressTopBannerClick.current = false; return; } if (topBanner?.target_campaign_id) setActiveBannerCampaignId(topBanner.target_campaign_id); }} onPointerDown={(event) => { topBannerTouchStart.current = { x: event.clientX, y: event.clientY }; }} onPointerUp={(event) => { const start = topBannerTouchStart.current; topBannerTouchStart.current = null; if (!start || topBanners.length < 2) return; const dx = event.clientX - start.x; const dy = event.clientY - start.y; if (Math.abs(dx) > 38 && Math.abs(dx) > Math.abs(dy) * 1.2) { suppressTopBannerClick.current = true; setTopBannerIndex((value) => (value + (dx < 0 ? 1 : -1) + topBanners.length) % topBanners.length); window.setTimeout(() => { suppressTopBannerClick.current = false; }, 350); } }} onKeyDown={(event) => { if (topBanner?.target_campaign_id && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); setActiveBannerCampaignId(topBanner.target_campaign_id); } }} className="relative min-h-[130px] rounded-[20px] px-4 pt-3 pb-3 overflow-hidden animate-pop-in shadow-elegant bg-gradient-to-br from-primary via-primary-glow to-accent text-primary-foreground" style={{ minHeight: Math.max(100,Math.min(300,Number(topBanner?.display_config?.height_px)||Number(gridLayout.top_banner_height_px)||130)), height: Math.max(100,Math.min(300,Number(topBanner?.display_config?.height_px)||Number(gridLayout.top_banner_height_px)||130)), borderRadius: Math.max(8,Math.min(40,Number(topBanner?.display_config?.border_radius_px)||20)), padding: Math.max(8,Math.min(32,Number(topBanner?.display_config?.padding_px)||12)), background: topBanner?.display_config?.background_color || undefined }}>
        {topBanner?.image_url && <div key={topBanner.id} className="absolute inset-0 overflow-hidden" style={{ animation: topBanner.motion_style === "fade" ? "mamnoonBannerFadeIn .55s ease-out both" : topBanner.motion_style === "drop" ? "mamnoonBannerDropIn .55s ease-out both" : undefined }}><img src={topBanner.image_url} alt="" className="mamnoon-top-banner-image absolute -inset-[10%] h-[120%] w-[120%] object-cover" style={{ opacity: Math.max(0.05,Math.min(1,Number(topBanner.display_config?.image_opacity)||0.4)), animation: `mamnoonBannerPan${topBanner.motion_direction === "right" ? "Right" : topBanner.motion_direction === "up" ? "Up" : topBanner.motion_direction === "down" ? "Down" : "Left"} ${Math.max(2, Math.min(120, (Number(topBanner.scroll_speed) || 5) * 2))}s ease-in-out infinite alternate` }} /></div>}
        <div className="absolute inset-0 shine opacity-40 mix-blend-overlay" />
        <div className="absolute -top-8 -left-8 h-40 w-40 rounded-full bg-white/20 blur-2xl" />
        <div className="relative">
          <div className="inline-flex items-center gap-1 rounded-full bg-white/15 backdrop-blur px-2 py-0.5 text-[9px] font-bold">
            <Sparkles className="h-3 w-3" /> {topBanner?.badge_text || "مجاناً بلا عمولة"}
          </div>
          <div className="font-black mt-1 leading-tight" style={{fontSize:Math.max(12,Math.min(30,Number(topBanner?.display_config?.title_size_px)||20)),color:topBanner?.display_config?.title_color||undefined,textAlign:topBanner?.display_config?.text_alignment||"right"}}>
            {topBanner?.banner_title || "اطلب الآن، ادفع للمزوّد مباشرة"}
          </div>
          <div className="text-[11px] leading-4 opacity-90 mt-0.5" style={{fontSize:Math.max(8,Math.min(20,Number(topBanner?.display_config?.subtitle_size_px)||11)),color:topBanner?.display_config?.description_color||undefined,textAlign:topBanner?.display_config?.text_alignment||"right"}}>
            {topBanner?.banner_description || topBanner?.badge_text || "ممنون منصّة مجانية وسريعة — بدون أي نسبة على طلبك"}
          </div>
          {topBanner?.display_config?.cta_visible !== false && <Link to="/request/new" onClick={(event) => event.stopPropagation()} className="mt-1 inline-flex rounded-full bg-white px-3 py-1 text-[10px] font-black text-primary shadow-sm" style={{backgroundColor:topBanner?.display_config?.cta_background_color||undefined,color:topBanner?.display_config?.cta_text_color||undefined}}>{topBanner?.display_config?.cta_text || "اطلب الآن"}</Link>}
        </div>
      </div>
      {activeBannerCampaignId && <HomeBannerCampaignDialog campaignId={activeBannerCampaignId} onClose={closeBannerCampaign} />}

      <HomeCustomContent placementKey="home.customer.top" />

      <div dir="ltr" className="grid" style={{ gap: gridGap, gridTemplateColumns: `minmax(0, ${wideRatio}fr) minmax(0, 1fr)`, gridTemplateRows: `${firstRowHeight}px ${secondRowHeight}px`, gridAutoFlow: "row" }}>
        <QuickTile
          to="/request/new"
          type="taxi"
          title={visuals.home_customer_taxi?.title && visuals.home_customer_taxi.title !== "طلب سيارة" ? visuals.home_customer_taxi.title : "طلب تكسي"}
          subtitle={visuals.home_customer_taxi?.subtitle || "خلال دقائق"}
          icon={visuals.home_customer_taxi?.icon_name ? <span className="text-3xl">{visuals.home_customer_taxi.icon_name}</span> : <img src={visuals.home_customer_taxi?.image_url || "https://raw.githubusercontent.com/ali8102000/mamnoonChatGPT/main/src/assets/car-luxury.png"} alt="" style={{ width: Number(visuals.home_customer_taxi?.width_px) || 52, height: Number(visuals.home_customer_taxi?.height_px) || 52, objectFit: visuals.home_customer_taxi?.image_fit === "cover" ? "cover" : "contain", borderRadius: Number(visuals.home_customer_taxi?.image_border_radius_px) || 0, aspectRatio: visuals.home_customer_taxi?.image_shape === "landscape" ? "4 / 3" : visuals.home_customer_taxi?.image_shape === "portrait" ? "3 / 4" : "1 / 1" }} />}
          iconBoxSize={Math.max(32, Math.min(96, Number(visuals.home_customer_taxi?.width_px) || Number(gridLayout.taxi_icon_size_px) || 56))}
          sortOrder={Number(visuals.home_customer_taxi?.sort_order) || 10}
          styleConfig={{ ...(visuals.home_customer_taxi || {}), card_height_px: Number(visuals.home_customer_taxi?.card_height_px) || firstRowHeight, border_radius_px: Number(visuals.home_customer_taxi?.border_radius_px) || gridRadius }}
          gradient="from-amber-500 to-orange-500"
          span={2}
          delay={0.05}
        />
        <QuickTile
          to="/request/new"
          type="service"
          title={visuals.home_customer_service?.title || "طلب فني"}
          subtitle={visuals.home_customer_service?.subtitle || "١٦ خدمة"}
          icon={visuals.home_customer_service?.icon_name ? <span className="text-3xl">{visuals.home_customer_service.icon_name}</span> : visuals.home_customer_service?.image_url ? <img src={visuals.home_customer_service.image_url} alt="" style={{ width: Number(visuals.home_customer_service.width_px) || 64, height: Number(visuals.home_customer_service.height_px) || 64, objectFit: visuals.home_customer_service.image_fit === "cover" ? "cover" : "contain", borderRadius: Number(visuals.home_customer_service.image_border_radius_px) || 0, aspectRatio: visuals.home_customer_service.image_shape === "landscape" ? "4 / 3" : visuals.home_customer_service.image_shape === "portrait" ? "3 / 4" : "1 / 1" }} /> : <ServiceIconPanorama />}
          iconBoxSize={64}
          sortOrder={Number(visuals.home_customer_service?.sort_order) || 20}
          styleConfig={{ ...(visuals.home_customer_service || {}), card_height_px: Number(visuals.home_customer_service?.card_height_px) || firstRowHeight, border_radius_px: Number(visuals.home_customer_service?.border_radius_px) || gridRadius }}
          gradient="from-emerald-500 to-teal-400"
          delay={0.1}
        />
        <div className="col-span-2 flex min-w-0 flex-wrap" style={{ gap: gridGap, order: 30 }}>
        <QuickTile
          to="/request/new"
          type="taxi"
          vehicle="large"
          title={visuals.home_customer_large_vehicle?.title || "طلب سيارة كبيرة"}
          subtitle={visuals.home_customer_large_vehicle?.subtitle || "كيا حمل أو كيا ركاب أو باص"}
          icon={visuals.home_customer_large_vehicle?.icon_name ? <span className="text-3xl">{visuals.home_customer_large_vehicle.icon_name}</span> : <img src={visuals.home_customer_large_vehicle?.image_url || "https://raw.githubusercontent.com/ali8102000/mamnoonChatGPT/main/src/assets/service-kia-driver.png"} alt="" style={{ width: Number(visuals.home_customer_large_vehicle?.width_px) || 52, height: Number(visuals.home_customer_large_vehicle?.height_px) || 52, objectFit: visuals.home_customer_large_vehicle?.image_fit === "cover" ? "cover" : "contain", borderRadius: Number(visuals.home_customer_large_vehicle?.image_border_radius_px) || 0, aspectRatio: visuals.home_customer_large_vehicle?.image_shape === "landscape" ? "4 / 3" : visuals.home_customer_large_vehicle?.image_shape === "portrait" ? "3 / 4" : "1 / 1" }} />}
          iconBoxSize={Math.max(32, Math.min(96, Number(visuals.home_customer_large_vehicle?.width_px) || Number(gridLayout.large_icon_size_px) || 56))}
          sortOrder={Number(visuals.home_customer_large_vehicle?.sort_order) || 30}
          styleConfig={{ ...(visuals.home_customer_large_vehicle || {}), card_height_px: Number(visuals.home_customer_large_vehicle?.card_height_px) || secondRowHeight, border_radius_px: Number(visuals.home_customer_large_vehicle?.border_radius_px) || gridRadius }}
          gradient="from-orange-500 to-amber-600"
          span={1}
          tileWidth={`calc(${100 / (wideRatio + 1)}% - ${gridGap / (wideRatio + 1)}px)`}
          delay={0.15}
        />
        <div dir="rtl" className="min-w-0" style={{ width: `calc(${(wideRatio / (wideRatio + 1)) * 100}% - ${(gridGap * wideRatio) / (wideRatio + 1)}px)`, height: carouselHeight, flexShrink: 0, order: (Number(visuals.home_customer_large_vehicle?.sort_order) || 30) + 1, borderRadius: gridRadius, overflow: "hidden" }}>
          <HomeCategoryCarousel />
        </div>
      </div>
        </div>

      <HomeCustomContent placementKey="home.customer.content" />

      <section className="mt-5 space-y-3" dir="rtl">
        <h3 className="text-sm font-black text-foreground">قسم المطاعم</h3>
        <div className="h-44 w-full overflow-hidden rounded-[18px]">
          <HomeCategoryCarousel placement="restaurant_section" />
        </div>
        <HomeCustomContent placementKey="home.restaurant.content" />
      </section>

      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-3 text-right">
        <a href="/ask-mamnoon" className="flex items-center justify-between px-1 py-1 transition hover:bg-primary/5">
          <span><span className="block text-sm font-black text-foreground">🤖 اسأل ممنون</span><span className="mt-1 block text-xs text-muted-foreground">مساعد ذكي يجاوبك عن خدمات التطبيق</span></span>
          <span className="text-xs font-black text-primary">ابدأ المحادثة ←</span>
        </a>
        <Link to="/coupons" className="mt-2 flex items-center justify-between rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2">
          <span className="text-sm font-black text-foreground">🎁 القسائم والكوبونات</span><span className="text-xs font-bold text-primary">عرض قسائمي ←</span>
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-2.5 animate-pop-in" style={{ animationDelay: "0.15s" }}>
        <MiniStat icon={<Clock className="h-4 w-4" />} label="أقل من" value="٣ د" />
        <MiniStat icon={<ShieldCheck className="h-4 w-4" />} label="مزودون" value="موثق" />
      </div>

      <HomeCustomContent placementKey="home.customer.after_stats" />

      <div className="mt-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-black text-sm text-foreground">لماذا ممنون؟</h3>
          <span className="text-[11px] text-muted-foreground font-medium">مميّزاتنا</span>
        </div>
        <div className="space-y-2.5">
          <FeatureRow
            icon={<Zap className="h-5 w-5" />}
            title="سرعة في الاستجابة"
            desc="نوصلك بأقرب سيارة أو فني في منطقتك"
            accent="from-amber-500 to-orange-500"
          />
          <FeatureRow
            icon={<ShieldCheck className="h-5 w-5" />}
            title="أمان مضمون"
            desc="جميع الكباتن والفنيين موثّقون رسمياً"
            accent="from-emerald-500 to-teal-400"
          />
        </div>
      </div>
    </div>
  );
}


function HomeCustomContent({ placementKey }: { placementKey: string }) {
  const { session } = useAuth();
  const [sections, setSections] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, any[]>>({});
  const [voting, setVoting] = useState<string | null>(null);
  const [popupCampaignId, setPopupCampaignId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [sectionResult, campaignResult] = await Promise.all([
      (supabase as any).from("app_content_sections_public").select("id,title,section_type,placement_key,sort_order,published_config").eq("placement_key", placementKey).order("sort_order"),
      (supabase as any).from("app_campaigns").select("id,campaign_type,title,description,image_url,popup_display_seconds,starts_at,ends_at,result_visibility,app_campaign_options(id,label,sort_order)").eq("status", "published").eq("placement_key", placementKey).order("sort_order").order("created_at", { ascending: false }),
    ]);
    if (!sectionResult.error) setSections(sectionResult.data ?? []);
    if (!campaignResult.error) {
      const now = Date.now();
      const active = (campaignResult.data ?? []).filter((item: any) =>
        (!item.starts_at || new Date(item.starts_at).getTime() <= now) &&
        (!item.ends_at || new Date(item.ends_at).getTime() > now || item.result_visibility === "public" || item.result_visibility === "after_end")
      );
      setCampaigns(active);
      setPopupCampaignId(active.find((item: any) => item.image_url)?.id ?? null);
      if (session?.user?.id && active.length) {
        const ids = active.map((item: any) => item.id);
        const { data: own } = await (supabase as any).from("app_campaign_responses").select("campaign_id,option_id").in("campaign_id", ids);
        const ownMap: Record<string, string> = {};
        for (const row of own ?? []) ownMap[row.campaign_id] = row.option_id;
        setResponses(ownMap);
        const resultPairs = await Promise.all(active.map(async (item: any) => {
          const { data } = await (supabase as any).from("app_campaign_option_results").select("option_id,vote_count").eq("campaign_id", item.id);
          return [item.id, data ?? []] as const;
        }));
        setResults(Object.fromEntries(resultPairs));
      }
    }
  }, [session?.user?.id, placementKey]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!popupCampaignId) return;
    const current = campaigns.find((item) => item.id === popupCampaignId);
    if (!current?.image_url) return;
    const timer = window.setTimeout(() => {
      const next = campaigns.find((item) => item.image_url && item.id !== popupCampaignId);
      setPopupCampaignId(next?.id ?? null);
    }, Math.max(1, Math.min(60, Number(current.popup_display_seconds) || 5)) * 1000);
    return () => window.clearTimeout(timer);
  }, [popupCampaignId, campaigns]);

  const vote = async (campaign: any, optionId: string) => {
    const now = Date.now();
    const votingOpen = (!campaign.starts_at || new Date(campaign.starts_at).getTime() <= now) && (!campaign.ends_at || new Date(campaign.ends_at).getTime() > now);
    if (!votingOpen) return;
    const userId = session?.user?.id;
    if (!userId || responses[campaign.id] || voting) return;
    setVoting(campaign.id);
    const { error } = await (supabase as any).from("app_campaign_responses").insert({
      campaign_id: campaign.id, option_id: optionId, user_id: userId,
    });
    if (error) toast.error(error.code === "23505" ? "سبق وشاركت بهذا الاستطلاع." : error.message);
    else {
      setResponses((current) => ({ ...current, [campaign.id]: optionId }));
      const { data } = await (supabase as any).from("app_campaign_option_results").select("option_id,vote_count").eq("campaign_id", campaign.id);
      setResults((current) => ({ ...current, [campaign.id]: data ?? [] }));
      toast.success("تم تسجيل مشاركتك");
    }
    setVoting(null);
  };

  if (!sections.length && !campaigns.length) return null;
  const popupCampaign = campaigns.find((item) => item.id === popupCampaignId && item.image_url);
  return (
    <div className="space-y-3">
      {popupCampaign && <div className="fixed inset-0 z-[100] grid place-items-center bg-black/75 p-5" role="dialog" aria-modal="true" aria-label={popupCampaign.title}>
        <div className="relative w-full max-w-md overflow-hidden rounded-2xl bg-card shadow-2xl">
          <button type="button" onClick={() => { const next = campaigns.find((item) => item.image_url && item.id !== popupCampaign.id); setPopupCampaignId(next?.id ?? null); }} className="absolute left-3 top-3 z-10 rounded-full bg-black/70 px-3 py-2 text-sm font-bold text-white">إغلاق</button>
          <img src={popupCampaign.image_url} alt={popupCampaign.title} className="max-h-[70vh] w-full object-contain" />
          <div className="p-3 text-center text-sm font-black">{popupCampaign.title}</div>
        </div>
      </div>}
      {sections.map((section) => {
        const config = section.published_config ?? {};
        if (section.section_type === "table") {
          const columns = Array.isArray(config.columns) ? config.columns : [];
          const rows = Array.isArray(config.rows) ? config.rows : [];
          return <section key={section.id} className="rounded-2xl border border-border bg-card p-3">
            <h3 className="mb-2 text-sm font-black">{section.title}</h3>
            <div className="overflow-x-auto"><table className="w-full min-w-max text-right text-xs">
              {columns.length > 0 && <thead><tr>{columns.map((column: any, index: number) => <th key={index} className="border-b border-border bg-muted px-3 py-2 font-black">{String(column)}</th>)}</tr></thead>}
              <tbody>{rows.map((row: any, rowIndex: number) => <tr key={rowIndex}>{(Array.isArray(row) ? row : []).map((cell: any, cellIndex: number) => <td key={cellIndex} className="border-b border-border/60 px-3 py-2">{String(cell ?? "")}</td>)}</tr>)}</tbody>
            </table></div>
          </section>;
        }
        return <section key={section.id} className="rounded-2xl border border-border bg-card p-4">
          <h3 className="text-sm font-black">{config.title || section.title}</h3>
          {config.description && <p className="mt-1 text-xs text-muted-foreground">{config.description}</p>}
          {config.image_url && <img src={config.image_url} alt="" className="mt-3 max-h-40 w-full rounded-xl object-cover" />}
        </section>;
      })}
      {campaigns.map((campaign) => {
        const options = [...(campaign.app_campaign_options ?? [])].sort((a: any, b: any) => a.sort_order - b.sort_order);
        const selected = responses[campaign.id];
        const counts = results[campaign.id] ?? [];
        const votingOpen = (!campaign.starts_at || new Date(campaign.starts_at).getTime() <= Date.now()) && (!campaign.ends_at || new Date(campaign.ends_at).getTime() > Date.now());
        const showResults = campaign.result_visibility === "public" || (campaign.result_visibility === "after_end" && !!campaign.ends_at && new Date(campaign.ends_at).getTime() <= Date.now());
        const total = counts.reduce((sum: number, row: any) => sum + Number(row.vote_count ?? 0), 0);
        return <section key={campaign.id} className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between"><span className="text-[10px] font-black text-primary">{campaign.campaign_type === "contest" ? "مسابقة" : "استطلاع رأي"}</span><span className="text-[10px] text-muted-foreground">{total} مشاركة</span></div>
          <h3 className="mt-1 text-base font-black">{campaign.title}</h3>
          {campaign.description && <p className="mt-1 text-xs text-muted-foreground">{campaign.description}</p>}
          <div className="mt-3 space-y-2">{options.map((option: any) => {
            const count = Number(counts.find((row: any) => row.option_id === option.id)?.vote_count ?? 0);
            const percent = total > 0 ? Math.round(count / total * 100) : 0;
            return <button key={option.id} type="button" disabled={!session?.user?.id || !!selected || voting === campaign.id || !votingOpen} onClick={() => void vote(campaign, option.id)} className={`w-full rounded-xl border p-3 text-right text-sm transition ${selected === option.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}>
              <span className="flex items-center justify-between gap-2"><span>{option.label}</span>{showResults && <b className="text-xs text-primary">{percent}% · {count}</b>}</span>
              {showResults && <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary" style={{ width: percent + "%" }} /></span>}
            </button>;
          })}</div>
          {!session?.user?.id && <p className="mt-2 text-[11px] text-muted-foreground">سجّل الدخول حتى تشارك.</p>}
          {selected && <p className="mt-2 text-xs font-bold text-primary">تم تسجيل مشاركتك.</p>}
        </section>;
      })}
    </div>
  );
}

function QuickTile({
  to,
  type,
  vehicle,
  title,
  subtitle,
  icon,
  gradient,
  span = 1,
  delay = 0,
  iconBoxSize,
  sortOrder = 0,
  tileWidth,
  styleConfig = {},
}: {
  to: string;
  type: "taxi" | "service";
  vehicle?: "large";
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  gradient: string;
  span?: 1 | 2;
  delay?: number;
  iconBoxSize?: number;
  sortOrder?: number;
  tileWidth?: string;
  styleConfig?: Record<string, any>;
}) {
  if (styleConfig.is_hidden === true) return null;
  const cardHeight = Math.max(96, Math.min(360, Number(styleConfig.card_height_px) || (vehicle === "large" ? 188 : 145)));
  const cardPadding = Math.max(4, Math.min(32, Number(styleConfig.card_padding_px) || 10));
  const radius = Math.max(8, Math.min(40, Number(styleConfig.border_radius_px) || 20));
  const alignment = ["left", "center", "right"].includes(styleConfig.content_alignment) ? styleConfig.content_alignment : "right";
  const titleSize = Math.max(10, Math.min(28, Number(styleConfig.title_size_px) || 16));
  const subtitleSize = Math.max(8, Math.min(20, Number(styleConfig.subtitle_size_px) || 11));
  const iconScale = Math.max(0.5, Math.min(2, Number(styleConfig.icon_scale) || 1));
  const iconWidth = Math.max(24, Math.min(180, Number(styleConfig.width_px) || iconBoxSize || 56));
  const iconHeight = Math.max(24, Math.min(180, Number(styleConfig.height_px) || iconBoxSize || 56));
  return (
    <Link
      dir="rtl"
      to={to as any}
      search={{ type, ...(vehicle ? { vehicle } : {}) } as any}
      onClick={() => playClick("pop")}
      className="glass btn-press shadow-card tap-highlight-none animate-pop-in relative overflow-hidden group"
      style={{ animationDelay: `${delay}s`, order: vehicle === "large" ? 0 : sortOrder, gridColumn: vehicle === "large" ? "1" : span === 2 ? "1" : "2", width: tileWidth, flexShrink: tileWidth ? 0 : undefined, height: cardHeight, minHeight: cardHeight, borderRadius: radius, padding: cardPadding, backgroundColor: styleConfig.background_color || undefined, translate: `${Number(styleConfig.position_x_px) || 0}px ${Number(styleConfig.position_y_px) || 0}px`, transform: `scale(${Math.max(0.6, Math.min(1.6, Number(styleConfig.element_scale) || 1))})` }}
    >
      <div
        className={`absolute -bottom-6 -left-6 h-24 w-24 rounded-full bg-gradient-to-br ${gradient} opacity-20 blur-2xl group-hover:opacity-40 transition-opacity`}
      />
      <div className="relative flex h-full justify-between" style={{ flexDirection: styleConfig.content_direction === "row" ? "row" : "column", alignItems: alignment === "center" ? "center" : alignment === "left" ? "flex-start" : "flex-end" }}>
        <div
          className={`grid place-items-center text-white shadow-lg overflow-hidden ${type === "service" ? "rounded-xl" : "rounded-[14px]"} bg-gradient-to-br ${gradient}`}
          style={{ width: iconWidth, height: iconHeight, transform: `scale(${iconScale})` }}
        >
          <div style={{ transform: `translate(${Math.max(-100, Math.min(100, Number(styleConfig.content_position_x_px) || 0))}px, ${Math.max(-100, Math.min(100, Number(styleConfig.content_position_y_px) || 0))}px) scale(${Math.max(0.5, Math.min(2.5, Number(styleConfig.content_scale) || 1))})`, display: "grid", placeItems: "center", width: "100%", height: "100%" }}>{icon}</div>
        </div>
        <div style={{ width: styleConfig.content_direction === "row" ? "auto" : "100%", textAlign: alignment }}>
          <div className="flex items-center gap-1" style={{ justifyContent: alignment === "center" ? "center" : alignment === "left" ? "flex-start" : "flex-end" }}>
            <div className="font-black group-hover:text-primary transition-colors" style={{ fontSize: titleSize, color: styleConfig.title_color || undefined }}>
              {title}
            </div>
            <ArrowUpLeft className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
          </div>
          <div className="mt-0.5" style={{ fontSize: subtitleSize, color: styleConfig.subtitle_color || undefined }}>{subtitle}</div>
        </div>
      </div>
    </Link>
  );
}

function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="glass rounded-2xl p-3 flex flex-col items-center text-center gap-0.5">
      <div className="text-primary">{icon}</div>
      <div className="font-black text-sm text-foreground">{value}</div>
      <div className="text-[10px] text-muted-foreground font-medium">{label}</div>
    </div>
  );
}

function FeatureRow({
  icon,
  title,
  desc,
  accent,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  accent: string;
}) {
  return (
    <div className="glass rounded-2xl p-3.5 flex items-center gap-3 btn-press">
      <div
        className={`h-11 w-11 rounded-xl bg-gradient-to-br ${accent} grid place-items-center text-white shadow-md`}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-bold text-sm text-foreground">{title}</div>
        <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{desc}</div>
      </div>
    </div>
  );
}

function ProviderOfferCountdown({ expiresAt }: { expiresAt: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const remaining = Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));
  const progress = Math.max(0, Math.min(100, remaining / 60 * 100));
  const urgentFlash = remaining <= 10 && remaining % 2 === 0;
  return <div className="my-4 flex items-center justify-center gap-3">
    <div className="grid h-20 w-20 place-items-center rounded-full" style={{ background: `conic-gradient(${urgentFlash ? "#dc2626" : "#d69e36"} ${progress}%, #e5e7eb ${progress}% 100%)` }}>
      <div className="grid h-[68px] w-[68px] place-items-center rounded-full bg-background text-center">
        <span className={`text-xl font-black tabular-nums ${urgentFlash ? "text-red-600" : ""}`}>{String(Math.floor(remaining / 60)).padStart(2, "0")}:{String(remaining % 60).padStart(2, "0")}</span>
        <span className="text-[9px] text-muted-foreground">للقبول</span>
      </div>
    </div>
    <div className={`max-w-[210px] text-xs leading-6 ${remaining <= 10 ? "font-black text-red-600" : "text-muted-foreground"}`}>{remaining <= 10 ? "انتبه، راح ينتهي العرض خلال ثوانٍ!" : "أول مزوّد يقبل الطلب يحصل عليه، وبعد انتهاء الدقيقة ينتقل البحث للنطاق التالي."}</div>
  </div>;
}

function ProviderHome({ type, largeDriverMode = false }: { type: "taxi" | "service"; largeDriverMode?: boolean }) {
  const { session } = useAuth();
  const navigate = useNavigate();
  const acceptFn = useServerFn(acceptServiceRequest);
  const [available, setAvailable] = useState(false);
  const [requests, setRequests] = useState<any[]>([]);
  const [stats, setStats] = useState({ jobs: 0 });
  const [largeOfferPrices, setLargeOfferPrices] = useState<Record<string, string>>({});
  const [largeOfferMessages, setLargeOfferMessages] = useState<Record<string, string>>({});
  const [offerBusy, setOfferBusy] = useState<string | null>(null);
  const [teamSize, setTeamSize] = useState("1");
  const [popupRequest, setPopupRequest] = useState<any | null>(null);
  const popupShownRef = useRef<string | null>(null);
  useEffect(() => { setTeamSize("1"); }, [popupRequest?.id, popupRequest?.remaining_people_count]);
  const table = type === "taxi" ? "driver_profiles" : "worker_profiles";
  const [popupAttachmentUrl, setPopupAttachmentUrl] = useState<string | null>(null);
  const [popupAttachmentLoading, setPopupAttachmentLoading] = useState(false);
  useEffect(() => {
    const expiresAt = popupRequest?.my_offer?.expires_at;
    if (!expiresAt) return;
    const remainingMs = Date.parse(expiresAt) - Date.now();
    if (remainingMs <= 0) {
      setPopupRequest(null);
      return;
    }
    const timer = window.setTimeout(() => setPopupRequest(null), remainingMs);
    return () => window.clearTimeout(timer);
  }, [popupRequest?.my_offer?.expires_at]);

  useEffect(() => {
    let active = true;
    const attachmentPath = popupRequest?.attachment_path as string | null | undefined;
    setPopupAttachmentUrl(null);
    if (!attachmentPath) {
      setPopupAttachmentLoading(false);
      return;
    }
    setPopupAttachmentLoading(true);
    supabase.storage
      .from("request-attachments")
      .createSignedUrl(attachmentPath, 60 * 60)
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          console.warn("[provider-home] Could not sign request photo:", error.message);
          setPopupAttachmentUrl(null);
        } else {
          setPopupAttachmentUrl(data?.signedUrl ?? null);
        }
        setPopupAttachmentLoading(false);
      })
      .catch((error) => {
        if (!active) return;
        console.warn("[provider-home] Could not load request photo:", error);
        setPopupAttachmentUrl(null);
        setPopupAttachmentLoading(false);
      });
    return () => { active = false; };
  }, [popupRequest?.id, popupRequest?.attachment_path]);

  // Web providers must publish fresh GPS presence just like the native app.
  // Dispatch intentionally ignores stale locations so requests are never routed
  // to a provider who is no longer at the reported position.
  useEffect(() => {
    if (!session || !available) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      toast.error("هذا المتصفح لا يدعم تحديد الموقع؛ فعّل الاستقبال من تطبيق ممنون.");
      setAvailable(false);
      void supabase.from(table).update({ available: false }).eq("user_id", session.user.id);
      return;
    }

    let active = true;
    let watchId: number | null = null;
    let heartbeatId: number | null = null;
    let failed = false;
    const userId = session.user.id;
    const options: PositionOptions = {
      enableHighAccuracy: true,
      maximumAge: 15000,
      timeout: 20000,
    };

    const stopAvailability = async (message: string) => {
      if (!active || failed) return;
      failed = true;
      toast.error(message);
      setAvailable(false);
      const { error } = await supabase.from(table).update({ available: false }).eq("user_id", userId);
      if (error) console.error("[provider-presence] Could not disable availability:", error.message);
    };

    const publishPresence = async (position: GeolocationPosition) => {
      if (!active || failed) return;
      const { error } = await supabase.from("provider_presence").upsert({
        user_id: userId,
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        heading:
          position.coords.heading != null &&
          Number.isFinite(position.coords.heading) &&
          position.coords.heading >= 0 &&
          position.coords.heading <= 360
            ? position.coords.heading
            : null,
      }, { onConflict: "user_id" });
      if (error) {
        console.error("[provider-presence] Presence upsert failed:", error.message);
        await stopAvailability("تعذّر تحديث موقعك؛ أوقفنا استقبال الطلبات حتى لا تفوتك الطلبات.");
      }
    };

    const onLocationError = (error: GeolocationPositionError) => {
      console.warn("[provider-presence] Geolocation error:", error.code, error.message);
      if (error.code === error.PERMISSION_DENIED) {
        void stopAvailability("إذن الموقع مرفوض؛ فعّله من إعدادات المتصفح حتى تستقبل الطلبات.");
      }
    };

    watchId = navigator.geolocation.watchPosition(
      (position) => { void publishPresence(position); },
      onLocationError,
      options,
    );
    navigator.geolocation.getCurrentPosition(
      (position) => { void publishPresence(position); },
      onLocationError,
      options,
    );

    // Browser tabs may throttle watchPosition while idle. Refresh the fix
    // periodically so the database's five-minute freshness rule remains valid.
    heartbeatId = window.setInterval(() => {
      if (!active || failed) return;
      navigator.geolocation.getCurrentPosition(
        (position) => { void publishPresence(position); },
        onLocationError,
        options,
      );
    }, 45000);

    return () => {
      active = false;
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      if (heartbeatId !== null) window.clearInterval(heartbeatId);
    };
  }, [session, available, table]);

  useEffect(() => {
    if (!session) return;
    const providerUserId = session.user.id;
    supabase
      .from(table)
      .select("*")
      .eq("user_id", session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setAvailable(data.available);
          const d: any = data;
          setStats({ jobs: d.completed_jobs ?? d.completed_rides ?? 0 });
        }
      });

    async function loadRequests() {
      if (largeDriverMode) {
        const { data: offerRows, error: offerError } = await (supabase as any)
          .from("request_offers")
          .select("request_id, proposed_price, offer_message, expires_at, sent_at, distance_km")
          .eq("provider_id", providerUserId)
          .eq("status", "pending")
          .gt("expires_at", new Date().toISOString());
        if (offerError || !offerRows?.length) { setRequests([]); setPopupRequest(null); return; }
        const requestIds: string[] = [...new Set<string>((offerRows ?? []).map((offer: any) => String(offer.request_id)))];
        const { data } = await supabase
          .from("service_requests")
          .select("id, pickup_text, dest_text, notes, created_at, service_id, type, price_estimate, customer_price, pricing_mode, work_hours, work_description, attachment_path, vehicle_category, vehicle_type, urgency_multiplier, service_urgency_enabled, large_vehicle_urgency_enabled, taxi_urgency_enabled, taxi_urgency_percent")
          .in("id", requestIds)
          .eq("type", "taxi")
          .eq("vehicle_category", "large")
          .in("status", ["pending", "searching"])
          .order("urgency_multiplier", { ascending: false }).order("created_at", { ascending: false });
        const offerByRequest = new Map(offerRows.map((offer: any) => [offer.request_id, offer]));
        const mappedRequests = (data ?? []).map((request: any) => ({ ...request, my_offer: offerByRequest.get(request.id) }));
        setRequests(mappedRequests);
        const popupKey = mappedRequests[0] ? `${mappedRequests[0].id}:${mappedRequests[0].my_offer?.sent_at ?? ""}` : null;
        if (mappedRequests.length && popupShownRef.current !== popupKey) {
          popupShownRef.current = popupKey;
          setPopupRequest(mappedRequests[0]);
        } else if (!mappedRequests.length) {
          setPopupRequest(null);
        }
        return;
      }

      const { data: offerRows, error: offerError } = await (supabase as any)
        .from("request_offers")
        .select("request_id, expires_at, sent_at, distance_km")
        .eq("provider_id", providerUserId)
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString());
      if (offerError || !offerRows?.length) { setRequests([]); setPopupRequest(null); return; }
      const requestIds: string[] = [...new Set<string>(offerRows.map((offer: any) => String(offer.request_id)))];
      let query = supabase
        .from("service_requests")
        .select("id, pickup_text, dest_text, notes, created_at, service_id, type, price_estimate, customer_payable, customer_price, pricing_mode, work_hours, work_description, attachment_path, vehicle_category, vehicle_type, distance_km, workers_count, urgency_multiplier, service_urgency_enabled, large_vehicle_urgency_enabled, taxi_urgency_enabled, taxi_urgency_percent")
        .in("id", requestIds)
        .in("status", ["pending", "searching"])
        .eq("type", type);
      if (type === "taxi") query = query.neq("vehicle_category", "large");
      const { data } = await query.order("urgency_multiplier", { ascending: false }).order("created_at", { ascending: false }).limit(50);
      const offerByRequest = new Map(offerRows.map((offer: any) => [offer.request_id, offer]));
      let acceptedCountByRequest = new Map<string, number>();
      if (type === "service") {
        const { data: acceptedRows, error: acceptedRowsError } = await (supabase as any)
          .from("service_request_providers")
          .select("request_id,team_size")
          .in("request_id", requestIds);
        if (!acceptedRowsError) {
          acceptedCountByRequest = (acceptedRows ?? []).reduce((map: Map<string, number>, row: any) => {
            map.set(row.request_id, (map.get(row.request_id) ?? 0) + Number(row.team_size || 1));
            return map;
          }, new Map<string, number>());
        }
      }
      const mappedRequests = (data ?? []).map((request: any) => {
        const acceptedPeople = acceptedCountByRequest.get(request.id) ?? 0;
        return {
          ...request,
          my_offer: offerByRequest.get(request.id),
          accepted_people_count: acceptedPeople,
          remaining_people_count: Math.max(0, Number(request.workers_count || 1) - acceptedPeople),
        };
      });
      setRequests(mappedRequests);
      setPopupRequest((current: any) => current
        ? mappedRequests.find((request: any) => request.id === current.id) ?? current
        : current);
      const popupKey = mappedRequests[0] ? `${mappedRequests[0].id}:${mappedRequests[0].my_offer?.sent_at ?? ""}` : null;
      if (mappedRequests.length && popupShownRef.current !== popupKey) {
        popupShownRef.current = popupKey;
        setPopupRequest(mappedRequests[0]);
      } else if (!mappedRequests.length) {
        setPopupRequest(null);
      }
    }
    loadRequests();

    const channel = supabase
      .channel("provider-requests")
      .on("postgres_changes", { event: "*", schema: "public", table: "service_requests" }, () =>
        loadRequests(),
      )
      .subscribe();

    const timer = setInterval(loadRequests, 3000);

    let bc: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== "undefined") {
        bc = new BroadcastChannel("mumnun-offers");
        bc.onmessage = () => loadRequests();
      }
    } catch {}

    return () => {
      clearInterval(timer);
      bc?.close();
      supabase.removeChannel(channel);
    };
  }, [session, type, table, largeDriverMode]);

  async function toggleAvail() {
    playClick("toggle");
    const next = !available;

    // Never advertise a provider as available before a fresh location is stored.
    if (next) {
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        toast.error("متصفحك لا يدعم الموقع؛ استخدم تطبيق ممنون لتفعيل الاستقبال.");
        return;
      }
      try {
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            maximumAge: 10000,
            timeout: 20000,
          });
        });
        const { error: presenceError } = await supabase.from("provider_presence").upsert({
          user_id: session!.user.id,
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          heading:
            position.coords.heading != null &&
            Number.isFinite(position.coords.heading) &&
            position.coords.heading >= 0 &&
            position.coords.heading <= 360
              ? position.coords.heading
              : null,
        }, { onConflict: "user_id" });
        if (presenceError) throw presenceError;
      } catch (error: any) {
        toast.error(error?.code === 1
          ? "اسمح لممنون باستخدام موقعك حتى تستقبل الطلبات."
          : "تعذّر تحديد موقعك الحالي؛ شغّل GPS وحاول مرة ثانية.");
        return;
      }
    }

    const { error } = await supabase
      .from(table)
      .update({ available: next })
      .eq("user_id", session!.user.id);
    if (error) {
      toast.error("تعذّر تحديث الحالة");
      return;
    }
    setAvailable(next);
    if (next) toast.success("تم تفعيل الاستقبال ومشاركة موقعك الحي.");
  }

  async function sendLargeOffer(id: string) {
    const price = Number((largeOfferPrices[id] ?? "").replace(/[^0-9]/g, ""));
    if (!Number.isSafeInteger(price) || price < 250 || price % 250 !== 0) { toast.error("اكتب سعراً صحيحاً لا يقل عن 250 ديناراً ومن مضاعفات 250"); return; }
    setOfferBusy(id);
    try {
      const { error } = await (supabase as any).rpc("submit_large_vehicle_offer", { _request_id: id, _price: price, _message: largeOfferMessages[id] ?? null });
      if (error) throw error;
      toast.success("تم إرسال عرض السعر للزبون");
      setLargeOfferPrices((current) => ({ ...current, [id]: String(price) }));
    } catch (error: any) { toast.error(error?.message ?? "تعذر إرسال عرض السعر"); }
    finally { setOfferBusy(null); }
  }

  async function accept(id: string) {
    playClick("pop");
    try {
      if (type === "service" && session?.user.id) {
        const selectedTeamSize = Math.max(1, Math.min(10, Number(teamSize) || 1));
        const { error: teamError } = await (supabase as any)
          .from("worker_profiles")
          .update({ team_size: selectedTeamSize })
          .eq("user_id", session.user.id);
        if (teamError) throw teamError;
      }
      await acceptFn({ data: { requestId: id } });
      setPopupRequest(null);
      toast.success("تم قبول الطلب وإرسال عدد أفراد فريقك");
      navigate({ to: `/request/$id`, params: { id } });
    } catch (e: any) {
      toast.error(e.message ?? "تعذّر قبول الطلب");
    }
  }

  return (
    <div className="space-y-4">
      {popupRequest && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 p-4" role="dialog" aria-modal="true" aria-label="طلب جديد">
          <div className="w-full max-w-md max-h-[92vh] overflow-y-auto rounded-3xl border border-primary/40 bg-background p-5 shadow-2xl">
            <div className="mb-3 text-xs font-black text-primary">🔔 طلب جديد موجّه إلك</div>
            <div className="text-lg font-black text-foreground">{type === "taxi" ? (largeDriverMode ? "طلب سيارة كبيرة جديد" : "طلب رحلة جديد") : "طلب خدمة جديد"}</div>
            {(popupRequest.service_urgency_enabled || popupRequest.large_vehicle_urgency_enabled || popupRequest.taxi_urgency_enabled || Number(popupRequest.urgency_multiplier ?? 1) > 1) && <div className="mt-2 inline-flex rounded-full border border-amber-400/40 bg-amber-500/10 px-3 py-1 text-xs font-black text-amber-600">⚡ طلب مستعجل{Number(popupRequest.urgency_multiplier ?? 1) > 1 ? ` ×${popupRequest.urgency_multiplier}` : ""}</div>}
            {popupRequest.my_offer?.expires_at && <ProviderOfferCountdown expiresAt={popupRequest.my_offer.expires_at} />}
            <div className="mt-2 rounded-2xl bg-muted/60 p-3 text-sm font-bold text-foreground">📍 {popupRequest.pickup_text || "موقع الزبون"}</div>
            {popupRequest.dest_text && <div className="mt-2 text-xs text-muted-foreground">🎯 {popupRequest.dest_text}</div>}
            {popupRequest.my_offer?.distance_km != null && <div className="mt-2 text-xs font-bold text-muted-foreground">المسافة إليك: {Number(popupRequest.my_offer.distance_km).toFixed(1)} كم</div>}
            {(popupRequest.customer_price ?? popupRequest.customer_payable ?? popupRequest.price_estimate) != null && <div className="mt-2 text-sm font-black text-primary">السعر: {Number(popupRequest.customer_price ?? popupRequest.customer_payable ?? popupRequest.price_estimate).toLocaleString("ar-IQ")} د.ع</div>}
            {popupRequest.work_description && <div className="mt-2 text-xs text-muted-foreground">🛠️ {popupRequest.work_description}</div>}
            {type === "service" && (
              <div className="mt-3 rounded-xl border border-primary/20 bg-primary/5 p-3">
                <div className="text-xs font-black text-foreground">كم شخص يجي وياك؟</div>
                <div className="mt-1 text-[11px] text-muted-foreground">العدد يشمل الخبير نفسه، حتى نحسب الفريق بدقة.</div>
                <div className="mt-2 text-[11px] font-bold text-primary">المؤكد حالياً: {popupRequest.accepted_people_count ?? 0} · المتبقي: {popupRequest.remaining_people_count ?? popupRequest.workers_count ?? 1}</div>
                <select value={teamSize} onChange={(event) => setTeamSize(event.target.value)} className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-3 text-sm font-bold text-foreground">
                  {Array.from({ length: Math.min(5, Math.max(1, Number(popupRequest.remaining_people_count ?? popupRequest.workers_count) || 1)) }, (_, index) => index + 1).map((count) => (
                    <option key={count} value={String(count)}>
                      {count === 1 ? "أنا وحدي · شخص واحد" : `أنا + ${count - 1} ${count === 2 ? "عامل" : "عمال"} · ${count} أشخاص`}
                    </option>
                  ))}
                </select>
                <div className="mt-2 text-[11px] font-bold text-primary">المطلوب من الزبون: {popupRequest.workers_count ?? 1} أشخاص</div>
              </div>
            )}
            {popupRequest.attachment_path && (
              <div className="mt-3 rounded-2xl border border-primary/20 bg-primary/5 p-3">
                <div className="mb-2 text-sm font-black text-primary">صورة الزبون المرفقة بالطلب</div>
                {popupAttachmentUrl ? (
                  <img
                    src={popupAttachmentUrl}
                    alt="صورة مرفقة بطلب الزبون"
                    className="mx-auto h-[224px] max-h-[32vh] w-full rounded-xl bg-background object-contain"
                  />
                ) : (
                  <div className="py-4 text-center text-xs text-muted-foreground">
                    {popupAttachmentLoading ? "جاري تحميل الصورة..." : "تعذر تحميل الصورة حالياً"}
                  </div>
                )}
              </div>
            )}
            <div className="mt-4 flex gap-2">
              {!largeDriverMode && (
                <button onClick={() => { const id = popupRequest.id; setPopupRequest(null); void accept(id); }} className="flex-1 rounded-xl bg-primary px-4 py-3 text-sm font-black text-primary-foreground">موافقة وقبول</button>
              )}
              <button onClick={() => setPopupRequest(null)} className="flex-1 rounded-xl border border-border px-4 py-3 text-sm font-bold text-foreground">{largeDriverMode ? "تقديم عرض السعر" : "لاحقاً"}</button>
            </div>
          </div>
        </div>
      )}
      <div
        className={`relative rounded-3xl p-5 overflow-hidden animate-pop-in shadow-card ${
          available ? "bg-gradient-to-br from-emerald-500 to-teal-400 text-white" : "glass"
        }`}
      >
        {available && <div className="absolute inset-0 shine opacity-30 mix-blend-overlay" />}
        <div className="relative flex items-center justify-between">
          <div>
            <div className={`text-xs ${available ? "text-white/80" : "text-muted-foreground"}`}>
              حالة التوفر
            </div>
            <div className="font-black text-lg mt-0.5">{available ? "متاح للعمل" : "غير متاح"}</div>
          </div>
          <button
            onClick={toggleAvail}
            className={`h-14 w-14 rounded-2xl grid place-items-center btn-press transition ${
              available ? "bg-white/25 backdrop-blur" : "bg-surface-2"
            }`}
          >
            <Power className={`h-6 w-6 ${available ? "text-white" : "text-muted-foreground"}`} />
          </button>
        </div>
      </div>

      <ProviderMissions />

      <div className="glass rounded-2xl p-4 animate-pop-in" style={{ animationDelay: "0.05s" }}>
        <div className="text-xs text-muted-foreground">الطلبات المكتملة</div>
        <div className="font-black text-lg mt-1">{stats.jobs}</div>
      </div>

      <div>
        <h3 className="font-black mb-3 mt-2">الطلبات المتاحة</h3>
        {!available && (
          <div className="glass rounded-2xl p-4 text-center text-sm text-muted-foreground">
            فعّل التوفر لعرض الطلبات
          </div>
        )}
        {available && requests.length === 0 && (
          <div className="glass rounded-2xl p-6 text-center text-sm text-muted-foreground">
            لا توجد طلبات جديدة الآن
          </div>
        )}
        {available &&
          requests.map((r, i) => (
            <div
              key={r.id}
              className="glass rounded-2xl p-4 mb-2.5 animate-pop-in"
              style={{ animationDelay: `${i * 0.04}s` }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold truncate">
                    📍 {r.pickup_text || "بدون عنوان"}
                  </div>
                  {(r.service_urgency_enabled || r.large_vehicle_urgency_enabled || r.taxi_urgency_enabled) && <div className="mt-1 text-xs font-black text-amber-600">⚡ طلب مستعجل</div>}
                  {r.dest_text && (
                    <div className="text-xs text-muted-foreground mt-1 truncate">
                      🎯 {r.dest_text}
                    </div>
                  )}
                  {largeDriverMode && <div className="text-xs text-muted-foreground mt-1">🚚 طلب سيارة كبيرة — الوجهة اختيارية</div>}
                  {r.work_description && (
                    <div className="text-xs mt-1 line-clamp-2">🛠️ {r.work_description}</div>
                  )}
                  {(r.customer_price || r.price_estimate) && (
                    <div className="text-sm font-black text-primary mt-1">
                      💰 {(r.customer_price ?? r.price_estimate).toLocaleString()} د.ع
                      {r.pricing_mode === "hourly" && r.work_hours
                        ? ` · ${r.work_hours} ساعة`
                        : r.pricing_mode === "fixed"
                          ? " · إنجاز تام"
                          : ""}
                    </div>
                  )}
                  {r.pricing_mode === "negotiable" && (
                    <div className="text-xs font-bold text-primary mt-1">
                      💰 السعر يتفق عليه وياك
                    </div>
                  )}
                  {r.notes && (
                    <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      📝 {r.notes}
                    </div>
                  )}
                  {largeDriverMode && (
                    <div className="mt-3 space-y-2">
                      <input value={largeOfferPrices[r.id] ?? (r.my_offer?.proposed_price ? String(r.my_offer.proposed_price) : "")}
                        onChange={(e) => setLargeOfferPrices((current) => ({ ...current, [r.id]: e.target.value.replace(/[^0-9]/g, "") }))}
                        inputMode="numeric" placeholder="عرض سعرك بالدينار" className="w-full rounded-xl border border-orange-200 bg-white px-3 py-2 text-sm" />
                      <input value={largeOfferMessages[r.id] ?? r.my_offer?.offer_message ?? ""}
                        onChange={(e) => setLargeOfferMessages((current) => ({ ...current, [r.id]: e.target.value }))}
                        placeholder="ملاحظة للزبون (اختياري)" className="w-full rounded-xl border border-orange-200 bg-white px-3 py-2 text-sm" />
                      <button onClick={() => sendLargeOffer(r.id)} disabled={offerBusy === r.id}
                        className="w-full rounded-xl bg-orange-600 text-white px-4 py-2.5 text-xs font-black disabled:opacity-60">
                        {offerBusy === r.id ? "جارٍ إرسال العرض..." : r.my_offer?.proposed_price ? "تحديث عرض السعر" : "إرسال عرض السعر"}
                      </button>
                    </div>
                  )}
                </div>
                {largeDriverMode ? (
                  <span className="shrink-0 rounded-xl bg-orange-100 text-orange-800 px-3 py-2 text-[10px] font-black">
                    {r.vehicle_type === "kia_cargo" ? "كيا حمل" : r.vehicle_type === "kia_passenger" ? "كيا ركاب" : "باص"}
                  </span>
                ) : (
                  <button
                    onClick={() => accept(r.id)}
                    className="shrink-0 px-4 py-2 rounded-xl bg-gradient-to-br from-primary to-primary-glow text-primary-foreground font-bold text-xs btn-press shadow-md"
                  >
                    قبول
                  </button>
                )}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
