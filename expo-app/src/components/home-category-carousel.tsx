import { useCallback, useEffect, useRef, useState } from "react";
import { Dimensions, FlatList, Image, NativeScrollEvent, NativeSyntheticEvent, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { supabase } from "@/lib/supabase";
import { palette } from "@/styles/theme";

type Banner = { id: string; image_url: string; target_category: "restaurant" | "hotel" | "store"; banner_type: "category" | "poll" | "contest" | "ad"; target_campaign_id: string | null; is_active: boolean; scroll_speed: number; badge_text: string | null; display_order: number; motion_axis: "horizontal" | "vertical"; motion_direction: "left" | "right" | "up" | "down"; motion_style: "slide" | "fade" | "drop" };
const width = (Dimensions.get("window").width - 36) * (2 / 3);

function openBanner(item: Banner) {
  if (item.banner_type === "ad") return;
  if ((item.banner_type === "poll" || item.banner_type === "contest") && item.target_campaign_id) {
    router.push({ pathname: "/campaign/[id]", params: { id: item.target_campaign_id } });
    return;
  }
  if (item.banner_type === "category") router.push({ pathname: "/discover/[category]", params: { category: item.target_category } });
}

type Props = { height?: number };

export function HomeCategoryCarousel({ height: requestedHeight = 132 }: Props) {
  const bannerHeight = Math.max(130, Math.min(188, requestedHeight));
  const [banners, setBanners] = useState<Banner[]>([]);
  const [index, setIndex] = useState(0);
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const list = useRef<FlatList<Banner>>(null);
  const resumeAt = useRef(0);
  const axis = banners[index]?.motion_axis ?? "horizontal";
  const direction = banners[index]?.motion_direction ?? "left";
  const vertical = axis === "vertical";
  const reverse = direction === "right" || direction === "down";

  const refresh = useCallback(async () => {
    const { data, error } = await (supabase as any)
      .from("home_carousel_banners")
      .select("id,image_url,target_category,banner_type,target_campaign_id,is_active,scroll_speed,badge_text,display_order,motion_axis,motion_direction,motion_style")
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
    if (banners.length < 2) return;
    const speed = Math.max(1, Math.min(60, Number(banners[index]?.scroll_speed) || 5));
    const timer = setInterval(() => {
      if (Date.now() < resumeAt.current) return;
      const step = reverse ? -1 : 1;
      const next = (index + step + banners.length) % banners.length;
      setIndex(next);
      list.current?.scrollToIndex({ index: next, animated: true });
    }, speed * 1000);
    return () => clearInterval(timer);
  }, [banners, index]);

  const onScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round((vertical ? event.nativeEvent.contentOffset.y : event.nativeEvent.contentOffset.x) / (vertical ? bannerHeight : width));
    if (next >= 0 && next < banners.length) setIndex(next);
    resumeAt.current = Date.now() + 5000;
  };

  if (!banners.length) {
    return (
      <>
          <View style={{ width: "100%", height: bannerHeight, backgroundColor: "#173F35", borderRadius: 20, padding: 14, justifyContent: "center", alignItems: "center" }}>
          <Text style={{ color: "#FFFFFF", fontWeight: "900", fontSize: 16, textAlign: "center" }}>اكتشف شركاء ممنون</Text>
          <Text style={{ color: "#FFFFFF", opacity: 0.9, fontWeight: "700", fontSize: 11, textAlign: "center", marginTop: 6 }}>المطاعم والفنادق والمولات والمتاجر المنشورة هنا</Text>
        </View>
      </>
    );
  }

  return (
    <>
      <View style={{ width: "100%", height: bannerHeight, borderRadius: 20, overflow: "hidden", backgroundColor: "transparent" }}>
        <FlatList
          ref={list}
          data={banners}
          horizontal={!vertical}
          inverted={reverse}
          snapToInterval={vertical ? bannerHeight : width}
          snapToAlignment="start"
          decelerationRate="fast"
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item) => item.id}
          onMomentumScrollEnd={onScrollEnd}
          onTouchStart={() => { resumeAt.current = Date.now() + 5000; }}
          onTouchEnd={() => { resumeAt.current = Date.now() + 5000; }}
          getItemLayout={(_, i) => ({ length: vertical ? bannerHeight : width, offset: (vertical ? bannerHeight : width) * i, index: i })}
          renderItem={({ item }) => (
            <Pressable
              disabled={item.banner_type === "ad"}
              onPress={() => openBanner(item)}
              accessibilityRole={item.banner_type === "ad" ? "image" : "button"}
              style={{ width, height: bannerHeight, position: "relative", backgroundColor: "#173F35", justifyContent: "center", alignItems: "center" }}
            >
              {!failedImages.includes(item.id) && !!item.image_url ? (
                <Image source={{ uri: item.image_url }} onError={() => setFailedImages((value) => value.includes(item.id) ? value : [...value, item.id])} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
              ) : (
                <View style={{ padding: 12, alignItems: "center" }}>
                  <Text style={{ color: "#fff", fontWeight: "900", fontSize: 15, textAlign: "center" }}>
                    {item.banner_type === "ad" ? "إعلان" : item.banner_type === "poll" ? "استطلاع رأي" : item.banner_type === "contest" ? "مسابقة" : item.target_category === "restaurant" ? "المطاعم" : item.target_category === "hotel" ? "الفنادق" : "المولات والمحلات"}
                  </Text>
                </View>
              )}
              {item.banner_type !== "ad" && (
                <View style={{ position: "absolute", bottom: 10, right: 8, backgroundColor: "#0009", borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6 }}>
                  <Text style={{ color: "#fff", fontSize: 10, fontWeight: "900" }}>{item.banner_type === "poll" ? "شارك برأيك ←" : item.banner_type === "contest" ? "شاهد المسابقة وشارك ←" : "استعراض المحتويات ←"}</Text>
                </View>
              )}
              {!!item.badge_text && <View style={{ position: "absolute", top: 12, right: 12, backgroundColor: "#0009", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 }}><Text style={{ color: "#fff", fontWeight: "800", fontSize: 11 }}>{item.badge_text}</Text></View>}
            </Pressable>
          )}
        />
        {banners.length > 1 && <View pointerEvents="none" style={{ position: "absolute", bottom: 10, left: 0, right: 0, flexDirection: "row", justifyContent: "center", gap: 6 }}>{banners.map((banner, i) => <View key={banner.id} style={{ width: i === index ? 18 : 6, height: 6, borderRadius: 9, backgroundColor: "#FFFFFF" }} />)}</View>}
      </View>
    </>
  );
}
