import { useEffect, useState } from "react";
import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { MobileShell } from "@/components/mobile-shell";
import { Building2, MapPin, Phone, ArrowRight, Store } from "lucide-react";

export const Route = createFileRoute("/partner/dashboard")({ ssr: false, component: PartnerDashboardPage });

function PartnerDashboardPage() {
  const { session, loading } = useAuth();
  const [applications, setApplications] = useState<any[]>([]);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    if (!session?.user.id) return;
    let active = true;
    (supabase as any).from("partner_applications")
      .select("id,partner_type,business_name,contact_name,phone,governorate_key,city,address,description,status,created_at")
      .eq("user_id", session.user.id).eq("status", "approved")
      .order("created_at", { ascending: false })
      .then(({ data, error }: any) => {
        if (!active) return;
        if (error) console.error("[partner-dashboard]", error.message);
        setApplications(data ?? []);
        setBusy(false);
      });
    return () => { active = false; };
  }, [session?.user.id]);

  if (loading) return null;
  if (!session) return <Navigate to="/auth" />;
  return <MobileShell>
    <main dir="rtl" className="max-w-lg mx-auto px-4 pt-6 pb-12">
      <Link to="/account-settings" className="inline-flex items-center gap-2 text-sm text-primary font-bold mb-5"><ArrowRight className="h-4 w-4"/> الإعدادات</Link>
      <div className="rounded-3xl bg-gradient-to-br from-primary to-primary-glow text-primary-foreground p-6 shadow-lg">
        <div className="flex items-center gap-3"><Building2 className="h-8 w-8"/><div><h1 className="text-2xl font-black">لوحة الشريك</h1><p className="text-xs opacity-80 mt-1">إدارة بيانات منشآتك المعتمدة في ممنون</p></div></div>
      </div>
      <section className="mt-5 space-y-3">
        <h2 className="font-black text-sm">منشآتي المعتمدة</h2>
        {busy ? <div className="rounded-2xl border p-5 text-center text-sm text-muted-foreground">جارٍ تحميل بيانات الشراكة...</div> : applications.length===0 ? <div className="rounded-2xl border p-5 text-center text-sm text-muted-foreground">ما عندك منشأة معتمدة حالياً. تگدر تقدم طلب من الإعدادات.</div> : applications.map((item:any)=><article key={item.id} className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-3"><span className="h-11 w-11 rounded-xl bg-primary/10 text-primary grid place-items-center"><Store className="h-5 w-5"/></span><div><h3 className="font-black">{item.business_name}</h3><p className="text-[10px] text-emerald-700 font-bold">شريك معتمد</p></div></div>
          <div className="text-xs text-muted-foreground flex items-center gap-2"><MapPin className="h-4 w-4"/>{item.city} · {item.governorate_key} · {item.address}</div>
          <div className="text-xs text-muted-foreground flex items-center gap-2"><Phone className="h-4 w-4"/><span dir="ltr">{item.phone}</span></div>
          {item.description&&<p className="text-xs leading-6">{item.description}</p>}
          <div className="rounded-xl bg-muted/60 p-3 text-xs leading-6 text-muted-foreground">حساب الشراكة معتمد. أدوات إدارة الحجوزات والمنتجات والعروض ستظهر هنا عند تفعيل وحدات نشاط الشريك.</div>
        </article>)}
      </section>
    </main>
  </MobileShell>;
}
