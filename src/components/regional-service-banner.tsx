import { useEffect, useState } from "react";
import { ShieldCheck, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { GOV_STORAGE_KEY } from "@/lib/governorates";

type Row = { governorate_key: string; services_enabled: boolean; message_enabled: boolean; message_title: string; message_text: string; message_animate: boolean };

export function RegionalServiceBanner() {
  const [row, setRow] = useState<Row | null>(null);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    const load = async () => {
      let key = "";
      try { key = localStorage.getItem(GOV_STORAGE_KEY) || ""; } catch {}
      if (!key && navigator.geolocation) {
        const position = await new Promise<GeolocationPosition | null>((resolve) =>
          navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { enableHighAccuracy: false, timeout: 4500, maximumAge: 300000 }),
        );
        if (position) {
          const { data } = await supabase.auth.getSession();
          if (data.session?.access_token) {
            const response = await fetch("/api/mobile-maps", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
              body: JSON.stringify({ action: "detectGovernorate", center: { lat: position.coords.latitude, lng: position.coords.longitude } }),
            }).catch(() => null);
            const result = response?.ok ? await response.json().catch(() => null) : null;
            key = result?.key || "";
            if (key) { try { localStorage.setItem(GOV_STORAGE_KEY, key); } catch {} }
          }
        }
      }
      if (!active || !key) return;
      const { data } = await (supabase as any).from("regional_service_controls").select("*").in("governorate_key", [key, "all"]);
      if (!active) return;
      const exact = (data ?? []).find((item: Row) => item.governorate_key === key);
      const global = (data ?? []).find((item: Row) => item.governorate_key === "all");
      setRow((exact || global || null) as Row | null);
    };
    void load();
    timer = setInterval(() => void load(), 60000);
    return () => { active = false; if (timer) clearInterval(timer); };
  }, []);
  if (!row || (row.services_enabled && !row.message_enabled)) return null;
  const text = row.message_text || (row.services_enabled ? "" : "الخدمات متوقفة مؤقتاً في محافظتك بقرار من إدارة ممنون.");
  if (!text) return null;
  return (
    <div className="mb-4 rounded-2xl border border-amber-400/60 bg-[#080808] px-4 py-3 text-right shadow-[0_8px_30px_rgba(0,0,0,.24)] overflow-hidden" dir="rtl">
      <div className="flex items-center justify-between gap-2 border-b border-amber-500/25 pb-2">
        <span className="text-[10px] font-black tracking-wide bg-gradient-to-l from-yellow-100 via-amber-400 to-yellow-700 bg-clip-text text-transparent">{row.message_title || "تنويه رسمي من إدارة ممنون"}</span>
        <span className="inline-flex items-center gap-1 text-[9px] text-amber-300"><ShieldCheck className="h-3 w-3" /> الإدارة الرسمية · موثّق</span>
      </div>
      <div className="relative mt-2 overflow-hidden whitespace-nowrap">
        <div className={row.message_animate ? "mamnoon-regional-marquee" : "text-xs leading-6 text-amber-100 whitespace-normal"}>{text}</div>
      </div>
      {!row.services_enabled && <div className="mt-2 flex items-center gap-1 text-[10px] text-rose-300"><AlertTriangle className="h-3 w-3" /> إنشاء الطلبات متوقف حالياً في هذه المحافظة.</div>}
      <style>{`@keyframes mamnoon-regional-scroll { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } } .mamnoon-regional-marquee { display:inline-block; min-width:100%; white-space:nowrap; font-size:12px; line-height:1.9; color:#f6d98a; animation:mamnoon-regional-scroll 20s linear infinite; }`}</style>
    </div>
  );
}
