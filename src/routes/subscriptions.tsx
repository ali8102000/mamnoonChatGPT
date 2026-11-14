import { createFileRoute, Navigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { MobileShell } from "@/components/mobile-shell";
import { ArrowRight, BadgeCheck, Crown, CreditCard, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { toast } from "@/lib/toast";

type Plan = {
  id: string; code: string; name_ar: string; description_ar: string | null;
  monthly_price: number; currency: string; badge_label: string | null;
  badge_color: string | null;
  features?: Record<string, any> | null;
  governorate_limit?: number | null;
};
export const Route = createFileRoute("/subscriptions")({
  ssr: false,
  head: () => ({ meta: [{ title: "اشتراكات ممنون" }, { name: "description", content: "باقات مقدمي الخدمة في ممنون" }] }),
  component: ProviderSubscriptionsPage,
});
function ProviderSubscriptionsPage() {
  const { session, roles, loading } = useAuth();
  const isProvider = roles.some((r) => ["worker", "driver", "large_driver"].includes(r));
  const userId = session?.user.id;
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscription, setSubscription] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [paymentGatewayEnabled, setPaymentGatewayEnabled] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    if (!userId || !isProvider) { setLoadingData(false); return; }
    let active = true;
    (async () => {
      const [{ data: planRows, error: plansError }, { data: sub, error: subError }, { data: settings }] = await Promise.all([
        supabase.from("subscription_plans").select("id,code,name_ar,description_ar,monthly_price,currency,badge_label,badge_color,features,governorate_limit")
          .in("code", ["bronze", "silver", "gold"]).eq("is_active", true).order("tier"),
        supabase.from("user_subscriptions").select("status,is_trial,trial_started_at,trial_ends_at,current_period_end,auto_renew,cancel_at_period_end,plan:subscription_plans(code,name_ar,tier,badge_label)")
          .eq("user_id", userId).maybeSingle(),
        supabase.from("subscription_settings").select("*").eq("id", 1).maybeSingle(),
      ]);
      if (!active) return;
      if (plansError) toast.error("تعذر تحميل باقات الاشتراك");
      if (subError) toast.error("تعذر تحميل حالة اشتراكك");
      setPlans((planRows ?? []) as Plan[]);
      setSubscription(sub);
      setPaymentGatewayEnabled(Boolean((settings as any)?.payment_gateway_enabled));
      setLoadingData(false);
    })();
    return () => { active = false; };
  }, [userId, isProvider]);

  async function pay(planCode: string) {
    if (!session || busy || !paymentGatewayEnabled) return;
    setBusy(planCode);
    try {
      const { data, error } = await supabase.functions.invoke("qicard-create-payment", {
        body: { planCode, billingCycle: "monthly", appChannel: false },
      });
      if (error || !data?.checkoutUrl) throw new Error(data?.error || error?.message || "تعذر إنشاء عملية الدفع");
      window.location.assign(data.checkoutUrl);
    } catch (error: any) {
      toast.error(error?.message || "تعذر بدء الدفع");
      setBusy(null);
    }
  }

  if (loading) return null;
  if (!session) return <Navigate to="/auth" />;
  if (!isProvider) return <Navigate to="/profile" />;
  const planCode = subscription?.plan?.code;
  return (
    <MobileShell>
      <div className="max-w-xl mx-auto px-5 pt-8 pb-24" dir="rtl">
        <div className="flex items-center gap-3 mb-5">
          <Link to="/profile" className="glass rounded-xl p-2"><ArrowRight className="h-5 w-5" /></Link>
          <div><h1 className="text-xl font-black">اشتراكات ممنون</h1><p className="text-xs text-muted-foreground">باقات مقدمي الخدمة</p></div>
        </div>
        {loadingData ? <Loader2 className="h-7 w-7 animate-spin mx-auto mt-16" /> : <>
          {subscription && <div className="glass rounded-2xl p-4 mb-4">
            <div className="flex items-center gap-2 font-black"><ShieldCheck className="h-5 w-5 text-primary" /> اشتراكك الحالي</div>
            <div className="mt-2 text-sm">{subscription.plan?.name_ar ?? "بدون باقة"} · {subscription.is_trial ? "تجربة مجانية" : subscription.status === "active" ? "نشط" : "منتهي"}</div>
            {subscription.trial_ends_at && <div className="text-xs text-muted-foreground mt-1">نهاية التجربة: {new Date(subscription.trial_ends_at).toLocaleDateString("ar-IQ")}</div>}
            {subscription.current_period_end && !subscription.is_trial && <div className="text-xs text-muted-foreground mt-1">ينتهي: {new Date(subscription.current_period_end).toLocaleDateString("ar-IQ")}</div>}
            {subscription.cancel_at_period_end && <div className="text-xs text-amber-600 mt-1">تم إيقاف التجديد، وتبقى المزايا حتى نهاية الفترة</div>}
          </div>}
          <div className="space-y-3">
            {plans.map((plan) => {
              const active = subscription?.status === "active" && planCode === plan.code;
              const Icon = plan.code === "gold" ? Crown : plan.code === "silver" ? BadgeCheck : Sparkles;
              return <div key={plan.id} className="glass rounded-3xl p-5 border border-border/70">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2"><Icon className="h-6 w-6" style={{ color: plan.badge_color || "currentColor" }} /><div className="font-black text-lg">{plan.name_ar}</div></div>
                  {active && <span className="text-[10px] rounded-full bg-emerald-100 text-emerald-700 px-3 py-1 font-bold">باقتك الحالية</span>}
                </div>
                <p className="text-xs text-muted-foreground mt-2">{plan.description_ar}</p>
                {plan.governorate_limit ? <p className="text-[11px] text-muted-foreground mt-2">نطاق العمل: {plan.governorate_limit === 1 ? "محافظة واحدة كاملة" : "محافظتان كاملتان"}</p> : null}
                {plan.features?.profile_promotion_monthly ? <p className="text-[11px] text-muted-foreground mt-1">ترويج الملف: {plan.features.profile_promotion_monthly} مرات شهرياً</p> : null}
                <div className="text-2xl font-black mt-4">{Number(plan.monthly_price).toLocaleString("ar-IQ")} <span className="text-xs font-bold text-muted-foreground">د.ع / شهرياً</span></div>
                <button type="button" onClick={() => setSelectedPlan(plan.code)} disabled={active}
                  className="w-full mt-4 rounded-xl bg-primary text-primary-foreground py-3 font-black text-sm disabled:opacity-50 flex items-center justify-center gap-2">
                  {busy === plan.code ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                  {active ? "مشترك بهذه الباقة" : selectedPlan === plan.code ? "تم اختيار الباقة" : "اختيار هذه الباقة"}
                </button>
              </div>;
            })}
          </div>
          {selectedPlan && <div className="glass rounded-2xl p-4 mt-4"><p className="text-sm font-black">تم اختيار باقة {plans.find(p => p.code === selectedPlan)?.name_ar}</p><p className="text-xs text-muted-foreground mt-2">الدفع الإلكتروني غير متاح حالياً إلى حين إكمال ربط واختبار QiCard. اختيارك لا يخصم أي مبلغ ولا يغير اشتراكك.</p><button disabled className="w-full mt-3 rounded-xl bg-primary text-primary-foreground py-3 text-xs font-black opacity-60"><CreditCard className="inline h-4 w-4 ml-2" /> الدفع قيد الربط</button></div>}
          {subscription?.status === "active" && subscription?.current_period_end && !subscription?.cancel_at_period_end && (
            <button type="button" onClick={async () => {
              try {
                const { data, error } = await supabase.rpc("cancel_own_subscription_at_period_end");
                if (error) throw error;
                if (!data) throw new Error("ماكو اشتراك فعال قابل لإيقاف تجديده");
                setSubscription((current: any) => current ? { ...current, cancel_at_period_end: true, auto_renew: false } : current);
                toast.success("تم إيقاف التجديد، وتبقى المزايا حتى نهاية الفترة");
              } catch (error: any) { toast.error(error.message || "تعذر إيقاف التجديد"); }
            }} className="w-full mt-3 rounded-xl border border-destructive/40 text-destructive py-3 text-xs font-bold">
              إيقاف التجديد عند نهاية الفترة
            </button>
          )}
          <p className="text-[11px] text-muted-foreground text-center mt-5 leading-6">عند تفعيل حساب التاجر وربط مفاتيح QiCard سيُتاح الدفع الآمن. لا يخزن ممنون رقم البطاقة أو رمز الأمان، ولا يُفعّل الاشتراك إلا بعد تأكيد البوابة من الخادم.</p>
        </>}
      </div>
    </MobileShell>
  );
}