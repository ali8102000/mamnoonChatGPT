import { createFileRoute, Navigate, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import {
  adminGetPlans,
  adminSavePlan,
  adminTogglePlan,
  adminGetSettings,
  adminSaveSettings,
  adminGetStats,
  adminGetSubscriptions,
  adminSearchSubscriptionUsers,
  adminGrantSubscription,
  adminSetSubscriptionStatus,
  adminExtendSubscription,
  adminPauseAllSubscriptions,
  adminGrantSubscriptionsBulk,
  adminBroadcastAnnouncement,
} from "@/lib/subscription.functions";
import {
  Loader2,
  ShieldCheck,
  Crown,
  Award,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  Users,
  TrendingUp,
  Calendar,
  AlertCircle,
  Plus,
  Save,
  X,
  BadgeCheck,
  Headphones,
  BarChart3,
  Star,
  ChevronLeft,
  UserPlus,
  Search,
} from "lucide-react";
import { toast } from "@/lib/toast";

export const Route = createFileRoute("/admin/subscriptions")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "إدارة الاشتراكات | كفو" },
      { name: "description", content: "إدارة خطط واشتراكات منصة كفو." },
      { property: "og:title", content: "إدارة الاشتراكات | كفو" },
      { property: "og:description", content: "إدارة خطط واشتراكات منصة كفو." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SubscriptionsAdmin,
});

type Plan = {
  id: string;
  code: string;
  name_ar: string;
  name_en: string;
  description_ar: string | null;
  tier: number;
  max_requests_per_month: number | null;
  priority_weight: number;
  offer_priority: number;
  badge_label: string | null;
  badge_color: string | null;
  show_stats: boolean;
  priority_support: boolean;
  monthly_price: number;
  yearly_price: number;
  currency: string;
  is_active: boolean;
  sort_order: number;
};
type Stats = {
  totalSubscribers: number;
  activeSubscriptions: number;
  expiredSubscriptions: number;
  monthlyRevenue: number;
  yearlyRevenue: number;
  freeCount: number;
  bronzeCount: number;
  silverCount: number;
  trialCount?: number;
  goldCount: number;
};
type SubscriptionRow = {
  id: string;
  user_id: string;
  status: string;
  billing_cycle: string;
  current_period_start: string;
  current_period_end: string | null;
  request_count: number;
  auto_renew: boolean;
  created_at: string;
  grant_type: string; granted_by: string | null; is_trial: boolean; paused_at: string | null; cancel_at_period_end: boolean;
  profile: { full_name: string | null; email: string | null; phone: string | null } | null;
  plan: { code: string; name_ar: string; tier: number } | null;
};

