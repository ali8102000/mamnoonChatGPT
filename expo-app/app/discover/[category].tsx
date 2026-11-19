import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { supabase } from "@/lib/supabase";
import { palette, radius, space } from "@/styles/theme";

type PartnerType = "hotel" | "restaurant" | "store" | "mall";
type Business = { id: string; partner_type: PartnerType; business_name: string; city: string; address: string; description: string | null; phone: string };

const categories: Record<string, { title: string; types: PartnerType[]; subtitle: string }> = {
  restaurant: { title: "المطاعم", types: ["restaurant"], subtitle: "تصفح المطاعم وقوائم الطعام والخدمات المتاحة." },
  hotel: { title: "الفنادق", types: ["hotel"], subtitle: "اكتشف الفنادق والغرف والخدمات المتاحة." },
  store: { title: "المتاجر", types: ["store", "mall"], subtitle: "تصفح المتاجر والمنتجات المعروضة." },
};

export default function DiscoverCategoryScreen() {
  const { category: rawCategory } = useLocalSearchParams<{ category: string }>();
  const category = categories[String(rawCategory ?? "")];
  const [items, setItems] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!category) { setLoading(false); setError("هذا القسم غير متاح."); return; }
    setLoading(true); setError("");
    const { data, error: queryError } = await (supabase as any)
      .from("partner_business_profiles")
      .select("id,partner_type,business_name,city,address,description,phone")
      .eq("is_published", true)
      .in("partner_type", category.types)
      .order("business_name");
    if (queryError) setError("تعذر تحميل المنشآت حالياً. حاول تحديث الصفحة.");
    setItems((data ?? []) as Business[]);
    setLoading(false);
  }, [category]);

  useEffect(() => { void load(); }, [load]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: palette.pageCanvas }} contentContainerStyle={{ padding: space.lg, paddingBottom: 44, gap: 14 }}>
      <Pressable onPress={() => router.back()} style={{ alignSelf: "flex-start", paddingVertical: 8 }}><Text style={{ color: palette.brand, fontWeight: "900" }}>→ رجوع</Text></Pressable>
      <View style={{ backgroundColor: palette.brand, borderRadius: radius.xl, padding: 20, gap: 6 }}>
        <Text style={{ color: "#fff", fontSize: 24, fontWeight: "900", textAlign: "right" }}>{category?.title ?? "اكتشاف"}</Text>
        <Text style={{ color: "#fff", opacity: 0.9, fontSize: 12, lineHeight: 21, textAlign: "right" }}>{category?.subtitle ?? "تصفح محتويات ممنون."}</Text>
        <Text style={{ color: "#fff", opacity: 0.8, fontSize: 11, textAlign: "right" }}>{items.length} منشأة منشورة</Text>
      </View>
      {loading ? <ActivityIndicator color={palette.brand} style={{ marginTop: 30 }} /> : error ? (
        <View style={{ backgroundColor: palette.surface, borderRadius: radius.lg, padding: 18, gap: 10 }}><Text style={{ color: palette.danger, textAlign: "right" }}>{error}</Text><Pressable onPress={() => void load()}><Text style={{ color: palette.brand, fontWeight: "900", textAlign: "right" }}>إعادة المحاولة</Text></Pressable></View>
      ) : items.length === 0 ? (
        <View style={{ backgroundColor: palette.surface, borderRadius: radius.lg, padding: 22, gap: 8 }}><Text style={{ color: palette.ink, fontSize: 16, fontWeight: "900", textAlign: "center" }}>ماكو منشآت منشورة حالياً</Text><Text style={{ color: palette.muted, fontSize: 12, textAlign: "center", lineHeight: 20 }}>من تنشر الإدارة المطاعم أو الفنادق أو المتاجر راح تظهر هنا مباشرة.</Text></View>
      ) : items.map((item) => (
        <Pressable key={item.id} onPress={() => router.push({ pathname: "/partner/[id]", params: { id: item.id } })} style={{ backgroundColor: palette.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: palette.line, padding: 16, gap: 7 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <Text style={{ color: palette.brand, fontWeight: "900", fontSize: 12 }}>{item.partner_type === "hotel" ? "فندق" : item.partner_type === "restaurant" ? "مطعم" : item.partner_type === "mall" ? "مول" : "متجر"}</Text>
            <Text style={{ color: palette.ink, fontSize: 17, fontWeight: "900", textAlign: "right", flex: 1 }}>{item.business_name}</Text>
          </View>
          <Text style={{ color: palette.muted, fontSize: 12, textAlign: "right" }}>📍 {item.city} · {item.address}</Text>
          {item.description ? <Text numberOfLines={2} style={{ color: palette.muted, fontSize: 12, lineHeight: 19, textAlign: "right" }}>{item.description}</Text> : null}
          <Text style={{ color: palette.brand, fontSize: 12, fontWeight: "900", textAlign: "right", marginTop: 3 }}>عرض المحتويات والخدمات ←</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
