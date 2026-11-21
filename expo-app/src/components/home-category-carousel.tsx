import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Dimensions, PanResponder, Pressable, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { supabase } from "@/lib/supabase";

type Category = "restaurant" | "hotel" | "store";
type CategoryBanner = {
  id: string; image_url: string; target_category: Category; display_order: number; is_active: boolean;
  scroll_speed?: number | null; motion_direction?: "left" | "right" | "up" | "down" | null;
  motion_style?: "slide" | "fade" | "drop" | null; banner_title?: string | null; banner_description?: string | null;
};

const fallbackSlides = [
  { id: "restaurant", title: "المطاعم", subtitle: "مطاعم وكافيهات", category: "restaurant" as const, image_url: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1200&q=85" },
  { id: "hotel", title: "الفنادق", subtitle: "فنادق وشقق فندقية", category: "hotel" as const, image_url: "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=85" },
  { id: "mall", title: "المولات", subtitle: "مراكز تسوق وترفيه", category: "store" as const, image_url: "https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=1200&q=85" },
  { id: "shop", title: "المتاجر", subtitle: "محلات ومتاجر قريبة", category: "store" as const, image_url: "https://images.unsplash.com/photo-1472851294608-062f824d29cc?auto=format&fit=crop&w=1200&q=85" },
];

export function HomeCategoryCarousel({ height = 360, width: requestedWidth, placement = "top_panorama" }: { height?: number; width?: number; placement?: "top_panorama" | "restaurant_section" }) {
  const width = requestedWidth ?? (Dimensions.get("window").width - 36) * (2 / 3);
  const [banners, setBanners] = useState<CategoryBanner[]>([]);
  const [index, setIndex] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const opacity = useRef(new Animated.Value(1)).current;
  const translate = useRef(new Animated.Value(0)).current;
  const slideCount = useRef(1);
  const swipeResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onStartShouldSetPanResponderCapture: () => false,
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 18 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.15,
    onMoveShouldSetPanResponderCapture: (_, gesture) => Math.abs(gesture.dx) > 18 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.15,
    onPanResponderTerminationRequest: () => false,
    onPanResponderRelease: (_, gesture) => { if (slideCount.current < 2 || Math.abs(gesture.dx) < 30) return; setIndex((value) => (value + (gesture.dx < 0 ? 1 : -1) + slideCount.current) % slideCount.current); },
  })).current;

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const { data, error } = await (supabase as any).from("home_carousel_banners")
        .select("id,image_url,target_category,display_order,is_active,scroll_speed,motion_direction,motion_style,banner_title,banner_description")
        .eq("is_active", true).eq("banner_type", "category").eq("display_location", placement).order("display_order").order("created_at");
      if (active && !error) { setBanners(data ?? []); setIndex(0); setImageFailed(false); }
    };
    void refresh();
    const channel = supabase.channel("home-category-panorama-native")
      .on("postgres_changes", { event: "*", schema: "public", table: "home_carousel_banners" }, () => void refresh())
      .subscribe();
    return () => { active = false; void supabase.removeChannel(channel); };
  }, [placement]);

  const slides = useMemo(() => banners.length ? banners.map((item) => ({
    id: item.id, image_url: item.image_url, category: item.target_category,
    title: item.banner_title || (item.target_category === "restaurant" ? "المطاعم" : item.target_category === "hotel" ? "الفنادق" : "المتاجر"),
    subtitle: item.banner_description || "اكتشف الأماكن والخدمات القريبة",
    scroll_speed: item.scroll_speed, motion_direction: item.motion_direction || "left", motion_style: item.motion_style || "slide",
  })) : fallbackSlides.map((item) => ({ ...item, scroll_speed: 5, motion_direction: "left" as const, motion_style: "slide" as const })), [banners]);
  slideCount.current = slides.length;
  const current = slides[index % Math.max(1, slides.length)];

  useEffect(() => {
    if (slides.length < 2) return;
    const timer = setTimeout(() => setIndex((value) => (value + 1) % slides.length), Math.max(1, Math.min(60, Number(current?.scroll_speed) || 5)) * 1000);
    return () => clearTimeout(timer);
  }, [slides, index, current?.scroll_speed]);

  useEffect(() => {
    setImageFailed(false);
    opacity.setValue(current?.motion_style === "fade" ? 0.25 : 0.75);
    translate.setValue(current?.motion_style === "drop" ? -14 : current?.motion_direction === "right" ? -14 : current?.motion_direction === "up" ? 14 : current?.motion_direction === "down" ? -14 : 14);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(translate, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start();
  }, [current?.id, current?.motion_style, current?.motion_direction, opacity, translate]);

  if (!current) return null;
  return (
    <View {...swipeResponder.panHandlers} style={{ width, height, borderRadius: 18, overflow: "hidden", backgroundColor: "#173F35" }}>
    <Pressable onPress={() => router.push({ pathname: "/discover/[category]", params: { category: current.category } })} accessibilityRole="button" accessibilityLabel={`فتح قسم ${current.title}`}
      style={{ flex: 1 }}>
      {!imageFailed ? <Animated.Image source={{ uri: current.image_url }} onError={() => setImageFailed(true)} resizeMode="cover"
        style={{ position: "absolute", width: "100%", height: "100%", opacity, transform: [{ translateX: current.motion_direction === "left" || current.motion_direction === "right" ? translate : 0 }, { translateY: current.motion_direction === "up" || current.motion_direction === "down" || current.motion_style === "drop" ? translate : 0 }] }} /> : null}
      <LinearGradient pointerEvents="none" colors={["rgba(0,0,0,0.04)", "rgba(0,0,0,0.24)", "rgba(0,0,0,0.84)"]} locations={[0, 0.42, 1]} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }} />
      <View style={{ position: "absolute", right: 12, bottom: 12, left: 12 }}>
        <Text style={{ color: "#FFFFFF", fontSize: 18, fontWeight: "900", textAlign: "right" }}>{current.title}</Text>
        <Text style={{ color: "rgba(255,255,255,0.92)", fontSize: 11, fontWeight: "700", textAlign: "right", marginTop: 3 }}>{current.subtitle}</Text>
      </View>
      <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: 8, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6 }}>{slides.map((slide, dotIndex) => <Pressable key={slide.id} accessibilityRole="button" accessibilityLabel={`عرض الشريحة ${dotIndex + 1}`} onPress={() => setIndex(dotIndex)} style={{ width: dotIndex === index ? 20 : 6, height: 6, borderRadius: 8, backgroundColor: dotIndex === index ? "#FFFFFF" : "rgba(255,255,255,0.62)" }} />)}</View>
    </Pressable>
    </View>
  );
}
