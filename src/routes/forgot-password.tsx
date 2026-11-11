import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowRight, Loader2, Mail, ShieldCheck } from "lucide-react";
import { toast } from "@/lib/toast";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/forgot-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "استعادة كلمة المرور | ممنون" },
      { name: "description", content: "استعد حسابك في ممنون باستخدام رمز تحقق عبر البريد الإلكتروني." },
      { property: "og:title", content: "استعادة كلمة المرور | ممنون" },
      { property: "og:description", content: "استعد حسابك في ممنون باستخدام رمز تحقق عبر البريد الإلكتروني." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const navigate = useNavigate();

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    const value = email.trim().toLowerCase();
    if (!value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      toast.error("أدخل بريداً إلكترونياً صحيحاً");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(value);
      if (error) {
        console.error("[forgot-password] Supabase recovery request failed:", error.message);
        const message = error.message.toLowerCase().includes("email address not authorized")
          ? "خدمة البريد الحالية تسمح بالإرسال فقط إلى عناوين فريق المشروع. يلزم إعداد SMTP مخصص في Supabase."
          : error.message.toLowerCase().includes("rate limit")
            ? "طلبت رمزاً عدة مرات. انتظر دقيقة ثم حاول مجدداً."
            : `تعذّر إرسال الرمز: ${error.message}`;
        throw new Error(message);
      }
      setSent(true);
      toast.success("إذا كان البريد مرتبطاً بحساب، فسيصلك رمز التحقق. افحص الوارد والرسائل المهملة.");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "تعذّر إرسال رمز التحقق");
    } finally {
      setBusy(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(token.trim())) {
      toast.error("أدخل رمز التحقق المكوّن من 6 أرقام");
      return;
    }
    if (password.length < 6) {
      toast.error("كلمة المرور يجب أن تكون 6 أحرف على الأقل");
      return;
    }
    if (password !== confirm) {
      toast.error("كلمتا المرور غير متطابقتين");
      return;
    }
    setBusy(true);
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: token.trim(),
        type: "recovery",
      });
      if (verifyError) throw verifyError;
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      toast.success("تم تغيير كلمة المرور بنجاح");
      navigate({ to: "/" });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "الرمز غير صحيح أو منتهي الصلاحية");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen px-5 pt-14 pb-8 flex flex-col">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center h-16 w-16 rounded-3xl bg-gradient-to-br from-primary to-primary-glow glow-primary mb-4 shadow-elegant">
          <ShieldCheck className="h-8 w-8 text-primary-foreground" />
        </div>
        <h1 className="text-2xl font-black">استعادة كلمة المرور</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {sent ? "أدخل رمز التحقق الذي وصلك بالبريد ثم عيّن كلمة مرور جديدة" : "أدخل بريدك الإلكتروني لنرسل لك رمز تحقق من 6 أرقام"}
        </p>
      </div>

      <div className="glass rounded-3xl p-6 shadow-card flex-1 flex flex-col">
        {!sent ? (
          <form onSubmit={requestCode} className="space-y-4 flex-1 flex flex-col">
            <label className="block">
              <div className="text-xs font-bold text-muted-foreground mb-2">البريد الإلكتروني</div>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                dir="ltr"
                autoComplete="email"
                className="w-full bg-input border border-border text-foreground px-4 py-3.5 rounded-2xl text-sm font-semibold outline-none focus:border-ring focus:ring-4 focus:ring-ring text-left"
              />
            </label>
            <div className="flex-1" />
            <button type="submit" disabled={busy} className="w-full py-4 rounded-2xl bg-gradient-to-r from-primary to-primary-glow text-primary-foreground font-bold btn-press glow-primary shadow-elegant disabled:opacity-60 flex items-center justify-center gap-2">
              {busy && <Loader2 className="h-5 w-5 animate-spin" />}
              إرسال رمز التحقق
              <ArrowRight className="h-5 w-5" />
            </button>
          </form>
        ) : (
          <form onSubmit={changePassword} className="space-y-4 flex-1 flex flex-col">
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Mail className="h-4 w-4" /><span dir="ltr">{email}</span></div>
            <label className="block">
              <div className="text-xs font-bold text-muted-foreground mb-2">رمز التحقق (6 أرقام)</div>
              <input value={token} onChange={(e) => setToken(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" dir="ltr" className="w-full bg-input border border-border text-foreground px-4 py-3.5 rounded-2xl text-lg font-bold tracking-[0.4em] outline-none focus:border-ring focus:ring-4 focus:ring-ring text-center" />
            </label>
            <label className="block">
              <div className="text-xs font-bold text-muted-foreground mb-2">كلمة المرور الجديدة</div>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder="6 أحرف على الأقل" className="w-full bg-input border border-border text-foreground px-4 py-3.5 rounded-2xl text-sm font-semibold outline-none focus:border-ring focus:ring-4 focus:ring-ring" />
            </label>
            <label className="block">
              <div className="text-xs font-bold text-muted-foreground mb-2">تأكيد كلمة المرور</div>
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" placeholder="أعد كتابة كلمة المرور" className="w-full bg-input border border-border text-foreground px-4 py-3.5 rounded-2xl text-sm font-semibold outline-none focus:border-ring focus:ring-4 focus:ring-ring" />
            </label>
            <button type="submit" disabled={busy} className="w-full py-4 rounded-2xl bg-gradient-to-r from-primary to-primary-glow text-primary-foreground font-bold btn-press glow-primary shadow-elegant disabled:opacity-60 flex items-center justify-center gap-2">
              {busy && <Loader2 className="h-5 w-5 animate-spin" />}
              تأكيد الرمز وتغيير كلمة المرور
            </button>
            <button type="button" disabled={busy} onClick={() => { setSent(false); setToken(""); }} className="text-center text-sm text-muted-foreground">استخدام بريد آخر</button>
          </form>
        )}
        <Link to="/auth" className="mt-5 text-center text-sm text-muted-foreground hover:text-foreground">العودة لتسجيل الدخول</Link>
      </div>
    </div>
  );
}
