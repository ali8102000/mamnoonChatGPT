import { useEffect, useState } from "react";
import { Image, Text, View } from "react-native";
import { getServiceImage } from "@/lib/service-visuals";
import { supabase } from "@/lib/supabase";

const SERVICES = [
  "build","plaster","carpentry_form","flooring","chef",
  "plumbing","electric_setup","electric_street","washer_repair","stove_repair",
  "fridge_repair","ac_repair","cleaning","wood_carpentry","blacksmith",
  "goods_transport","furniture_moving","cargo_handling","gardener","internet_install",
  "phone_repair","electronics_repair","computer_repair","security_cameras","general",
] as const;

type Props = {
  imageUrl?: string | null;
  imageScale?: number;
  imageFit?: "cover" | "contain";
  imageShape?: "square" | "landscape" | "portrait";
  imageRadius?: number;
  contentPositionX?: number;
  contentPositionY?: number;
};

export function ServiceIconPanorama({ imageUrl, imageScale = 1, imageFit, imageShape, imageRadius, contentPositionX, contentPositionY }: Props) {
  const [index, setIndex] = useState(0);
  const [visuals, setVisuals] = useState<Record<string, any>>({});
  const scale = Math.min(1.8, Math.max(0.65, Number(imageScale) || 1));

  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data, error } = await (supabase as any).from("app_ui_elements_public").select("element_key,published_config,title").eq("placement_key", "home.customer.service_icons");
      if (!active || error) return;
      const next: Record<string, any> = {};
      for (const item of data ?? []) next[String(item.element_key).replace("service_", "")] = { ...(item.published_config ?? {}), title: item.title };
      setVisuals(next);
    };
    void load();
    // Artwork configuration changes infrequently; polling avoids a persistent
    // channel on the home tab and keeps the native view safe during remounts.
    const refreshTimer = setInterval(() => { void load(); }, 30_000);
    return () => { active = false; clearInterval(refreshTimer); };
  }, []);

  useEffect(() => {
    if (imageUrl) return;
    const timer = setInterval(() => setIndex((value) => (value + 1) % SERVICES.length), 2400);
    return () => clearInterval(timer);
  }, [imageUrl]);

  return (
    <View
      pointerEvents="none"
      style={{ width: "100%", height: "100%", overflow: "hidden", borderRadius: 18, padding: 0, margin: 0, alignItems: "center", justifyContent: "center" }}
    >
      {(() => {
        const visual = visuals[SERVICES[index]] || {};
        if (!imageUrl && visual.icon_name) return <Text style={{ fontSize: 28, textAlign: "center", transform: [{ translateX: Number(visual.content_position_x_px) || 0 }, { translateY: Number(visual.content_position_y_px) || 0 }, { scale: Math.max(.5, Math.min(2.5, Number(visual.content_scale) || 1)) }] }}>{visual.icon_name}</Text>;
        return <Image
          source={imageUrl ? { uri: imageUrl } : visual.image_url ? { uri: visual.image_url } : getServiceImage(SERVICES[index])}
          resizeMode={(imageUrl ? imageFit : visual.image_fit) === "contain" ? "contain" : "cover"}
          style={{
            width: Number(visual.width_px) || "100%",
            height: Number(visual.height_px) || "100%",
            borderRadius: Number(imageUrl ? imageRadius ?? 18 : visual.image_border_radius_px ?? 18),
            aspectRatio: (imageUrl ? imageShape : visual.image_shape) === "landscape" ? 4/3 : (imageUrl ? imageShape : visual.image_shape) === "portrait" ? 3/4 : 1,
            transform: [{ translateX: Number(imageUrl ? contentPositionX : visual.content_position_x_px) || 0 }, { translateY: Number(imageUrl ? contentPositionY : visual.content_position_y_px) || 0 }, { scale: scale * Math.max(.5,Math.min(2.5,Number(visual.content_scale)||1)) }],
          }}
        />;
      })()}
    </View>
  );
}
