import { useEffect, useRef, useState } from "react";
import { ScrollView, View, Text, Image } from "react-native";
import { supabase } from "@/lib/supabase";
import { getServiceImage } from "@/lib/service-visuals";

const SERVICES = [
  ["build","بناء"],["plaster","لبخ"],["carpentry_form","نجارة"],["flooring","أرضيات"],["chef","طباخ"],
  ["plumbing","سباكة"],["electric_setup","كهرباء"],["electric_street","كهربائي"],["washer_repair","غسالات"],["stove_repair","طباخات"],
  ["fridge_repair","ثلاجات"],["ac_repair","تبريد"],["cleaning","تنظيف"],["wood_carpentry","نجارة خشب"],["blacksmith","حداد"],
  ["goods_transport","نقل بضائع"],["furniture_moving","نقل أثاث"],["cargo_handling","تحميل"],["gardener","حدائق"],["internet_install","إنترنت"],
  ["phone_repair","موبايلات"],["electronics_repair","إلكترونيات"],["computer_repair","حاسبات"],["security_cameras","كاميرات"],["general","خدمات عامة"],
] as const;

export function ServiceIconPanorama() {
  const scroll = useRef<ScrollView>(null);
  const offset = useRef(0);
  const [seconds,setSeconds] = useState(2);
  const [imageSize,setImageSize] = useState(56);
  useEffect(() => {
    let active = true;
    (supabase as any).from("company_settings").select("service_icon_display_seconds,service_icon_image_size_px").eq("id",1).maybeSingle()
      .then(({data}: any) => { if(active && Number.isInteger(data?.service_icon_display_seconds)) setSeconds(Math.min(10,Math.max(1,data.service_icon_display_seconds))); if(active && Number.isInteger(data?.service_icon_image_size_px)) setImageSize(Math.min(64,Math.max(24,data.service_icon_image_size_px))); });
    return () => { active = false; };
  },[]);
  useEffect(() => {
    const timer = setInterval(() => {
      offset.current += 58;
      if(offset.current >= SERVICES.length * 58) offset.current = 0;
      scroll.current?.scrollTo({x:offset.current,animated:true});
    },seconds * 1000);
    return () => clearInterval(timer);
  },[seconds]);
  return <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false} scrollEnabled={false} style={{width:68,height:68}} contentContainerStyle={{alignItems:"center",gap:5}}>
    {SERVICES.map(([slug,label]) => <View key={slug} style={{width:53,alignItems:"center",justifyContent:"center",gap:2}}>
      <Image source={getServiceImage(slug)} style={{width:imageSize,height:imageSize,borderRadius:imageSize / 2,overflow:"hidden"}} resizeMode="cover" />
      <Text numberOfLines={1} style={{fontSize:8,fontWeight:"800",color:"#fff"}}>{label}</Text>
    </View>)}
  </ScrollView>;
}
