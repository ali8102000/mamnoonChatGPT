import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isValidPhone, normalizePhone } from "@/lib/phone";
import { useAuth, SUPER_ADMIN_EMAIL } from "@/lib/auth-context";
import { signInWithIdentifier } from "@/lib/auth.functions";
import { Loader2, Phone, Lock, ArrowLeft, ArrowRight, Mail, User } from "lucide-react";
import { toast } from "@/lib/toast";
import { useWelcomePreferences } from "@/lib/welcome-preferences";
import { Button } from "@/components/ui/button";
import { signupSchema, requiresEmailConfirmation } from "@/lib/signup-validation";

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { mode?: Mode } => ({
    mode: search.mode === "login" ? "login" : undefined,
  }),
  head: () => ({
    meta: [
      { title: "تسجيل الدخول | ممنون" },
      { name: "description", content: "أنشئ حسابك أو سجّل الدخول لطلب النقل والخدمات في ممنون." },
      { property: "og:title", content: "تسجيل الدخول | ممنون" },
      {
        property: "og:description",
        content: "أنشئ حسابك أو سجّل الدخول لطلب النقل والخدمات في ممنون.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

type Mode = "signup" | "login";

function AuthPage() {
  const search = Route.useSearch();
  const [mode, setMode] = useState<Mode>(search.mode || "signup");
  const { language } = useWelcomePreferences();
  const t = (ar: string, en: string) => (language === "ar" ? ar : en);
  const Forward = language === "ar" ? ArrowLeft : ArrowRight;
  const [identifier, setIdentifier] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmationEmail, setConfirmationEmail] = useState("");
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const signIn = useServerFn(signInWithIdentifier);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      toast.error(
        t("كلمة المرور يجب أن تكون 6 أحرف على الأقل", "Password must be at least 6 characters"),
      );
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        const parsed = signupSchema.safeParse({ name, phone, email, password });
        if (!parsed.success) {
          toast.error(parsed.error.issues[0]?.message || "تحقق من بيانات التسجيل");
          return;
        }
        const { phone: normalized, email: realEmail, name: fullName } = parsed.data;
        const isSuperAdminEmail = realEmail === SUPER_ADMIN_EMAIL.toLowerCase();

        const { data, error } = await supabase.auth.signUp({
          email: realEmail,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            data: {
              phone: normalized,
              full_name: fullName,
            },
          },
        });
        if (error) throw error;
        if (requiresEmailConfirmation(data.session)) {
          setConfirmationEmail(realEmail);
          setPassword("");
          return;
        }
        await refresh();
        if (isSuperAdminEmail) {
          toast.success("تم إنشاء الحساب. أكمل إعداد المدير الأعلى برمز التهيئة الآمن.");
          navigate({ to: "/admin/bootstrap" });
        } else {
          toast.success(t("تم إنشاء الحساب", "Account created"));
          navigate({ to: "/select-role" });
        }
      } else {
        const id = identifier.trim();
        if (!id) {
          toast.error(
            t("أدخل رقم الهاتف أو البريد الإلكتروني", "Enter your phone number or email"),
          );
          setBusy(false);
          return;
        }
        const isEmail = id.includes("@");
        const isSuper = id.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase();

        if (!isEmail && !isValidPhone(id)) {
          toast.error(t("رقم الهاتف غير صالح", "Invalid phone number"));
          setBusy(false);
          return;
        }
        const finalId = isEmail ? id : normalizePhone(id);
        const tokens = await signIn({ data: { identifier: finalId, password } });
        const { data, error } = await supabase.auth.setSession({
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken,
        });
        if (error) throw error;
        const authenticatedEmail = data.user?.email?.toLowerCase();

        if (isSuper || authenticatedEmail === SUPER_ADMIN_EMAIL.toLowerCase()) {
          await refresh();
          toast.success("أهلاً بعودتك. أكمل التحقق من إعداد المدير الأعلى.");
          navigate({ to: "/admin/bootstrap" });
          return;
        }

        await refresh();
        toast.success(t("أهلاً بعودتك", "Welcome back"));
        navigate({ to: "/" });
      }
    } catch (err: any) {
      const msg = err?.message || t("حدث خطأ", "Something went wrong");
      if (/Failed to fetch|NetworkError|fetch.*failed/i.test(msg)) {
        toast.error(
          t(
            "تعذّر الاتصال بالخادم. تحقق من اتصال الإنترنت وحاول مرة أخرى.",
            "Unable to connect. Check your internet and try again.",
          ),
        );
      } else if (/already registered|User already/i.test(msg)) {
        toast.error(
          t(
            "هذا الحساب مسجّل مسبقاً. أدخل كلمة المرور لتسجيل الدخول.",
            "This account already exists. Enter your password to sign in.",
          ),
        );
        setIdentifier(phone || email);
        setMode("login");
      } else if (/Invalid login|Invalid credentials/i.test(msg)) {
        toast.error(t("بيانات الدخول غير صحيحة", "Incorrect sign-in details"));
      } else if (/Email rate limit/i.test(msg)) {
        toast.error(t("الرجاء المحاولة بعد دقيقة", "Please try again in a minute"));
      } else {
        toast.error(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      dir={language === "ar" ? "rtl" : "ltr"}
      lang={language}
      className="min-h-screen flex flex-col px-5 pt-6 pb-10 w-full max-w-lg mx-auto"
    >
      <Button asChild variant="link" className="self-start mb-3">
        <Link to="/welcome">{t("اللغة والترحيب", "Language & welcome")}</Link>
      </Button>
      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center h-20 w-20 rounded-3xl bg-gradient-to-br from-primary to-primary-glow glow-primary mb-4 shadow-elegant">
          <span className="text-3xl font-black text-primary-foreground">م</span>
        </div>
        <h1 className="text-4xl font-black text-gradient">{t("ممنون", "Mumnun")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("منصة النقل والخدمات الفاخرة", "Rides and home services")}
        </p>
      </div>

      <div className="flex flex-col">
        <div className="flex bg-surface-2 border border-border rounded-xl p-1.5 mb-7">
          {(["signup", "login"] as Mode[]).map((m) => (
            <Button
              key={m}
              type="button"
              variant={mode === m ? "default" : "ghost"}
              onClick={() => { setMode(m); setConfirmationEmail(""); }}
              className={`flex-1 h-12 rounded-lg text-base font-bold transition btn-press tap-highlight-none ${
                mode === m
                  ? "bg-primary text-primary-foreground shadow-card"
                  : "text-muted-foreground"
              }`}
            >
              {m === "signup" ? t("حساب جديد", "New account") : t("تسجيل دخول", "Sign in")}
            </Button>
          ))}
        </div>

        {confirmationEmail ? (
          <section className="py-8 text-center flex flex-col items-center gap-5" aria-live="polite">
            <div className="h-20 w-20 rounded-full bg-primary/10 grid place-items-center">
              <Mail className="h-9 w-9 text-primary" />
            </div>
            <h2 className="text-2xl font-bold">{t("أكّد بريدك الإلكتروني", "Confirm your email")}</h2>
            <p className="text-muted-foreground leading-7">{t("أرسلنا رابط تأكيد إلى", "We sent a confirmation link to")}</p>
            <p dir="ltr" className="font-semibold break-all w-full">{confirmationEmail}</p>
            <p className="text-muted-foreground leading-7">{t("افتح الرابط لإكمال التسجيل. راجع البريد الوارد ومجلد الرسائل غير المرغوب فيها.", "Open the link to complete registration. Check your inbox and spam folder.")}</p>
            <Button className="w-full h-14 text-base rounded-xl" onClick={() => { setIdentifier(confirmationEmail); setConfirmationEmail(""); setMode("login"); }}>{t("العودة لتسجيل الدخول", "Back to sign in")}</Button>
            <Button variant="ghost" onClick={() => setConfirmationEmail("")}>{t("تعديل البريد الإلكتروني", "Edit email")}</Button>
          </section>
        ) : (
        <form noValidate onSubmit={onSubmit} className="space-y-5 flex flex-col">
          {mode === "signup" ? (
            <>
              <Field label={t("الاسم الكامل", "Full name")} icon={<User className="h-5 w-5" />}>
                <input
                  required
                  autoComplete="name"
                  maxLength={100}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("مثال: أحمد محمد", "e.g. Ahmed Mohammed")}
                  className="input-base"
                />
              </Field>
              <Field label={t("رقم الهاتف", "Phone number")} icon={<Phone className="h-5 w-5" />}>
                <input
                  required
                  type="tel"
                  autoComplete="tel"
                  maxLength={30}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  dir="ltr"
                  placeholder="07XXXXXXXXX"
                  inputMode="tel"
                  className="input-base text-left"
                />
              </Field>
              <Field
                label={t(
                  "البريد الإلكتروني (مطلوب)",
                  "Email (required)",
                )}
                icon={<Mail className="h-5 w-5" />}
              >
                <input
                  required
                  type="email"
                  autoComplete="email"
                  maxLength={255}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  dir="ltr"
                  placeholder="you@example.com"
                  inputMode="email"
                  className="input-base text-left"
                />
              </Field>
            </>
          ) : (
            <Field
              label={t("رقم الهاتف أو البريد", "Phone number or email")}
              icon={<Phone className="h-5 w-5" />}
            >
              <input
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                dir="ltr"
                placeholder="07XXXXXXXXX أو البريد"
                className="input-base text-left"
              />
            </Field>
          )}

          <Field label={t("كلمة المرور", "Password")} icon={<Lock className="h-5 w-5" />}>
            <input
              required
              minLength={6}
              maxLength={128}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••"
              className="input-base"
            />
          </Field>

          {mode === "login" && (
            <Link
              to="/forgot-password"
              className="text-xs text-primary self-end hover:underline btn-press"
            >
              {t("نسيت كلمة المرور؟", "Forgot password?")}
            </Link>
          )}

          <div className="pt-2">
            <Button
              type="submit"
              disabled={busy}
              className="w-full h-14 rounded-xl font-bold text-base shadow-elegant"
            >
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <>
                <span>{mode === "signup" ? t("إنشاء الحساب", "Create account") : t("تسجيل الدخول", "Sign in")}</span>
                <Forward className="h-5 w-5" />
              </>}
            </Button>
          </div>
        </form>
        )}
      </div>
    </label>
  );
}

function Field({
  label,
  icon,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-bold text-foreground mb-2.5">{label}</span>
      <div className="relative">
        <div className="absolute end-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
          {icon}
        </div>
        <div className="[&>input]:w-full [&>input]:h-16 [&>input]:ps-12 [&>input]:pe-4 [&>input]:rounded-xl [&>input]:border [&>input]:border-border [&>input]:bg-input [&>input]:text-foreground [&>input]:text-base [&>input]:outline-none [&>input]:transition [&>input:focus]:border-primary [&>input:focus]:ring-4 [&>input:focus]:ring-primary/10">{children}</div>
      </div>
    </label>
  );
}
