import { createFileRoute, Navigate, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { MobileShell } from "@/components/mobile-shell";
import {
  LogOut,
  Star,
  Settings,
  TrendingUp,
  ShieldCheck,
  ChevronLeft,
  CreditCard,
  Wallet,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { NotificationsBell } from "@/components/notifications-bell";
import { MyPartnerOrders } from "@/components/my-partner-orders";
import { useServerFn } from "@tanstack/react-start";
import { getReputation, getProviderReviews, type ReputationData } from "@/lib/reputation.functions";
import { ReputationCard, StarRating, SubScoreBar } from "@/components/reputation";
import { toast } from "@/lib/toast";

export const Route = createFileRoute("/profile")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "الملف الشخصي | ممنون" },
      { name: "description", content: "إدارة معلومات حسابك وتقييماتك في ممنون." },
      { property: "og:title", content: "الملف الشخصي | ممنون" },
      { property: "og:description", content: "إدارة معلومات حسابك وتقييماتك في ممنون." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProfilePage,
});

type ProviderWallet = { balance: number; total_earned: number; total_commission: number };
type WalletTransaction = { id: string; type: string; created_at: string; amount: number; note?: string | null };
type EarningsSummary = { last24h: number; week: number; month: number; year: number };

function getProviderEarningsQueryStart(): string {
  const now = new Date();
  const last24h = now.getTime() - 86400000;
  const week = new Date(now);
  week.setHours(0, 0, 0, 0);
  week.setDate(week.getDate() - ((week.getDay() + 6) % 7));
  const month = new Date(now.getFullYear(), now.getMonth(), 1);
  const year = new Date(now.getFullYear(), 0, 1);
  return new Date(Math.min(last24h, week.getTime(), month.getTime(), year.getTime())).toISOString();
}

function summarizeProviderEarnings(rows: WalletTransaction[]): EarningsSummary {
  const now = new Date();
  const last24hStart = now.getTime() - 86400000;
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const sumSince = (start: number) => rows.reduce((sum, row) => {
    const createdAt = Date.parse(row.created_at);
    return row.type === "earning" && Number.isFinite(createdAt) && createdAt >= start ? sum + Number(row.amount || 0) : sum;
  }, 0);
  return { last24h: sumSince(last24hStart), week: sumSince(weekStart.getTime()), month: sumSince(monthStart.getTime()), year: sumSince(yearStart.getTime()) };
}