function SubscriptionsAdmin() {
  const { session, loading } = useAuth();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [subs, setSubs] = useState<SubscriptionRow[]>([]);
  const [tab, setTab] = useState("overview");
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [grantRefresh, setGrantRefresh] = useState(0);

  const loadAll = useCallback(async () => {
    // Load each panel independently: a statistics/RPC failure must never hide
    // the actual subscription ledger or prevent the grant tab from refreshing.
    const results = await Promise.allSettled([
      adminGetPlans(),
      adminGetSettings(),
      adminGetStats(),
      adminGetSubscriptions(),
    ]);
    const [plansResult, settingsResult, statsResult, subsResult] = results;
    if (plansResult.status === "fulfilled") setPlans(plansResult.value as Plan[]);
    else toast.error("تعذر تحميل الباقات: " + (plansResult.reason?.message || "خطأ غير معروف"));
    if (settingsResult.status === "fulfilled") setSettings(settingsResult.value);
    else toast.error("تعذر تحميل الإعدادات: " + (settingsResult.reason?.message || "خطأ غير معروف"));
    if (statsResult.status === "fulfilled") setStats(statsResult.value as Stats);
    else toast.error("تعذر تحميل الإحصائيات: " + (statsResult.reason?.message || "خطأ غير معروف"));
    if (subsResult.status === "fulfilled") setSubs(subsResult.value as SubscriptionRow[]);
    else toast.error("تعذر تحميل سجل الاشتراكات: " + (subsResult.reason?.message || "خطأ غير معروف"));
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!session) {
      setAuthorized(false);
      return;
    }
    (async () => {
      try {
        const [{ data: viewData, error: viewError }, { data: adminData }] = await Promise.all([
          (supabase as any).rpc("has_subscription_admin_access", { p_user_id: session.user.id }),
          (supabase as any).rpc("has_admin_access", { p_user_id: session.user.id }),
        ]);
        if (!viewError && viewData) {
          setAuthorized(true);
          setCanManage(adminData === true);
          loadAll();
        } else {
          setAuthorized(false);
        }
      } catch {
        setAuthorized(false);
      }
    })();
  }, [session, loading, loadAll]);

  if (loading) return <Loader2 className="h-8 w-8 animate-spin mx-auto mt-20" />;
  if (authorized === false) return <Navigate to="/auth" />;
  if (authorized !== true) return <Loader2 className="h-8 w-8 animate-spin mx-auto mt-20" />;

  return (
    <div className="min-h-screen bg-background p-4 pb-20 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <Link to="/admin" className="glass rounded-xl p-2">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-lg font-black flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          نظام الاشتراكات
        </h1>
      </div>
      <div className="flex gap-1 mb-4 glass rounded-2xl p-1">
        {["overview", "plans", "subscriptions", "grant", "broadcast", "settings"].filter(t => canManage || ["overview","subscriptions"].includes(t)).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 rounded-xl text-xs font-bold transition ${tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
          >
            {t === "overview"
              ? "نظرة عامة"
              : t === "plans"
                ? "الباقات"
                : t === "subscriptions"
                  ? "المشتركون"
                  : t === "grant"
                    ? "منح اشتراك"
                    : t === "broadcast"
                      ? "رسالة عامة"
                      : "الإعدادات"}
          </button>
        ))}
      </div>
      {tab === "overview" && <OverviewTab stats={stats} settings={settings} />}
      {tab === "plans" && (
        <PlansTab
          plans={plans}
          onEdit={(p: Plan) => {
            setEditingPlan(p);
            setShowEditModal(true);
          }}
          onToggle={async (id: string, isActive: boolean) => {
            try {
              await adminTogglePlan({ data: { id, is_active: isActive } });
              toast.success(isActive ? "تم تفعيل الباقة" : "تم إيقاف الباقة");
              loadAll();
            } catch (e: any) {
              toast.error(e.message);
            }
          }}
          onNew={() => {
            setEditingPlan(null);
            setShowEditModal(true);
          }}
        />
      )}
      {tab === "subscriptions" && <SubscriptionsTab subs={subs} onRefresh={loadAll} canManage={canManage} />}
      {tab === "grant" && <GrantSubscriptionTab plans={plans} onGranted={() => { loadAll(); setGrantRefresh((v) => v + 1); }} refreshKey={grantRefresh} />}
      {tab === "broadcast" && <BroadcastTab />}
      {tab === "settings" && (
        <SettingsTab
          settings={settings}
          onSave={async (enabled: boolean, minDownloads: number) => {
            try {
              await adminSaveSettings({
                data: {
                  subscription_enabled: enabled,
                  minimum_downloads_before_activation: minDownloads,
                },
              });
              toast.success("تم حفظ الإعدادات");
              loadAll();
            } catch (e: any) {
              toast.error(e.message);
            }
          }}
        />
      )}
      {showEditModal && (
        <PlanEditModal
          plan={editingPlan}
          onClose={() => setShowEditModal(false)}
          onSave={async (planData: Partial<Plan>) => {
            try {
              await adminSavePlan({ data: { id: editingPlan?.id, plan: planData } });
              toast.success(editingPlan ? "تم تحديث الباقة" : "تم إنشاء الباقة");
              setShowEditModal(false);
              loadAll();
            } catch (e: any) {
              toast.error(e.message);
            }
          }}
        />
      )}
    </div>
  );
}

