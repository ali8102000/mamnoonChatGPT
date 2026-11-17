import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ShieldCheck, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { GOV_STORAGE_KEY } from "@/lib/governorates";

type Row = {
  governorate_key: string; services_enabled: boolean; message_enabled: boolean;
  message_title: string; message_text: string; message_animate: boolean;
  message_image_url?: string; rejection_message?: string;
  message_float_enabled?: boolean; message_width_percent?: number; message_height_percent?: number;
  message_position?: "top-center" | "top-right" | "top-left"; message_top_offset?: number; message_font_size?: number;
};

export function RegionalServiceBanner() {
  const [row, setRow] = useState<Row | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    let active = true;
    const load = async () => {
      let key = "";
      try { key = localStorage.getItem(GOV_STORAGE_KEY) || ""; } catch {}
      let shouldLocate = !key;
      if (navigator.permissions?.query) {
        const permission = await navigator.permissions.query({ name: "geolocation" }).catch(() => null);
        shouldLocate = shouldLocate || permission?.state === "granted";
      }
      if (navigator.geolocation && shouldLocate) {
        const position = await new Promise<GeolocationPosition | null>((resolve) => navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { enableHighAccuracy: false, timeout: 5000, maximumAge: 300000 }));
        if (position) {
          const { data } = await supabase.auth.getSession();
          if (data.session?.access_token) {
            const response = await fetch("/api/mobile-maps", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify({ action: "detectGovernorate", center: { lat: position.coords.latitude, lng: position.coords.longitude } }) }).catch(() => null);
            const result = response?.ok ? await response.json().catch(() => null) : null;
            if (result?.key) { key = result.key; try { localStorage.setItem(GOV_STORAGE_KEY, key); } catch {} }
          }
        }
      }
      if (!active || !key) return;
      const { data, error } = await (supabase as any).from("regional_service_controls")
        .select("governorate_key,services_enabled,message_enabled,message_title,message_text,message_animate,message_image_url,rejection_message,message_float_enabled,message_width_percent,message_height_percent,message_position,message_top_offset,message_font_size")
        .in("governorate_key", [key, "all"]);
      if (!active) return;
      if (error) { console.warn("[regional controls] load failed", error); return; }
      const exact = (data ?? []).find((item: Row) => item.governorate_key === key);
      const global = (data ?? []).find((item: Row) => item.governorate_key === "all");
      const base = exact || global;
      if (!base) { setRow(null); return; }
      setRow({
        ...base,
        services_enabled: global?.services_enabled === false ? false : exact?.services_enabled ?? global?.services_enabled ?? true,
        message_float_enabled: exact?.message_float_enabled ?? global?.message_float_enabled ?? true,
        message_width_percent: exact?.message_width_percent ?? global?.message_width_percent ?? 92,
        message_height_percent: exact?.message_height_percent ?? global?.message_height_percent ?? 34,
        message_position: exact?.message_position ?? global?.message_position ?? "top-center",
        message_top_offset: exact?.message_top_offset ?? global?.message_top_offset ?? 12,
        message_font_size: exact?.message_font_size ?? global?.message_font_size ?? 14,
      });
    };
    void load();
    const channel = supabase.channel("regional-service-controls-web").on("postgres_changes", { event: "*", schema: "public", table: "regional_service_controls" }, () => { void load(); }).subscribe();
    const timer = setInterval(() => void load(), 30000);
    return () => { active = false; clearInterval(timer); void supabase.removeChannel(channel); };
  }, []);
  if (!mounted || !row || (row.services_enabled && !row.message_enabled)) return null;
  const message = row.message_text || (row.services_enabled ? "" : "الخدمات متوقفة مؤقتاً في محافظتك بقرار من إدارة ممنون.");
  if (!message) return null;
  const width = Math.max(60, Math.min(100, row.message_width_percent ?? 92));
  const height = Math.max(12, Math.min(60, row.message_height_percent ?? 34));
  const top = Math.max(0, Math.min(160, row.message_top_offset ?? 12));
  const fontSize = Math.max(11, Math.min(22, row.message_font_size ?? 14));
  const position = row.message_position ?? "top-center";
  const floating = row.message_float_enabled !== false;
  const card = (
    <div dir="rtl" className="rounded-2xl border border-amber-400/60 bg-[#080808] px-4 py-3 text-right text-amber-100 shadow-[0_8px_30px_rgba(0,0,0,.38)] overflow-y-auto"
      style={floating ? { position: "fixed", zIndex: 99999, top: `max(env(safe-area-inset-top), ${top}px)`, width: `min(${width}vw, calc(100vw - 16px))`, height: `min(${height}vh, calc(100vh - ${top + 16}px))`, left: position === "top-center" ? "50%" : position === "top-left" ? "8px" : "auto", right: position === "top-right" ? "8px" : "auto", transform: position === "top-center" ? "translateX(-50%)" : "none" } : { position: "relative", margin: "0 16px 12px" }}>
      <div className="flex items-center justify-between gap-2 border-b border-amber-500/25 pb-2">
        <span className="font-black tracking-wide bg-gradient-to-l from-yellow-100 via-amber-400 to-yellow-700 bg-clip-text text-transparent" style={{fontSize: Math.max(10,fontSize-2)}}>{row.message_title || "تنويه رسمي من إدارة ممنون"}</span>
        <span className="inline-flex items-center gap-1 text-amber-300" style={{fontSize: Math.max(9,fontSize-5)}}><ShieldCheck className="h-3 w-3" /> إدارة ممنون · الحساب الرسمي الموثّق</span>
      </div>
      {row.message_enabled && row.message_image_url && <img src={row.message_image_url} alt="صورة تنويه إدارة ممنون" className="mt-3 max-h-40 w-full rounded-xl object-contain" />}
      <div className="relative mt-2 overflow-hidden whitespace-nowrap">
        <div className={row.message_animate ? "mamnoon-regional-marquee" : "leading-6 whitespace-normal"} style={{fontSize,lineHeight:1.8}}>{message}</div>
      </div>
      {!row.services_enabled && <div className="mt-3 rounded-xl border border-amber-500/35 bg-gradient-to-l from-[#211706] to-[#090909] p-3"><div className="flex items-center justify-between text-[10px] font-black text-amber-300"><span>رسالة رفض الطلب</span><span>✓ إدارة ممنون الموثّقة</span></div><p className="mt-2 font-black leading-7 text-amber-100" style={{fontSize}}>{row.rejection_message || "الخدمة متوقفة حالياً في منطقتك بقرار من إدارة ممنون."}</p><div className="mt-2 flex items-center gap-1 text-[10px] text-rose-300"><AlertTriangle className="h-3 w-3" /> إنشاء الطلبات متوقف حالياً في هذه المحافظة.</div></div>}
      <style>{`@keyframes mamnoon-regional-scroll { 0% { transform: translateX(100%); } 100% { transform: translateX(-100%); } } .mamnoon-regional-marquee { display:inline-block; width:max-content; white-space:nowrap; color:#f6d98a; will-change:transform; animation:mamnoon-regional-scroll 24s ease-in-out infinite alternate; }`}</style>
    </div>
  );
  return floating ? createPortal(card, document.body) : card;
}
