import { useEffect, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Linking, StyleSheet } from "react-native";
import { router } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { palette, radius, space } from "@/styles/theme";

type Plan = { id: string; code: string; name_ar: string; description_ar: string | null; monthly_price: number; badge_label: string | null };
export default function SubscriptionsScreen() {
  const { user, roles } = useAuth();
  const isProvider = roles.some((r) => ["worker", "driver", "large_driver"].includes(r));
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscription, setSubscription] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    async function load() {
      if (!user?.id || !isProvider) { setLoading(false); return; }
      const [{ data: planRows, error: planError }, { data: sub, error: subError }] = await Promise.all([
        supabase.from("subscription_plans").select("id,code,name_ar,description_ar,monthly_price,badge_label")
          .in("code", ["bronze", "silver", "gold"]).eq("is_active", true).order("tier"),
        supabase.from("user_subscriptions").select("status,is_trial,trial_ends_at,current_period_end,cancel_at_period_end,plan:subscription_plans(code,name_ar,tier)")
          .eq("user_id", user.id).maybeSingle(),
      ]);
      if (!active) return;
      if (planError || subError) Alert.alert("تنبيه", "تعذر تحميل بيانات الاشتراكات");
      setPlans(planRows || []); setSubscription(sub); setLoading(false);
    }
    load();
    return () => { active = false; };
  }, [user?.id, isProvider]);
  async function pay(planCode: string) {
    if (busy) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("qicard-create-payment", { body: { planCode, billingCycle: "monthly" } });
      if (error || !data?.checkoutUrl) throw new Error(data?.error || error?.message || "تعذر بدء الدفع");
      await Linking.openURL(data.checkoutUrl);
    } catch (error: any) {
      Alert.alert("تعذر بدء الدفع", error?.message || "حاول مرة ثانية");
    } finally { setBusy(false); }
  }
  if (!isProvider) return <View style={styles.container}><Text style={styles.title}>الاشتراكات متاحة لمقدمي الخدمة فقط</Text></View>;
  return <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
    <TouchableOpacity onPress={() => router.back()} style={styles.back}><Text style={styles.backText}>← رجوع</Text></TouchableOpacity>
    <Text style={styles.title}>اشتراكات ممنون</Text>
    <Text style={styles.subtitle}>باقات مقدمي الخدمة</Text>
    {loading ? <ActivityIndicator color={palette.brand} style={{ marginTop: 40 }} /> : <>
      {subscription && <View style={styles.current}>
        <Text style={styles.cardTitle}>اشتراكك الحالي</Text>
        <Text style={styles.body}>{subscription.plan?.name_ar || "بدون باقة"} · {subscription.is_trial ? "تجربة مجانية" : subscription.status === "active" ? "نشط" : "منتهي"}</Text>
        {subscription.trial_ends_at && <Text style={styles.note}>نهاية التجربة: {new Date(subscription.trial_ends_at).toLocaleDateString("ar-IQ")}</Text>}
        {subscription.current_period_end && <Text style={styles.note}>ينتهي: {new Date(subscription.current_period_end).toLocaleDateString("ar-IQ")}</Text>}
        {subscription.cancel_at_period_end && <Text style={styles.note}>تم إيقاف التجديد مع استمرار المزايا حتى نهاية الفترة</Text>}
      </View>}
      {plans.map((plan) => <View key={plan.id} style={styles.card}>
        <Text style={styles.cardTitle}>{plan.name_ar}</Text>
        <Text style={styles.body}>{plan.description_ar || ""}</Text>
        <Text style={styles.price}>{Number(plan.monthly_price).toLocaleString("ar-IQ")} د.ع <Text style={styles.note}>شهرياً</Text></Text>
        <TouchableOpacity disabled={busy || (subscription?.status === "active" && subscription?.plan?.code === plan.code)} onPress={() => pay(plan.code)} style={[styles.payButton, busy && { opacity: 0.5 }]}>
          <Text style={styles.payText}>{subscription?.status === "active" && subscription?.plan?.code === plan.code ? "باقتك الحالية" : "اشترك وادفع بالبطاقة"}</Text>
        </TouchableOpacity>
      </View>)}
      {subscription?.status === "active" && subscription?.current_period_end && !subscription?.cancel_at_period_end && (
        <TouchableOpacity style={styles.cancelButton} onPress={async () => {
          try {
            const { error } = await supabase.rpc("cancel_own_subscription_at_period_end");
            if (error) throw error;
            setSubscription((current: any) => current ? { ...current, cancel_at_period_end: true } : current);
            Alert.alert("تم", "تم إيقاف التجديد، وتبقى المزايا حتى نهاية الفترة");
          } catch (error: any) { Alert.alert("تعذر الإلغاء", error?.message || "حاول مرة ثانية"); }
        }}>
          <Text style={styles.cancelText}>إيقاف التجديد عند نهاية الفترة</Text>
        </TouchableOpacity>
      )}
      <Text style={styles.noteCenter}>تتم عملية الدفع داخل صفحة QiCard الآمنة. لا يخزن ممنون بيانات البطاقة، ولا يتفعّل الاشتراك إلا بعد تأكيد الدفع من الخادم.</Text>
    </>}
  </ScrollView>;
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.canvas, paddingHorizontal: space.xl, paddingTop: 48 },
  back: { alignSelf: "flex-start", padding: 10, backgroundColor: palette.surface, borderRadius: radius.md, marginBottom: 16 },
  backText: { color: palette.ink, fontWeight: "800" },
  title: { color: palette.ink, fontSize: 23, fontWeight: "900", textAlign: "right" },
  subtitle: { color: palette.muted, fontSize: 12, textAlign: "right", marginTop: 4, marginBottom: 18 },
  current: { backgroundColor: palette.surface, borderColor: palette.brand, borderWidth: 1, borderRadius: radius.xl, padding: 16, marginBottom: 14 },
  card: { backgroundColor: palette.surface, borderColor: palette.line, borderWidth: 1, borderRadius: radius.xl, padding: 18, marginBottom: 12 },
  cardTitle: { color: palette.ink, fontSize: 18, fontWeight: "900", textAlign: "right" },
  body: { color: palette.muted, fontSize: 12, textAlign: "right", marginTop: 7 },
  price: { color: palette.brand, fontSize: 24, fontWeight: "900", textAlign: "right", marginTop: 16 },
  note: { color: palette.muted, fontSize: 11 },
  payButton: { backgroundColor: palette.brand, borderRadius: radius.md, padding: 14, marginTop: 14, alignItems: "center" },
  payText: { color: palette.white, fontSize: 13, fontWeight: "900" },
  cancelButton: { borderColor: "#dc2626", borderWidth: 1, borderRadius: radius.md, padding: 13, marginTop: 10, alignItems: "center" },
  cancelText: { color: "#dc2626", fontSize: 12, fontWeight: "800" },
  noteCenter: { color: palette.muted, fontSize: 11, lineHeight: 20, textAlign: "center", marginTop: 12 },
});