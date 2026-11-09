import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type DbError = { message: string };
type DbResponse<T> = { data: T | null; error: DbError | null };
type SubscriptionQuery<T> = PromiseLike<DbResponse<T>> & {
  select(columns?: string): SubscriptionQuery<T>;
  order(column: string, options?: { ascending?: boolean }): SubscriptionQuery<T>;
  eq(column: string, value: string | number | boolean): SubscriptionQuery<T>;
  update(values: object): SubscriptionQuery<T>;
  insert(values: object): SubscriptionQuery<T>;
  upsert(values: object, options?: { onConflict?: string }): SubscriptionQuery<T>;
  maybeSingle(): Promise<DbResponse<T>>;
  limit(count: number): Promise<DbResponse<T>>;
};
type SubscriptionAdminClient = {
  rpc<T>(name: string, args?: Record<string, unknown>): Promise<DbResponse<T>>;
  from<T>(table: string): SubscriptionQuery<T>;
};
type AllowedRow = { allowed: boolean; reason: string; plan_code: string; requests_used: number; requests_limit: number | null };
type UserSubscriptionSummary = {
  plan_code: string; plan_name_ar: string; tier: number; max_requests_per_month: number | null;
  priority_weight: number; offer_priority: number; badge_label: string | null; badge_color: string | null;
  show_stats: boolean; priority_support: boolean; status: string; current_period_end: string | null;
  request_count: number; auto_renew: boolean; subscription_enabled: boolean;
};
type PlanRow = {
  id: string; code: string; name_ar: string; name_en: string; description_ar: string | null; tier: number;
  max_requests_per_month: number | null; priority_weight: number; offer_priority: number; badge_label: string | null;
  badge_color: string | null; show_stats: boolean; priority_support: boolean; monthly_price: number;
  yearly_price: number; currency: string; is_active: boolean; sort_order: number;
};
type SubscriptionStatsRow = {
  total_subscribers: number; active_subscriptions: number; expired_subscriptions: number; monthly_revenue: number;
  yearly_revenue: number; free_count: number; silver_count: number; gold_count: number;
};
type SubscriptionListRow = {
  id: string; user_id: string; status: string; billing_cycle: string; current_period_start: string;
  current_period_end: string | null; request_count: number; auto_renew: boolean; created_at: string;
  plan: { code: string; name_ar: string; tier: number } | null;
};

export const checkSubscriptionAllowed = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const adminDb = supabaseAdmin as unknown as SubscriptionAdminClient;
    const { data, error } = await adminDb.rpc<AllowedRow[]>("check_request_allowed", {
      _user_id: userId,
    });
    if (error || !data || data.length === 0) {
      return { allowed: true, reason: "system_disabled", planCode: "free", requestsUsed: 0, requestsLimit: null };
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
    const adminDb = supabaseAdmin as unknown as SubscriptionAdminClient;
    const { data, error } = await adminDb.rpc<UserSubscriptionSummary[]>("get_user_subscription", {
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
    const adminDb = supabaseAdmin as unknown as SubscriptionAdminClient;
    await adminDb.rpc("increment_request_count", { _user_id: userId });
    return { ok: true };
  });

async function requireAdmin(context: { userId: string }) {
  const { userId } = context;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const adminDb = supabaseAdmin as unknown as SubscriptionAdminClient;
  const { data } = await adminDb.rpc<boolean>("has_admin_access", {
    p_user_id: userId,
  });
  if (!data) throw new Error("غير مصرّح: للمديرين فقط");
}

export const adminGetPlans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const adminDb = supabaseAdmin as unknown as SubscriptionAdminClient;
    const { data, error } = await adminDb
      .from<PlanRow[]>("subscription_plans")
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
    z.object({
      id: z.string().uuid().optional(),
      plan: planSchema,
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const adminDb = supabaseAdmin as unknown as SubscriptionAdminClient;
    const { id, plan } = data;

    if (id) {
      const { data: updated, error } = await adminDb
        .from<PlanRow>("subscription_plans")
        .update(plan)
        .eq("id", id)
        .select()
        .maybeSingle();
      if (error) throw new Error("Failed to update plan");
      return updated;
    } else {
      const { data: created, error } = await adminDb
        .from<PlanRow>("subscription_plans")
        .insert(plan)
        .select()
        .maybeSingle();
      if (error) throw new Error("Failed to create plan: " + error.message);
      return created;
    }
  });

export const adminTogglePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ id: z.string().uuid(), is_active: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const adminDb = supabaseAdmin as unknown as SubscriptionAdminClient;
    const { error } = await adminDb
      .from("subscription_plans")
      .update({ is_active: data.is_active })
      .eq("id", data.id);
    if (error) throw new Error("Failed to toggle plan");
    return { ok: true };
  });

