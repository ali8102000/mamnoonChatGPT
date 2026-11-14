import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const checkSubscriptionAllowed = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as any).rpc("check_request_allowed", {
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

export const getUserSubscription = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as any).rpc("get_user_subscription", {
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

export const incrementUserRequestCount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await (supabaseAdmin as any).rpc("increment_request_count", { _user_id: userId });
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

export const adminGetPlans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireSubscriptionViewer(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as any)
      .from("subscription_plans")
      .select("*")
      .order("sort_order");
    if (error) throw new Error("Failed to load plans");
    return data ?? [];
  });

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

export const adminSavePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid().optional(),
        plan: planSchema,
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { id, plan } = data;

    if (id) {
      const { data: updated, error } = await (supabaseAdmin as any)
        .from("subscription_plans")
        .update(plan)
        .eq("id", id)
        .select()
        .maybeSingle();
      if (error) throw new Error("Failed to update plan");
      return updated;
    } else {
      const { data: created, error } = await (supabaseAdmin as any)
        .from("subscription_plans")
        .insert(plan)
        .select()
        .maybeSingle();
      if (error) throw new Error("Failed to create plan: " + error.message);
      return created;
    }
  });

export const adminTogglePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), is_active: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as any)
      .from("subscription_plans")
      .update({ is_active: data.is_active })
      .eq("id", data.id);
    if (error) throw new Error("Failed to toggle plan");
    return { ok: true };
  });

export const adminGetSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireSubscriptionViewer(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as any)
      .from("subscription_settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle();
    if (error) throw new Error("Failed to load settings");
    return data ?? { subscription_enabled: false, minimum_downloads_before_activation: 100000 };
  });

export const adminSaveSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        subscription_enabled: z.boolean(),
        minimum_downloads_before_activation: z.number().int().min(0),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as any)
      .from("subscription_settings")
      .update({
        subscription_enabled: data.subscription_enabled,
        minimum_downloads_before_activation: data.minimum_downloads_before_activation,
      })
      .eq("id", 1);
    if (error) throw new Error("Failed to save settings");
    return { ok: true };
  });

export const adminGetStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
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

export const adminGetSubscriptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireSubscriptionViewer(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as any)
      .from("user_subscriptions")
      .select(
        `
        id, user_id, status, billing_cycle, current_period_start, current_period_end,
        request_count, auto_renew, created_at, grant_type, granted_by, is_trial, paused_at, cancel_at_period_end,
        profile:profiles!user_subscriptions_user_id_fkey(full_name,email,phone),
        plan:subscription_plans(code, name_ar, tier)
      `,
      )
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error("تعذر تحميل سجل الاشتراكات: " + error.message);
    return data ?? [];
  });

export const adminAssignSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        user_id: z.string().uuid(),
        plan_id: z.string().uuid(),
        billing_cycle: z.enum(["monthly", "yearly"]).default("monthly"),
        period_days: z.number().int().min(1).max(365).default(30),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const periodEnd = new Date();
    periodEnd.setDate(periodEnd.getDate() + data.period_days);

    const { error: upErr } = await (supabaseAdmin as any).from("user_subscriptions").upsert(
      {
        user_id: data.user_id,
        plan_id: data.plan_id,
        status: "active",
        billing_cycle: data.billing_cycle,
        current_period_start: new Date().toISOString(),
        current_period_end: periodEnd.toISOString(),
        request_count: 0,
        resets_count_period_start: new Date().toISOString(),
        auto_renew: false,
      },
      { onConflict: "user_id" },
    );

    if (upErr) throw new Error("Failed to assign subscription: " + upErr.message);

    const { data: plan } = await (supabaseAdmin as any)
      .from("subscription_plans")
      .select("monthly_price, yearly_price")
      .eq("id", data.plan_id)
      .maybeSingle();

    const amount =
      data.billing_cycle === "yearly" ? (plan?.yearly_price ?? 0) : (plan?.monthly_price ?? 0);
    if (amount > 0) {
      await (supabaseAdmin as any).from("subscription_payments").insert({
        user_id: data.user_id,
        plan_id: data.plan_id,
        amount,
        billing_cycle: data.billing_cycle,
        status: "paid",
        period_start: new Date().toISOString(),
        period_end: periodEnd.toISOString(),
      });
    }

    return { ok: true };
  });


