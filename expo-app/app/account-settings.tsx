import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Alert } from "react-native";
import { router } from "expo-router";
import * as Linking from "expo-linking";
import { supabase } from "@/lib/supabase";
import { normalizePhone, isValidPhone } from "@/lib/phone";
import { useAuth } from "@/lib/auth-context";
import { Button, RealInput } from "@/components/ui";

export default function AccountSettingsScreen() {
  const { user, profile, refresh } = useAuth();
  const [email, setEmail] = useState(user?.email ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [otp, setOtp] = useState("");
  const [phonePending, setPhonePending] = useState(false);
  const [busy, setBusy] = useState(false);

  async function changeEmail() {
    const next = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) {
      Alert.alert("تنبيه", "أدخل بريداً إلكترونياً صحيحاً"); return;
    }
    if (next === user?.email?.toLowerCase()) {
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
    <Text style={styles.note}>أي تغيير ببيانات الدخول لا يعتمد إلا بعد إكمال التحقق.</Text>
    <Text style={styles.label}>البريد الحالي</Text>
    <Text style={styles.current} selectable>{user?.email || "غير مسجل"}</Text>
    <Text style={styles.label}>البريد الجديد</Text>
    <RealInput value={email} onChangeText={setEmail} placeholder="name@example.com" keyboardType="email-address" />
    <View style={{ height: 12 }} />
    <Button title="إرسال رابط تأكيد البريد الجديد" onPress={changeEmail} loading={busy} />
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
  note: { color: "#64748b", lineHeight: 22, marginBottom: 22 },
  label: { fontSize: 13, fontWeight: "800", color: "#475569", marginTop: 16, marginBottom: 8 },
  current: { color: "#64748b", fontSize: 14, paddingVertical: 8 },
  separator: { height: 1, backgroundColor: "#e2e8f0", marginVertical: 26 },
  hint: { color: "#64748b", fontSize: 12, lineHeight: 20, marginTop: 10 },
  back: { textAlign: "center", color: "#0f766e", fontWeight: "800", padding: 24 },
});