function OverviewTab({ stats, settings }: { stats: Stats | null; settings: any }) {
  if (!stats || !settings) return <Loader2 className="h-6 w-6 animate-spin mx-auto" />;
  const enabled = settings?.subscription_enabled ?? false;
  return (
    <div className="space-y-4">
      <div className={`glass rounded-2xl p-4 ${enabled ? "border-2 border-emerald-500" : ""}`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="font-black text-sm">حالة نظام الاشتراكات</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {enabled ? "مُفعّل — يعمل النظام" : "مُعطّل — الجميع يعمل مجاناً"}
            </div>
          </div>
          {enabled ? (
            <ToggleRight className="h-10 w-10 text-emerald-500" />
          ) : (
            <ToggleLeft className="h-10 w-10 text-muted-foreground" />
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <StatCard icon={Users} label="إجمالي المشتركين" value={stats.totalSubscribers} />
        <StatCard
          icon={TrendingUp}
          label="اشتراكات نشطة"
          value={stats.activeSubscriptions}
          accent="text-emerald-600"
        />
        <StatCard
          icon={AlertCircle}
          label="اشتراكات منتهية"
          value={stats.expiredSubscriptions}
          accent="text-red-500"
        />
        <StatCard
          icon={Calendar}
          label="أرباح شهرية"
          value={stats.monthlyRevenue ? `${stats.monthlyRevenue.toLocaleString()} د.ع` : "—"}
          accent="text-amber-600"
        />
      </div>
      <div className="glass rounded-2xl p-4">
        <div className="font-black text-sm mb-3">الأرباح السنوية</div>
        <div className="text-2xl font-black text-amber-600">
          {stats.yearlyRevenue ? `${stats.yearlyRevenue.toLocaleString()} د.ع` : "—"}
        </div>
      </div>
      <div className="glass rounded-2xl p-4">
        <div className="font-black text-sm mb-3">توزيع المشتركين</div>
        <div className="space-y-2">
          <PlanCountRow label="برونزي" count={stats.bronzeCount} color="bg-orange-500" />
          <PlanCountRow label="فضي" count={stats.silverCount} color="bg-slate-400" />
          <PlanCountRow label="ذهبي" count={stats.goldCount} color="bg-amber-400" />
          <PlanCountRow label="تجريبي" count={stats.trialCount ?? 0} color="bg-violet-500" />
          <PlanCountRow label="مجاني" count={stats.freeCount} color="bg-slate-300" />
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, accent }: any) {
  return (
    <div className="glass rounded-2xl p-4">
      <Icon className={`h-5 w-5 mb-2 ${accent ?? "text-primary"}`} />
      <div className="text-xl font-black">{value ?? "—"}</div>
      <div className="text-[10px] text-muted-foreground font-bold mt-0.5">{label}</div>
    </div>
  );
}
function PlanCountRow({ label, count, color }: any) {
  return (
    <div className="flex items-center justify-between text-sm">
      <div className="flex items-center gap-2">
        <span className={`h-3 w-3 rounded-full ${color}`} />
        <span className="font-bold">{label}</span>
      </div>
      <span className="font-black">{count}</span>
    </div>
  );
}

function PlansTab({ plans, onEdit, onToggle, onNew }: any) {
  return (
    <div className="space-y-3">
      <button
        onClick={onNew}
        className="w-full glass rounded-2xl p-3 flex items-center justify-center gap-2 text-sm font-bold text-primary border-2 border-dashed border-primary/30"
      >
        <Plus className="h-4 w-4" /> إضافة باقة جديدة
      </button>
      {plans.map((p: Plan) => (
        <div key={p.id} className={`glass rounded-2xl p-4 ${!p.is_active ? "opacity-50" : ""}`}>
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-2">
              {p.tier === 0 ? (
                <Sparkles className="h-5 w-5 text-slate-400" />
              ) : p.tier === 1 ? (
                <Award className="h-5 w-5 text-slate-300" />
              ) : (
                <Crown className="h-5 w-5 text-amber-500" />
              )}
              <div>
                <div className="font-black text-sm">{p.name_ar}</div>
                <div className="text-[10px] text-muted-foreground">{p.code}</div>
              </div>
            </div>
            <button onClick={() => onToggle(p.id, !p.is_active)} className="text-xs">
              {p.is_active ? (
                <ToggleRight className="h-7 w-7 text-emerald-500" />
              ) : (
                <ToggleLeft className="h-7 w-7 text-muted-foreground" />
              )}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs mb-3">
            <Feature
              icon={Star}
              label="طلبات/شهر"
              value={
                p.max_requests_per_month == null ? "غير محدود" : String(p.max_requests_per_month)
              }
            />
            <Feature icon={TrendingUp} label="أولوية الظهور" value={String(p.priority_weight)} />
            <Feature icon={BadgeCheck} label="الشارة" value={p.badge_label ?? "—"} />
            <Feature icon={BarChart3} label="الإحصائيات" value={p.show_stats ? "نعم" : "لا"} />
            <Feature
              icon={Headphones}
              label="الدعم المميز"
              value={p.priority_support ? "نعم" : "لا"}
            />
            <Feature icon={TrendingUp} label="أولوية العروض" value={String(p.offer_priority)} />
          </div>
          <div className="flex items-center justify-between text-xs mb-3">
            <span className="text-muted-foreground">
              شهري:{" "}
              <span className="font-black text-foreground">
                {p.monthly_price.toLocaleString()} د.ع
              </span>
            </span>
            <span className="text-muted-foreground">
              سنوي:{" "}
              <span className="font-black text-foreground">
                {p.yearly_price.toLocaleString()} د.ع
              </span>
            </span>
          </div>
          <button
            onClick={() => onEdit(p)}
            className="w-full py-2 rounded-xl bg-primary/10 text-primary text-xs font-bold"
          >
            تعديل الباقة
          </button>
        </div>
      ))}
    </div>
  );
}

function Feature({ icon: Icon, label, value }: any) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-bold">{value}</span>
    </div>
  );
}

function SubscriptionsTab({ subs, onRefresh, canManage }: { subs: SubscriptionRow[]; onRefresh: () => void; canManage: boolean }) {
  const [filter, setFilter] = useState("all");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [days, setDays] = useState<Record<string, number>>({});
  const filtered = subs.filter((s) => filter === "all" || (filter === "company" ? s.grant_type === "admin" : filter === "trial" ? s.is_trial || s.grant_type === "trial" : s.plan?.code === filter));
  async function changeStatus(s: SubscriptionRow, status: "active" | "paused" | "cancelled") {
    const confirmText = status === "cancelled" ? "متأكد تريد إلغاء الاشتراك نهائياً؟" : status === "paused" ? "توقف الاشتراك واستقبال الطلبات الجديدة؟" : "تريد إعادة تفعيل الاشتراك؟";
    if (!window.confirm(confirmText)) return;
    setBusyId(s.id);
    try { await adminSetSubscriptionStatus({ data: { user_id: s.user_id, status } }); toast.success(status === "paused" ? "تم إيقاف الاشتراك فعلياً" : status === "active" ? "تم تفعيل الاشتراك فعلياً" : "تم إلغاء الاشتراك"); onRefresh(); }
    catch (e: any) { toast.error(e.message || "تعذر تحديث الاشتراك"); }
    finally { setBusyId(null); }
  }
  async function extend(s: SubscriptionRow) {
    const amount = Math.max(1, Math.min(3650, Number(days[s.id] ?? 30)));
    setBusyId(s.id);
    try { await adminExtendSubscription({ data: { user_id: s.user_id, days: amount } }); toast.success(`تم تمديد الاشتراك ${amount} يوم فعلياً`); onRefresh(); }
    catch (e: any) { toast.error(e.message || "تعذر تمديد الاشتراك"); }
    finally { setBusyId(null); }
  }
  return <div className="space-y-3">
    <div className="glass rounded-2xl p-3">
      <div className="font-black text-sm mb-2">سجل الاشتراكات الفعلي ({subs.length})</div>
      {canManage && <button disabled={bulkBusy || !subs.some(s => s.status === "active")} onClick={async () => { if (!window.confirm("سيتم إيقاف جميع الاشتراكات النشطة حالياً ومنع استقبال طلبات جديدة. متأكد؟")) return; setBulkBusy(true); try { const result = await adminPauseAllSubscriptions(); toast.success("تم إيقاف " + result.count + " اشتراك فعلياً"); onRefresh(); } catch(e:any) { toast.error(e.message || "تعذر إيقاف الاشتراكات"); } finally { setBulkBusy(false); } }} className="w-full rounded-xl bg-red-600 text-white py-2.5 text-xs font-black disabled:opacity-50">{bulkBusy ? "جارٍ إيقاف الاشتراكات..." : "إيقاف جميع الاشتراكات النشطة"}</button>}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {[["all","الكل"],["company","اشتراكات ممنوحة من الشركة"],["bronze","برونزي"],["silver","فضي"],["gold","ذهبي"],["trial","تجريبي"]].map(([key,label]) =>
          <button key={key} onClick={() => setFilter(key)} className={`rounded-xl px-2 py-2 text-[11px] font-bold ${filter===key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{label}</button>
        )}
      </div>
    </div>
    {filtered.length === 0 ? <div className="glass rounded-2xl p-8 text-center text-sm text-muted-foreground">ماكو اشتراكات ضمن هذا التصنيف</div> :
    filtered.map((s) => {
      const name = s.profile?.full_name || s.profile?.phone || s.profile?.email || s.user_id;
      const grantLabel = s.grant_type === "admin" ? "منحة من شركة ممنون" : s.is_trial || s.grant_type === "trial" ? "تجربة مجانية" : s.grant_type === "paid" ? "اشتراك مدفوع" : s.grant_type || "—";
      const statusLabel = s.status === "active" ? "نشط" : s.status === "paused" ? "موقوف مؤقتاً" : s.status === "expired" ? "منتهي" : s.status === "cancelled" ? "ملغي" : s.status;
      return <div key={s.id} className="glass rounded-2xl p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0"><div className="font-black text-sm">{name}</div><div className="text-[10px] text-muted-foreground break-all" dir="ltr">{s.profile?.email || "لا يوجد بريد مسجل"}</div><div className="text-[10px] text-muted-foreground" dir="ltr">{s.profile?.phone || ""}</div></div>
          <span className={`shrink-0 text-[10px] font-bold px-2 py-1 rounded-full ${s.status === "active" ? "bg-emerald-100 text-emerald-700" : s.status === "paused" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>{statusLabel}</span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div><span className="text-muted-foreground">الباقة: </span><b>{s.plan?.name_ar || "—"}</b></div>
          <div><span className="text-muted-foreground">نوع الاشتراك: </span><b>{grantLabel}</b></div>
          <div><span className="text-muted-foreground">بداية الفترة: </span><b>{new Date(s.current_period_start).toLocaleDateString("ar-IQ")}</b></div>
          <div><span className="text-muted-foreground">نهاية الفترة: </span><b>{s.current_period_end ? new Date(s.current_period_end).toLocaleDateString("ar-IQ") : "دائم"}</b></div>
          <div><span className="text-muted-foreground">الطلبات: </span><b>{s.request_count}</b></div>
          <div><span className="text-muted-foreground">إيقاف عند النهاية: </span><b>{s.cancel_at_period_end ? "نعم" : "لا"}</b></div>
        </div>
        {canManage && <div className="border-t border-border pt-3 space-y-2">
          <div className="text-xs font-black">إدارة الاشتراك من لوحة الأدمن</div>
          <div className="grid grid-cols-2 gap-2">
            {s.status === "active" ? <button disabled={!!busyId} onClick={() => changeStatus(s,"paused")} className="rounded-xl bg-amber-500/10 text-amber-700 py-2 text-xs font-bold disabled:opacity-50">إيقاف مؤقت</button> : <button disabled={!!busyId || (s.current_period_end != null && new Date(s.current_period_end).getTime() <= Date.now())} onClick={() => changeStatus(s,"active")} className="rounded-xl bg-emerald-500/10 text-emerald-700 py-2 text-xs font-bold disabled:opacity-50">تفعيل الاشتراك</button>}
            <button disabled={!!busyId || s.status === "cancelled"} onClick={() => changeStatus(s,"cancelled")} className="rounded-xl bg-red-500/10 text-red-700 py-2 text-xs font-bold disabled:opacity-50">إلغاء الاشتراك</button>
          </div>
          <div className="flex gap-2">
            <input type="number" min={1} max={3650} value={days[s.id] ?? 30} onChange={(e) => setDays(v => ({...v,[s.id]:Number(e.target.value)}))} className="input-base w-24 text-center" aria-label="عدد أيام التمديد" />
            <button disabled={!!busyId || Number(days[s.id] ?? 30) < 1 || Number(days[s.id] ?? 30) > 3650} onClick={() => extend(s)} className="flex-1 rounded-xl bg-primary text-primary-foreground py-2 text-xs font-bold disabled:opacity-50">{busyId === s.id ? "جارٍ التنفيذ..." : "تمديد الاشتراك بالأيام"}</button>
          </div>
        </div>}
      </div>;
    })}
  </div>;
}

function GrantSubscriptionTab({ plans, onGranted }: { plans: Plan[]; onGranted: () => void; refreshKey: number }) {
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<any[]>([]);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [planCode, setPlanCode] = useState("bronze");
  const [duration, setDuration] = useState("month");
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searched, setSearched] = useState(false);
  const activePlans = plans.filter((p) => p.is_active && ["bronze", "silver", "gold"].includes(p.code));
  async function searchUsers() {
    if (query.trim().length < 2) { toast.error("اكتب الاسم أو البريد أو رقم الهاتف"); return; }
    setSearching(true); setSearched(false); setSelectedUser(null); setSelectedUserIds([]);
    try {
      const result = await adminSearchSubscriptionUsers({ data: { query: query.trim() } });
      setUsers(result as any[]); setSearched(true);
      if (!(result as any[]).length) toast.error("ما لكينا مقدم خدمة مطابق");
    } catch (e: any) { toast.error(e.message || "فشل البحث"); }
    finally { setSearching(false); }
  }
  async function grantBulk() {
    if (!selectedUserIds.length) { toast.error("حدد حساباً واحداً على الأقل"); return; }
    setSaving(true);
    try { const result = await adminGrantSubscriptionsBulk({ data: { user_ids: selectedUserIds, plan_code: planCode as any, duration: duration as any } }); toast.success("تم منح الاشتراك لـ " + result.count + " حساب"); setSelectedUserIds([]); setUsers([]); setQuery(""); setSearched(false); onGranted(); }
    catch(e:any) { toast.error(e.message || "تعذر منح الاشتراكات المحددة"); }
    finally { setSaving(false); }
  }
  async function grant() {
    if (!selectedUser) { toast.error("اختَر مقدم الخدمة أولاً"); return; }
    setSaving(true);
    try {
      await adminGrantSubscription({ data: { user_id: selectedUser.id, plan_code: planCode as any, duration: duration as any } });
      toast.success("تم منح الاشتراك مجاناً بنجاح");
      setSelectedUser(null); setUsers([]); setQuery(""); setSearched(false);
      onGranted();
    } catch (e: any) { toast.error(e.message || "تعذر منح الاشتراك"); }
    finally { setSaving(false); }
  }
  return <div className="space-y-4">
    <div className="glass rounded-2xl p-4">
      <div className="flex items-center gap-2 font-black text-sm mb-2"><UserPlus className="h-5 w-5 text-primary" /> منح اشتراك مجاني لمقدم خدمة</div>
      <p className="text-xs text-muted-foreground leading-6">ابحث بالاسم أو البريد الإلكتروني أو رقم الهاتف، ثم اختر حساب الفني أو السائق والباقة والمدة. لا يتم تحصيل أي مبلغ من المستخدم.</p>
      <div className="flex gap-2 mt-3">
        <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") searchUsers(); }} placeholder="الاسم أو البريد أو رقم الهاتف" className="input-base flex-1 min-w-0" />
        <button onClick={searchUsers} disabled={searching} className="rounded-xl bg-primary text-primary-foreground px-4 font-bold text-xs disabled:opacity-50">{searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}</button>
      </div>
      {searched && users.length > 0 && <div className="space-y-2 mt-3">
        <button onClick={() => setSelectedUserIds(selectedUserIds.length === users.length ? [] : users.map(u => u.id))} className="w-full rounded-xl border border-primary/40 py-2 text-xs font-black">{selectedUserIds.length === users.length ? "إلغاء تحديد الكل" : "تحديد كل نتائج البحث"} ({selectedUserIds.length}/{users.length})</button>
        {users.map((u) => <div key={u.id} className={`w-full text-right rounded-xl border p-3 ${selectedUserIds.includes(u.id) || selectedUser?.id === u.id ? "border-primary bg-primary/10" : "border-border"}`}>
          <label className="flex items-center gap-2 text-xs font-bold mb-1"><input type="checkbox" checked={selectedUserIds.includes(u.id)} onChange={(e) => setSelectedUserIds(current => e.target.checked ? [...current,u.id] : current.filter(id => id !== u.id))} /> تحديد لمنح جماعي</label>
          <button className="w-full text-right" onClick={() => setSelectedUser(u)}>
          <div className="text-sm font-bold">{u.full_name || "بدون اسم"}</div>
          <div className="text-[11px] text-muted-foreground" dir="ltr">{u.email || u.phone || u.id}</div>
          {u.email && u.phone && <div className="text-[10px] text-muted-foreground" dir="ltr">{u.phone}</div>}
          </button>
        </div>)}
        <button onClick={grantBulk} disabled={saving || selectedUserIds.length===0 || activePlans.length===0} className="w-full rounded-xl bg-amber-500 text-white py-3 text-xs font-black disabled:opacity-50">{saving ? "جارٍ المنح..." : "منح الباقة المحددة لكل الحسابات المحددة ("+selectedUserIds.length+")"}</button>
      </div>}
    </div>
    {selectedUser && <div className="glass rounded-2xl p-4 space-y-3">
      <div className="font-black text-sm">الحساب المحدد: {selectedUser.full_name || selectedUser.email || selectedUser.phone}</div>
      <label className="block"><span className="text-xs font-bold text-muted-foreground">الباقة</span><select value={planCode} onChange={(e) => setPlanCode(e.target.value)} className="input-base mt-1">{activePlans.map((p) => <option key={p.id} value={p.code}>{p.name_ar} — {p.monthly_price.toLocaleString("ar-IQ")} د.ع / شهر</option>)}</select></label>
      <label className="block"><span className="text-xs font-bold text-muted-foreground">مدة الاشتراك المجاني</span><select value={duration} onChange={(e) => setDuration(e.target.value)} className="input-base mt-1"><option value="month">شهر واحد</option><option value="two_months">شهران</option><option value="year">سنة كاملة</option><option value="permanent">دائم</option></select></label>
      <button onClick={grant} disabled={saving || activePlans.length === 0} className="w-full rounded-xl bg-primary text-primary-foreground py-3 text-sm font-black disabled:opacity-50">{saving ? <Loader2 className="inline h-4 w-4 animate-spin ml-2" /> : <UserPlus className="inline h-4 w-4 ml-2" />}منح الاشتراك مجاناً</button>
      {activePlans.length === 0 && <p className="text-xs text-destructive">لا توجد باقات برونزية أو فضية أو ذهبية مفعّلة حالياً.</p>}
    </div>}
  </div>;
}


function BroadcastTab() {
  const [target,setTarget]=useState("all");
  const [title,setTitle]=useState("");
  const [body,setBody]=useState("");
  const [busy,setBusy]=useState(false);
  return <div className="glass rounded-2xl p-4 space-y-3">
    <div className="font-black text-sm">رسالة رسمية من شركة ممنون</div>
    <p className="text-xs text-muted-foreground leading-6">تصل كإشعار رسمي منبثق وتبقى في مركز الإشعارات لمدة 24 ساعة.</p>
    <label className="block text-xs font-bold">المستلمون<select value={target} onChange={e=>setTarget(e.target.value)} className="input-base mt-1"><option value="all">جميع المستخدمين</option><option value="worker">الفنيون</option><option value="large_driver">أصحاب الكيات</option><option value="driver">سائقو التكسي</option></select></label>
    <label className="block text-xs font-bold">عنوان الرسالة<input value={title} onChange={e=>setTitle(e.target.value)} maxLength={100} className="input-base mt-1" placeholder="عنوان الإعلان"/></label>
    <label className="block text-xs font-bold">نص الرسالة<textarea value={body} onChange={e=>setBody(e.target.value)} maxLength={1500} rows={4} className="input-base mt-1" placeholder="اكتب رسالة ممنون الرسمية"/></label>
    <button disabled={busy || title.trim().length<2 || body.trim().length<2} onClick={async()=>{if(!window.confirm("إرسال الرسالة لجميع الفئة المحددة؟"))return;setBusy(true);try{const r=await adminBroadcastAnnouncement({data:{target:target as any,title,body}});toast.success("تم إرسال الرسالة إلى "+r.count+" حساب");setTitle("");setBody("");}catch(e:any){toast.error(e.message||"تعذر إرسال الرسالة");}finally{setBusy(false);}}} className="w-full rounded-xl bg-amber-500 text-white py-3 text-sm font-black disabled:opacity-50">{busy?"جارٍ الإرسال...":"إرسال الرسالة الرسمية"}</button>
  </div>;
}

function SettingsTab({ settings, onSave }: any) {
  const [enabled, setEnabled] = useState(false);
  const [minDownloads, setMinDownloads] = useState(100000);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (settings) {
      setEnabled(settings.subscription_enabled ?? false);
      setMinDownloads(settings.minimum_downloads_before_activation ?? 100000);
    }
  }, [settings]);
  return (
    <div className="space-y-4">
      <div className="glass rounded-2xl p-4">
        <div className="flex items-center justify-between mb-1">
          <div>
            <div className="font-black text-sm">تفعيل نظام الاشتراكات</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              عند الإيقاف: الجميع يعمل مجاناً بلا قيود
            </div>
          </div>
          <button onClick={() => setEnabled(!enabled)}>
            {enabled ? (
              <ToggleRight className="h-10 w-10 text-emerald-500" />
            ) : (
              <ToggleLeft className="h-10 w-10 text-muted-foreground" />
            )}
          </button>
        </div>
      </div>
      <div className="glass rounded-2xl p-4">
        <div className="font-black text-sm mb-2">الحد الأدنى للتحميلات قبل التفعيل</div>
        <div className="text-xs text-muted-foreground mb-3">
          عدد تحميلات التطبيق المطلوبة قبل بدء نظام الاشتراكات
        </div>
        <input
          type="number"
          value={minDownloads}
          onChange={(e) => setMinDownloads(Number(e.target.value))}
          className="w-full glass rounded-xl px-4 py-3 text-sm font-bold outline-none"
          min={0}
        />
      </div>
      <button
        onClick={async () => {
          setSaving(true);
          await onSave(enabled, minDownloads);
          setSaving(false);
        }}
        disabled={saving}
        className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}حفظ
        الإعدادات
      </button>
    </div>
  );
}

