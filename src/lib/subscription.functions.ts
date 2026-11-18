import { createClientFn } from "@/lib/client-server-fn";
import { z } from "zod";

const planSchema = z.object({
  code: z.string().min(2).max(30),
  name_ar: z.string().min(1).max(100),
  name_en: z.string().min(1).max(100),
  description_ar: z.string().max(500).optional().nullable(),
  tier: z.number().int().min(0).max(100),
  max_requests_per_month: z.number().int().nullable(),
  priority_weight: z.number().int().min(0).max(1000),
  offer_priority: z.number().int().min(0).max(1000),
  badge_label: z.string().max(50).optional().nullable(),
  badge_color: z.string().max(20).optional().nullable(),
  show_stats: z.boolean(),
  priority_support: z.boolean(),
  monthly_price: z.number().int().min(0),
  yearly_price: z.number().int().min(0),
  currency: z.string().max(10).default("IQD"),
  is_active: z.boolean(),
  sort_order: z.number().int().min(0).max(1000),
});


export const checkSubscriptionAllowed = createClientFn({ method: "GET" })
  .handler(async ({ context }) => {
    const { userId, supabase } = context;
    const { data, error } = await (supabase as any).rpc("check_request_allowed", {
      _user_id: userId,
    });
    if (error) {
      console.error("[subscription] check_request_allowed failed:", error.message);
      return { allowed: false, reason: "subscription_check_failed", planCode: "free", requestsUsed: 0, requestsLimit: null };
    }
    if (!data || data.length === 0) {
      return { allowed: false, reason: "subscription_required", planCode: "free", requestsUsed: 0, requestsLimit: null };
    }
    const row = data[0];
    return {
      allowed: row.allowed,
      reason: row.reason,
      planCode: row.plan_code,
      requestsUsed: row.requests_used,
      requestsLimit: row.requests_limit,
    };
  });

export const getUserSubscription = createClientFn({ method: "GET" })
  .handler(async ({ context }) => {
    const { userId, supabase } = context;
    const { data, error } = await (supabase as any).rpc("get_user_subscription", {
      _user_id: userId,
    });
    if (error || !data || data.length === 0) {
      return null;
    }
    const row = data[0];
    return {
      planCode: row.plan_code,
      planNameAr: row.plan_name_ar,
      tier: row.tier,
      maxRequestsPerMonth: row.max_requests_per_month,
      priorityWeight: row.priority_weight,
      offerPriority: row.offer_priority,
      badgeLabel: row.badge_label,
      badgeColor: row.badge_color,
      showStats: row.show_stats,
      prioritySupport: row.priority_support,
      status: row.status,
      currentPeriodEnd: row.current_period_end,
      requestCount: row.request_count,
      autoRenew: row.auto_renew,
      subscriptionEnabled: row.subscription_enabled,
    };
  });

export const incrementUserRequestCount = createClientFn({ method: "POST" })
  .handler(async ({ context }) => {
    const { error } = await (context.supabase as any).functions.invoke("increment-request-count", {
      body: {},
    });
    if (error) throw new Error("تعذر تحديث عداد الطلبات");
    return { ok: true };
  });

async function requireSubscriptionViewer(context: any) {
  const { supabase, userId } = context;
  const { data, error } = await (supabase as any).rpc("has_subscription_admin_access", { p_user_id: userId });
  if (error || !data) throw new Error("غير مصرّح: إدارة الاشتراكات للمدير والمالية فقط");
}

async function requireAdmin(context: any) {
  const { supabase, userId } = context;
  // Use the caller's authenticated JWT: admin checks depend on auth.uid().
  const { data, error } = await (supabase as any).rpc("has_admin_access", {
    p_user_id: userId,
  });
  if (error || !data) throw new Error("غير مصرّح: للمديرين فقط");
}

