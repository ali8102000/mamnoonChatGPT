import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.0";
import { getSupabasePublishableKey, getSupabaseSecretKey } from "../_shared/api-keys.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors });

const required = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error("missing_" + name);
  return value;
};

const isUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const durations = ["month", "two_months", "year", "permanent"] as const;
const plans = ["bronze", "silver", "gold"] as const;
const statuses = ["active", "paused", "cancelled"] as const;

function normalizeSearch(raw: string) {
  const term = raw.trim().replace(/[,%()]/g, " ").slice(0, 100);
  const western = term.replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
  const digits = western.replace(/\D/g, "");
  const phones = new Set<string>();
  if (digits) {
    phones.add(digits);
    if (digits.startsWith("00")) phones.add(digits.slice(2));
    if (digits.startsWith("964")) {
      phones.add("+" + digits);
      phones.add("0" + digits.slice(3));
      phones.add(digits.slice(3));
    } else if (digits.startsWith("0")) {
      phones.add("964" + digits.slice(1));
      phones.add("+964" + digits.slice(1));
    } else if (digits.startsWith("7")) {
      phones.add("0" + digits);
      phones.add("964" + digits);
      phones.add("+964" + digits);
    }
  }
  return { term, digits, phones: [...phones] };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const supabaseUrl = required("SUPABASE_URL");
    const anonKey = getSupabasePublishableKey();
    const serviceKey = getSupabaseSecretKey();
    const authHeader = req.headers.get("Authorization") || "";
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!bearer) return json({ error: "unauthorized" }, 401);

    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: "Bearer " + bearer } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await caller.auth.getUser(bearer);
    const user = authData?.user;
    if (authError || !user) return json({ error: "unauthorized" }, 401);

    const { data: canView, error: viewError } = await caller.rpc(
      "has_subscription_admin_access",
      { p_user_id: user.id },
    );
    if (viewError || canView !== true) return json({ error: "forbidden" }, 403);

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const body = await req.json().catch(() => null);
    if (!body || typeof body.action !== "string") return json({ error: "invalid_request" }, 400);

    const requireAdmin = async () => {
      const { data, error } = await caller.rpc("has_admin_access", { p_user_id: user.id });
      if (error || data !== true) throw new Error("admin_required");
    };

    if (body.action === "plans") {
      const { data, error } = await admin.from("subscription_plans").select("*").order("sort_order");
      if (error) return json({ error: "plans_load_failed" }, 500);
      return json({ plans: data ?? [] });
    }

    if (body.action === "settings") {
      const { data, error } = await admin.from("subscription_settings").select("*").eq("id", 1).maybeSingle();
      if (error) return json({ error: "settings_load_failed" }, 500);
      return json({ settings: data ?? { subscription_enabled: false, minimum_downloads_before_activation: 100000 } });
    }

    if (body.action === "payments") {
      const { data, error } = await admin.from("payment_transactions")
        .select("id,user_id,purpose,amount,currency,status,gateway_status,gateway_transaction_id,paid_at,created_at,profile:profiles!payment_transactions_user_id_fkey(full_name,email,phone),plan:subscription_plans(name_ar,code)")
        .eq("purpose", "subscription")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) return json({ error: "payments_load_failed" }, 500);
      const rows = data ?? [];
      return json({
        payments: {
          rows,
          totals: {
            paidCount: rows.filter((row: any) => row.status === "paid").length,
            paidAmount: rows.filter((row: any) => row.status === "paid").reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0),
            pendingCount: rows.filter((row: any) => row.status === "pending").length,
            failedCount: rows.filter((row: any) => ["failed", "expired", "refunded", "partially_refunded"].includes(row.status)).length,
          },
        },
      });
    }

    if (body.action === "subscriptions") {
      const { data, error } = await admin.from("user_subscriptions")
        .select("id, user_id, status, billing_cycle, current_period_start, current_period_end, request_count, auto_renew, created_at, grant_type, granted_by, is_trial, paused_at, cancel_at_period_end, profile:profiles!user_subscriptions_user_id_fkey(full_name,email,phone), plan:subscription_plans(code,name_ar,tier)")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) return json({ error: "subscriptions_load_failed" }, 500);
      return json({ subscriptions: data ?? [] });
    }


    if (body.action === "list") {
      const [plansResult, settingsResult, subscriptionsResult, paymentsResult, statsResult] =
        await Promise.all([
          admin.from("subscription_plans").select("*").order("sort_order"),
          admin.from("subscription_settings").select("*").eq("id", 1).maybeSingle(),
          admin.from("user_subscriptions").select(
            "id,user_id,status,billing_cycle,current_period_start,current_period_end,request_count,auto_renew,created_at,grant_type,granted_by,is_trial,paused_at,cancel_at_period_end,profile:profiles!user_subscriptions_user_id_fkey(full_name,email,phone),plan:subscription_plans(code,name_ar,tier)",
          ).order("created_at", { ascending: false }).limit(500),
          admin.from("payment_transactions").select(
            "id,user_id,purpose,amount,currency,status,gateway_status,gateway_transaction_id,paid_at,created_at,profile:profiles!payment_transactions_user_id_fkey(full_name,email,phone),plan:subscription_plans(name_ar,code)",
          ).eq("purpose", "subscription").order("created_at", { ascending: false }).limit(1000),
          caller.rpc("get_subscription_stats_v2"),
        ]);
      const failed = [plansResult, settingsResult, subscriptionsResult, paymentsResult]
        .find((result) => result.error);
      if (failed?.error) return json({ error: "subscription_data_load_failed" }, 500);
      if (statsResult.error) return json({ error: "subscription_stats_load_failed" }, 500);
      const payments = paymentsResult.data ?? [];
      return json({
        plans: plansResult.data ?? [],
        settings: settingsResult.data ?? {
          subscription_enabled: false,
          minimum_downloads_before_activation: 100000,
        },
        subscriptions: subscriptionsResult.data ?? [],
        payments: {
          rows: payments,
          totals: {
            paidCount: payments.filter((row: any) => row.status === "paid").length,
            paidAmount: payments.filter((row: any) => row.status === "paid")
              .reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0),
            pendingCount: payments.filter((row: any) => row.status === "pending").length,
            failedCount: payments.filter((row: any) =>
              ["failed", "expired", "refunded", "partially_refunded"].includes(row.status)
            ).length,
          },
        },
        stats: statsResult.data?.[0] ?? null,
        canManage: await (async () => {
          const { data } = await caller.rpc("has_admin_access", { p_user_id: user.id });
          return data === true;
        })(),
      });
    }

    if (body.action === "search_users") {
      await requireAdmin();
      if (typeof body.query !== "string" || body.query.trim().length < 2) {
        return json({ error: "query_too_short" }, 400);
      }
      const { term, digits, phones } = normalizeSearch(body.query);
      const filters = [
        `email.ilike.%${term}%`,
        `full_name.ilike.%${term}%`,
        ...phones.map((value) => `phone.ilike.%${value}%`),
        ...(digits ? [`email.ilike.%phone${digits}%`] : []),
      ];
      const { data: users, error } = await admin.from("profiles")
        .select("id,email,phone,full_name")
        .or(filters.join(","))
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) return json({ error: "user_search_failed" }, 500);
      const ids = (users ?? []).map((entry: any) => entry.id);
      if (!ids.length) return json({ users: [] });
      const { data: roles, error: rolesError } = await admin.from("user_roles")
        .select("user_id,role").in("user_id", ids)
        .in("role", ["worker", "driver", "large_driver"]);
      if (rolesError) return json({ error: "provider_role_lookup_failed" }, 500);
      const providerIds = new Set((roles ?? []).map((entry: any) => entry.user_id));
      return json({ users: (users ?? []).filter((entry: any) => providerIds.has(entry.id)) });
    }

    if (body.action === "save_plan") {
      await requireAdmin();
      if (!body.plan || typeof body.plan !== "object") return json({ error: "invalid_plan" }, 400);
      const p = body.plan;
      const requiredStrings = ["code", "name_ar", "name_en"];
      if (requiredStrings.some((key) => typeof p[key] !== "string" || !p[key].trim())) {
        return json({ error: "invalid_plan" }, 400);
      }
      if (!Number.isInteger(p.tier) || !Number.isInteger(p.monthly_price) ||
          !Number.isInteger(p.yearly_price) || !Number.isInteger(p.sort_order) ||
          typeof p.is_active !== "boolean" || p.currency !== "IQD") {
        return json({ error: "invalid_plan" }, 400);
      }
      const allowed = [
        "code","name_ar","name_en","description_ar","tier","max_requests_per_month",
        "priority_weight","offer_priority","badge_label","badge_color","show_stats",
        "priority_support","monthly_price","yearly_price","currency","is_active","sort_order",
        "governorate_limit","features",
      ];
      const clean = Object.fromEntries(Object.entries(p).filter(([key]) => allowed.includes(key)));
      const query = isUuid(body.id)
        ? admin.from("subscription_plans").update(clean).eq("id", body.id).select().maybeSingle()
        : admin.from("subscription_plans").insert(clean).select().maybeSingle();
      const { data, error } = await query;
      if (error) return json({ error: "plan_save_failed" }, 500);
      return json({ plan: data });
    }

    if (body.action === "toggle_plan") {
      await requireAdmin();
      if (!isUuid(body.id) || typeof body.is_active !== "boolean") {
        return json({ error: "invalid_request" }, 400);
      }
      const { error } = await admin.from("subscription_plans")
        .update({ is_active: body.is_active }).eq("id", body.id);
      if (error) return json({ error: "plan_toggle_failed" }, 500);
      return json({ ok: true });
    }

    if (body.action === "save_settings") {
      await requireAdmin();
      if (typeof body.subscription_enabled !== "boolean" ||
          !Number.isInteger(body.minimum_downloads_before_activation) ||
          body.minimum_downloads_before_activation < 0) {
        return json({ error: "invalid_settings" }, 400);
      }
      const { error } = await admin.from("subscription_settings")
        .update({
          subscription_enabled: body.subscription_enabled,
          minimum_downloads_before_activation: body.minimum_downloads_before_activation,
        }).eq("id", 1);
      if (error) return json({ error: "settings_save_failed" }, 500);
      return json({ ok: true });
    }

    if (body.action === "assign_subscription") {
      await requireAdmin();
      if (!isUuid(body.user_id) || !isUuid(body.plan_id) ||
          !["monthly", "yearly"].includes(body.billing_cycle) ||
          !Number.isInteger(body.period_days) || body.period_days < 1 || body.period_days > 365) {
        return json({ error: "invalid_request" }, 400);
      }
      const { data: plan, error: planError } = await admin.from("subscription_plans")
        .select("monthly_price,yearly_price").eq("id", body.plan_id).maybeSingle();
      if (planError) return json({ error: "subscription_plan_lookup_failed" }, 500);
      if (!plan) return json({ error: "subscription_plan_not_found" }, 404);
      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setDate(periodEnd.getDate() + body.period_days);
      const { error: upsertError } = await admin.from("user_subscriptions").upsert({
        user_id: body.user_id,
        plan_id: body.plan_id,
        status: "active",
        billing_cycle: body.billing_cycle,
        current_period_start: now.toISOString(),
        current_period_end: periodEnd.toISOString(),
        request_count: 0,
        resets_count_period_start: now.toISOString(),
        auto_renew: false,
      }, { onConflict: "user_id" });
      if (upsertError) return json({ error: "subscription_assign_failed" }, 500);
      const amount = body.billing_cycle === "yearly" ? (plan.yearly_price ?? 0) : (plan.monthly_price ?? 0);
      if (amount > 0) {
        const { error: paymentError } = await admin.from("subscription_payments").insert({
          user_id: body.user_id,
          plan_id: body.plan_id,
          amount,
          billing_cycle: body.billing_cycle,
          status: "paid",
          period_start: now.toISOString(),
          period_end: periodEnd.toISOString(),
        });
        if (paymentError) console.error("subscription_payment_record_failed", paymentError.message);
      }
      return json({ ok: true });
    }

    if (body.action === "grant_subscription") {
      await requireAdmin();
      if (!isUuid(body.user_id) || !plans.includes(body.plan_code) ||
          !durations.includes(body.duration)) return json({ error: "invalid_request" }, 400);
      const { data: providerRoles, error: roleError } = await admin.from("user_roles")
        .select("role").eq("user_id", body.user_id)
        .in("role", ["worker", "driver", "large_driver"]);
      if (roleError || !providerRoles?.length) return json({ error: "provider_account_required" }, 400);
      const { data, error } = await caller.rpc("admin_grant_subscription", {
        p_user_id: body.user_id,
        p_plan_code: body.plan_code,
        p_duration: body.duration,
      });
      if (error) return json({ error: "subscription_grant_failed", detail: error.message }, 400);
      return json({ ok: true, subscription_id: data });
    }

    if (body.action === "set_status") {
      await requireAdmin();
      if (!isUuid(body.user_id) || !statuses.includes(body.status)) {
        return json({ error: "invalid_request" }, 400);
      }
      const { data, error } = await caller.rpc("admin_set_subscription_status", {
        p_user_id: body.user_id,
        p_status: body.status,
      });
      if (error || data !== true) return json({ error: "subscription_status_update_failed" }, 400);
      return json({ ok: true });
    }

    if (body.action === "extend") {
      await requireAdmin();
      if (!isUuid(body.user_id) || !Number.isInteger(body.days) ||
          body.days < 1 || body.days > 3650) return json({ error: "invalid_request" }, 400);
      const { data, error } = await caller.rpc("admin_extend_subscription", {
        p_user_id: body.user_id,
        p_days: body.days,
      });
      if (error) return json({ error: "subscription_extend_failed" }, 400);
      return json({ ok: true, current_period_end: data });
    }

    if (body.action === "pause_all") {
      await requireAdmin();
      const { data, error } = await caller.rpc("admin_pause_all_subscriptions");
      if (error) return json({ error: "pause_all_failed" }, 400);
      return json({ count: Number(data ?? 0) });
    }

    if (body.action === "grant_bulk") {
      await requireAdmin();
      if (!Array.isArray(body.user_ids) || body.user_ids.length < 1 ||
          body.user_ids.length > 500 || !body.user_ids.every(isUuid) ||
          !plans.includes(body.plan_code) || !durations.includes(body.duration)) {
        return json({ error: "invalid_request" }, 400);
      }
      const { data, error } = await caller.rpc("admin_grant_subscriptions_bulk", {
        p_user_ids: body.user_ids,
        p_plan_code: body.plan_code,
        p_duration: body.duration,
      });
      if (error) return json({ error: "bulk_grant_failed" }, 400);
      return json({ count: Number(data ?? 0) });
    }

    if (body.action === "broadcast") {
      await requireAdmin();
      const targets = ["all", "worker", "large_driver", "driver"];
      if (!targets.includes(body.target) || typeof body.title !== "string" ||
          body.title.trim().length < 2 || body.title.length > 100 ||
          typeof body.body !== "string" || body.body.trim().length < 2 ||
          body.body.length > 1500) return json({ error: "invalid_request" }, 400);
      const { data, error } = await caller.rpc("admin_broadcast_announcement", {
        p_target: body.target,
        p_title: body.title.trim(),
        p_body: body.body.trim(),
      });
      if (error) return json({ error: "broadcast_failed" }, 400);
      return json({ count: Number(data ?? 0) });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (error) {
    const message = String(error);
    if (message.includes("missing_")) return json({ error: "server_configuration_incomplete" }, 503);
    if (message.includes("admin_required")) return json({ error: "admin_required" }, 403);
    return json({ error: "internal_error" }, 500);
  }
});
