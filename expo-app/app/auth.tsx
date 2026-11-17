import { useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { router } from "expo-router";
import {
  View, Text, StyleSheet, ScrollView, Alert, Pressable,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { authProxy, supabase } from "@/lib/supabase";
import { isValidPhone, normalizePhone, phoneToEmail } from "@/lib/phone";
import { useAuth } from "@/lib/auth-context";
import { Button, RealInput } from "@/components/ui";
import { palette, space } from "@/styles/theme";

type Mode = "signup" | "login";
type AuthSessionTokens = Pick<Session, "access_token" | "refresh_token">;
type AuthIconName = "user" | "phone" | "mail" | "lock";

export default function AuthScreen() {
  const [mode, setMode] = useState<Mode>("signup");
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
        if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
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
        router.replace("/home");
      } else {
        const id = identifier.trim();
        if (!id) throw new Error("أدخل رقم الهاتف أو البريد الإلكتروني");
        const isEmail = id.includes("@");
        let payload: { phone: string; password: string } | { email: string; password: string };
        if (isEmail) {
          const normalizedEmail = id.toLowerCase();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
            throw new Error("البريد الإلكتروني غير صالح");
          }
          payload = { email: normalizedEmail, password };
        } else {
          if (!isValidPhone(id)) throw new Error("رقم الهاتف غير صالح");
          payload = { phone: normalizePhone(id), password };
        }
        const result = await authProxy<{ session: AuthSessionTokens | null }>("/login", payload);
        if (!result.session) throw new Error("تعذر إنشاء جلسة تسجيل الدخول");
        const { data: sessionData, error } = await supabase.auth.setSession(result.session);
        if (error) throw error;
        const userId = sessionData.session?.user.id;
        const { data: roleRows } = userId
          ? await supabase.from("user_roles").select("role").eq("user_id", userId)
          : { data: [] as { role: string }[] };
        await refresh();
        if (roleRows?.some((row) => row.role === "super_admin")) {
          router.replace("/admin/bootstrap");
        } else {
          router.replace("/");
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "حدث خطأ";
      if (/Failed to fetch|NetworkError/i.test(msg)) {
        Alert.alert("الاتصال غير متاح", "تحقق من اتصال الإنترنت وحاول مرة ثانية.");
      } else if (/already registered|User already/i.test(msg)) {
        Alert.alert("الحساب موجود", "هذا الحساب مسجّل مسبقاً. أدخل كلمة المرور لتسجيل الدخول.");
        setIdentifier(phone || email);
        setMode("login");
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
            <LinearGradient
              colors={[palette.brand, palette.brandGlow]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.brandMark}
            >
              <Text style={styles.brandLetter}>م</Text>
            </LinearGradient>
            <Text style={styles.brandName}>ممنون</Text>
            <Text style={styles.brandCaption}>منصة النقل والخدمات الفاخرة</Text>
          </View>

          <View style={styles.modeSwitch}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: isSignup }}
              onPress={() => setMode("signup")}
              style={[styles.modeOption, isSignup && styles.modeOptionActive]}
            >
              <Text style={[styles.modeText, isSignup && styles.modeTextActive]}>حساب جديد</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: !isSignup }}
              onPress={() => setMode("login")}
              style={[styles.modeOption, !isSignup && styles.modeOptionActive]}
            >
              <Text style={[styles.modeText, !isSignup && styles.modeTextActive]}>تسجيل دخول</Text>
            </Pressable>
          </View>

          <View style={styles.form}>
            {isSignup ? (
              <>
                <AuthField title="الاسم الكامل" icon="user">
                  <RealInput
                    value={name}
                    onChangeText={setName}
                    placeholder="مثال: أحمد محمد"
                    autoCapitalize="words"
                    textContentType="name"
                    maxLength={100}
                    style={styles.inputRtl}
                  />
                </AuthField>
                <AuthField title="رقم الهاتف" icon="phone">
                  <RealInput
                    value={phone}
                    onChangeText={setPhone}
                    placeholder="07XXXXXXXXX"
                    keyboardType="phone-pad"
                    textContentType="telephoneNumber"
                    maxLength={30}
                    style={styles.inputLtr}
                  />
                </AuthField>
                <AuthField title="البريد الإلكتروني" hint="اختياري" icon="mail">
                  <RealInput
                    value={email}
                    onChangeText={setEmail}
                    placeholder="you@example.com"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    textContentType="emailAddress"
                    maxLength={255}
                    style={styles.inputLtr}
                  />
                </AuthField>
              </>
            ) : (
              <AuthField title="رقم الهاتف أو البريد" icon="phone">
                <RealInput
                  value={identifier}
                  onChangeText={setIdentifier}
                  placeholder="07XXXXXXXXX أو البريد"
                  keyboardType="default"
                  autoCapitalize="none"
                  autoComplete="username"
                  style={styles.inputLtr}
                />
              </AuthField>
            )}

            <AuthField title="كلمة المرور" icon="lock">
              <RealInput
                value={password}
                onChangeText={setPassword}
                placeholder="••••••"
                secureTextEntry
                autoCapitalize="none"
                textContentType={isSignup ? "newPassword" : "password"}
                returnKeyType="done"
                onSubmitEditing={onSubmit}
                maxLength={128}
                style={styles.inputLtr}
              />
            </AuthField>

            {!isSignup && (
              <Pressable onPress={() => router.push("/forgot-password")} style={styles.forgotButton}>
                <Text style={styles.forgotText}>نسيت كلمة المرور؟</Text>
              </Pressable>
            )}

            <Button
              title={busy ? "جارٍ المتابعة..." : isSignup ? "إنشاء الحساب" : "تسجيل الدخول"}
              onPress={onSubmit}
              loading={busy}
              style={styles.submit}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function AuthField({
  title,
  hint,
  icon,
  children,
}: {
  title: string;
  hint?: string;
  icon: AuthIconName;
  children: ReactNode;
}) {
  return (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <Text style={styles.fieldLabel}>{title}</Text>
        {!!hint && <Text style={styles.fieldHint}>({hint})</Text>}
      </View>
      <View style={styles.inputWrap}>
        {children}
        <AuthFieldIcon name={icon} />
      </View>
    </View>
  );
}