export const adminGetPlans = createClientFn({ method: "GET" })
  .handler(async ({ context }) => {
    const { data: result, error } = await (context.supabase as any).functions.invoke("admin-subscriptions", {
      body: { action: "plans" },
    });
    if (error || result?.error) throw new Error("تعذر تحميل الباقات");
    return result?.plans ?? [];
  });


export const adminSavePlan = createClientFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({ id: z.string().uuid().optional(), plan: planSchema }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context.supabase as any).functions.invoke("admin-subscriptions", {
      body: { action: "save_plan", id: data.id, plan: data.plan },
    });
    if (error || result?.error) throw new Error("تعذر حفظ الباقة");
    return result?.plan ?? null;
  });


export const adminTogglePlan = createClientFn({ method: "POST" })
  .inputValidator((d) => z.object({ id: z.string().uuid(), is_active: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context.supabase as any).functions.invoke("admin-subscriptions", {
      body: { action: "toggle_plan", id: data.id, is_active: data.is_active },
    });
    if (error || result?.error) throw new Error("تعذر تغيير حالة الباقة");
    return { ok: true };
  });


export const adminGetSettings = createClientFn({ method: "GET" })
  .handler(async ({ context }) => {
    const { data: result, error } = await (context.supabase as any).functions.invoke("admin-subscriptions", {
      body: { action: "settings" },
    });
    if (error || result?.error) throw new Error("تعذر تحميل إعدادات الاشتراكات");
    return result?.settings ?? { subscription_enabled: false, minimum_downloads_before_activation: 100000 };
  });


export const adminSaveSettings = createClientFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({
      subscription_enabled: z.boolean(),
      minimum_downloads_before_activation: z.number().int().min(0),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context.supabase as any).functions.invoke("admin-subscriptions", {
      body: { action: "save_settings", ...data },
    });
    if (error || result?.error) throw new Error("تعذر حفظ إعدادات الاشتراكات");
    return { ok: true };
  });


export const adminGetPayments = createClientFn({ method: "GET" })
  .handler(async ({ context }) => {
    const { data: result, error } = await (context.supabase as any).functions.invoke("admin-subscriptions", {
      body: { action: "payments" },
    });
    if (error || result?.error) throw new Error("تعذر تحميل سجل مدفوعات الاشتراكات");
    return result?.payments ?? { rows: [], totals: { paidCount: 0, paidAmount: 0, pendingCount: 0, failedCount: 0 } };
  });


export const adminGetStats = createClientFn({ method: "GET" })
  .handler(async ({ context }) => {
    await requireSubscriptionViewer(context);
    // This RPC checks auth.uid() through assert_staff, so use the caller JWT.
    const { data, error } = await (context.supabase as any).rpc("get_subscription_stats_v2");
    if (error) throw new Error("تعذر تحميل إحصائيات الاشتراكات: " + error.message);
    if (!data || data.length === 0) throw new Error("لا توجد بيانات إحصائية متاحة");
    const r = data[0];
    return {
      totalSubscribers: r.total_subscribers ?? 0,
      activeSubscriptions: r.active_subscriptions ?? 0,
      expiredSubscriptions: r.expired_subscriptions ?? 0,
      monthlyRevenue: r.monthly_revenue ?? 0,
      yearlyRevenue: r.yearly_revenue ?? 0,
      freeCount: r.free_count ?? 0,
      bronzeCount: r.bronze_count ?? 0,
      silverCount: r.silver_count ?? 0,
      goldCount: r.gold_count ?? 0,
      trialCount: r.trial_count ?? 0,
    };
  });

export const adminGetSubscriptions = createClientFn({ method: "GET" })
  .handler(async ({ context }) => {
    const { data: result, error } = await (context.supabase as any).functions.invoke("admin-subscriptions", {
      body: { action: "subscriptions" },
    });
    if (error || result?.error) throw new Error("تعذر تحميل سجل الاشتراكات");
    return result?.subscriptions ?? [];
  });