function ProfilePage() {
  const { session, profile, roles, activeRole, loading, signOut, refresh } = useAuth();
  const navigate = useNavigate();
  const [wallet, setWallet] = useState<any>(null);
  const [txs, setTxs] = useState<any[]>([]);
  const [earnings, setEarnings] = useState<EarningsSummary>({ last24h: 0, week: 0, month: 0, year: 0 });
  const [providerWallet, setProviderWallet] = useState<ProviderWallet | null>(null);
  const [providerTxs, setProviderTxs] = useState<WalletTransaction[]>([]);
  const [providerWalletOffline, setProviderWalletOffline] = useState(false);
  const [showEarningsDetails, setShowEarningsDetails] = useState(false);
  const [showProviderWalletDetails, setShowProviderWalletDetails] = useState(false);
  const [showProviderRecentTransactions, setShowProviderRecentTransactions] = useState(false);
  const [showRecentTransactions, setShowRecentTransactions] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [referralSummary, setReferralSummary] = useState<{referral_code:string;successful_signups:number}|null>(null);
  const [showLogout, setShowLogout] = useState(false);

  useEffect(() => {
    const updateLogoutVisibility = () => {
      const root = document.documentElement;
      setShowLogout(window.scrollY + window.innerHeight >= root.scrollHeight - 48);
    };
    window.addEventListener("scroll", updateLogoutVisibility, { passive: true });
    window.addEventListener("resize", updateLogoutVisibility);
    updateLogoutVisibility();
    return () => {
      window.removeEventListener("scroll", updateLogoutVisibility);
      window.removeEventListener("resize", updateLogoutVisibility);
    };
  }, []);
  const [reputation, setReputation] = useState<ReputationData | null>(null);
  const [reviews, setReviews] = useState<any[]>([]);
  const [showReviews, setShowReviews] = useState(false);
  const [showRatingDetails, setShowRatingDetails] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const uid = session?.user.id;
  const isDriver = roles.includes("driver") || roles.includes("large_driver");
  const isWorker = roles.includes("worker");
  const isProvider = (isDriver || isWorker) && activeRole !== "customer";

  const getRepFn = useServerFn(getReputation);
  const getReviewsFn = useServerFn(getProviderReviews);

  useEffect(() => {
    if (!uid) return;
    let active = true;
    async function loadWallets() {
      if (activeRole === "customer") {
        setProviderWallet(null);
        setProviderTxs([]);
        setEarnings({ last24h: 0, week: 0, month: 0, year: 0 });
        const { data, error } = await (supabase as any).rpc("get_my_customer_wallet");
        if (!active) return;
        if (error) {
          console.warn("[wallet] customer wallet unavailable:", error.message);
          setWallet(null);
          setTxs([]);
          return;
        }
        setWallet(data?.wallet ?? null);
        setTxs(Array.isArray(data?.transactions) ? data.transactions : []);
        return;
      }
      setWallet(null);
      setTxs([]);
      if (!isProvider) {
        setProviderWallet(null);
        setProviderTxs([]);
        setEarnings({ last24h: 0, week: 0, month: 0, year: 0 });
        setProviderWalletOffline(false);
        return;
      }
      try {
        const earningsStart = getProviderEarningsQueryStart();
        const since24Hours = new Date(Date.now() - 86400000).toISOString();
        const [walletResult, recentResult] = await Promise.all([
          (supabase as any).from("driver_wallets").select("balance,total_earned,total_commission").eq("user_id", uid).maybeSingle(),
          (supabase as any).from("transactions").select("id,type,created_at,amount,note").eq("user_id", uid)
            .gte("created_at", since24Hours).order("created_at", { ascending: false }).limit(30),
        ]);
        if (walletResult.error) throw walletResult.error;
        if (recentResult.error) throw recentResult.error;
        const earningRows: WalletTransaction[] = [];
        let offset = 0;
        while (true) {
          const { data, error } = await (supabase as any).from("transactions")
            .select("id,type,created_at,amount").eq("user_id", uid).eq("type", "earning")
            .gte("created_at", earningsStart).order("created_at", { ascending: true })
            .range(offset, offset + 999);
          if (error) throw error;
          const page = (data || []) as WalletTransaction[];
          earningRows.push(...page);
          if (page.length < 1000) break;
          offset += 1000;
        }
        if (!active) return;
        setProviderWallet(walletResult.data as ProviderWallet | null);
        setProviderTxs((recentResult.data || []) as WalletTransaction[]);
        setEarnings(summarizeProviderEarnings(earningRows));
        setProviderWalletOffline(false);
      } catch (error) {
        console.warn("[wallet] provider wallet unavailable:", error);
        if (!active) return;
        setProviderWallet(null);
        setProviderTxs([]);
        setEarnings({ last24h: 0, week: 0, month: 0, year: 0 });
        setProviderWalletOffline(true);
      }
    }
    void loadWallets();
    (supabase as any).rpc("has_admin_access", { p_user_id: uid }).then(({ data }: any) => {
      if (active) setIsAdmin(!!data);
    });
    if (isProvider) getRepFn({ data: { userId: uid } }).then((rep) => {
      if (active) setReputation(rep);
    }).catch(() => {});
    return () => { active = false; };
  }, [uid, activeRole, isProvider, getRepFn]);

  useEffect(() => {
    let active = true;
    if (!uid) { setReferralSummary(null); return () => { active = false; }; }
    (supabase as any).rpc("get_my_referral_summary").then(({ data, error }: any) => {
      if (!active || error) return;
      const row = Array.isArray(data) ? data[0] : data;
      if (row?.referral_code) setReferralSummary({ referral_code: String(row.referral_code), successful_signups: Number(row.successful_signups) || 0 });
    });
    return () => { active = false; };
  }, [uid]);

  async function shareReferralLink() {
    if (!referralSummary?.referral_code) return;
    const link = `https://mamnoon-theta.vercel.app/invite?ref=${encodeURIComponent(referralSummary.referral_code)}`;
    const message = `انضم إلى ممنون باستخدام رمز الإحالة الخاص بي: ${referralSummary.referral_code}\\n${link}`;
    if (navigator.share) await navigator.share({ title: "دعوة إلى ممنون", text: message, url: link });
    else { await navigator.clipboard.writeText(message); toast.success("تم نسخ رابط ورمز الإحالة"); }
  }

  async function uploadAvatar(file?: File) {
    if (!file || !uid || avatarUploading) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast.error("اختر صورة بصيغة JPG أو PNG أو WEBP");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("حجم الصورة يجب ألا يتجاوز 5 ميغابايت");
      return;
    }
    setAvatarUploading(true);
    try {
      const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
      const path = `${uid}/avatar-${Date.now()}.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, file, { contentType: file.type, cacheControl: "3600", upsert: false });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ avatar_url: data.publicUrl })
        .eq("id", uid);
      if (updateError) throw updateError;
      await refresh();
      toast.success("تم حفظ صورتك الشخصية");
    } catch (error: any) {
      toast.error(error?.message || "تعذر رفع الصورة، حاول مرة ثانية");
    } finally {
      setAvatarUploading(false);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    }
  }

  async function loadReviews() {
    if (!uid) return;
    try {
      const r = await getReviewsFn({ data: { userId: uid } });
      setReviews(r as any[]);
    } catch {}
  }

  if (loading) return null;
  if (!session) return <Navigate to="/auth" />;

  return (
    <MobileShell>
      <div className="px-5 pt-10 pb-6">
        <div className="flex justify-end mb-3">
          <NotificationsBell />
        </div>
        <div className="glass rounded-3xl p-6 text-center shadow-card">
          {profile?.avatar_url ? (
            <div className="h-20 w-20 mx-auto rounded-3xl overflow-hidden border-2 border-primary shadow-lg mb-3">
              <img
                src={profile.avatar_url}
                alt={profile.full_name}
                className="h-full w-full object-cover"
              />
            </div>
          ) : (
            <div className="h-20 w-20 mx-auto rounded-3xl bg-gradient-to-br from-primary to-primary-glow grid place-items-center text-primary-foreground text-3xl font-black glow-primary mb-3">
              {(profile?.full_name || "؟").charAt(0)}
            </div>
          )}
        {referralSummary && (
          <button type="button" onClick={() => void shareReferralLink()} title={`مشاركة رابط الإحالة · التسجيلات الناجحة: ${referralSummary.successful_signups}`} className="mx-auto mt-1 mb-1 inline-flex items-center gap-1 rounded-full border border-border/50 bg-muted/30 px-2 py-0.5 text-[9px] font-medium text-muted-foreground opacity-75 hover:opacity-100">
            <span>رابط الدعوة</span><span dir="ltr" className="font-semibold">{referralSummary.referral_code}</span><span>↗</span>
          </button>
        )}
          {!isProvider && <>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(event) => uploadAvatar(event.currentTarget.files?.[0])}
            />
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              disabled={avatarUploading}
              className="mx-auto mb-3 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground disabled:opacity-60"
            >
              {avatarUploading ? "جارٍ حفظ الصورة..." : "📷 تغيير الصورة الشخصية"}
            </button>
          </>}
          <div className="text-xl font-black flex items-center justify-center gap-1.5 flex-wrap">
            <span>{profile?.full_name}</span>
            {isAdmin && <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/70 bg-gradient-to-r from-amber-100 via-yellow-200 to-amber-300 px-2.5 py-1 text-[10px] font-black text-amber-900 shadow-sm" title="حساب مسؤول ممنون موثق"><ShieldCheck className="h-3.5 w-3.5" /> مسؤول موثق</span>}
            {isProvider && (
              <ShieldCheck className="h-4 w-4 text-emerald-600 inline" aria-label="هوية موثقة" />
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-1" dir="ltr">
            {profile?.phone}
          </div>


          <div className="flex justify-center gap-1.5 mt-3 flex-wrap">
            {roles.map((r) => (
              <span
                key={r}
                className="text-[10px] font-black px-3 py-1 rounded-full bg-primary/20 text-primary"
              >
                {r === "customer"
                  ? "زبون"
                  : r === "driver"
                    ? "كابتن موثق 🚗"
                    : r === "large_driver"
                      ? "سائق سيارات كبيرة 🚚"
                    : (r as string) === "admin"
                      ? "مدير"
                      : "فني موثق 🛠️"}
              </span>
            ))}
          </div>
          {isProvider && reputation && (
            <div className="mt-3 flex items-center justify-center gap-2">
              <StarRating stars={Number(reputation.avg_stars)} size="sm" />
              <span className="text-xs font-bold text-muted-foreground">
                {Number(reputation.avg_stars).toFixed(1)} ({reputation.ratings_count})
              </span>
            </div>
          )}
        </div>
        {isProvider && reputation && (
          <div className="mt-5">
            <ReputationCard reputation={reputation} />
            {reputation.ratings_count > 0 && (
              <button
                onClick={() => {
                  if (!showReviews && reviews.length === 0) loadReviews();
                  setShowReviews(!showReviews);
                }}
                className="w-full mt-3 glass rounded-2xl p-3 flex items-center justify-between btn-press"
              >
                <span className="text-xs font-bold">آراء العملاء</span>
                <ChevronLeft
                  className={`h-4 w-4 text-muted-foreground transition-transform ${showReviews ? "rotate-90" : ""}`}
                />
              </button>
            )}
            {showReviews && reputation && (
              <div className="mt-2 glass rounded-2xl p-3">
                <button
                  type="button"
                  onClick={() => setShowRatingDetails((value) => !value)}
                  aria-expanded={showRatingDetails}
                  className="w-full flex items-center justify-between text-right"
                >
                  <span className="text-[11px] font-bold text-primary">تفاصيل التقييم</span>
                  <ChevronLeft className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${showRatingDetails ? "-rotate-90" : ""}`} />
                </button>
                {showRatingDetails && (
                  <div className="mt-3 space-y-3">
                    <SubScoreBar label="الاحترافية" value={Number(reputation.professionalism_avg)} icon={<ShieldCheck className="h-3.5 w-3.5" />} />
                    <SubScoreBar label="الالتزام بالوقت" value={Number(reputation.punctuality_avg)} icon={<TrendingUp className="h-3.5 w-3.5" />} />
                    <SubScoreBar label="جودة العمل" value={Number(reputation.quality_avg)} icon={<Star className="h-3.5 w-3.5" />} />
                  </div>
                )}
              </div>
            )}
            {showReviews && reviews.length > 0 && (
              <div className="mt-2 space-y-2">
                {reviews.map((rv) => (
                  <div key={rv.id} className="glass rounded-2xl p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <div className="h-7 w-7 rounded-full bg-primary/20 grid place-items-center text-xs font-bold text-primary">
                          {(rv.rater?.full_name || "؟").charAt(0)}
                        </div>
                        <span className="text-xs font-bold">{rv.rater?.full_name || "مستخدم"}</span>
                      </div>
                      <StarRating stars={rv.stars} size="sm" />
                    </div>
                    {rv.comment && (
                      <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                        «{rv.comment}»
                      </p>
                    )}
                    <div className="text-[10px] text-muted-foreground/60 mt-1">
                      {new Date(rv.created_at).toLocaleDateString("ar-IQ")}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {isProvider && (
          <div className="mt-5 grid grid-cols-2 gap-2">
            <section className="min-w-0 rounded-2xl border border-primary-foreground/10 bg-gradient-to-br from-primary to-primary-glow p-3 text-primary-foreground shadow-card">
              {providerWalletOffline && <p className="mb-2 rounded-lg bg-white/15 p-2 text-[9px] leading-4">تعذر تحديث المحفظة؛ الأرقام الحالية غير متاحة.</p>}
              <div className="flex items-center gap-1.5 text-xs font-black"><Wallet className="h-4 w-4" /> محفظتي</div>
              <div className="mt-2 text-xl font-black tabular-nums break-words">{Number(providerWallet?.balance ?? 0).toLocaleString("ar-IQ")} <span className="text-[10px] opacity-80">د.ع</span></div>
              <button type="button" onClick={() => setShowProviderWalletDetails((v) => !v)} aria-expanded={showProviderWalletDetails} className="mt-3 w-full rounded-xl bg-white/15 px-2 py-2 text-[10px] font-black flex items-center justify-between">
                <span>{showProviderWalletDetails ? "إخفاء" : "تفاصيل المحفظة"}</span><ChevronLeft className={"h-3.5 w-3.5 transition-transform " + (showProviderWalletDetails ? "-rotate-90" : "")} />
              </button>
              {showProviderWalletDetails && <div className="mt-2 space-y-2">
                <div className="rounded-lg bg-white/10 p-2"><div className="text-[9px] opacity-75">إجمالي الأرباح</div><div className="text-xs font-black">{Number(providerWallet?.total_earned ?? 0).toLocaleString("ar-IQ")} د.ع</div></div>
                <div className="rounded-lg bg-white/10 p-2"><div className="text-[9px] opacity-75">العمولة</div><div className="text-xs font-black">{Number(providerWallet?.total_commission ?? 0).toLocaleString("ar-IQ")} د.ع</div></div>
                <button type="button" onClick={() => setShowProviderRecentTransactions((v) => !v)} className="w-full rounded-lg bg-white/15 p-2 text-[10px] font-black text-right">{showProviderRecentTransactions ? "إخفاء حركات آخر ٢٤ ساعة" : "حركات آخر ٢٤ ساعة"}</button>
                {showProviderRecentTransactions && (providerTxs.length ? providerTxs.map((t) => <div key={t.id} className="rounded-lg bg-white/10 p-2 flex items-center justify-between gap-2"><div className="min-w-0"><div className="text-[10px] font-bold">{t.note || (t.type === "earning" ? "أرباح" : t.type === "commission" ? "عمولة" : t.type === "withdrawal" ? "سحب" : t.type === "refund" ? "استرجاع" : "تسوية")}</div><div className="text-[9px] opacity-75">{new Date(t.created_at).toLocaleString("ar-IQ")}</div></div><div className="shrink-0 text-[10px] font-black">{Number(t.amount).toLocaleString("ar-IQ")} د.ع</div></div>) : <p className="rounded-lg bg-white/10 p-2 text-center text-[10px]">ماكو حركات خلال آخر ٢٤ ساعة</p>)}
              </div>}
            </section>
            <section className="min-w-0 rounded-2xl border border-emerald-200/20 bg-gradient-to-br from-emerald-700 to-teal-600 p-3 text-white shadow-card">
              <div className="text-xs font-black">أرباحي · آخر ٢٤ ساعة</div>
              <div className="mt-2 text-xl font-black tabular-nums break-words">{earnings.last24h.toLocaleString("ar-IQ")} <span className="text-[10px] opacity-80">د.ع</span></div>
              <button type="button" onClick={() => setShowEarningsDetails((v) => !v)} aria-expanded={showEarningsDetails} className="mt-3 w-full rounded-xl bg-white/15 px-2 py-2 text-[10px] font-black flex items-center justify-between">
                <span>{showEarningsDetails ? "إخفاء" : "تفاصيل الأرباح"}</span><ChevronLeft className={"h-3.5 w-3.5 transition-transform " + (showEarningsDetails ? "-rotate-90" : "")} />
              </button>
              {showEarningsDetails && <div className="mt-2 space-y-2">
                <div className="rounded-lg bg-white/10 p-2"><div className="text-[9px] opacity-75">هذا الأسبوع</div><div className="text-xs font-black">{earnings.week.toLocaleString("ar-IQ")} د.ع</div></div>
                <div className="rounded-lg bg-white/10 p-2"><div className="text-[9px] opacity-75">هذا الشهر</div><div className="text-xs font-black">{earnings.month.toLocaleString("ar-IQ")} د.ع</div></div>
                <div className="rounded-lg bg-white/10 p-2"><div className="text-[9px] opacity-75">هذه السنة</div><div className="text-xs font-black">{earnings.year.toLocaleString("ar-IQ")} د.ع</div></div>
              </div>}
            </section>
          </div>
        )}
        {activeRole === "customer" && (
          <div className="mt-5 rounded-2xl p-4 bg-gradient-to-br from-primary to-primary-glow text-primary-foreground shadow-card">
            <div className="flex items-center gap-2"><Wallet className="h-4 w-4" /><span className="text-sm font-black">محفظتي</span></div>
            <div className="mt-1 text-[10px] opacity-80">رصيدك المتاح</div>
            <div className="text-2xl font-black tabular-nums mt-1">{Number(wallet?.balance ?? 0).toLocaleString("ar-IQ")} <span className="text-xs font-bold opacity-80">د.ع</span></div>
            <div className="mt-2 rounded-xl bg-white/15 p-2 text-[10px] leading-5">شحن الرصيد والسحب عبر زين كاش يتفعّلان بعد ربط مفاتيح التاجر الرسمية.</div>
            <button type="button" onClick={() => setShowRecentTransactions((v) => !v)} aria-expanded={showRecentTransactions} className="mt-2 w-full flex items-center justify-between rounded-xl bg-white/15 px-3 py-2.5 text-[10px] font-black">
              <span className="flex items-center gap-2"><TrendingUp className="h-3.5 w-3.5" /> سجل حركات المحفظة</span>
              <ChevronLeft className={"h-3.5 w-3.5 transition-transform " + (showRecentTransactions ? "-rotate-90" : "")} />
            </button>
            {showRecentTransactions && <ul className="mt-2 space-y-2">
              {txs.length === 0 ? <li className="rounded-xl bg-white/10 p-3 text-center text-[10px] opacity-80">لا توجد حركات مسجلة في المحفظة حالياً</li> : txs.map((t) => (
                <li key={t.id} className="rounded-xl bg-white/10 p-3 flex items-center justify-between gap-3">
                  <div><div className="text-xs font-bold">{t.note ?? (t.type === "deposit" ? "إيداع رصيد" : t.type === "withdrawal" ? "سحب" : t.type === "payment" ? "دفع من المحفظة" : t.type === "refund" ? "استرجاع مبلغ" : t.type === "adjustment" ? "تسوية رصيد" : t.type)}</div><div className="text-[10px] opacity-75">{new Date(t.created_at).toLocaleString("ar-IQ")}</div></div>
                  <div className={"text-sm font-black whitespace-nowrap " + (Number(t.amount) >= 0 ? "text-emerald-200" : "text-red-200")}>{Number(t.amount) >= 0 ? "+" : ""}{Number(t.amount).toLocaleString("ar-IQ")} د.ع</div>
                </li>
              ))}
            </ul>}
          </div>
        )}

          {isAdmin && (
            <Link
              to="/admin"
              className="w-full glass rounded-2xl p-4 flex items-center gap-3 btn-press text-right"
            >
              <ShieldCheck className="h-5 w-5 text-primary" />
              <span className="flex-1 font-bold text-sm">لوحة الإدارة</span>
            </Link>
          )}

          <Link
            to="/account-settings"
            className="w-full glass rounded-2xl p-4 flex items-center gap-3 btn-press text-right"
          >
            <Settings className="h-5 w-5 text-primary" />
            <span className="flex-1 font-bold text-sm">الإعدادات وسجّل معنا</span>
          </Link>
        </div>
        <MyPartnerOrders customerId={session?.user.id ?? null} />
        <div className="mt-6 text-center text-[11px] text-muted-foreground">ممنون · v2.0</div>
      {showLogout && <div className="fixed inset-x-0 bottom-[100px] z-30 px-5 pointer-events-none">
        <div className="mx-auto max-w-md pointer-events-auto">
          <button
            type="button"
            onClick={async () => {
              await signOut();
              navigate({ to: "/auth" });
            }}
            className="w-full glass rounded-2xl border border-destructive/30 bg-background/95 p-4 flex items-center gap-3 btn-press text-right text-destructive shadow-xl backdrop-blur-md"
          >
            <LogOut className="h-5 w-5" />
            <span className="flex-1 font-bold text-sm">تسجيل الخروج</span>
          </button>
        </div>
      </div>}
    </MobileShell>
  );
}
