import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { isValidPhone, normalizePhone } from "@/lib/phone";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { ArrowRight, UserRound, CarFront, Wrench, Mail, Phone, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/account-settings")({ ssr: false, component: AccountSettingsPage });

function AccountSettingsPage() {
  const { session, profile, refresh, loading, roles, activeRole, setActiveRole } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState(session?.user.email ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [otp, setOtp] = useState("");
  const [phonePending, setPhonePending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [displayName, setDisplayName] = useState(profile?.full_name ?? "");
  const isStaffAdmin = roles.some((role) => ["admin", "super_admin"].includes(role));

  if (loading) return null;
  if (!session) return <Navigate to="/auth" />;
  const currentUser = session.user;

  async function changeDisplayName() {
    const next = displayName.trim().replace(/\\s+/g, " ");
    if (next.length < 2 || next.length > 60) { toast.error("الاسم لازم يكون بين حرفين و60 حرفاً"); return; }
    if (!session?.user.id) return;
    setBusy(true);
    try {
      const { error } = await (supabase as any).from("profiles").update({ full_name: next }).eq("id", session.user.id);
      if (error) throw error;
      await refresh();
      toast.success("تم تحديث اسم المسؤول الظاهر للناس");
    } catch (e) { toast.error(e instanceof Error ? e.message : "تعذر تحديث الاسم"); }
    finally { setBusy(false); }
  }

  async function changeEmail() {
    const next = email.trim().toLowerCase();
    if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(next)) { toast.error("أدخل بريداً إلكترونياً صحيحاً"); return; }
    if (next === currentUser.email?.toLowerCase()) { toast.error("هذا هو بريدك الحالي"); return; }
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

  const roleItems = [
    { role: "customer", title: "زبون", subtitle: "طلب الخدمات والتكسي", icon: UserRound, style: "bg-sky-500/10 border-sky-500/20 text-sky-700 dark:text-sky-300" },
    { role: "driver", title: "سائق تكسي", subtitle: "استقبال طلبات التوصيل", icon: CarFront, style: "bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-300" },
    { role: "worker", title: "فني", subtitle: "تقديم الخدمات للعملاء", icon: Wrench, style: "bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-300" },
  ];

  return <main dir="rtl" className="min-h-screen max-w-lg mx-auto px-4 pt-5 pb-10">
    <header className="flex items-center gap-3 mb-6">
      <button onClick={() => navigate({ to: "/profile" })} aria-label="رجوع" className="h-10 w-10 rounded-2xl bg-muted/70 grid place-items-center">
        <ArrowRight className="h-5 w-5" />
      </button>
      <div>
        <h1 className="text-xl font-black">الإعدادات</h1>
        <p className="text-xs text-muted-foreground mt-0.5">كل أمور حسابك بمكان واحد</p>
      </div>
    </header>

    <section className="mb-6">
      <div className="flex items-center justify-between mb-3 px-1">
        <h2 className="font-black text-sm">طريقة استخدام ممنون</h2>
        <span className="text-[10px] text-muted-foreground">الدور الحالي محدد بإطار</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {roleItems.filter(item => roles.includes(item.role as any)).map(item => {
          const Icon = item.icon;
          const selected = activeRole === item.role;
          return <button key={item.role} type="button" onClick={() => {
            setActiveRole(item.role as any);
            toast.success(`تم اختيار دور ${item.title}`);
          }} className={`relative min-h-[112px] rounded-3xl border p-4 text-right transition active:scale-[0.98] ${item.style} ${selected ? "ring-2 ring-primary shadow-md" : "opacity-90"}`}>
            {selected && <span className="absolute left-3 top-3 rounded-full bg-primary text-primary-foreground px-2 py-0.5 text-[9px] font-bold">الحالي</span>}
            <span className="h-10 w-10 rounded-2xl bg-white/60 dark:bg-black/10 grid place-items-center mb-3"><Icon className="h-5 w-5" /></span>
            <span className="block text-sm font-black">{item.title}</span>
            <span className="block text-[10px] opacity-75 mt-1">{item.subtitle}</span>
          </button>;
        })}
      </div>
    </section>

    {isStaffAdmin && <section className="mb-6">
      <h2 className="font-black text-sm mb-3 px-1">اسم المسؤول الظاهر للجميع</h2>
      <div className="rounded-3xl border border-primary/20 bg-card p-4">
        <p className="text-xs text-muted-foreground mb-3">هذا الاسم يظهر في حسابك وملفك العام وعند تفاعلك مع المستخدمين.</p>
        <input value={displayName} onChange={e => setDisplayName(e.target.value)} maxLength={60} className="input-base w-full rounded-2xl" placeholder="اكتب الاسم الذي سيظهر للجميع" />
        <Button className="w-full mt-3 rounded-2xl" disabled={busy} onClick={changeDisplayName}>حفظ الاسم الجديد</Button>
      </div>
    </section>}

    <section className="mb-6">
      <h2 className="font-black text-sm mb-3 px-1">معلومات التواصل</h2>
      <div className="rounded-3xl border border-border/60 bg-card overflow-hidden">
        <div className="p-4">
          <div className="flex items-center gap-2 mb-2"><span className="h-8 w-8 rounded-xl bg-violet-500/10 text-violet-600 grid place-items-center"><Mail className="h-4 w-4" /></span><div className="font-bold text-sm">البريد الإلكتروني</div></div>
          <p className="text-[11px] text-muted-foreground mb-3" dir="ltr">{session.user.email}</p>
          <input dir="ltr" type="email" value={email} onChange={e => setEmail(e.target.value)} className="input-base w-full rounded-2xl" placeholder="البريد الجديد" />
          <Button className="w-full mt-3 rounded-2xl" disabled={busy} onClick={changeEmail}>إرسال رابط التأكيد</Button>
        </div>
        <div className="h-px bg-border/70 mx-4" />
        <div className="p-4">
          <div className="flex items-center gap-2 mb-2"><span className="h-8 w-8 rounded-xl bg-emerald-500/10 text-emerald-600 grid place-items-center"><Phone className="h-4 w-4" /></span><div className="font-bold text-sm">رقم الهاتف</div></div>
          <p className="text-[11px] text-muted-foreground mb-3" dir="ltr">{profile?.phone || session.user.phone || "غير مسجل"}</p>
          <input dir="ltr" type="tel" value={phone} onChange={e => setPhone(e.target.value)} className="input-base w-full rounded-2xl text-left" placeholder="07XXXXXXXXX" />
          {!phonePending ? <Button className="w-full mt-3 rounded-2xl" disabled={busy} onClick={requestPhoneChange}>إرسال رمز التحقق</Button> : <>
            <label className="block text-xs font-bold mt-3 mb-2">رمز SMS</label>
            <input dir="ltr" inputMode="numeric" value={otp} onChange={e => setOtp(e.target.value)} className="input-base w-full rounded-2xl text-left" placeholder="أدخل الرمز" />
            <Button className="w-full mt-3 rounded-2xl" disabled={busy} onClick={verifyPhone}>تأكيد الرقم الجديد</Button>
          </>}
          <p className="text-[10px] text-muted-foreground mt-3">يتطلب تغيير الرقم تفعيل خدمة SMS في النظام.</p>
        </div>
      </div>
    </section>

    <div className="rounded-2xl bg-primary/5 border border-primary/10 p-3 flex items-center gap-2 text-xs text-muted-foreground">
      <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
      <span>بيانات حسابك محمية، ولا يتغير البريد أو الهاتف إلا بعد إكمال التحقق.</span>
    </div>
  </main>;
}