export const adminGetSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const adminDb = supabaseAdmin as unknown as SubscriptionAdminClient;
    const { data, error } = await adminDb
      .from<{ subscription_enabled: boolean; minimum_downloads_before_activation: number }>("subscription_settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle();
    if (error) throw new Error("Failed to load settings");
    return data ?? { subscription_enabled: false, minimum_downloads_before_activation: 100000 };
  });

export const adminSaveSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      subscription_enabled: z.boolean(),
      minimum_downloads_before_activation: z.number().int().min(0),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const adminDb = supabaseAdmin as unknown as SubscriptionAdminClient;
    const { error } = await adminDb
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
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const adminDb = supabaseAdmin as unknown as SubscriptionAdminClient;
    const { data, error } = await adminDb.rpc<SubscriptionStatsRow[]>("get_subscription_stats");
    if (error || !data || data.length === 0) {
      return { totalSubscribers: 0, activeSubscriptions: 0, expiredSubscriptions: 0, monthlyRevenue: 0, yearlyRevenue: 0, freeCount: 0, silverCount: 0, goldCount: 0 };
    }
    const r = data[0];
    return {
      totalSubscribers: r.total_subscribers ?? 0,
      activeSubscriptions: r.active_subscriptions ?? 0,
      expiredSubscriptions: r.expired_subscriptions ?? 0,
      monthlyRevenue: r.monthly_revenue ?? 0,
      yearlyRevenue: r.yearly_revenue ?? 0,
      freeCount: r.free_count ?? 0,
      silverCount: r.silver_count ?? 0,
      goldCount: r.gold_count ?? 0,
    };
  });

export const adminGetSubscriptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const adminDb = supabaseAdmin as unknown as SubscriptionAdminClient;
    const { data, error } = await adminDb
      .from<SubscriptionListRow[]>("user_subscriptions")
      .select(`
        id, user_id, status, billing_cycle, current_period_start, current_period_end,
        request_count, auto_renew, created_at,
        plan:subscription_plans(code, name_ar, tier)
      `)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error("Failed to load subscriptions");
    return data ?? [];
  });

export const adminAssignSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      user_id: z.string().uuid(),
      plan_id: z.string().uuid(),
      billing_cycle: z.enum(["monthly", "yearly"]).default("monthly"),
      period_days: z.number().int().min(1).max(365).default(30),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const adminDb = supabaseAdmin as unknown as SubscriptionAdminClient;

    const periodEnd = new Date();
    periodEnd.setDate(periodEnd.getDate() + data.period_days);

    const { error: upErr } = await adminDb
      .from("user_subscriptions")
      .upsert({
        user_id: data.user_id,
        plan_id: data.plan_id,
        status: "active",
        billing_cycle: data.billing_cycle,
        current_period_start: new Date().toISOString(),
        current_period_end: periodEnd.toISOString(),
        request_count: 0,
        resets_count_period_start: new Date().toISOString(),
        auto_renew: false,
      }, { onConflict: "user_id" });

    if (upErr) throw new Error("Failed to assign subscription: " + upErr.message);

    const { data: plan } = await adminDb
      .from<Pick<PlanRow, "monthly_price" | "yearly_price">>("subscription_plans")
      .select("monthly_price, yearly_price")
      .eq("id", data.plan_id)
      .maybeSingle();

    const amount = data.billing_cycle === "yearly" ? (plan?.yearly_price ?? 0) : (plan?.monthly_price ?? 0);
    if (amount > 0) {
      await adminDb.from<unknown[]>("subscription_payments").insert({
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
