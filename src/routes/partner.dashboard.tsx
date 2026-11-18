import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { MobileShell } from "@/components/mobile-shell";
import { Building2, MapPin, Phone, ArrowRight, Save, Eye, EyeOff, RefreshCw } from "lucide-react";

type PartnerProfile = {
  id: string; application_id: string; partner_type: "hotel"|"restaurant"|"store"|"mall";
  business_name: string; phone: string; email: string|null; city: string; address: string;
  description: string|null; is_published: boolean;
};

const typeLabels: Record<string,string> = {hotel:"فندق",restaurant:"مطعم",store:"محل",mall:"مول"};

export const Route = createFileRoute("/partner/dashboard")({ ssr: false, component: PartnerDashboardPage });

function PartnerDashboardPage() {
  const { session, loading } = useAuth();
  const [profiles, setProfiles] = useState<PartnerProfile[]>([]);
  const [busy, setBusy] = useState(true);
  const [savingId, setSavingId] = useState<string|null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!session?.user.id) return;
    setBusy(true); setError("");
    const { data: approved, error: approvalError } = await (supabase as any).from("partner_applications")
      .select("id").eq("user_id", session.user.id).eq("status", "approved");
    if (approvalError) { setError(approvalError.message); setProfiles([]); setBusy(false); return; }
    const ids = (approved ?? []).map((row:any)=>row.id);
    if (!ids.length) { setProfiles([]); setBusy(false); return; }
    const { data, error } = await (supabase as any).from("partner_business_profiles")
      .select("id,application_id,partner_type,business_name,phone,email,city,address,description,is_published")
      .eq("user_id", session.user.id).in("application_id", ids).order("created_at", { ascending: false });
    if (error) setError(error.message);
    setProfiles(data ?? []);
    setBusy(false);
  }, [session?.user.id]);

  useEffect(() => { void load(); }, [load]);

  const change = (id:string, key:keyof PartnerProfile, value:any) =>
    setProfiles(current => current.map(item => item.id===id ? {...item,[key]:value} : item));

  const save = async (item:PartnerProfile) => {
    if (item.business_name.trim().length<2 || item.phone.trim().length<7 || item.city.trim().length<2 || item.address.trim().length<4) {
      setError("تأكد من اسم المنشأة والهاتف والمدينة والعنوان قبل الحفظ."); return;
    }
    setSavingId(item.id); setError("");
    const { error } = await (supabase as any).from("partner_business_profiles").update({
      business_name:item.business_name.trim(), phone:item.phone.trim(), email:item.email?.trim()||null,
      city:item.city.trim(), address:item.address.trim(), description:item.description?.trim()||null,
      is_published:item.is_published, updated_at:new Date().toISOString()
    }).eq("id",item.id).eq("user_id",session?.user.id);
    setSavingId(null);
    if(error){setError(error.message);return;}
    await load();
  };

  if (loading) return null;
  if (!session) return <Navigate to="/auth" />;
  return <MobileShell>
    <main dir="rtl" className="max-w-2xl mx-auto px-4 pt-6 pb-12 space-y-5">
      <Link to="/account-settings" className="inline-flex items-center gap-2 text-sm text-primary font-bold"><ArrowRight className="h-4 w-4"/> الإعدادات</Link>
      <div className="rounded-3xl bg-gradient-to-br from-primary to-primary-glow text-primary-foreground p-6 shadow-lg">
        <div className="flex items-center gap-3"><Building2 className="h-8 w-8"/><div><h1 className="text-2xl font-black">لوحة الشريك</h1><p className="text-xs opacity-80 mt-1">إدارة بيانات منشآتك وحالة نشرها في ممنون</p></div></div>
      </div>
      <div className="flex items-center justify-between"><h2 className="font-black">منشآتي المعتمدة</h2><button onClick={()=>void load()} className="inline-flex items-center gap-2 text-xs text-primary"><RefreshCw className="h-4 w-4"/> تحديث</button></div>
      {error&&<div className="rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-700">{error}</div>}
      {busy ? <div className="rounded-2xl border p-5 text-center text-sm text-muted-foreground">جارٍ تحميل بيانات الشراكة...</div> : profiles.length===0 ? <div className="rounded-2xl border p-5 text-center text-sm text-muted-foreground">ما عندك منشأة معتمدة حالياً. تگدر تتابع حالة طلبك من الإعدادات.</div> : profiles.map(item=><article key={item.id} className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-2"><div><h3 className="font-black">{item.business_name}</h3><p className="text-[10px] text-muted-foreground">{typeLabels[item.partner_type]}</p></div><span className={`rounded-full px-3 py-1 text-[10px] font-bold ${item.is_published?"bg-emerald-500/10 text-emerald-700":"bg-amber-500/10 text-amber-700"}`}>{item.is_published?"ظاهر للمستخدمين":"غير منشور"}</span></div>
        <label className="block text-xs font-bold">اسم المنشأة<input value={item.business_name} onChange={e=>change(item.id,"business_name",e.target.value)} maxLength={120} className="input-base mt-1 w-full rounded-xl"/></label>
        <label className="block text-xs font-bold">رقم التواصل<input dir="ltr" value={item.phone} onChange={e=>change(item.id,"phone",e.target.value)} maxLength={30} className="input-base mt-1 w-full rounded-xl text-left"/></label>
        <label className="block text-xs font-bold">البريد الإلكتروني<input dir="ltr" type="email" value={item.email??""} onChange={e=>change(item.id,"email",e.target.value)} className="input-base mt-1 w-full rounded-xl text-left"/></label>
        <label className="block text-xs font-bold">المدينة<input value={item.city} onChange={e=>change(item.id,"city",e.target.value)} maxLength={80} className="input-base mt-1 w-full rounded-xl"/></label>
        <label className="block text-xs font-bold">العنوان<input value={item.address} onChange={e=>change(item.id,"address",e.target.value)} maxLength={240} className="input-base mt-1 w-full rounded-xl"/></label>
        <label className="block text-xs font-bold">نبذة المنشأة<textarea value={item.description??""} onChange={e=>change(item.id,"description",e.target.value)} maxLength={1000} className="input-base mt-1 min-h-20 w-full rounded-xl"/></label>
        <button type="button" onClick={()=>change(item.id,"is_published",!item.is_published)} className="w-full flex items-center justify-center gap-2 rounded-xl border border-border p-3 text-xs font-bold">{item.is_published?<><EyeOff className="h-4 w-4"/> إيقاف حالة النشر</>:<><Eye className="h-4 w-4"/> تفعيل حالة النشر</>}</button>
        <button disabled={savingId===item.id} onClick={()=>void save(item)} className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground p-3 text-sm font-black disabled:opacity-50"><Save className="h-4 w-4"/>{savingId===item.id?"جارٍ الحفظ...":"حفظ التعديلات"}</button>
        <div className="text-[10px] text-muted-foreground flex items-center gap-2"><MapPin className="h-3.5 w-3.5"/>{item.city} · {item.address}<Phone className="h-3.5 w-3.5 mr-2"/><span dir="ltr">{item.phone}</span></div>
      </article>)}
      <div className="rounded-xl bg-muted/60 p-3 text-xs leading-6 text-muted-foreground">حالة النشر تُحفظ بملف الشريك. ربط الدليل العام للزبائن وإدارة الحجوزات والغرف وقائمة الطعام والمنتجات يحتاج وحدات عرض وتشغيل مستقلة.</div>
    </main>
  </MobileShell>;
}