function PlanEditModal({ plan, onClose, onSave }: any) {
  const [form, setForm] = useState<any>(
    plan ?? {
      code: "",
      name_ar: "",
      name_en: "",
      description_ar: "",
      tier: 0,
      max_requests_per_month: 50,
      priority_weight: 0,
      offer_priority: 0,
      badge_label: "",
      badge_color: "",
      show_stats: false,
      priority_support: false,
      monthly_price: 0,
      yearly_price: 0,
      currency: "IQD",
      is_active: true,
      sort_order: 0,
    },
  );
  const [saving, setSaving] = useState(false);
  const upd = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  return (
    <div className="fixed inset-0 z-50 bg-black/50 grid place-items-center p-4 overflow-y-auto">
      <div className="glass rounded-3xl p-5 w-full max-w-md my-8 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-black">{plan ? "تعديل الباقة" : "إضافة باقة"}</h2>
          <button onClick={onClose}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-3">
          <Field label="الكود (بالإنجليزية)">
            <input
              value={form.code}
              onChange={(e) => upd("code", e.target.value)}
              className="input-base"
              disabled={!!plan}
            />
          </Field>
          <Field label="الاسم بالعربية">
            <input
              value={form.name_ar}
              onChange={(e) => upd("name_ar", e.target.value)}
              className="input-base"
            />
          </Field>
          <Field label="الاسم بالإنجليزية">
            <input
              value={form.name_en}
              onChange={(e) => upd("name_en", e.target.value)}
              className="input-base"
            />
          </Field>
          <Field label="الوصف">
            <textarea
              value={form.description_ar ?? ""}
              onChange={(e) => upd("description_ar", e.target.value)}
              className="input-base"
              rows={2}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="المستوى (Tier)">
              <input
                type="number"
                value={form.tier}
                onChange={(e) => upd("tier", Number(e.target.value))}
                className="input-base"
                min={0}
              />
            </Field>
            <Field label="حد الطلبات/شهر (فارغ=غير محدود)">
              <input
                type="number"
                value={form.max_requests_per_month ?? ""}
                onChange={(e) =>
                  upd(
                    "max_requests_per_month",
                    e.target.value === "" ? null : Number(e.target.value),
                  )
                }
                className="input-base"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="أولوية الظهور">
              <input
                type="number"
                value={form.priority_weight}
                onChange={(e) => upd("priority_weight", Number(e.target.value))}
                className="input-base"
                min={0}
              />
            </Field>
            <Field label="أولوية استقبال العروض">
              <input
                type="number"
                value={form.offer_priority}
                onChange={(e) => upd("offer_priority", Number(e.target.value))}
                className="input-base"
                min={0}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="نص الشارة">
              <input
                value={form.badge_label ?? ""}
                onChange={(e) => upd("badge_label", e.target.value)}
                className="input-base"
                placeholder="مثال: ذهبي"
              />
            </Field>
            <Field label="لون الشارة">
              <input
                value={form.badge_color ?? ""}
                onChange={(e) => upd("badge_color", e.target.value)}
                className="input-base"
                placeholder="#f59e0b"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="السعر الشهري (د.ع)">
              <input
                type="number"
                value={form.monthly_price}
                onChange={(e) => upd("monthly_price", Number(e.target.value))}
                className="input-base"
                min={0}
              />
            </Field>
            <Field label="السعر السنوي (د.ع)">
              <input
                type="number"
                value={form.yearly_price}
                onChange={(e) => upd("yearly_price", Number(e.target.value))}
                className="input-base"
                min={0}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="ترتيب العرض">
              <input
                type="number"
                value={form.sort_order}
                onChange={(e) => upd("sort_order", Number(e.target.value))}
                className="input-base"
                min={0}
              />
            </Field>
            <Field label="العملة">
              <input
                value={form.currency}
                onChange={(e) => upd("currency", e.target.value)}
                className="input-base"
              />
            </Field>
          </div>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.show_stats}
                onChange={(e) => upd("show_stats", e.target.checked)}
              />
              إظهار الإحصائيات
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.priority_support}
                onChange={(e) => upd("priority_support", e.target.checked)}
              />
              دعم فني مميز
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => upd("is_active", e.target.checked)}
              />
              مفعّلة
            </label>
          </div>
        </div>
        <button
          onClick={async () => {
            setSaving(true);
            await onSave(form);
            setSaving(false);
          }}
          disabled={saving}
          className="w-full mt-4 py-3 rounded-xl bg-primary text-primary-foreground font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}حفظ
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: any) {
  return (
    <div>
      <div className="text-[11px] font-bold text-muted-foreground mb-1">{label}</div>
      {children}
    </div>
  );
}
