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
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { NotificationsBell } from "@/components/notifications-bell";
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

function ProfilePage() {
  const { session, profile, roles, loading, signOut, refresh } = useAuth();
  const navigate = useNavigate();
  const [wallet, setWallet] = useState<any>(null);
  const [txs, setTxs] = useState<any[]>([]);
  const [earnings, setEarnings] = useState({ today: 0, week: 0, month: 0 });
  const [showEarningsDetails, setShowEarningsDetails] = useState(false);
  const [showRecentTransactions, setShowRecentTransactions] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [reputation, setReputation] = useState<ReputationData | null>(null);
  const [reviews, setReviews] = useState<any[]>([]);
  const [showReviews, setShowReviews] = useState(false);
  const [showRatingDetails, setShowRatingDetails] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const uid = session?.user.id;
  const isDriver = roles.includes("driver") || roles.includes("large_driver");
  const isWorker = roles.includes("worker");
  const isProvider = isDriver || isWorker;

  const getRepFn = useServerFn(getReputation);
  const getReviewsFn = useServerFn(getProviderReviews);

  useEffect(() => {
    if (!uid) return;
    if (isProvider) {
      (supabase as any)
        .from("driver_wallets")
        .select("*")
        .eq("user_id", uid)
        .maybeSingle()
        .then(({ data }: any) => setWallet(data));

      const now = new Date();
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);
      const weekStart = new Date(todayStart);
      weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const last24Hours = new Date(now.getTime() - 86400000);

      (supabase as any)
        .from("transactions")
        .select("*")
        .eq("user_id", uid)
        .gte("created_at", monthStart.toISOString())
        .order("created_at", { ascending: false })
        .then(({ data, error }: any) => {
          if (error) {
            console.warn("[earnings] transaction summary unavailable:", error.message);
            return;
          }
          const rows = data ?? [];
          const earningRows = rows.filter((t: any) => t.type === "earning");
          const sumSince = (start: Date) => earningRows.reduce((total: number, t: any) =>
            new Date(t.created_at) >= start ? total + Number(t.amount || 0) : total, 0);
          setEarnings({ today: sumSince(todayStart), week: sumSince(weekStart), month: sumSince(monthStart) });
          setTxs(rows.filter((t: any) => new Date(t.created_at).getTime() >= last24Hours.getTime()));
        });
    }
    (supabase as any)
      .rpc("has_admin_access", { p_user_id: uid })
      .then(({ data }: any) => setIsAdmin(!!data));
    if (isProvider && uid) {
      getRepFn({ data: { userId: uid } })
        .then((rep) => setReputation(rep))
        .catch(() => {});
    }
  }, [uid, isProvider, getRepFn]);

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
          <div className="mt-5 rounded-3xl p-5 bg-gradient-to-br from-primary to-primary-glow text-primary-foreground shadow-elegant">
            <div className="flex items-center gap-2 mb-3 opacity-90"><TrendingUp className="h-4 w-4" /><span className="text-sm font-black">أرباحي</span></div>
            <div className="text-xs opacity-80 mb-1">أرباح اليوم</div>
            <div className="text-3xl font-black tabular-nums">{earnings.today.toLocaleString("ar-IQ")} <span className="text-base font-bold opacity-80">د.ع</span></div>
            <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-white/15 px-3 py-3">
              <div><div className="text-[11px] opacity-80">الرصيد المتاح</div><div className="text-lg font-black tabular-nums">{Number(wallet?.balance ?? 0).toLocaleString("ar-IQ")} د.ع</div></div>
              <button type="button" onClick={() => setShowEarningsDetails((value) => !value)} aria-expanded={showEarningsDetails} className="rounded-xl bg-white px-4 py-2.5 text-xs font-black text-primary active:scale-95 transition">{showEarningsDetails ? "إخفاء التفاصيل" : "تفاصيل الأرباح"}</button>
            </div>
            {showEarningsDetails && <div className="grid grid-cols-2 gap-3 mt-3 text-xs">
              <div className="bg-white/15 rounded-2xl p-3"><div className="opacity-80">أرباح هذا الأسبوع</div><div className="font-black text-lg mt-1 tabular-nums">{earnings.week.toLocaleString("ar-IQ")} د.ع</div></div>
              <div className="bg-white/15 rounded-2xl p-3"><div className="opacity-80">أرباح هذا الشهر</div><div className="font-black text-lg mt-1 tabular-nums">{earnings.month.toLocaleString("ar-IQ")} د.ع</div></div>
              <div className="bg-white/10 rounded-2xl p-3"><div className="opacity-80">إجمالي الأرباح</div><div className="font-black mt-1">{Number(wallet?.total_earned ?? 0).toLocaleString("ar-IQ")} د.ع</div></div>
              <div className="bg-white/10 rounded-2xl p-3"><div className="opacity-80">إجمالي العمولة</div><div className="font-black mt-1">{Number(wallet?.total_commission ?? 0).toLocaleString("ar-IQ")} د.ع</div></div>
              <div className="col-span-2 border-t border-white/15 pt-3">
                <button type="button" onClick={() => setShowRecentTransactions((v) => !v)} aria-expanded={showRecentTransactions} className="w-full flex items-center justify-between rounded-xl bg-white/15 px-3 py-3 text-xs font-black">
                  <span className="flex items-center gap-2"><TrendingUp className="h-4 w-4" /> آخر الحركات · آخر ٢٤ ساعة</span>
                  <ChevronLeft className={`h-4 w-4 transition-transform ${showRecentTransactions ? "-rotate-90" : ""}`} />
                </button>
                {showRecentTransactions && <ul className="mt-3 space-y-2">
                  {txs.length === 0 ? <li className="rounded-xl bg-white/10 p-3 text-center text-xs opacity-80">ماكو حركات مالية خلال آخر ٢٤ ساعة</li> : txs.map((t) => (
                    <li key={t.id} className="rounded-xl bg-white/10 p-3 flex items-center justify-between gap-3">
                      <div><div className="text-xs font-bold">{t.note ?? t.type}</div><div className="text-[10px] opacity-75">{new Date(t.created_at).toLocaleString("ar-IQ")}</div></div>
                      <div className={`text-sm font-black whitespace-nowrap ${Number(t.amount) >= 0 ? "text-emerald-200" : "text-red-200"}`}>{Number(t.amount) >= 0 ? "+" : ""}{Number(t.amount).toLocaleString("ar-IQ")} د.ع</div>
                    </li>
                  ))}
                </ul>}
              </div>
            </div>}
          </div>
        )}
        <div className="mt-5 space-y-2">
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
            <span className="flex-1 font-bold text-sm">تبديل الدور وإعدادات الحساب</span>
          </Link>
          <button
            onClick={() => navigate({ to: "/select-role" })}
            className="w-full glass rounded-2xl p-4 flex items-center gap-3 btn-press text-right"
          >
            <Settings className="h-5 w-5 text-primary" />
            <span className="flex-1 font-bold text-sm">التسجيل في دور جديد</span>
          </button>
          <button
            onClick={async () => {
              await signOut();
              navigate({ to: "/auth" });
            }}
            className="w-full glass rounded-2xl p-4 flex items-center gap-3 btn-press text-right text-destructive"
          >
            <LogOut className="h-5 w-5" />
            <span className="flex-1 font-bold text-sm">تسجيل الخروج</span>
          </button>
        </div>
        <div className="mt-6 text-center text-[11px] text-muted-foreground">ممنون · v2.0</div>
      </div>
    </MobileShell>
  );
}
