import { useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { router } from "expo-router";
import {
  View, Text, StyleSheet, ScrollView, Alert, Pressable,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { authProxy, supabase } from "@/lib/supabase";
import { isValidPhone, normalizePhone, phoneToEmail } from "@/lib/phone";
import { useAuth } from "@/lib/auth-context";
import { Button, RealInput } from "@/components/ui";
import { palette, radius, space } from "@/styles/theme";

type Mode = "signup" | "login";
type LoginMethod = "phone" | "email";
type AuthSessionTokens = Pick<Session, "access_token" | "refresh_token">;

export default function AuthScreen() {
  const [mode, setMode] = useState<Mode>("login");
  const [loginMethod, setLoginMethod] = useState<LoginMethod>("phone");
  const [identifier, setIdentifier] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const { refresh } = useAuth();

  async function onSubmit() {
    if (password.length < 6) {
      Alert.alert("تحقق من كلمة المرور", "كلمة المرور يجب أن تكون 6 أحرف على الأقل");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        if (name.trim().length < 2) throw new Error("الرجاء إدخال الاسم الكامل");
        if (!isValidPhone(phone)) throw new Error("رقم الهاتف غير صالح");
        const normalized = normalizePhone(phone);
        const contactEmail = email.trim().toLowerCase();
        if (contactEmail && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(contactEmail)) {
          throw new Error("البريد الإلكتروني غير صالح");
        }
        const result = await authProxy<{ session: AuthSessionTokens | null }>("/signup", {
          email: contactEmail || phoneToEmail(normalized),
          password,
          phone: normalized,
          full_name: name.trim(),
          contact_email: contactEmail || null,
        });
        if (!result.session) throw new Error("تعذّر إكمال التسجيل. حاول مرة أخرى.");
        const { error } = await supabase.auth.setSession(result.session);
        if (error) throw error;
        if (contactEmail) {
          const { error: metadataError } = await supabase.auth.updateUser({
            data: { contact_email: contactEmail },
          });
          if (metadataError) throw metadataError;
        }
        await refresh();
        router.replace("/select-role");
      } else {
        const id = identifier.trim();
        if (!id) throw new Error(loginMethod === "phone" ? "أدخل رقم الهاتف" : "أدخل البريد الإلكتروني");
        let payload: { phone: string; password: string } | { email: string; password: string };
        if (loginMethod === "phone") {
          if (!isValidPhone(id)) throw new Error("رقم الهاتف غير صالح");
          payload = { phone: normalizePhone(id), password };
        } else {
          const normalizedEmail = id.toLowerCase();
          if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(normalizedEmail)) {
            throw new Error("البريد الإلكتروني غير صالح");
          }
          payload = { email: normalizedEmail, password };
        }
        const result = await authProxy<{ session: AuthSessionTokens | null }>("/login", payload);
        if (!result.session) throw new Error("تعذر إنشاء جلسة تسجيل الدخول");
        const { error } = await supabase.auth.setSession(result.session);
        if (error) throw error;
        await refresh();
        router.replace("/");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "حدث خطأ";
      if (/Failed to fetch|NetworkError/i.test(msg)) {
        Alert.alert("الاتصال غير متاح", "تحقق من اتصال الإنترنت وحاول مرة ثانية.");
      } else if (/already registered|User already/i.test(msg)) {
        Alert.alert("الحساب موجود", "هذا الحساب مسجّل مسبقاً. انتقل إلى تسجيل الدخول.");
        setMode("login");
        setLoginMethod("phone");
        setIdentifier(phone);
      } else if (/Invalid login|Invalid credentials/i.test(msg)) {
        Alert.alert("تعذر الدخول", "بيانات الدخول غير صحيحة.");
      } else {
        Alert.alert("تعذر إكمال العملية", msg);
      }
    } finally {
      setBusy(false);
    }
  }

  const isSignup = mode === "signup";

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.brandTop}>
            <View style={styles.brandMark}><Text style={styles.brandLetter}>م</Text></View>
            <Text style={styles.brandName}>ممنون</Text>
            <Text style={styles.brandCaption}>كل مشاويرك وخدمات بيتك بمكان واحد</Text>
            <View style={styles.brandRule}><View style={styles.brandRuleGold} /></View>
          </View>

          <View style={styles.panel}>
            <View style={styles.panelIntro}>
              <Text style={styles.kicker}>{isSignup ? "ابدأ رحلتك ويانه" : "أهلاً بعودتك"}</Text>
              <Text style={styles.title}>{isSignup ? "أنشئ حسابك" : "سجّل دخولك"}</Text>
              <Text style={styles.subtitle}>
                {isSignup ? "بيانات بسيطة وتكون جاهز تستخدم ممنون" : "ادخل لحسابك وتابع طلباتك بسهولة"}
              </Text>
            </View>

            <View style={styles.modeSwitch}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: !isSignup }}
                onPress={() => setMode("login")}
                style={[styles.modeOption, !isSignup && styles.modeOptionActive]}
              >
                <Text style={[styles.modeText, !isSignup && styles.modeTextActive]}>تسجيل الدخول</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: isSignup }}
                onPress={() => setMode("signup")}
                style={[styles.modeOption, isSignup && styles.modeOptionActive]}
              >
                <Text style={[styles.modeText, isSignup && styles.modeTextActive]}>حساب جديد</Text>
              </Pressable>
            </View>

            {!isSignup && (
              <View style={styles.methodBlock}>
                <Text style={styles.fieldLabel}>طريقة تسجيل الدخول</Text>
                <View style={styles.methodSwitch}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: loginMethod === "phone" }}
                    onPress={() => { setLoginMethod("phone"); setIdentifier(""); }}
                    style={[styles.methodOption, loginMethod === "phone" && styles.methodOptionActive]}
                  >
                    <Text style={[styles.methodText, loginMethod === "phone" && styles.methodTextActive]}>رقم الهاتف</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: loginMethod === "email" }}
                    onPress={() => { setLoginMethod("email"); setIdentifier(""); }}
                    style={[styles.methodOption, loginMethod === "email" && styles.methodOptionActive]}
                  >
                    <Text style={[styles.methodText, loginMethod === "email" && styles.methodTextActive]}>البريد الإلكتروني</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {isSignup ? (
              <>
                <FieldLabel title="الاسم الكامل" />
                <RealInput value={name} onChangeText={setName} placeholder="اكتب اسمك الثلاثي" autoCapitalize="words" textContentType="name" />
                <FieldLabel title="رقم الهاتف" />
                <RealInput value={phone} onChangeText={setPhone} placeholder="07XXXXXXXXX" keyboardType="phone-pad" textContentType="telephoneNumber" />
                <FieldLabel title="البريد الإلكتروني" hint="اختياري" />
                <RealInput value={email} onChangeText={setEmail} placeholder="name@example.com" keyboardType="email-address" autoCapitalize="none" textContentType="emailAddress" />
              </>
            ) : (
              <>
                <FieldLabel title={loginMethod === "phone" ? "رقم الهاتف" : "البريد الإلكتروني"} />
                <RealInput
                  value={identifier}
                  onChangeText={setIdentifier}
                  placeholder={loginMethod === "phone" ? "07XXXXXXXXX" : "name@example.com"}
                  keyboardType={loginMethod === "phone" ? "phone-pad" : "email-address"}
                  autoCapitalize="none"
                  textContentType={loginMethod === "phone" ? "telephoneNumber" : "emailAddress"}
                />
              </>
            )}

            <FieldLabel title="كلمة المرور" />
            <RealInput
              value={password}
              onChangeText={setPassword}
              placeholder="ستة أحرف على الأقل"
              secureTextEntry
              autoCapitalize="none"
              textContentType={isSignup ? "newPassword" : "password"}
              returnKeyType="done"
              onSubmitEditing={onSubmit}
            />

            {!isSignup && (
              <Pressable onPress={() => router.push("/forgot-password")} style={styles.forgotButton}>
                <Text style={styles.forgotText}>نسيت كلمة المرور؟</Text>
              </Pressable>
            )}

            <Button
              title={busy ? "جارٍ المتابعة..." : isSignup ? "إنشاء حسابي" : "الدخول إلى ممنون"}
              onPress={onSubmit}
              loading={busy}
              style={styles.submit}
            />
            <Text style={styles.terms}>بمتابعتك، أنت توافق على شروط الاستخدام وسياسة الخصوصية.</Text>
          </View>
          <Text style={styles.footer}>ممنون — تجربة أسهل، وخدمة أقرب</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function FieldLabel({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={styles.labelRow}>
      <Text style={styles.fieldLabel}>{title}</Text>
      {!!hint && <Text style={styles.fieldHint}>{hint}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.canvas },
  flex: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: space.xl, paddingTop: space.xl, paddingBottom: space.xxl },
  brandTop: { alignItems: "center", paddingTop: space.md, paddingBottom: space.xxl },
  brandMark: {
    width: 68, height: 68, borderRadius: 22, backgroundColor: palette.brand,
    alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: palette.gold,
  },
  brandLetter: { color: palette.white, fontSize: 34, fontWeight: "900" },
  brandName: { color: palette.ink, fontSize: 30, fontWeight: "900", marginTop: 10, letterSpacing: -0.5 },
  brandCaption: { color: palette.muted, fontSize: 13, fontWeight: "600", marginTop: 4 },
  brandRule: { height: 2, width: 58, backgroundColor: palette.line, marginTop: 16, borderRadius: 2 },
  brandRuleGold: { width: 22, height: 2, backgroundColor: palette.gold, alignSelf: "center", borderRadius: 2 },
  panel: {
    backgroundColor: palette.surface, borderRadius: radius.xl, padding: space.xl,
    borderWidth: 1, borderColor: palette.line,
  },
  panelIntro: { marginBottom: space.xl },
  kicker: { color: palette.gold, fontSize: 11, fontWeight: "900", marginBottom: 7 },
  title: { color: palette.ink, fontSize: 25, fontWeight: "900" },
  subtitle: { color: palette.muted, fontSize: 13, lineHeight: 21, marginTop: 6 },
  modeSwitch: { flexDirection: "row", backgroundColor: palette.surfaceSoft, borderRadius: radius.md, padding: 4, marginBottom: space.xl },
  modeOption: { flex: 1, minHeight: 46, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  modeOptionActive: { backgroundColor: palette.brand },
  modeText: { color: palette.muted, fontSize: 13, fontWeight: "800" },
  modeTextActive: { color: palette.white },
  methodBlock: { marginBottom: space.md },
  methodSwitch: { flexDirection: "row", gap: 8, backgroundColor: palette.canvas, padding: 5, borderRadius: radius.md, borderWidth: 1, borderColor: palette.line },
  methodOption: { flex: 1, minHeight: 46, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  methodOptionActive: { backgroundColor: palette.goldSoft, borderWidth: 1, borderColor: "#E4D4AD" },
  methodText: { color: palette.muted, fontSize: 12, fontWeight: "800" },
  methodTextActive: { color: palette.brandDeep },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: space.md, marginBottom: space.sm },
  fieldLabel: { color: palette.ink, fontSize: 13, fontWeight: "800" },
  fieldHint: { color: palette.muted, fontSize: 11 },
  forgotButton: { alignSelf: "flex-start", paddingVertical: space.md },
  forgotText: { color: palette.brand, fontSize: 12, fontWeight: "800" },
  submit: { marginTop: space.xl },
  terms: { color: palette.muted, fontSize: 10, lineHeight: 17, textAlign: "center", marginTop: space.lg },
  footer: { textAlign: "center", color: palette.muted, fontSize: 11, fontWeight: "700", marginTop: space.xl },
});
