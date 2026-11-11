import { useState } from "react";
import { router } from "expo-router";
import { View, Text, StyleSheet, Alert } from "react-native";
import { supabase } from "@/lib/supabase";
import { normalizePhone, isValidPhone } from "@/lib/phone";
import { Button, RealInput } from "@/components/ui";

export default function ForgotPassword() {
  const [identifier, setIdentifier] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const id = identifier.trim();
    if (!id) {
      Alert.alert("خطأ", "أدخل رقم الهاتف أو البريد");
      return;
    }
    setBusy(true);
    try {
      const isEmail = id.includes("@");
      let email = id.toLowerCase();
      if (!isEmail) {
        const normalized = normalizePhone(id);
        if (!isValidPhone(id)) {
          throw new Error("رقم الهاتف غير صالح");
        }
        const { data: emailResult, error: lookupError } = await supabase.rpc(
          "lookup_email_by_phone",
          { _phone: normalized },
        );
        if (lookupError) throw lookupError;
        if (!emailResult || !String(emailResult).includes("@")) {
          throw new Error("لم نعثر على بريد مرتبط بهذا الرقم. أدخل البريد الإلكتروني المسجل بالحساب.");
        }
        email = String(emailResult).trim().toLowerCase();
      }

      // Use the installed app scheme; createURL may produce an Expo Go URL\n      // that is not allow-listed by Supabase for production password recovery.\n      const redirectTo = "mamnoon://auth/callback";
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo,
      });
      if (error) throw error;

      Alert.alert(
        "تم إرسال الطلب",
        "إذا كان البريد مسجلاً، ستصلك رسالة استعادة. افحص الوارد والرسائل غير المرغوب فيها.",
      );
      router.back();
    } catch (error: unknown) {
      Alert.alert(
        "تعذر إرسال رابط الاستعادة",
        error instanceof Error ? error.message : "حدث خطأ غير معروف. حاول مرة أخرى.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>استعادة كلمة المرور</Text>
      <Text style={styles.subtitle}>أدخل البريد الإلكتروني المسجل بحسابك أو رقم الهاتف المرتبط به</Text>
      <RealInput
        value={identifier}
        onChangeText={setIdentifier}
        placeholder="البريد الإلكتروني أو 07XXXXXXXXX"
        keyboardType={identifier.includes("@") ? "email-address" : "default"}
      />
      <View style={{ height: 24 }} />
      <Button title="إرسال رابط الاستعادة" onPress={submit} loading={busy} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 20, paddingTop: 50 },
  title: { fontSize: 26, fontWeight: "900", color: "#1e293b", marginBottom: 8 },
  subtitle: { fontSize: 14, color: "#64748b", marginBottom: 24 },
});
