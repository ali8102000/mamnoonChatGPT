import { useEffect, useState } from "react";
import { router } from "expo-router";
import { View, Text, StyleSheet, Alert } from "react-native";
import { supabase } from "@/lib/supabase";
import { Button, RealInput } from "@/components/ui";
import { palette } from "@/styles/theme";

export default function ResetPassword() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);

  useEffect(() => {
    let active = true;
    const checkSession = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (!active) return;
      setHasRecoverySession(!error && Boolean(data.session));
      setSessionReady(true);
    };
    void checkSession();
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY" || session) setHasRecoverySession(Boolean(session));
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function submit() {
    if (!hasRecoverySession) {
      Alert.alert("الرابط غير صالح", "ارجع إلى بريدك وافتح رابط استعادة كلمة المرور من جديد.");
      return;
    }
    if (password.length < 6 || password.length > 128) {
      Alert.alert("خطأ", "كلمة المرور يجب أن تكون بين 6 و128 حرفاً");
      return;
    }
    if (password !== confirm) {
      Alert.alert("خطأ", "كلمتا المرور غير متطابقتين");
      return;
    }
    setBusy(true);
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!sessionData.session) throw new Error("انتهت جلسة الاستعادة. افتح رابط البريد مرة ثانية.");
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      Alert.alert("تم", "تم تغيير كلمة المرور بنجاح");
      router.replace("/");
    } catch (error: unknown) {
      Alert.alert("تعذّر تغيير كلمة المرور", error instanceof Error ? error.message : "تعذر إكمال العملية. حاول مرة أخرى.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>كلمة مرور جديدة</Text>
      <Text style={styles.subtitle}>
        {sessionReady
          ? hasRecoverySession
            ? "أدخل كلمة المرور الجديدة لحسابك"
            : "افتح رابط استعادة كلمة المرور الذي وصلك بالبريد حتى نتحقق من هويتك"
          : "جارٍ التحقق من رابط الاستعادة..."}
      </Text>
      <Text style={styles.label}>كلمة المرور الجديدة</Text>
      <RealInput value={password} onChangeText={setPassword} placeholder="6 أحرف على الأقل" secureTextEntry />
      <Text style={styles.label}>تأكيد كلمة المرور</Text>
      <RealInput value={confirm} onChangeText={setConfirm} placeholder="أعد كتابة كلمة المرور" secureTextEntry />
      <View style={{ height: 24 }} />
      <Button title="حفظ كلمة المرور الجديدة" onPress={submit} loading={busy} disabled={!sessionReady || !hasRecoverySession || busy} />
      {!hasRecoverySession && sessionReady ? (
        <Text style={styles.link} onPress={() => router.replace("/forgot-password")}>إرسال رابط استعادة جديد</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.pageCanvas, paddingHorizontal: 20, paddingTop: 52 },
  title: { fontSize: 26, fontWeight: "900", color: palette.ink, marginBottom: 8 },
  subtitle: { fontSize: 13, color: palette.muted, marginBottom: 24, lineHeight: 22 },
  label: { fontSize: 13, fontWeight: "900", color: palette.ink, marginBottom: 8, marginTop: 16 },
  link: { color: palette.brand, textAlign: "center", marginTop: 22, fontWeight: "800" },
});
