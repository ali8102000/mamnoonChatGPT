import { useEffect, useRef, useState } from "react";
import { Alert, Animated, Dimensions, Easing, Pressable } from "react-native";
import { supabase } from "@/lib/supabase";
import { palette } from "@/styles/theme";

type SquareBanner = { id: string; image_url: string; scroll_speed: number; display_order: number };
type Props = { width?: number; height?: number };

export function HomeTopSquareBanner({ width = (Dimensions.get("window").width - 36) / 3, height = 188 }: Props) {
  const [banners, setBanners] = useState<SquareBanner[]>([]);
  const [index, setIndex] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const pauseUntil = useRef(0);
  const suppressPress = useRef(false);
  const motion = useRef(new Animated.Value(0)).current;
  const current = banners[index] ?? null;

  useEffect(() => {
    motion.setValue(0);
    const animation = Animated.timing(motion, { toValue: 1, duration: 450, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [motion, current?.id]);

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
    const channel = supabase.channel("home-top-square-banner-native")
      .on("postgres_changes", { event: "*", schema: "public", table: "home_carousel_banners" }, () => void load())
      .subscribe();
    return () => { active = false; void supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    if (banners.length < 2) return;
    const seconds = Math.max(1, Math.min(60, Number(current?.scroll_speed) || 5));
    const timer = setInterval(() => {
      if (Date.now() < pauseUntil.current) return;
      setIndex((value) => (value + 1) % banners.length);
    }, seconds * 1000);
    return () => clearInterval(timer);
  }, [banners, current?.scroll_speed]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="بانر الشركاء والعروض، سيتوفر قريباً"
      onTouchStart={(event) => {
        touchStartX.current = event.nativeEvent.pageX;
        suppressPress.current = false;
      }}
      onTouchEnd={(event) => {
        const endX = event.nativeEvent.pageX;
        const startX = touchStartX.current;
        pauseUntil.current = Date.now() + 5000;
        if (startX != null && Math.abs(endX - startX) > 28 && banners.length > 1) {
          suppressPress.current = true;
          setIndex((value) => (value + (endX < startX ? 1 : -1) + banners.length) % banners.length);
        }
        touchStartX.current = null;
      }}
      onPress={() => {
        if (suppressPress.current) { suppressPress.current = false; return; }
        Alert.alert("سيتوفر قريباً", "أنت شريك؟ سجل ويانه وانتظر طلباتك", [{ text: "حسناً" }]);
      }}
      style={{
        width,
        height,
        borderRadius: 20,
        overflow: "hidden",
        backgroundColor: palette.surface,
        borderWidth: 1,
        borderColor: palette.line,
        borderStyle: banners.length ? "solid" : "dashed",
      }}
    >
      {current?.image_url ? (
        <Animated.Image key={current.id} source={{ uri: current.image_url }} resizeMode="cover"
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%", opacity: motion, transform: [{ translateX: motion.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }] }} />
      ) : null}
    </Pressable>
  );
}