function AuthFieldIcon({ name }: { name: AuthIconName }) {
  const common = {
    stroke: palette.muted,
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    fill: "none" as const,
  };
  return (
    <View pointerEvents="none" style={styles.inputIcon}>
      <Svg width={20} height={20} viewBox="0 0 24 24">
        {name === "user" ? (
          <>
            <Circle {...common} cx="12" cy="8" r="4" />
            <Path {...common} d="M4.5 21a7.5 7.5 0 0 1 15 0" />
          </>
        ) : name === "phone" ? (
          <Path {...common} d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.4 19.4 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7l.5 2.7a2 2 0 0 1-.6 1.9L7.2 10a16 16 0 0 0 6.8 6.8l1.7-1.8a2 2 0 0 1 1.9-.6l2.7.5a2 2 0 0 1 1.7 2Z" />
        ) : name === "mail" ? (
          <>
            <Rect {...common} x="3" y="5" width="18" height="14" rx="2" />
            <Path {...common} d="m3 7 9 6 9-6" />
          </>
        ) : (
          <>
            <Rect {...common} x="4" y="10" width="16" height="11" rx="2" />
            <Path {...common} d="M8 10V7a4 4 0 0 1 8 0v3" />
          </>
        )}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.pageCanvas },
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
    paddingBottom: space.xxl,
  },
  welcomeLink: { alignSelf: "flex-start", paddingVertical: 6, marginBottom: 12 },
  welcomeLinkText: { color: palette.brand, fontSize: 12, fontWeight: "800" },
  brandTop: { alignItems: "center", paddingBottom: 24 },
  brandMark: {
    width: 80,
    height: 80,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: palette.brand,
    shadowOpacity: 0.2,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  brandLetter: { color: palette.white, fontSize: 34, fontWeight: "900" },
  brandName: { color: palette.ink, fontSize: 36, fontWeight: "900", marginTop: 12, letterSpacing: -0.5 },
  brandCaption: { color: palette.muted, fontSize: 13, fontWeight: "600", marginTop: 7 },
  modeSwitch: {
    flexDirection: "row",
    backgroundColor: palette.surfaceSoft,
    borderRadius: 12,
    padding: 6,
    marginBottom: 28,
    borderWidth: 1,
    borderColor: palette.line,
  },
  modeOption: { flex: 1, minHeight: 48, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  modeOptionActive: { backgroundColor: palette.brand, elevation: 2 },
  modeText: { color: palette.muted, fontSize: 14, fontWeight: "800" },
  modeTextActive: { color: palette.white },
  form: { flex: 1 },
  field: { marginBottom: 20 },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 },
  fieldLabel: { color: palette.ink, fontSize: 14, fontWeight: "800" },
  fieldHint: { color: palette.muted, fontSize: 12 },
  inputWrap: { position: "relative", justifyContent: "center" },
  inputIcon: { position: "absolute", left: 14, top: 0, bottom: 0, justifyContent: "center" },
  inputRtl: {
    minHeight: 64,
    borderRadius: 12,
    paddingLeft: 46,
    paddingRight: 16,
    textAlign: "right",
    fontSize: 16,
    borderColor: palette.line,
    backgroundColor: palette.surfaceSoft,
  },
  inputLtr: {
    minHeight: 64,
    borderRadius: 12,
    paddingLeft: 46,
    paddingRight: 16,
    textAlign: "left",
    fontSize: 16,
    borderColor: palette.line,
    backgroundColor: palette.surfaceSoft,
  },
  forgotButton: { alignSelf: "flex-start", paddingVertical: 8, marginTop: -8, marginBottom: 4 },
  forgotText: { color: palette.brand, fontSize: 12, fontWeight: "800" },
  submit: { width: "100%", minHeight: 56, borderRadius: 12, marginTop: 8 },
});
