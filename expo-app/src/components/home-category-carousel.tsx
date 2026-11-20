import { useEffect, useState } from "react";
import { Dimensions, Image, Pressable, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { supabase } from "@/lib/supabase";

type CategoryBanner = { id: string; image_url: string; target_category: "restaurant" | "hotel" | "store"; banner_type: string; display_order: number; is_active: boolean };
const width = (Dimensions.get("window").width - 36) * (2 / 3);

const FALLBACK_IMAGES = {
  restaurant: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=640&q=85",
  hotel: "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=640&q=85",
  mall: "https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=640&q=85",
  shop: "https://images.unsplash.com/photo-1472851294608-062f824d29cc?auto=format&fit=crop&w=640&q=85",
};

const cards = [
  { key: "restaurant", title: "المطاعم", subtitle: "مطاعم وكافيهات", category: "restaurant" as const, fallback: FALLBACK_IMAGES.restaurant },
  { key: "hotel", title: "الفنادق", subtitle: "فنادق وشقق فندقية", category: "hotel" as const, fallback: FALLBACK_IMAGES.hotel },
  { key: "mall", title: "المولات", subtitle: "مراكز تسوق وترفيه", category: "store" as const, fallback: FALLBACK_IMAGES.mall },
  { key: "shop", title: "المحلات", subtitle: "متاجر ومحلات قريبة", category: "store" as const, fallback: FALLBACK_IMAGES.shop },
];

type Props = { height?: number };

export function HomeCategoryCarousel({ height: requestedHeight = 188 }: Props) {
  const height = Math.max(130, Math.min(188, requestedHeight));
  const [banners, setBanners] = useState<CategoryBanner[]>([]);
  const [failedImages, setFailedImages] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const { data, error } = await (supabase as any)
        .from("home_carousel_banners")
        .select("id,image_url,target_category,banner_type,display_order,is_active")
        .eq("is_active", true)
        .eq("banner_type", "category")
        .order("display_order")
        .order("created_at");
      if (active && !error) {
        setBanners(data ?? []);
        setFailedImages([]);
      }
    };
    void refresh();
    const channel = supabase.channel("home-fixed-category-tiles-native")
      .on("postgres_changes", { event: "*", schema: "public", table: "home_carousel_banners" }, () => void refresh())
      .subscribe();
    return () => { active = false; void supabase.removeChannel(channel); };
  }, []);

  const storeBanners = banners.filter((item) => item.target_category === "store");
  const cardWidth = (width - 7) / 2;
  const cardHeight = (height - 7) / 2;

  return (
    <View style={{ width: "100%", height, flexDirection: "row", flexWrap: "wrap", gap: 7 }}>
      {cards.map((card) => {
        const match = card.key === "mall" ? storeBanners[0] : card.key === "shop" ? storeBanners[1] : banners.find((item) => item.target_category === card.category);
        const image = match?.image_url || card.fallback;
        const imageKey = match?.id || card.key;
        return (
          <Pressable
            key={card.key}
            onPress={() => router.push({ pathname: "/discover/[category]", params: { category: card.category } })}
            accessibilityRole="button"
            accessibilityLabel={`فتح قسم ${card.title}`}
            style={{ width: cardWidth, height: cardHeight, borderRadius: 12, overflow: "hidden", backgroundColor: "#173F35" }}
          >
            {!failedImages.includes(imageKey) && (
              <Image
                source={{ uri: image }}
                onError={() => setFailedImages((current) => current.includes(imageKey) ? current : [...current, imageKey])}
                resizeMode="cover"
                style={{ position: "absolute", width: "100%", height: "100%" }}
              />
            )}
            <LinearGradient
              pointerEvents="none"
              colors={["rgba(0,0,0,0.04)", "rgba(0,0,0,0.24)", "rgba(0,0,0,0.84)"]}
              locations={[0, 0.42, 1]}
              style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
            />
            <View style={{ position: "absolute", right: 8, bottom: 7, left: 8 }}>
              <Text style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "900", textAlign: "right" }}>{card.title}</Text>
              <Text style={{ color: "rgba(255,255,255,0.9)", fontSize: 9, fontWeight: "700", textAlign: "right", marginTop: 2 }}>{card.subtitle}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
