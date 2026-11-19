import { useCallback, useEffect, useRef, useState } from "react";
import { Dimensions, FlatList, Image, NativeScrollEvent, NativeSyntheticEvent, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { supabase } from "@/lib/supabase";

type Banner = { id: string; image_url: string; target_category: "restaurant" | "hotel" | "store"; is_active: boolean; scroll_speed: number; badge_text: string | null };
const width = (Dimensions.get("window").width - 40) * 0.65;
const height = width * 0.88;

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
    setBanners(data ?? []);
    setFailedImages([]);
    setIndex(0);
    resumeAt.current = 0;
    list.current?.scrollToOffset({ offset: 0, animated: false });
  }, []);
  useEffect(() => {
    void refresh();
    const channel = supabase.channel("home-category-banners-native")
      .on("postgres_changes", { event: "*", schema: "public", table: "home_carousel_banners" }, () => void refresh())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [refresh]);
  useEffect(() => {
    if (banners.length < 2 || index >= banners.length - 1) return;
    const speed = Math.max(1, Math.min(60, Number(banners[index]?.scroll_speed) || 5));
    const timer = setTimeout(() => {
      if (Date.now() < resumeAt.current) return;
      const next = Math.min(index + 1, banners.length - 1);
      setIndex(next);
      list.current?.scrollToIndex({ index: next, animated: true });
    }, speed * 1000);
    return () => clearTimeout(timer);
  }, [banners, index]);
  const onScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.x / width);
    if (next >= 0 && next < banners.length) setIndex(next);
    resumeAt.current = Date.now() + 5000;
  };
  if (!banners.length) return (
    <View style={{ width: "100%", height, backgroundColor: "#173F35", borderRadius: 22, padding: 14, justifyContent: "center", alignItems: "center" }}>
      <Text style={{ color: "#FFFFFF", fontWeight: "900", fontSize: 16, textAlign: "center" }}>اكتشف شركاء ممنون</Text>
      <Text style={{ color: "#FFFFFF", opacity: 0.9, fontWeight: "700", fontSize: 11, textAlign: "center", marginTop: 6 }}>المطاعم والفنادق والمتاجر المنشورة تظهر هنا</Text>
    </View>
  );
  return (
    <View style={{ width: "100%", height, borderRadius: 22, overflow: "hidden", backgroundColor: "transparent" }}>
      <FlatList ref={list} data={banners} horizontal snapToInterval={width} snapToAlignment="start" decelerationRate="fast" showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.id} onMomentumScrollEnd={onScrollEnd}
        onTouchStart={() => { resumeAt.current = Date.now() + 5000; }}
        onTouchEnd={() => { resumeAt.current = Date.now() + 5000; }}
        getItemLayout={(_, itemIndex) => ({ length: width, offset: width * itemIndex, index: itemIndex })}
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push({ pathname: "/discover/[category]", params: { category: item.target_category } })} accessibilityRole="button" accessibilityLabel={item.target_category === "restaurant" ? "عرض المطاعم" : item.target_category === "hotel" ? "عرض الفنادق" : "عرض المتاجر"} style={{ width, height, position: "relative", backgroundColor: "#173F35", justifyContent: "center", alignItems: "center" }}>
            {!failedImages.includes(item.id) && !!item.image_url ? <Image source={{ uri: item.image_url }} onError={() => setFailedImages(current => current.includes(item.id) ? current : [...current, item.id])} style={{ width: "100%", height: "100%" }} resizeMode="cover" /> : <View style={{ padding: 12, alignItems: "center" }}><Text style={{ color: "#fff", fontWeight: "900", fontSize: 15, textAlign: "center" }}>{item.target_category === "restaurant" ? "المطاعم" : item.target_category === "hotel" ? "الفنادق" : "المتاجر"}</Text><Text style={{ color: "#fff", fontSize: 11, fontWeight: "800", marginTop: 8 }}>اضغط لاستعراض المحتويات والخدمات</Text></View>}
            {!!item.badge_text && <View style={{ position: "absolute", top: 12, right: 12, backgroundColor: "#0009", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 }}>
              <Text style={{ color: "#fff", fontWeight: "800", fontSize: 11 }}>{item.badge_text}</Text>
            </View>}
          </Pressable>
        )}
      />
      {banners.length > 1 && <View style={{ position: "absolute", bottom: 10, left: 0, right: 0, flexDirection: "row", justifyContent: "center", gap: 6, pointerEvents: "none" }}>
        {banners.map((banner, i) => <View key={banner.id} style={{ width: i === index ? 18 : 6, height: 6, borderRadius: 9, backgroundColor: "#FFFFFF" }} />)}
      </View>}
    </View>
  );
}
