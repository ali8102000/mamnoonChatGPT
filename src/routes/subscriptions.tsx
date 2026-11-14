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
  const [providerRadius, setProviderRadius] = useState(25);
  const [radiusSaving, setRadiusSaving] = useState(false);
  const [demandAreas, setDemandAreas] = useState<any[]>([]);
  const [demandLoading, setDemandLoading] = useState(false);
  const [demandLoaded, setDemandLoaded] = useState(false);

  useEffect(() => {
    if (!userId || !isProvider) { setLoadingData(false); return; }
    let active = true;
    (async () => {
      const [{ data: planRows, error: plansError }, { data: sub, error: subError }, { data: settings }, { data: workerProfile }, { data: driverProfile }] = await Promise.all([
        supabase.from("subscription_plans").select("id,code,name_ar,description_ar,monthly_price,currency,badge_label,badge_color,features,governorate_limit")
          .in("code", ["bronze", "silver", "gold"]).eq("is_active", true).order("tier"),
        supabase.from("user_subscriptions").select("status,is_trial,trial_started_at,trial_ends_at,current_period_end,auto_renew,cancel_at_period_end,grant_type,granted_by,plan:subscription_plans(code,name_ar,tier,badge_label)")
          .eq("user_id", userId).maybeSingle(),
        supabase.from("subscription_settings").select("*").eq("id", 1).maybeSingle(),
        (supabase as any).from("worker_profiles").select("service_radius_km").eq("user_id", userId).maybeSingle(),
        (supabase as any).from("driver_profiles").select("service_radius_km").eq("user_id", userId).maybeSingle(),
      ]);
      if (!active) return;
      if (plansError) toast.error("تعذر تحميل باقات الاشتراك");
      if (subError) toast.error("تعذر تحميل حالة اشتراكك");
      setPlans((planRows ?? []) as Plan[]);
      setSubscription(sub);
      setProviderRadius(Number(workerProfile?.service_radius_km ?? driverProfile?.service_radius_km ?? 25));
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
  const planCode = subscription?.is_trial ? "bronze" : subscription?.plan?.code;
  const companyGranted = subscription?.grant_type === "admin";
  const canSetRadius = roles.some((r) => r === "worker" || r === "large_driver");
  const canTaxiPerks = roles.includes("driver");
  const maxRadius = planCode === "gold" ? 55 : planCode === "silver" ? 40 : 25;
  const canUseTaxiDemand = canTaxiPerks && subscription?.status === "active" && planCode === "gold";
  async function saveProviderRadius() {
    setRadiusSaving(true);
    try {
      const { data, error } = await (supabase as any).rpc("set_provider_service_radius", { p_radius_km: providerRadius });
      if (error) throw error;
      setProviderRadius(Number(data ?? providerRadius));
      toast.success("تم حفظ نطاق استقبال الطلبات وتطبيقه على التوزيع");
    } catch (error: any) {
      toast.error(error?.message === "radius_exceeds_subscription_limit" ? "نطاقك يتجاوز حد باقتك الحالية" : error?.message || "تعذر حفظ النطاق");
    } finally { setRadiusSaving(false); }
  }
  async function loadTaxiDemandAreas() {
    setDemandLoading(true);
    try {
      const { data, error } = await (supabase as any).rpc("get_taxi_high_demand_areas", { p_category: null });
      if (error) throw error;
      setDemandAreas(data ?? []);
      setDemandLoaded(true);
    } catch (error: any) {
      toast.error(error?.message || "تعذر جلب مناطق الطلب العالي");
    } finally { setDemandLoading(false); }
  }
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
            <div className="mt-2 text-sm">{subscription.plan?.name_ar ?? "بدون باقة"} · {subscription.is_trial ? "تجربة مجانية بميزات البرونزي" : subscription.status === "active" ? "نشط" : subscription.status === "paused" ? "موقوف مؤقتاً" : "منتهي"}{companyGranted ? " · منحة شركة ممنون" : ""}</div>
            {subscription.trial_ends_at && <div className="text-xs text-muted-foreground mt-1">نهاية التجربة: {new Date(subscription.trial_ends_at).toLocaleString("ar-IQ", { dateStyle: "medium", timeStyle: "short" })}</div>}
            {subscription.current_period_end && !subscription.is_trial && <div className="text-xs text-muted-foreground mt-1">ينتهي: {new Date(subscription.current_period_end).toLocaleString("ar-IQ", { dateStyle: "medium", timeStyle: "short" })}</div>}
            {companyGranted && <div className="text-xs text-amber-700 mt-1">هذه المنحة تديرها شركة ممنون ولا يمكن تغيير الباقة من حسابك</div>}
            {subscription.cancel_at_period_end && <div className="text-xs text-amber-600 mt-1">تم إيقاف التجديد، وتبقى المزايا حتى نهاية الفترة</div>}
          </div>}
          {canSetRadius && <div className="glass rounded-2xl p-4 mb-4 space-y-3">
            <div className="font-black">نطاق استقبال الطلبات</div>
            <p className="text-xs text-muted-foreground">هذا اختيار فعلي يحدد أبعد مسافة تُرسل منها الطلبات إليك، ويُطبّق من خادم ممنون.</p>
            <div className="flex items-center justify-between text-sm font-bold"><span>النطاق الحالي</span><span>{providerRadius} كم</span></div>
            <input type="range" min={1} max={maxRadius} step={1} value={Math.min(providerRadius,maxRadius)} onChange={(e) => setProviderRadius(Number(e.target.value))} disabled={subscription?.status !== "active"} className="w-full accent-primary" />
            <div className="flex justify-between text-[10px] text-muted-foreground"><span>1 كم</span><span>الحد الأعلى لباقة {planCode === "gold" ? "الذهبي" : planCode === "silver" ? "الفضي" : "البرونزي"}: {maxRadius} كم</span></div>
            <button type="button" onClick={saveProviderRadius} disabled={radiusSaving || subscription?.status !== "active"} className="w-full rounded-xl bg-primary text-primary-foreground py-3 text-xs font-black disabled:opacity-50">{radiusSaving ? "جارٍ الحفظ..." : "حفظ نطاق الاستقبال"}</button>
          </div>}
          {canTaxiPerks && <div className="glass rounded-2xl p-4 mb-4 space-y-3">
            <div className="font-black">امتيازات الكابتن</div>
            {["silver","gold"].includes(planCode) ? <ul className="text-xs leading-7 text-muted-foreground list-disc pr-5">
              <li>تنبيه عند الاقتراب من مناطق الطلب العالي.</li>
              <li>أولوية فعلية في ترتيب إرسال عروض الرحلات حسب مستوى الاشتراك.</li>
              <li>تقديم محادثات الدعم حسب أولوية الباقة.</li>
              {planCode === "gold" && <><li>أعلى أولوية متاحة في توزيع العروض.</li><li>استعلام مباشر عن مناطق الطلب العالي.</li><li>تنبيه مميز عند رصد طلب مرتفع قريب.</li></>}
            </ul> : <p className="text-xs text-muted-foreground">تنبيهات مناطق الطلب العالي وأولوية توزيع الرحلات والاستعلام عن المناطق متاحة ضمن الفضي والذهبي.</p>}
            {canUseTaxiDemand && <button type="button" onClick={loadTaxiDemandAreas} disabled={demandLoading} className="w-full rounded-xl border border-primary/30 py-3 text-xs font-black disabled:opacity-50">{demandLoading ? "جارٍ فحص الطلب..." : "استعلام عن مناطق الطلب العالي"}</button>}
            {demandLoaded && <div className="space-y-2">
              {demandAreas.length === 0 ? <p className="text-xs text-muted-foreground">ماكو حالياً مناطق طلب مرتفع حسب الطلبات المسجلة خلال آخر 30 دقيقة.</p> : demandAreas.map((area:any,index:number) => <div key={String(area.zone_lat)+"-"+String(area.zone_lng)+"-"+index} className="rounded-xl border border-border p-3 text-xs">
                <div className="flex justify-between font-black"><span>{area.demand_level === "high" ? "طلب مرتفع" : "طلب متوسط"}</span><span>{area.waiting_requests} طلبات · {area.online_drivers} سائقين</span></div>
                <p className="text-muted-foreground mt-1">مؤشر الطلب إلى السائقين: {area.demand_ratio}</p>
                <a className="text-primary underline mt-2 inline-block" target="_blank" rel="noreferrer" href={"https://www.google.com/maps?q="+area.zone_lat+","+area.zone_lng}>فتح المنطقة على الخريطة</a>
              </div>)}
            </div>}
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
                {roles.some((r) => r === "worker" || r === "large_driver") && plan.code === "silver" && <p className="text-[11px] text-muted-foreground mt-1">للفنيين وسائقي الكيات: اختيار نطاق استقبال حتى 40 كم</p>}
                {roles.some((r) => r === "worker" || r === "large_driver") && plan.code === "gold" && <p className="text-[11px] text-muted-foreground mt-1">للفنيين وسائقي الكيات: اختيار نطاق استقبال حتى 55 كم</p>}
                {roles.includes("driver") && ["silver","gold"].includes(plan.code) && <p className="text-[11px] text-muted-foreground mt-1">للكابتن: تنبيهات الطلب العالي وأولوية فعلية بالدور والدعم، والذهبي يشمل الاستعلام والأولوية القصوى</p>}
                <div className="text-2xl font-black mt-4">{Number(plan.monthly_price).toLocaleString("ar-IQ")} <span className="text-xs font-bold text-muted-foreground">د.ع / شهرياً</span></div>
                <button type="button" onClick={() => setSelectedPlan(plan.code)} disabled={active || companyGranted}
                  className="w-full mt-4 rounded-xl bg-primary text-primary-foreground py-3 font-black text-sm disabled:opacity-50 flex items-center justify-center gap-2">
                  {busy === plan.code ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                  {active ? "مشترك بهذه الباقة" : companyGranted ? "الباقة محددة من الشركة" : selectedPlan === plan.code ? "تم اختيار الباقة" : "اختيار هذه الباقة"}
                </button>
              </div>;
            })}
          </div>
          {selectedPlan && !companyGranted && <div className="glass rounded-2xl p-4 mt-4"><p className="text-sm font-black">تم اختيار باقة {plans.find(p => p.code === selectedPlan)?.name_ar}</p><p className="text-xs text-muted-foreground mt-2">الدفع الإلكتروني غير متاح حالياً إلى حين إكمال ربط واختبار QiCard. اختيارك لا يخصم أي مبلغ ولا يغير اشتراكك.</p><button disabled className="w-full mt-3 rounded-xl bg-primary text-primary-foreground py-3 text-xs font-black opacity-60"><CreditCard className="inline h-4 w-4 ml-2" /> الدفع قيد الربط</button></div>}
          {subscription && !companyGranted && ["active", "paused"].includes(subscription.status) && (
            <div className="glass rounded-2xl p-4 mt-3 space-y-3">
              <div className="text-sm font-black">إدارة اشتراكك</div>
              {subscription.status === "active" ? (
                <button type="button" disabled={!!busy} onClick={async () => {
                  setBusy("pause");
                  try {
                    const { data, error } = await supabase.rpc("pause_own_subscription");
                    if (error) throw error;
                    if (!data) throw new Error("ما قدرنا نوقف الاشتراك");
                    setSubscription((current: any) => current ? { ...current, status: "paused" } : current);
                    toast.success("تم إيقاف اشتراكك مؤقتاً ولن تصلك طلبات جديدة");
                  } catch (error: any) { toast.error(error.message || "تعذر إيقاف الاشتراك"); }
                  finally { setBusy(null); }
                }} className="w-full rounded-xl border border-amber-500/40 text-amber-700 py-3 text-xs font-bold disabled:opacity-50">
                  {busy === "pause" ? "جارٍ الإيقاف..." : "إيقاف الاشتراك مؤقتاً"}
                </button>
              ) : (
                <button type="button" disabled={!!busy} onClick={async () => {
                  setBusy("resume");
                  try {
                    const { data, error } = await supabase.rpc("resume_own_subscription");
                    if (error) throw error;
                    if (!data) throw new Error("ماكو اشتراك قابل للتفعيل");
                    setSubscription((current: any) => current ? { ...current, status: "active" } : current);
                    toast.success("تم تفعيل اشتراكك من جديد");
                  } catch (error: any) {
                    toast.error(error.message === "subscription_period_expired" ? "انتهت مدة الاشتراك، جدّد حتى تفعّله" : error.message || "تعذر تفعيل الاشتراك");
                  } finally { setBusy(null); }
                }} className="w-full rounded-xl bg-primary text-primary-foreground py-3 text-xs font-bold disabled:opacity-50">
                  {busy === "resume" ? "جارٍ التفعيل..." : "تفعيل الاشتراك من جديد"}
                </button>
              )}
              {subscription.current_period_end && (
                <>
                  <button type="button" disabled={!!busy} onClick={async () => {
                    setBusy("renewal");
                    try {
                      const rpc = subscription.cancel_at_period_end ? "restore_own_subscription_continuation" : "cancel_own_subscription_at_period_end";
                      const { data, error } = await supabase.rpc(rpc);
                      if (error) throw error;
                      if (!data) throw new Error("تعذر تحديث إعداد نهاية الاشتراك");
                      setSubscription((current: any) => current ? { ...current, cancel_at_period_end: !current.cancel_at_period_end, auto_renew: false } : current);
                      toast.success(subscription.cancel_at_period_end ? "تم التراجع عن طلب إيقاف الاشتراك عند نهاية الفترة" : "تم تحديد إيقاف الاشتراك عند نهاية الفترة");
                    } catch (error: any) { toast.error(error.message || "تعذر تحديث إعداد التجديد"); }
                    finally { setBusy(null); }
                  }} className={`w-full rounded-xl border py-3 text-xs font-bold disabled:opacity-50 ${subscription.cancel_at_period_end ? "border-emerald-500/40 text-emerald-700" : "border-destructive/40 text-destructive"}`}>
                    {busy === "renewal" ? "جارٍ التحديث..." : subscription.cancel_at_period_end ? "التراجع عن إيقاف الاشتراك عند نهاية الفترة" : "إيقاف الاشتراك عند نهاية الفترة"}
                  </button>
                  <p className="text-[10px] leading-5 text-muted-foreground">تقدر تغيّر هذا القرار بأي وقت قبل انتهاء الفترة. التجديد بالدفع التلقائي الفعلي غير مفعّل حالياً إلى حين اكتمال ربط الدفع الدوري.</p>
                </>
              )}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground text-center mt-5 leading-6">عند تفعيل حساب التاجر وربط مفاتيح QiCard سيُتاح الدفع الآمن. لا يخزن ممنون رقم البطاقة أو رمز الأمان، ولا يُفعّل الاشتراك إلا بعد تأكيد البوابة من الخادم.</p>
        </>}
      </div>
    </MobileShell>
  );
}