export const adminSearchSubscriptionUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ query: z.string().trim().min(2).max(100) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const rawTerm = data.query.trim().replace(/[,%()]/g, " ");
    // Normalize Arabic-Indic and Persian digits, then support common Iraqi
    // phone formats: 07..., 7..., 9647..., and +9647...
    const westernDigits = rawTerm.replace(/[٠-٩۰-۹]/g, (digit) => {
      const code = digit.charCodeAt(0);
      return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
    });
    const digits = westernDigits.replace(/\\D/g, "");
    const phoneVariants = new Set<string>();
    if (digits) {
      phoneVariants.add(digits);
      if (digits.startsWith("00")) phoneVariants.add(digits.slice(2));
      if (digits.startsWith("964")) {
        phoneVariants.add("+" + digits);
        phoneVariants.add("0" + digits.slice(3));
        phoneVariants.add(digits.slice(3));
      } else if (digits.startsWith("0")) {
        phoneVariants.add("964" + digits.slice(1));
        phoneVariants.add("+964" + digits.slice(1));
      } else if (digits.startsWith("7")) {
        phoneVariants.add("0" + digits);
        phoneVariants.add("964" + digits);
        phoneVariants.add("+964" + digits);
      }
    }
    const filters = [
      `email.ilike.%${rawTerm}%`,
      `full_name.ilike.%${rawTerm}%`,
      ...Array.from(phoneVariants).map((value) => `phone.ilike.%${value}%`),
      ...(digits ? [`email.ilike.%phone${digits}%`] : []),
    ];
    const { data: users, error } = await (supabaseAdmin as any)
      .from("profiles")
      .select("id,email,phone,full_name")
      .or(filters.join(","))
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error("تعذر البحث عن المستخدمين");
    const ids = (users ?? []).map((u: any) => u.id);
    if (!ids.length) return [];
    const { data: roles, error: rolesError } = await (supabaseAdmin as any)
      .from("user_roles").select("user_id,role").in("user_id", ids)
      .in("role", ["worker", "driver", "large_driver"]);
    if (rolesError) throw new Error("تعذر التحقق من نوع الحساب");
    const providerIds = new Set((roles ?? []).map((r: any) => r.user_id));
    return (users ?? []).filter((u: any) => providerIds.has(u.id));
  });

export const adminGrantSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    user_id: z.string().uuid(),
    plan_code: z.enum(["bronze", "silver", "gold"]),
    duration: z.enum(["month", "two_months", "year", "permanent"]),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: providerRoles, error: rolesError } = await (supabaseAdmin as any)
      .from("user_roles").select("role").eq("user_id", data.user_id)
      .in("role", ["worker", "driver", "large_driver"]);
    if (rolesError) throw new Error("تعذر التحقق من حساب مقدم الخدمة");
    if (!providerRoles?.length) throw new Error("يمكن منح الاشتراك للفنيين وسائقي التكسي والكيات فقط");
    const { data: subscriptionId, error } = await (context.supabase as any).rpc("admin_grant_subscription", {
      p_user_id: data.user_id,
      p_plan_code: data.plan_code,
      p_duration: data.duration,
    });
    if (error) throw new Error("فشل منح الاشتراك: " + error.message);
    return { ok: true, subscription_id: subscriptionId };
  });


export const adminSetSubscriptionStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
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

export const adminExtendSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
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


export const adminPauseAllSubscriptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { data, error } = await (context.supabase as any).rpc("admin_pause_all_subscriptions");
    if (error) throw new Error("تعذر إيقاف اشتراكات المشتركين: " + error.message);
    return { count: Number(data ?? 0) };
  });

export const adminGrantSubscriptionsBulk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
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

export const adminBroadcastAnnouncement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
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
