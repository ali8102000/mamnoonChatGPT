import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { View, Text, StyleSheet, Alert } from "react-native";
import { supabase } from "@/lib/supabase";
import { Button, RealInput } from "@/components/ui";

export default function ResetPassword() {
  const { email: emailParam } = useLocalSearchParams<{ email?: string }>();
  const email = String(emailParam ?? "").trim().toLowerCase();
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!email) {
      Alert.alert("تنبيه", "ارجع وأدخل بريدك الإلكتروني أولاً");
      router.replace("/forgot-password");
      return;
    }
    if (!/^\d{6}$/.test(token.trim())) {
      Alert.alert("خطأ", "أدخل رمز التحقق المكوّن من 6 أرقام");
      return;
    }
    if (password.length < 6) {
      Alert.alert("خطأ", "كلمة المرور يجب أن تكون 6 أحرف على الأقل");
      return;
    }
    if (password !== confirm) {
      Alert.alert("خطأ", "كلمتا المرور غير متطابقتين");
      return;
    }
    setBusy(true);
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: token.trim(),
        type: "recovery",
      });
      if (verifyError) throw verifyError;
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      Alert.alert("تم", "تم تغيير كلمة المرور بنجاح");
      router.replace("/");
    } catch (error: unknown) {
      Alert.alert("تعذّر تغيير كلمة المرور", error instanceof Error ? error.message : "الرمز غير صحيح أو منتهي الصلاحية");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>رمز التحقق</Text>
      <Text style={styles.subtitle}>أدخل الرمز المرسل إلى بريدك الإلكتروني</Text>
      <Text style={styles.email} numberOfLines={1}>{email}</Text>
      <Text style={styles.label}>رمز التحقق (6 أرقام)</Text>
      <RealInput value={token} onChangeText={(value) => setToken(value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" keyboardType="numeric" />
      <Text style={styles.label}>كلمة المرور الجديدة</Text>
      <RealInput value={password} onChangeText={setPassword} placeholder="6 أحرف على الأقل" secureTextEntry />
      <Text style={styles.label}>تأكيد كلمة المرور</Text>
      <RealInput value={confirm} onChangeText={setConfirm} placeholder="أعد كتابة كلمة المرور" secureTextEntry />
      <View style={{ height: 24 }} />
      <Button title="تأكيد الرمز وتغيير كلمة المرور" onPress={submit} loading={busy} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 20, paddingTop: 50 },
  title: { fontSize: 26, fontWeight: "900", color: "#1e293b", marginBottom: 8 },
  subtitle: { fontSize: 14, color: "#64748b", marginBottom: 8 },
  email: { color: "#64748b", fontSize: 13, marginBottom: 12 },
  label: { fontSize: 13, fontWeight: "700", color: "#64748b", marginBottom: 8, marginTop: 16 },
});
