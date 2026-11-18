import { useCallback, useEffect, useRef, useState } from "react";
import { Dimensions, FlatList, Image, NativeScrollEvent, NativeSyntheticEvent, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { supabase } from "@/lib/supabase";

type Banner = { id: string; image_url: string; target_category: "restaurant" | "hotel" | "store"; is_active: boolean; scroll_speed: number; badge_text: string | null };
const width = (Dimensions.get("window").width - 40) * 0.65;
const height = width * 0.88;
const messages: Record<Banner["target_category"], string> = {
  restaurant: "أنت صاحب مطعم؟ سجل ويانه وانتظر طلباتك",
  hotel: "أنت صاحب فندق؟ سجل ويانه وخليك ويانه",
  store: "أنت صاحب محل أو مول؟ انضم الآن وعرض منتجاتك",
};

export function HomeCategoryCarousel() {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [index, setIndex] = useState(0);
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const list = useRef<FlatList<Banner>>(null);
  const resumeAt = useRef(0);
  const refresh = useCallback(async () => {
    const { data, error } = await (supabase as any).from("home_carousel_banners")
      .select("id,image_url,target_category,is_active,scroll_speed,badge_text,display_order")
      .eq("is_active", true).order("display_order").order("created_at");
    if (error) { console.warn("[home-banners] load failed:", error.message); return; }
    setBanners(data ?? []); setFailedImages([]); setIndex(0);
  }, []);
  useEffect(() => {
    void refresh();
    const channel = supabase.channel("home-category-banners-native")
      .on("postgres_changes", { event: "*", schema: "public", table: "home_carousel_banners" }, () => void refresh())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [refresh]);
  useEffect(() => {
    if (banners.length < 2) return;
    const speed = Math.max(2, Math.min(30, Number(banners[index]?.scroll_speed) || 5));
    const timer = setInterval(() => {
      if (Date.now() >= resumeAt.current) {
        const next = (index + 1) % banners.length;
        setIndex(next);
        list.current?.scrollToIndex({ index: next, animated: true });
      }
    }, speed * 1000);
    return () => clearInterval(timer);
  }, [banners, index]);
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.x / width);
    if (next >= 0 && next < banners.length) setIndex(next);
  };
  if (!banners.length) return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="انضم كشريك في ممنون"
      onPress={() => router.push("/account-settings")}
      style={{ width: "100%", height, backgroundColor: "#173F35", borderRadius: 22, padding: 14, justifyContent: "center", alignItems: "center" }}
    >
      <Text style={{ color: "#FFFFFF", fontWeight: "900", fontSize: 16, textAlign: "center" }}>انضم كشريك في ممنون</Text>
      <Text style={{ color: "#FFFFFF", opacity: 0.9, fontWeight: "700", fontSize: 11, textAlign: "center", marginTop: 6 }}>فندق أو مطعم أو محل أو مول</Text>
      <Text style={{ color: "#FFFFFF", fontWeight: "800", fontSize: 11, textAlign: "center", marginTop: 8 }}>اضغط للتسجيل ←</Text>
    </Pressable>
  );
  return (
    <View style={{ width: "100%", height, borderRadius: 22, overflow: "hidden", backgroundColor: "transparent" }}>
      <FlatList ref={list} data={banners} horizontal pagingEnabled showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.id} onScroll={onScroll} scrollEventThrottle={16}
        onTouchStart={() => { resumeAt.current = Date.now() + 5000; }}
        onTouchEnd={() => { resumeAt.current = Date.now() + 5000; }}
        onMomentumScrollEnd={() => { resumeAt.current = Date.now() + 5000; }}
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push("/account-settings")} accessibilityRole="button" accessibilityLabel={messages[item.target_category]} style={{ width, height, position: "relative", backgroundColor: "#173F35", justifyContent: "center", alignItems: "center" }}>
            {!failedImages.includes(item.id) && !!item.image_url ? <Image source={{ uri: item.image_url }} onError={() => setFailedImages(current => current.includes(item.id) ? current : [...current, item.id])} style={{ width: "100%", height: "100%" }} resizeMode="cover" /> : <View style={{ padding: 12, alignItems: "center" }}><Text style={{ color: "#fff", fontWeight: "900", fontSize: 15, textAlign: "center" }}>{messages[item.target_category]}</Text><Text style={{ color: "#fff", fontSize: 11, fontWeight: "800", marginTop: 8 }}>اضغط للتسجيل كشريك</Text></View>}
            {!!item.badge_text && <View style={{ position: "absolute", top: 12, right: 12, backgroundColor: "#0009", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 }}>
              <Text style={{ color: "#fff", fontWeight: "800", fontSize: 11 }}>{item.badge_text}</Text>
            </View>}
          </Pressable>
        )}
        onViewableItemsChanged={({ viewableItems }) => {
          const item = viewableItems[0]?.item as Banner | undefined;
          if (item) {
            const next = banners.findIndex((banner) => banner.id === item.id);
            if (next >= 0) setIndex(next);
          }
        }}
        viewabilityConfig={{ itemVisiblePercentThreshold: 70 }}
      />
      {banners.length > 1 && <View style={{ position: "absolute", bottom: 10, left: 0, right: 0, flexDirection: "row", justifyContent: "center", gap: 6 }}>
        {banners.map((banner, i) => <View key={banner.id} style={{ width: i === index ? 18 : 6, height: 6, borderRadius: 9, backgroundColor: "#FFFFFF" }} />)}
      </View>}
    </View>
  );
}
