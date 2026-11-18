import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Dimensions, FlatList, Image, NativeScrollEvent, NativeSyntheticEvent, Text, View } from "react-native";
import { supabase } from "@/lib/supabase";

type Banner = { id: string; image_url: string; target_category: "restaurant" | "hotel" | "store"; scroll_speed: number; badge_text: string | null };
const width = Dimensions.get("window").width - 40;
const height = width / 1.13;
const messages: Record<Banner["target_category"], string> = {
  restaurant: "أنت صاحب مطعم؟ سجل ويانه وانتظر طلباتك",
  hotel: "أنت صاحب فندق؟ سجل ويانه وخليك ويانه",
  store: "أنت صاحب محل أو مول؟ انضم الآن وعرض منتجاتك",
};

export function HomeCategoryCarousel() {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [index, setIndex] = useState(0);
  const list = useRef<FlatList<Banner>>(null);
  const resumeAt = useRef(0);
  const refresh = useCallback(async () => {
    const { data, error } = await (supabase as any).from("home_carousel_banners")
      .select("id,image_url,target_category,scroll_speed,badge_text,display_order")
      .eq("is_active", true).order("display_order").order("created_at");
    if (!error) { setBanners(data ?? []); setIndex(0); }
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
  if (!banners.length) return <View style={{ width: "100%", height, backgroundColor: "transparent" }} />;
  return (
    <View style={{ width: "100%", height, borderRadius: 22, overflow: "hidden", backgroundColor: "transparent" }}>
      <FlatList ref={list} data={banners} horizontal pagingEnabled showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.id} onScroll={onScroll} scrollEventThrottle={16}
        onTouchStart={() => { resumeAt.current = Date.now() + 5000; }}
        onMomentumScrollEnd={() => { resumeAt.current = Date.now() + 5000; }}
        renderItem={({ item }) => (
          <View style={{ width, height, position: "relative" }}>
            <Image source={{ uri: item.image_url }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
            {!!item.badge_text && <View style={{ position: "absolute", top: 12, right: 12, backgroundColor: "#0009", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 }}>
              <Text style={{ color: "#fff", fontWeight: "800", fontSize: 11 }}>{item.badge_text}</Text>
            </View>}
            <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 54 }} />
          </View>
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
      <View pointerEvents="box-none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, flexDirection: "row" }}>
        {banners.map((banner, i) => <View key={banner.id} style={{ width: 0, height: 0 }} />)}
      </View>
    </View>
  );
}
