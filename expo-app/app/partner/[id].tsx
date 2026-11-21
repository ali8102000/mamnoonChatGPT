import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Image, Linking, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { palette, radius, space } from "@/styles/theme";

type Business = { id: string; partner_type: string; business_name: string; phone: string; city: string; address: string; description: string | null; opening_hours: Record<string, unknown> | null };
type CatalogItem = { id: string; item_type: string; name: string; description: string | null; price_amount: number; currency: string; quantity_available: number | null; image_urls: string[] };
type CartLine = { id: string; catalog_item_id: string; quantity: number };

export default function PartnerPublicDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const [business, setBusiness] = useState<Business | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [customerNote, setCustomerNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [cartLoading, setCartLoading] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [error, setError] = useState("");

  const loadCart = useCallback(async () => {
    if (!user?.id || !id) { setCart([]); return; }
    const { data, error: cartError } = await (supabase as any)
      .from("partner_customer_cart_items")
      .select("id,catalog_item_id,quantity")
      .eq("customer_id", user.id)
      .eq("business_profile_id", id)
      .order("created_at", { ascending: true });
    if (cartError) { setError("تعذر تحميل سلة التسوق حالياً."); return; }
    setCart((data ?? []) as CartLine[]);
  }, [id, user?.id]);

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
    await loadCart();
  }, [id, loadCart]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadCart(); }, [loadCart]);

  const kind = business?.partner_type === "hotel" ? "الغرف" : business?.partner_type === "restaurant" ? "قائمة الطعام" : "المنتجات";
  const itemLabel = business?.partner_type === "hotel" ? "غرفة" : business?.partner_type === "restaurant" ? "وجبة / صنف" : "منتج";
  const cartCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const cartSubtotal = useMemo(() => cart.reduce((sum, line) => {
    const item = catalog.find((entry) => entry.id === line.catalog_item_id);
    return sum + (item ? Number(item.price_amount) * line.quantity : 0);
  }, 0), [cart, catalog]);
  const cartCurrency = useMemo<string | null>(() => {
    const currencies = new Set<string>(cart.map((line) => catalog.find((entry) => entry.id === line.catalog_item_id)?.currency).filter((value): value is string => typeof value === "string" && value.length > 0));
    return currencies.size === 1 ? [...currencies][0] : null;
  }, [cart, catalog]);

  async function addToCart(item: CatalogItem) {
    if (!user?.id) { router.push("/auth"); return; }
    setCartLoading(true); setError("");
    const { error: addError } = await (supabase as any).rpc("add_partner_customer_cart_item", {
      p_business_profile_id: id, p_catalog_item_id: item.id, p_quantity: 1,
    });
    setCartLoading(false);
    if (addError) { Alert.alert("تعذر إضافة المنتج", addError.message || "تحقق من الكمية المتاحة."); return; }
    await loadCart();
    Alert.alert("تمت الإضافة", "انضاف المنتج إلى سلة التسوق.");
  }

  async function setQuantity(line: CartLine, quantity: number) {
    if (!user?.id) return;
    if (quantity <= 0) {
      const { error: deleteError } = await (supabase as any).from("partner_customer_cart_items")
        .delete().eq("id", line.id).eq("customer_id", user.id);
      if (deleteError) Alert.alert("تعذر حذف المنتج", deleteError.message);
    } else {
      const item = catalog.find((entry) => entry.id === line.catalog_item_id);
      if (item?.quantity_available != null && quantity > item.quantity_available) {
        Alert.alert("الكمية غير متوفرة", "الكمية المطلوبة أكبر من المخزون المتاح.");
        return;
      }
      const { error: updateError } = await (supabase as any).from("partner_customer_cart_items")
        .update({ quantity, updated_at: new Date().toISOString() })
        .eq("id", line.id).eq("customer_id", user.id);
      if (updateError) Alert.alert("تعذر تحديث الكمية", updateError.message);
    }
    await loadCart();
  }

  async function submitOrder() {
    if (!user?.id) { router.push("/auth"); return; }
    if (!cart.length) { Alert.alert("السلة فارغة", "أضف المنتجات قبل تأكيد الطلب."); return; }
    if (!deliveryAddress.trim()) { Alert.alert("عنوان التوصيل مطلوب", "اكتب عنوان استلام الطلب حتى نرسله للمنشأة."); return; }
    setCheckoutBusy(true);
    const { data: orderId, error: orderError } = await (supabase as any).rpc("place_partner_customer_order", {
      p_business_profile_id: id,
      p_delivery_address: deliveryAddress.trim(),
      p_customer_note: customerNote.trim() || null,
      p_expected_total: Number(cartSubtotal.toFixed(2)),
      p_expected_currency: cartCurrency,
    });
    setCheckoutBusy(false);
    if (orderError || !orderId) {
      Alert.alert("تعذر إتمام الطلب", orderError?.message || "تأكد من توفر المنتجات ثم حاول مرة ثانية.");
      await load();
      return;
    }
    setDeliveryAddress(""); setCustomerNote("");
    await load();
    Alert.alert("تم إرسال طلبك", "وصل طلبك إلى المنشأة بنجاح. رقم الطلب: " + String(orderId).slice(0, 8));
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: palette.pageCanvas }} contentContainerStyle={{ padding: space.lg, paddingBottom: 70, gap: 14 }}>
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
              {business.partner_type !== "hotel" ? <Pressable disabled={cartLoading || item.quantity_available === 0} onPress={() => void addToCart(item)} style={{ borderWidth: 1.5, borderColor: palette.brand, backgroundColor: palette.brandSoft, borderRadius: 12, padding: 11, alignItems: "center", opacity: cartLoading || item.quantity_available === 0 ? 0.45 : 1 }}><Text style={{ color: palette.brand, fontWeight: "900" }}>{item.quantity_available === 0 ? "نفد المخزون" : cartLoading ? "جارٍ الإضافة..." : "أضف إلى السلة +"}</Text></Pressable> : null}
            </View>
          ))}
          {business.partner_type !== "hotel" ? <View style={{ backgroundColor: palette.surface, borderRadius: radius.xl, borderWidth: 1.5, borderColor: palette.brand, padding: 16, gap: 12 }}>
            <Text style={{ color: palette.ink, fontSize: 18, fontWeight: "900", textAlign: "right" }}>🛒 سلة التسوق · {cartCount} قطعة</Text>
            {cart.length === 0 ? <Text style={{ color: palette.muted, fontSize: 12, textAlign: "center" }}>سلتك فارغة. أضف المنتجات حتى تكمل الطلب.</Text> : cart.map((line) => {
              const item = catalog.find((entry) => entry.id === line.catalog_item_id);
              return <View key={line.id} style={{ borderTopWidth: 1, borderTopColor: palette.line, paddingTop: 9, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <View style={{ flex: 1 }}><Text style={{ color: palette.ink, fontWeight: "800", textAlign: "right" }}>{item?.name ?? "منتج غير متاح"}</Text><Text style={{ color: palette.muted, fontSize: 11, textAlign: "right" }}>{item ? `${Number(item.price_amount).toLocaleString("ar-IQ")} ${item.currency === "USD" ? "$" : "د.ع"}` : ""}</Text></View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}><Pressable onPress={() => void setQuantity(line, line.quantity - 1)}><Text style={{ color: palette.danger, fontSize: 22, fontWeight: "900" }}>−</Text></Pressable><Text style={{ color: palette.ink, fontWeight: "900" }}>{line.quantity}</Text><Pressable onPress={() => void setQuantity(line, line.quantity + 1)}><Text style={{ color: palette.brand, fontSize: 22, fontWeight: "900" }}>+</Text></Pressable></View>
              </View>;
            })}
            {cart.length > 0 ? <>
              <View style={{ borderTopWidth: 1, borderTopColor: palette.line, paddingTop: 10, flexDirection: "row", justifyContent: "space-between" }}><Text style={{ color: palette.brand, fontWeight: "900" }}>{cartCurrency ? `${cartSubtotal.toLocaleString("ar-IQ")} ${cartCurrency === "USD" ? "$" : "د.ع"}` : "عملات مختلفة"}</Text><Text style={{ color: palette.ink, fontWeight: "900" }}>المجموع التقديري</Text></View>
              {!cartCurrency ? <Text style={{ color: palette.danger, fontSize: 11, textAlign: "right" }}>لا يمكن إتمام سلة تحتوي على عملات مختلفة. استخدم سلة واحدة بعملة موحدة.</Text> : null}
              <TextInput value={deliveryAddress} onChangeText={setDeliveryAddress} placeholder="عنوان التوصيل بالتفصيل" placeholderTextColor={palette.muted} style={{ borderWidth: 1, borderColor: palette.line, borderRadius: 10, padding: 11, color: palette.ink, textAlign: "right" }} />
              <TextInput value={customerNote} onChangeText={setCustomerNote} placeholder="ملاحظات للمنشأة (اختياري)" placeholderTextColor={palette.muted} multiline style={{ borderWidth: 1, borderColor: palette.line, borderRadius: 10, padding: 11, color: palette.ink, textAlign: "right", minHeight: 60 }} />
              <Pressable disabled={checkoutBusy || !cartCurrency} onPress={() => void submitOrder()} style={{ backgroundColor: palette.brand, borderRadius: 12, padding: 14, alignItems: "center", opacity: checkoutBusy || !cartCurrency ? 0.5 : 1 }}><Text style={{ color: "#fff", fontWeight: "900" }}>{checkoutBusy ? "جارٍ تأكيد الطلب..." : "تأكيد الطلب وإرساله للمنشأة"}</Text></Pressable>
            </> : null}
          </View> : null}
        </>
      )}
    </ScrollView>
  );
}
