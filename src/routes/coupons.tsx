import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { ArrowRight, Copy, Gift, Loader2 } from "lucide-react";
import { toast } from "@/lib/toast";

export const Route = createFileRoute("/coupons")({
  ssr: false,
  head: () => ({ meta: [{ title: "كوبوناتي | ممنون" }] }),
  component: MyCouponsPage,
});

type Coupon = {
  id: string;
  code: string;
  type: "percentage" | "fixed";
  value: number;
  min_amount: number;
  expires_at: string | null;
  active: boolean;
  assigned_at: string;
  used: boolean;
};

function MyCouponsPage() {
  const { session, loading } = useAuth();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!session) return;
    let alive = true;
    (async () => {
      setBusy(true);
      const { data, error: queryError } = await supabase.rpc("get_my_coupons");
      if (!alive) return;
      if (queryError) setError("تعذّر تحميل كوبوناتك حالياً");
      else setCoupons((data ?? []) as Coupon[]);
      setBusy(false);
    })();
    return () => { alive = false; };
  }, [session]);

  if (loading) return <div className="min-h-screen grid place-items-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!session) return <Navigate to="/auth" />;

  const now = Date.now();
  const available = coupons.filter(c => c.active && !c.used && (!c.expires_at || new Date(c.expires_at).getTime() > now));
  const unavailable = coupons.filter(c => !available.includes(c));

  return (
    <div className="min-h-screen bg-background px-4 py-5" dir="rtl">
      <div className="max-w-xl mx-auto">
        <div className="flex items-center gap-3 mb-5">
          <Link to="/home" className="h-10 w-10 rounded-xl glass grid place-items-center"><ArrowRight className="h-5 w-5" /></Link>
          <div><h1 className="text-xl font-black">كوبوناتي</h1><p className="text-xs text-muted-foreground">العروض والكوبونات المرسلة إلك من ممنون</p></div>
        </div>
        {busy ? <div className="py-16 grid place-items-center"><Loader2 className="h-7 w-7 animate-spin" /></div>
          : error ? <div className="glass rounded-2xl p-5 text-sm text-center">{error}</div>
          : coupons.length === 0 ? (
            <div className="glass rounded-3xl p-8 text-center">
              <Gift className="h-10 w-10 mx-auto mb-3 text-primary" />
              <div className="font-black">ما عندك كوبونات حالياً</div>
              <p className="text-xs text-muted-foreground mt-1">من توصلّك عروض جديدة راح تظهر هنا</p>
            </div>
          ) : (
            <div className="space-y-3">
              {available.map(c => (
                <div key={c.id} className="glass rounded-2xl p-4 border border-emerald-500/20">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-emerald-600">كوبون متاح</span>
                    <span className="font-mono text-lg font-black">{c.code}</span>
                  </div>
                  <div className="text-xl font-black mt-2">{c.type === "percentage" ? `خصم ${c.value}%` : `خصم ${Number(c.value).toLocaleString("ar-IQ")} د.ع`}</div>
                  <div className="text-xs text-muted-foreground mt-1">الحد الأدنى للطلب: {Number(c.min_amount).toLocaleString("ar-IQ")} د.ع</div>
                  {c.expires_at && <div className="text-xs text-muted-foreground mt-1">ينتهي: {new Date(c.expires_at).toLocaleString("ar-IQ")}</div>}
                  <button onClick={() => { void navigator.clipboard?.writeText(c.code).then(() => toast.success("تم نسخ الكود")).catch(() => toast.error("تعذّر نسخ الكود")); }} className="mt-3 w-full rounded-xl bg-primary/10 text-primary font-bold text-sm py-2.5 flex items-center justify-center gap-2"><Copy className="h-4 w-4" /> نسخ الكوبون</button>
                </div>
              ))}
              {unavailable.map(c => (
                <div key={c.id} className="glass rounded-2xl p-4 opacity-60">
                  <div className="flex justify-between gap-2"><span className="font-mono font-black">{c.code}</span><span className="text-xs font-bold">{c.used ? "مستخدم" : "منتهي أو متوقف"}</span></div>
                </div>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}
