import { useState } from "react";
import { router } from "expo-router";
import { View, Text, StyleSheet, Alert } from "react-native";
import { authProxy } from "@/lib/supabase";
import { Button, RealInput } from "@/components/ui";
import { palette } from "@/styles/theme";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const value = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      Alert.alert("تنبيه", "أدخل بريداً إلكترونياً صحيحاً");
      return;
    }
    setBusy(true);
    try {
      const result = await authProxy<{ ok?: boolean; error?: string }>("/reset", {
        identifier: value,
      });
      if (result.ok !== true) {
        throw new Error(result.error || "reset_unavailable");
      }
      router.push({ pathname: "/reset-password", params: { email: value } });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "";
      Alert.alert(
        "تعذّر إرسال الرمز",
        message === "too_many_attempts"
          ? "طلبت رمزاً عدة مرات. انتظر قليلاً ثم حاول مجدداً."
          : "تعذّر إرسال رمز الاستعادة حالياً. تحقق من البريد وحاول لاحقاً.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>استعادة كلمة المرور</Text>
      <Text style={styles.subtitle}>أدخل بريدك الإلكتروني المسجّل بحسابك لنرسل لك رمز تحقق من 6 أرقام</Text>
      <RealInput value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" />
      <View style={{ height: 24 }} />
      <Button title="إرسال رمز التحقق" onPress={submit} loading={busy} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.pageCanvas, paddingHorizontal: 20, paddingTop: 52 },
  title: { fontSize: 26, fontWeight: "900", color: palette.ink, marginBottom: 8 },
  subtitle: { fontSize: 13, color: palette.muted, marginBottom: 24, lineHeight: 22 },
});
