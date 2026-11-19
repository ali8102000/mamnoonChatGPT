import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { supabase } from "@/lib/supabase";
import { palette, radius, space } from "@/styles/theme";

type Business = { id: string; partner_type: string; business_name: string; phone: string; city: string; address: string; description: string | null; opening_hours: Record<string, unknown> | null };
type CatalogItem = { id: string; item_type: string; name: string; description: string | null; price_amount: number; currency: string; quantity_available: number | null; image_urls: string[] };

export default function PartnerPublicDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [business, setBusiness] = useState<Business | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true); setError("");
    const { data: profile, error: profileError } = await (supabase as any)
      .from("partner_business_profiles")
      .select("id,partner_type,business_name,phone,city,address,description,opening_hours")
      .eq("id", id).eq("is_published", true).maybeSingle();
    if (profileError || !profile) {
      setBusiness(null); setCatalog([]); setError("المنشأة غير متاحة أو تم إيقاف نشرها."); setLoading(false); return;
    }
    setBusiness(profile as Business);
    const expectedType = profile.partner_type === "hotel" ? "room" : profile.partner_type === "restaurant" ? "menu_item" : "product";
    const { data: items, error: itemsError } = await (supabase as any)
      .from("partner_catalog_items")
      .select("id,item_type,name,description,price_amount,currency,quantity_available,image_urls")
      .eq("business_profile_id", id).eq("item_type", expectedType).eq("is_active", true)
      .order("sort_order").order("created_at", { ascending: false });
    if (itemsError) setError("تم تحميل بيانات المنشأة لكن تعذر تحميل قائمة المحتويات.");
    setCatalog((items ?? []) as CatalogItem[]);
    setLoading(false);
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const kind = business?.partner_type === "hotel" ? "الغرف" : business?.partner_type === "restaurant" ? "قائمة الطعام" : "المنتجات";
  const itemLabel = business?.partner_type === "hotel" ? "غرفة" : business?.partner_type === "restaurant" ? "وجبة / صنف" : "منتج";

  return (
    <ScrollView style={{ flex: 1, backgroundColor: palette.pageCanvas }} contentContainerStyle={{ padding: space.lg, paddingBottom: 48, gap: 14 }}>
      <Pressable onPress={() => router.back()} style={{ alignSelf: "flex-start", paddingVertical: 8 }}><Text style={{ color: palette.brand, fontWeight: "900" }}>→ رجوع</Text></Pressable>
      {loading ? <ActivityIndicator color={palette.brand} style={{ marginTop: 40 }} /> : !business ? (
        <View style={{ backgroundColor: palette.surface, borderRadius: radius.lg, padding: 20, gap: 12 }}><Text style={{ color: palette.danger, textAlign: "right" }}>{error || "المنشأة غير متاحة."}</Text><Pressable onPress={() => router.back()}><Text style={{ color: palette.brand, fontWeight: "900", textAlign: "right" }}>العودة للقائمة</Text></Pressable></View>
      ) : (
        <>
          <View style={{ backgroundColor: palette.brand, borderRadius: radius.xl, padding: 20, gap: 8 }}>
            <Text style={{ color: "#fff", opacity: 0.8, fontSize: 12, textAlign: "right" }}>{business.partner_type === "hotel" ? "فندق" : business.partner_type === "restaurant" ? "مطعم" : business.partner_type === "mall" ? "مول" : "متجر"}</Text>
            <Text style={{ color: "#fff", fontSize: 24, fontWeight: "900", textAlign: "right" }}>{business.business_name}</Text>
            <Text style={{ color: "#fff", opacity: 0.9, fontSize: 12, textAlign: "right" }}>📍 {business.city} · {business.address}</Text>
            {business.description ? <Text style={{ color: "#fff", opacity: 0.9, fontSize: 12, lineHeight: 21, textAlign: "right" }}>{business.description}</Text> : null}
            <Pressable onPress={() => void Linking.openURL(`tel:${business.phone}`)} style={{ alignSelf: "flex-end", backgroundColor: "#fff", borderRadius: 12, paddingHorizontal: 15, paddingVertical: 10, marginTop: 4 }}><Text style={{ color: palette.brand, fontWeight: "900" }}>اتصال بالمنشأة</Text></Pressable>
          </View>
          <View style={{ gap: 4 }}><Text style={{ color: palette.ink, fontSize: 19, fontWeight: "900", textAlign: "right" }}>{kind}</Text><Text style={{ color: palette.muted, fontSize: 11, textAlign: "right" }}>{catalog.length} {itemLabel}</Text></View>
          {error ? <Text style={{ color: palette.danger, fontSize: 12, textAlign: "right" }}>{error}</Text> : null}
          {catalog.length === 0 ? <View style={{ backgroundColor: palette.surface, borderRadius: radius.lg, padding: 20 }}><Text style={{ color: palette.muted, fontSize: 12, textAlign: "center" }}>ماكو {kind} مضافة حالياً. راح تظهر هنا من يضيفها صاحب المنشأة.</Text></View> : catalog.map((item) => (
            <View key={item.id} style={{ backgroundColor: palette.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: palette.line, padding: 14, gap: 8 }}>
              {item.image_urls?.[0] ? <Image source={{ uri: item.image_urls[0] }} resizeMode="cover" style={{ width: "100%", height: 170, borderRadius: radius.md, backgroundColor: palette.pageCanvas }} /> : null}
              <Text style={{ color: palette.ink, fontSize: 16, fontWeight: "900", textAlign: "right" }}>{item.name}</Text>
              {item.description ? <Text style={{ color: palette.muted, fontSize: 12, lineHeight: 20, textAlign: "right" }}>{item.description}</Text> : null}
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ color: palette.brand, fontWeight: "900", fontSize: 14 }}>{Number(item.price_amount).toLocaleString("ar-IQ")} {item.currency === "USD" ? "$" : "د.ع"}</Text>
                <Text style={{ color: palette.muted, fontSize: 11 }}>{item.quantity_available === null ? "متاح" : item.quantity_available === 0 ? "نفد حالياً" : `المتاح: ${item.quantity_available}`}</Text>
              </View>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}
