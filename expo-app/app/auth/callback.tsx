import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import * as Linking from "expo-linking";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";

export default function AuthCallbackScreen() {
  const params = useLocalSearchParams<{ code?: string; access_token?: string; refresh_token?: string; error_description?: string }>();
  const [message, setMessage] = useState("جارٍ تأكيد حسابك...");
  const [busy, setBusy] = useState(true);
  const { refresh } = useAuth();

  useEffect(() => {
    let active = true;
    async function complete() {
      try {
        const initialUrl = await Linking.getInitialURL();
        const parsed = initialUrl ? new URL(initialUrl) : null;
        const hashParams = new URLSearchParams((parsed?.hash ?? "").replace(/^#/, ""));
        const queryParams = parsed?.searchParams;
        const code = params.code || queryParams?.get("code") || undefined;
        const accessToken = params.access_token || hashParams.get("access_token") || queryParams?.get("access_token") || undefined;
        const refreshToken = params.refresh_token || hashParams.get("refresh_token") || queryParams?.get("refresh_token") || undefined;
        const callbackError = params.error_description || queryParams?.get("error_description") || hashParams.get("error_description");
        if (callbackError) throw new Error(callbackError);
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) throw error;
        } else {
          throw new Error("الرابط غير مكتمل أو منتهي الصلاحية. اطلب رابطاً جديداً.");
        }
        await refresh();
        if (!active) return;
        setMessage("تم تأكيد البريد الإلكتروني بنجاح");
        setTimeout(() => router.replace("/"), 1200);
      } catch (error) {
        if (!active) return;
        setMessage(error instanceof Error ? error.message : "تعذر تأكيد البريد");
      } finally {
        if (active) setBusy(false);
      }
    }
    complete();
    return () => { active = false; };
  }, [params.code, params.access_token, params.refresh_token, params.error_description]);

  return <View style={styles.container}>
    {busy ? <ActivityIndicator size="large" color="#2563eb" /> : null}
    <Text style={styles.title}>{message}</Text>
    {!busy ? <Text style={styles.link} onPress={() => router.replace("/auth")}>العودة لتسجيل الدخول</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center", padding: 28, backgroundColor: "#f9fafb" },
  title: { fontSize: 18, fontWeight: "800", color: "#1e293b", textAlign: "center", lineHeight: 30 },
  link: { color: "#2563eb", marginTop: 24, fontWeight: "700" },
});