export const adminAssignSubscription = createClientFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({
      user_id: z.string().uuid(),
      plan_id: z.string().uuid(),
      billing_cycle: z.enum(["monthly", "yearly"]).default("monthly"),
      period_days: z.number().int().min(1).max(365).default(30),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context.supabase as any).functions.invoke("admin-subscriptions", {
      body: { action: "assign_subscription", ...data },
    });
    if (error || result?.error) throw new Error("Failed to assign subscription");
    return { ok: true };
  });


export const adminSearchSubscriptionUsers = createClientFn({ method: "POST" })
  .inputValidator((d) => z.object({ query: z.string().trim().min(2).max(100) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context.supabase as any).functions.invoke("admin-subscriptions", {
      body: { action: "search_users", query: data.query },
    });
    if (error || result?.error) throw new Error("تعذر البحث عن المستخدمين");
    return result?.users ?? [];
  });


export const adminGrantSubscription = createClientFn({ method: "POST" })
  .inputValidator((d) => z.object({
    user_id: z.string().uuid(),
    plan_code: z.enum(["bronze", "silver", "gold"]),
    duration: z.enum(["month", "two_months", "year", "permanent"]),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context.supabase as any).functions.invoke("admin-subscriptions", {
      body: { action: "grant_subscription", ...data },
    });
    if (error || result?.error) throw new Error("فشل منح الاشتراك");
    return { ok: true, subscription_id: result?.subscription_id ?? null };
  });


export const adminSetSubscriptionStatus = createClientFn({ method: "POST" })
  .inputValidator((d) => z.object({ user_id: z.string().uuid(), status: z.enum(["active", "paused", "cancelled"]) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { supabase } = context;
    const { data: changed, error } = await (supabase as any).rpc("admin_set_subscription_status", {
      p_user_id: data.user_id, p_status: data.status,
    });
    if (error) throw new Error(error.message);
    if (!changed) throw new Error("لم يتم العثور على اشتراك لهذا الحساب");
    return { ok: true };
  });

export const adminExtendSubscription = createClientFn({ method: "POST" })
  .inputValidator((d) => z.object({ user_id: z.string().uuid(), days: z.number().int().min(1).max(3650) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { supabase } = context;
    const { data: endAt, error } = await (supabase as any).rpc("admin_extend_subscription", {
      p_user_id: data.user_id, p_days: data.days,
    });
    if (error) throw new Error(error.message);
    return { ok: true, current_period_end: endAt };
  });


export const adminPauseAllSubscriptions = createClientFn({ method: "POST" })
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { data, error } = await (context.supabase as any).rpc("admin_pause_all_subscriptions");
    if (error) throw new Error("تعذر إيقاف اشتراكات المشتركين: " + error.message);
    return { count: Number(data ?? 0) };
  });

export const adminGrantSubscriptionsBulk = createClientFn({ method: "POST" })
  .inputValidator((d) => z.object({
    user_ids: z.array(z.string().uuid()).min(1).max(500),
    plan_code: z.enum(["bronze", "silver", "gold"]),
    duration: z.enum(["month", "two_months", "year", "permanent"]),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { data: count, error } = await (context.supabase as any).rpc("admin_grant_subscriptions_bulk", {
      p_user_ids: data.user_ids, p_plan_code: data.plan_code, p_duration: data.duration,
    });
    if (error) throw new Error("تعذر منح الاشتراكات للمحددين: " + error.message);
    return { count: Number(count ?? 0) };
  });

export const adminBroadcastAnnouncement = createClientFn({ method: "POST" })
  .inputValidator((d) => z.object({
    target: z.enum(["all", "worker", "large_driver", "driver"]),
    title: z.string().trim().min(2).max(100),
    body: z.string().trim().min(2).max(1500),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { data: count, error } = await (context.supabase as any).rpc("admin_broadcast_announcement", {
      p_target: data.target, p_title: data.title, p_body: data.body,
    });
    if (error) throw new Error("تعذر إرسال الرسالة العامة: " + error.message);
    return { count: Number(count ?? 0) };
  });
