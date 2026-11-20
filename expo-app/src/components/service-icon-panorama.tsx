import { useEffect, useState } from "react";
import { Image, View } from "react-native";
import { getServiceImage } from "@/lib/service-visuals";

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
};

export function ServiceIconPanorama({ imageUrl, imageScale = 1 }: Props) {
  const [index, setIndex] = useState(0);
  const scale = Math.min(1.8, Math.max(0.65, Number(imageScale) || 1));

  useEffect(() => {
    if (imageUrl) return;
    const timer = setInterval(() => setIndex((value) => (value + 1) % SERVICES.length), 2400);
    return () => clearInterval(timer);
  }, [imageUrl]);

  return (
    <View
      pointerEvents="none"
      style={{ width: "100%", height: "100%", overflow: "hidden", borderRadius: 18, padding: 0, margin: 0 }}
    >
      <Image
        source={imageUrl ? { uri: imageUrl } : getServiceImage(SERVICES[index])}
        resizeMode="cover"
        style={{
          position: "absolute",
          width: "100%",
          height: "100%",
          left: 0,
          top: 0,
          borderRadius: 18,
          transform: [{ scale }],
        }}
      />
    </View>
  );
}
