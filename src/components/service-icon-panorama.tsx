import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { serviceIcon } from "@/lib/service-visuals";

const SERVICES = [
  ["build","بناء"],["plaster","لبخ"],["carpentry_form","نجارة"],["flooring","أرضيات"],["chef","طباخ"],
  ["plumbing","سباكة"],["electric_setup","كهرباء"],["electric_street","كهربائي"],["washer_repair","غسالات"],["stove_repair","طباخات"],
  ["fridge_repair","ثلاجات"],["ac_repair","تبريد"],["cleaning","تنظيف"],["wood_carpentry","نجارة خشب"],["blacksmith","حداد"],
  ["goods_transport","نقل بضائع"],["furniture_moving","نقل أثاث"],["cargo_handling","تحميل"],["gardener","حدائق"],["internet_install","إنترنت"],
  ["phone_repair","موبايلات"],["electronics_repair","إلكترونيات"],["computer_repair","حاسبات"],["security_cameras","كاميرات"],["general","خدمات عامة"],
] as const;

export function ServiceIconPanorama() {
  const track = useRef<HTMLDivElement>(null);
  const [seconds, setSeconds] = useState(2);
  const [imageSize, setImageSize] = useState(40);
  useEffect(() => {
    let active = true;
    (supabase as any).from("company_settings").select("service_icon_display_seconds,service_icon_image_size_px").eq("id",1).maybeSingle()
      .then(({data}: any) => { if(active && Number.isInteger(data?.service_icon_display_seconds)) setSeconds(Math.min(10,Math.max(1,data.service_icon_display_seconds))); if(active && Number.isInteger(data?.service_icon_image_size_px)) setImageSize(Math.min(64,Math.max(24,data.service_icon_image_size_px))); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const node = track.current;
    if (!node) return;
    const timer = window.setInterval(() => {
      const end = node.scrollWidth - node.clientWidth;
      if (node.scrollLeft >= end - 4) node.scrollTo({left:0,behavior:"smooth"});
      else node.scrollBy({left:58,behavior:"smooth"});
    }, seconds * 1000);
    return () => window.clearInterval(timer);
  }, [seconds]);
  return <div dir="ltr" className="h-full w-full overflow-hidden flex items-center justify-center">
    <div ref={track} className="flex h-full w-full items-center justify-center gap-2 overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {SERVICES.map(([slug,label]) => <div key={slug} className="flex min-w-[54px] flex-col items-center justify-center gap-0.5">
        <img src={serviceIcon(slug)} alt="" style={{width:imageSize,height:imageSize}} className="rounded-full object-cover overflow-hidden shrink-0" />
        <span className="max-w-[54px] truncate text-[8px] font-bold text-white">{label}</span>
      </div>)}
    </div>
  </div>;
}
