import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Alert, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import * as Linking from "expo-linking";
import * as SecureStore from "expo-secure-store";
import { supabase } from "@/lib/supabase";
import { normalizePhone, isValidPhone } from "@/lib/phone";
import { useAuth } from "@/lib/auth-context";
import { Button, RealInput } from "@/components/ui";

export default function AccountSettingsScreen() {
  const { user, profile, roles, refresh } = useAuth();
  const [email, setEmail] = useState(String(user?.user_metadata?.contact_email ?? user?.email ?? ""));
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [otp, setOtp] = useState("");
  const [phonePending, setPhonePending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [companyName, setCompanyName] = useState("شركة ممنون");
  const isCompanyAdmin = user?.email?.toLowerCase() === "a7md0555666@gmail.com" && roles.includes("super_admin");

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
      router.replace("/home");
      return;
    }
    if (role === "driver" && !roles.includes("driver")) {
      router.push("/onboarding/driver");
      return;
    }
    if (role === "worker" && !roles.includes("worker")) {
      router.push("/onboarding/worker");
      return;
    }
    if (role !== "driver" && role !== "worker") return;
    await SecureStore.setItemAsync("mamnoon_active_role", role);
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
    if (next === String(user?.email ?? "").toLowerCase()) {
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

  return <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
    <Text style={styles.title}>إعدادات الحساب</Text>
    {isCompanyAdmin && <View style={styles.nameSection}>
      <Text style={styles.sectionTitle}>اسم الشركة الظاهر للمستخدمين</Text>
      <Text style={styles.note}>يظهر هذا الاسم في رسائل انتظار الموافقة والتنبيهات بدلاً من اسم الشخص.</Text>
      <RealInput value={companyName} onChangeText={setCompanyName} placeholder="مثال: شركة ممنون" maxLength={60} />
      <View style={{ height: 12 }} />
      <Button title="حفظ اسم الشركة" onPress={saveCompanyName} loading={busy} />
    </View>}
    <Text style={styles.sectionTitle}>طريقة استخدام ممنون</Text>
    <Text style={styles.note}>اختَر الدور من هنا. إذا اخترت سائق تكسي لأول مرة راح تكمل بيانات السيارة.</Text>
    <View style={styles.roleGrid}>
      {["customer", "worker", "driver"].map((role) => {
        const selected = role === "customer"
          ? { title: "زبون", emoji: "👤", backgroundColor: "#e0f2fe", color: "#0369a1" }
          : role === "worker"
            ? { title: "فني", emoji: "🛠️", backgroundColor: "#dcfce7", color: "#15803d" }
            : { title: "سائق تكسي", emoji: "🚕", backgroundColor: "#fef3c7", color: "#b45309" };
        return (
          <TouchableOpacity key={role} activeOpacity={0.82} style={[styles.roleCard, { backgroundColor: selected.backgroundColor }]} onPress={() => switchRole(role)}>
            <Text style={styles.roleEmoji}>{selected.emoji}</Text>
            <Text style={[styles.roleTitle, { color: selected.color }]}>{selected.title}</Text>
            <Text style={[styles.roleHint, { color: selected.color }]}>{role === "customer" || roles.includes(role as any) ? "تبديل الدور" : "التسجيل بهذا الدور"}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
    <Text style={styles.note}>أي تغيير ببيانات الدخول لا يعتمد إلا بعد إكمال التحقق.</Text>
    <Text style={styles.label}>البريد الحالي</Text>
    <Text style={styles.current} selectable>{user?.user_metadata?.contact_email || user?.email || "غير مسجل"}</Text>
    <Text style={styles.label}>البريد الجديد</Text>
    <RealInput value={email} onChangeText={setEmail} placeholder="name@example.com" keyboardType="email-address" />
    <View style={{ height: 12 }} />
    <Button title="تأكيد البريد الإلكتروني" onPress={changeEmail} loading={busy} />
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
    <Text style={styles.back} onPress={() => router.back()}>رجوع</Text>
  </ScrollView>;
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 22, paddingTop: 54, backgroundColor: "#f7f8f5" },
  title: { fontSize: 26, fontWeight: "900", color: "#1e293b", marginBottom: 8 },
  sectionTitle: { fontSize: 18, fontWeight: "900", color: "#1e293b", marginTop: 18, marginBottom: 8 },
  nameSection: { backgroundColor: "#fff", borderRadius: 18, padding: 16, borderWidth: 1, borderColor: "#e2e8f0", marginBottom: 12 },
  roleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 18 },
  roleCard: { width: "48%", minHeight: 112, borderRadius: 20, padding: 14, justifyContent: "center", alignItems: "center" },
  roleEmoji: { fontSize: 28, marginBottom: 6 },
  roleTitle: { fontSize: 15, fontWeight: "900" },
  roleHint: { fontSize: 10, fontWeight: "700", marginTop: 4, opacity: 0.8 },
  note: { color: "#64748b", lineHeight: 22, marginBottom: 22 },
  label: { fontSize: 13, fontWeight: "800", color: "#475569", marginTop: 16, marginBottom: 8 },
  current: { color: "#64748b", fontSize: 14, paddingVertical: 8 },
  separator: { height: 1, backgroundColor: "#e2e8f0", marginVertical: 26 },
  hint: { color: "#64748b", fontSize: 12, lineHeight: 20, marginTop: 10 },
  back: { textAlign: "center", color: "#0f766e", fontWeight: "800", padding: 24 },
});
