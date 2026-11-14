import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Alert, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import * as Linking from "expo-linking";
import * as SecureStore from "expo-secure-store";
import { supabase } from "@/lib/supabase";
import { normalizePhone, isValidPhone } from "@/lib/phone";
import { useAuth } from "@/lib/auth-context";
import { Button, RealInput } from "@/components/ui";
import { palette, radius, space } from "@/styles/theme";

export default function AccountSettingsScreen() {
  const { user, profile, roles, refresh } = useAuth();
  const actualEmail = (() => { const candidate = String(user?.email ?? "").trim().toLowerCase(); return candidate && !/^phone\d+@mamnoon\.app$/.test(candidate) ? candidate : ""; })();
  const [email, setEmail] = useState(actualEmail);
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [otp, setOtp] = useState("");
  const [phonePending, setPhonePending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [companyName, setCompanyName] = useState("شركة ممنون");
  const [activeRole, setActiveRole] = useState("customer");
  const isCompanyAdmin = user?.email?.toLowerCase() === "a7md0555666@gmail.com" && roles.includes("super_admin");

  useEffect(() => { setEmail(actualEmail); }, [actualEmail]);

  useEffect(() => {
    let mounted = true;
    SecureStore.getItemAsync("mamnoon_active_role").then((saved) => { if (mounted && saved) setActiveRole(saved); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!isCompanyAdmin) return;
    (supabase as any).from("company_settings").select("company_name").eq("id", 1).maybeSingle()
      .then(({ data }: any) => { if (data?.company_name) setCompanyName(data.company_name); });
  }, [isCompanyAdmin]);

  async function switchRole(role: string) {
    if (role === "customer") {
      if (!roles.includes("customer") && user?.id) {
        const { error } = await (supabase as any).from("user_roles")
          .upsert({ user_id: user.id, role: "customer" }, { onConflict: "user_id,role" });
        if (error) { Alert.alert("تعذر التبديل", error.message); return; }
        await refresh();
      }
      await SecureStore.setItemAsync("mamnoon_active_role", "customer");
      setActiveRole("customer");
      router.replace("/home");
      return;
    }
    if (role === "driver" && !roles.includes("driver")) {
      router.push("/onboarding/driver");
      return;
    }
    if (role === "large_driver" && !roles.includes("large_driver")) {
      router.push({ pathname: "/onboarding/driver", params: { providerType: "large_driver" } });
      return;
    }
    if (role === "worker" && !roles.includes("worker")) {
      router.push("/onboarding/worker");
      return;
    }
    if (role !== "driver" && role !== "large_driver" && role !== "worker") return;
    await SecureStore.setItemAsync("mamnoon_active_role", role);
    setActiveRole(role);
    router.replace("/home");
  }

  async function saveCompanyName() {
    const next = companyName.trim().replace(/\s+/g, " ");
    if (next.length < 2 || next.length > 60) { Alert.alert("تنبيه", "اسم الشركة لازم يكون بين حرفين و60 حرفاً"); return; }
    if (!isCompanyAdmin || !user?.id) { Alert.alert("غير مخوّل", "هذه الصلاحية لحساب مالك شركة ممنون فقط"); return; }
    setBusy(true);
    try {
      const { error } = await (supabase as any).from("company_settings")
        .upsert({ id: 1, company_name: next, updated_by: user.id }, { onConflict: "id" });
      if (error) throw error;
      Alert.alert("تم", "تم تحديث اسم الشركة الظاهر للمستخدمين.");
    } catch (e) { Alert.alert("تعذر تحديث الاسم", e instanceof Error ? e.message : "حدث خطأ"); }
    finally { setBusy(false); }
  }

  async function changeEmail() {
    const next = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) {
      Alert.alert("تنبيه", "أدخل بريداً إلكترونياً صحيحاً"); return;
    }
    if (next === actualEmail) {
      Alert.alert("معلومة", "هذا هو بريدك الحالي"); return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser(
        { email: next },
        { emailRedirectTo: Linking.createURL("/auth/callback") },
      );
      if (error) throw error;
      Alert.alert("تم إرسال رسالة التأكيد", "افتح الرسالة في البريد الجديد واضغط رابط التأكيد حتى يتغير بريد حسابك.");
    } catch (e) {
      Alert.alert("تعذر تغيير البريد", e instanceof Error ? e.message : "حدث خطأ");
    } finally { setBusy(false); }
  }

  async function requestPhoneChange() {
    if (!isValidPhone(phone)) { Alert.alert("تنبيه", "رقم الهاتف غير صحيح"); return; }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ phone: normalizePhone(phone) });
      if (error) throw error;
      setPhonePending(true);
      Alert.alert("أرسلنا رمز التحقق", "أدخل رمز SMS الذي وصل إلى رقم الهاتف الجديد.");
    } catch (e) {
      Alert.alert("تعذر إرسال الرمز", e instanceof Error ? e.message : "تأكد من تفعيل مزود SMS في Supabase.");
    } finally { setBusy(false); }
  }

  async function verifyPhone() {
    if (!otp.trim()) { Alert.alert("تنبيه", "أدخل رمز التحقق"); return; }
    setBusy(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        phone: normalizePhone(phone), token: otp.trim(), type: "phone_change",
      });
      if (error) throw error;
      await refresh();
      setPhonePending(false); setOtp("");
      Alert.alert("تم", "تم تأكيد رقم الهاتف وتحديثه في حسابك.");
    } catch (e) {
      Alert.alert("فشل التحقق", e instanceof Error ? e.message : "رمز التحقق غير صحيح");
    } finally { setBusy(false); }
  }

  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
    <Text style={styles.kicker}>MAMNOON · ACCOUNT</Text>
    <Text style={styles.title}>إعدادات حسابك</Text>
    <Text style={styles.subtitle}>إدارة أدوارك وبيانات التواصل بأمان</Text>
    {isCompanyAdmin && <View style={styles.nameSection}>
      <Text style={styles.sectionTitle}>اسم الشركة الظاهر للمستخدمين</Text>
      <Text style={styles.note}>يظهر هذا الاسم في رسائل انتظار الموافقة والتنبيهات بدلاً من اسم الشخص.</Text>
      <RealInput value={companyName} onChangeText={setCompanyName} placeholder="مثال: شركة ممنون" maxLength={60} />
      <View style={{ height: 12 }} />
      <Button title="حفظ اسم الشركة" onPress={saveCompanyName} loading={busy} />
    </View>}
    <Text style={styles.sectionTitle}>مساحاتك في ممنون</Text>
    <Text style={styles.note}>بدّل بين حساب الزبون ومجالات العمل من نفس الحساب. الأدوار الجديدة تحتاج إكمال التوثيق.</Text>
    <View style={styles.roleGrid}>
      {["customer", "worker", "driver", "large_driver"].map((role) => {
        const selected = role === "customer"
          ? { title: "الزبون", mark: "ز", backgroundColor: palette.goldSoft, color: palette.brand }
          : role === "worker"
            ? { title: "الفني", mark: "ف", backgroundColor: palette.brandSoft, color: palette.brand }
            : role === "large_driver"
              ? { title: "سيارات كبيرة", mark: "ك", backgroundColor: "#F4E9DC", color: "#8A5B32" }
              : { title: "كابتن تكسي", mark: "س", backgroundColor: palette.brandSoft, color: palette.brand };
        return (
          <TouchableOpacity key={role} activeOpacity={0.82} style={[styles.roleCard, { backgroundColor: selected.backgroundColor }, activeRole === role && styles.roleCardActive]} onPress={() => switchRole(role)}>
            <View style={styles.roleMark}><Text style={styles.roleEmoji}>{selected.mark}</Text></View>
            <Text style={[styles.roleTitle, { color: selected.color }]}>{selected.title}</Text>
            <Text style={[styles.roleHint, { color: selected.color }]}>{activeRole === role ? "المساحة الحالية" : role === "customer" || roles.includes(role as any) ? "التبديل إلى هذا الدور" : "إكمال التسجيل"}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
    <Text style={styles.note}>أي تغيير ببيانات الدخول لا يعتمد إلا بعد إكمال التحقق.</Text>
    <Text style={styles.label}>البريد الإلكتروني</Text>
    {actualEmail ? <Text style={styles.current} selectable>{actualEmail}</Text> : <Text style={styles.hint}>ماكو بريد إلكتروني حقيقي مسجّل بحسابك. أضف بريدك حتى تستلم رسائل التأكيد واستعادة الحساب.</Text>}
    <Text style={styles.label}>{actualEmail ? "تغيير البريد الإلكتروني" : "إضافة بريد إلكتروني حقيقي"}</Text>
    <RealInput value={email} onChangeText={setEmail} placeholder="اكتب بريدك الحقيقي" keyboardType="email-address" autoCapitalize="none" textContentType="emailAddress" />
    <View style={{ height: 12 }} />
    <Button title={actualEmail ? "تأكيد تغيير البريد" : "إضافة البريد وإرسال رابط التأكيد"} onPress={changeEmail} loading={busy} />
    <View style={styles.separator} />
    <Text style={styles.label}>رقم الهاتف الحالي</Text>
    <Text style={styles.current} selectable>{profile?.phone || user?.phone || "غير مسجل"}</Text>
    <Text style={styles.label}>رقم الهاتف الجديد</Text>
    <RealInput value={phone} onChangeText={setPhone} placeholder="07XXXXXXXXX" keyboardType="phone-pad" />
    {!phonePending ? <>
      <View style={{ height: 12 }} />
      <Button title="إرسال رمز SMS للتحقق من الرقم" onPress={requestPhoneChange} loading={busy} />
      <Text style={styles.hint}>يتطلب هذا الخيار تفعيل خدمة SMS والتحقق الهاتفي في إعدادات Supabase.</Text>
    </> : <>
      <Text style={styles.label}>رمز التحقق</Text>
      <RealInput value={otp} onChangeText={setOtp} placeholder="أدخل رمز SMS" keyboardType="numeric" />
      <View style={{ height: 12 }} />
      <Button title="تأكيد الرقم الجديد" onPress={verifyPhone} loading={busy} />
    </>}
    <TouchableOpacity activeOpacity={0.85} onPress={() => router.push("/support-chat")} style={styles.supportCard}>
      <View style={{ flex: 1 }}><Text style={styles.supportTitle}>مراسلة دعم ممنون</Text><Text style={styles.supportHint}>راسل الإدارة وتابع الردود من نفس الحساب</Text></View>
      <Text style={styles.supportAction}>مراسلة الدعم</Text>
    </TouchableOpacity>
    <Text style={styles.back} onPress={() => router.back()}>رجوع</Text>
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.canvas },
  container: { flexGrow: 1, paddingHorizontal: space.xl, paddingTop: space.xl, paddingBottom: space.huge },
  kicker: { color: palette.gold, fontSize: 10, fontWeight: "900", letterSpacing: 1.3, marginBottom: 8 },
  title: { fontSize: 27, fontWeight: "900", color: palette.ink, marginBottom: 5 },
  subtitle: { fontSize: 13, color: palette.muted, marginBottom: space.xl },
  sectionTitle: { fontSize: 17, fontWeight: "900", color: palette.ink, marginTop: 20, marginBottom: 8 },
  nameSection: { backgroundColor: palette.surface, borderRadius: radius.xl, padding: space.lg, borderWidth: 1, borderColor: palette.line, marginBottom: 12 },
  roleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 18 },
  roleCard: { width: "48%", minHeight: 124, borderRadius: radius.lg, padding: 14, justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: "transparent" },
  roleCardActive: { borderColor: palette.gold },
  roleMark: { width: 42, height: 42, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.75)", justifyContent: "center", alignItems: "center", marginBottom: 8 },
  roleEmoji: { fontSize: 20, fontWeight: "900" },
  roleTitle: { fontSize: 14, fontWeight: "900" },
  roleHint: { fontSize: 10, fontWeight: "800", marginTop: 5, opacity: 0.9 },
  note: { color: palette.muted, lineHeight: 21, marginBottom: 16, fontSize: 12 },
  label: { fontSize: 12, fontWeight: "900", color: palette.ink, marginTop: 16, marginBottom: 8 },
  current: { color: palette.muted, fontSize: 14, paddingVertical: 8 },
  separator: { height: 1, backgroundColor: palette.line, marginVertical: 24 },
  hint: { color: palette.muted, fontSize: 11, lineHeight: 19, marginTop: 10 },
  supportCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: palette.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: palette.gold, padding: 16, marginTop: 22 },
  supportTitle: { color: palette.ink, fontSize: 14, fontWeight: "900", textAlign: "right" },
  supportHint: { color: palette.muted, fontSize: 11, marginTop: 5, textAlign: "right" },
  supportAction: { color: palette.white, backgroundColor: palette.brand, paddingHorizontal: 13, paddingVertical: 10, borderRadius: radius.md, fontSize: 11, fontWeight: "900" },
  back: { textAlign: "center", color: palette.brand, fontWeight: "900", padding: 24 },
});
