import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { isValidPhone, normalizePhone } from "@/lib/phone";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/account-settings")({ ssr: false, component: AccountSettingsPage });

function AccountSettingsPage() {
  const { session, profile, refresh, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState(session?.user.email ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [otp, setOtp] = useState("");
  const [phonePending, setPhonePending] = useState(false);
  const [busy, setBusy] = useState(false);

  if (loading) return null;
  if (!session) return <Navigate to="/auth" />;

  async function changeEmail() {
    const next = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) { toast.error("أدخل بريداً إلكترونياً صحيحاً"); return; }
    if (next === session.user.email?.toLowerCase()) { toast.error("هذا هو بريدك الحالي"); return; }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ email: next }, { emailRedirectTo: `${window.location.origin}/auth/callback` });
      if (error) throw error;
      toast.success("أرسلنا رابط تأكيد إلى البريد الجديد. لن يتغير بريد الحساب قبل الضغط على الرابط.");
    } catch (e) { toast.error(e instanceof Error ? e.message : "تعذر تغيير البريد"); }
    finally { setBusy(false); }
  }

  async function requestPhoneChange() {
    if (!isValidPhone(phone)) { toast.error("رقم الهاتف غير صحيح"); return; }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ phone: normalizePhone(phone) });
      if (error) throw error;
      setPhonePending(true);
      toast.success("أرسلنا رمز SMS إلى الرقم الجديد");
    } catch (e) { toast.error(e instanceof Error ? e.message : "تعذر إرسال رمز SMS. تحقق من إعدادات SMS في Supabase."); }
    finally { setBusy(false); }
  }

  async function verifyPhone() {
    if (!otp.trim()) { toast.error("أدخل رمز التحقق"); return; }
    setBusy(true);
    try {
      const { error } = await supabase.auth.verifyOtp({ phone: normalizePhone(phone), token: otp.trim(), type: "phone_change" });
      if (error) throw error;
      await refresh();
      setPhonePending(false); setOtp("");
      toast.success("تم تأكيد رقم الهاتف وتحديثه");
    } catch (e) { toast.error(e instanceof Error ? e.message : "رمز التحقق غير صحيح"); }
    finally { setBusy(false); }
  }

  return <main dir="rtl" className="min-h-screen max-w-lg mx-auto px-5 py-10">
    <button onClick={() => navigate({ to: "/profile" })} className="text-primary font-bold mb-6">رجوع إلى الملف الشخصي</button>
    <h1 className="text-2xl font-black mb-2">إعدادات الحساب</h1>
    <p className="text-sm text-muted-foreground mb-7">تغيير البريد أو رقم الهاتف مع التحقق قبل اعتماد التغيير.</p>
    <section className="glass rounded-2xl p-5 space-y-3">
      <h2 className="font-black">تغيير البريد الإلكتروني</h2>
      <p className="text-xs text-muted-foreground" dir="ltr">{session.user.email}</p>
      <label className="block text-sm font-bold">البريد الجديد</label>
      <input dir="ltr" type="email" value={email} onChange={e => setEmail(e.target.value)} className="input-base w-full" placeholder="name@example.com" />
      <Button className="w-full" disabled={busy} onClick={changeEmail}>إرسال رابط تأكيد البريد الجديد</Button>
    </section>
    <section className="glass rounded-2xl p-5 space-y-3 mt-5">
      <h2 className="font-black">تغيير رقم الهاتف</h2>
      <p className="text-xs text-muted-foreground" dir="ltr">{profile?.phone || session.user.phone || "غير مسجل"}</p>
      <label className="block text-sm font-bold">رقم الهاتف الجديد</label>
      <input dir="ltr" type="tel" value={phone} onChange={e => setPhone(e.target.value)} className="input-base w-full text-left" placeholder="07XXXXXXXXX" />
      {!phonePending ? <Button className="w-full" disabled={busy} onClick={requestPhoneChange}>إرسال رمز SMS للتحقق</Button> : <>
        <label className="block text-sm font-bold">رمز SMS</label>
        <input dir="ltr" inputMode="numeric" value={otp} onChange={e => setOtp(e.target.value)} className="input-base w-full text-left" placeholder="رمز التحقق" />
        <Button className="w-full" disabled={busy} onClick={verifyPhone}>تأكيد الرقم الجديد</Button>
      </>}
      <p className="text-xs text-muted-foreground">يتطلب تغيير الرقم تفعيل Phone Auth ومزود SMS في Supabase.</p>
    </section>
  </main>;
}
