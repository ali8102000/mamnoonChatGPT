import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.0";
import { getSupabasePublishableKey, getSupabaseSecretKey, createSupabaseFetch } from "../_shared/api-keys.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const publishable = getSupabasePublishableKey();
    const secret = getSupabaseSecretKey();
    if (!url || !secret) return json({ error: "server_configuration_incomplete" }, 503);
    const header = req.headers.get("Authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return json({ error: "unauthorized" }, 401);

    const caller = createClient(url, publishable, {
      global: { fetch: createSupabaseFetch(publishable), headers: { Authorization: "Bearer " + token } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth, error: authError } = await caller.auth.getUser(token);
    if (authError || !auth.user) return json({ error: "unauthorized" }, 401);
    const { data: isAdmin } = await caller.rpc("has_admin_access", { p_user_id: auth.user.id });
    const { data: isSuperAdmin } = await caller.rpc("is_super_admin", { p_user_id: auth.user.id });
    const { data: canAdjust } = await caller.rpc("admin_has_permission", {
      p_permission_key: "finance.wallet.adjust", p_scope_type: "global", p_scope_governorate: null,
    });
    if (isAdmin !== true && canAdjust !== true && isSuperAdmin !== true) return json({ error: "forbidden" }, 403);

    const admin = createClient(url, secret, {
      global: { fetch: createSupabaseFetch(secret) },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const body = await req.json().catch(() => null);
    if (!body || typeof body.action !== "string") return json({ error: "invalid_request" }, 400);

    if (body.action === "search_users") {
      const query = typeof body.query === "string" ? body.query.trim().slice(0, 100) : "";
      if (query.length < 2) return json({ error: "query_too_short" }, 400);
      const safe = query.replace(/[,%()]/g, " ");
      const { data: profiles, error } = await admin.from("profiles")
        .select("id,full_name,phone,email,governorate_key,created_at")
        .or(`full_name.ilike.%${safe}%,phone.ilike.%${safe}%,email.ilike.%${safe}%`)
        .order("created_at", { ascending: false }).limit(40);
      if (error) return json({ error: "user_search_failed" }, 500);
      const ids = (profiles ?? []).map((p: any) => p.id);
      const [{ data: roles }, { data: partners }, { data: wallets }] = await Promise.all([
        ids.length ? admin.from("user_roles").select("user_id,role").in("user_id", ids) : Promise.resolve({ data: [] }),
        ids.length ? admin.from("partner_business_profiles").select("user_id,partner_type,business_vertical,business_name").in("user_id", ids) : Promise.resolve({ data: [] }),
        ids.length ? admin.from("account_wallets").select("user_id,balance_iqd").in("user_id", ids) : Promise.resolve({ data: [] }),
      ]);
      const rolesMap = new Map<string,string[]>();
      for (const r of roles ?? []) rolesMap.set(r.user_id,[...(rolesMap.get(r.user_id) ?? []),String(r.role)]);
      const partnerMap = new Map((partners ?? []).map((p:any)=>[p.user_id,p]));
      const walletMap = new Map((wallets ?? []).map((w:any)=>[w.user_id,Number(w.balance_iqd)]));
      return json({ users: (profiles ?? []).map((p:any)=>({
        ...p, roles:rolesMap.get(p.id) ?? [], partner:partnerMap.get(p.id) ?? null,
        balance_iqd:walletMap.get(p.id) ?? 0,
      })) });
    }

    if (body.action === "wallet_adjust") {
      if (!uuid(body.user_id) || !Number.isSafeInteger(body.amount_iqd) || body.amount_iqd <= 0 ||
          !["credit","debit"].includes(body.type) || typeof body.note !== "string" ||
          body.note.trim().length < 2 || body.note.length > 500 ||
          typeof body.idempotency_key !== "string" || body.idempotency_key.length < 8 || body.idempotency_key.length > 200) {
        return json({ error: "invalid_wallet_adjustment" }, 400);
      }
      const { data, error } = await caller.rpc("admin_adjust_account_wallet", {
        p_user_id: body.user_id, p_amount_iqd: body.amount_iqd, p_type: body.type,
        p_note: body.note.trim(), p_idempotency_key: body.idempotency_key,
      });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, result: data });
    }

    if (body.action === "save_override") {
      if (isSuperAdmin !== true) return json({ error: "super_admin_required" }, 403);
      if (!uuid(body.user_id) || typeof body.charge_percent !== "number" ||
          !Number.isFinite(body.charge_percent) || body.charge_percent < 0 || body.charge_percent > 100 ||
          typeof body.reason !== "string" || body.reason.trim().length < 2 || body.reason.length > 500 ||
          (body.starts_at != null && (typeof body.starts_at !== "string" || !Number.isFinite(Date.parse(body.starts_at)))) ||
          (body.ends_at != null && (typeof body.ends_at !== "string" || !Number.isFinite(Date.parse(body.ends_at))))) {
        return json({ error: "invalid_user_override" }, 400);
      }
      const { data, error } = await caller.rpc("admin_set_user_fee_override", {
        p_user_id: body.user_id, p_charge_percent: body.charge_percent,
        p_starts_at: body.starts_at ?? null, p_ends_at: body.ends_at ?? null, p_reason: body.reason.trim(),
      });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, override_id: data });
    }

    if (body.action === "revoke_override") {
      if (isSuperAdmin !== true || !uuid(body.override_id)) return json({ error: "super_admin_required_or_invalid_id" }, 403);
      const { data, error } = await caller.rpc("admin_revoke_user_fee_override", { p_override_id: body.override_id });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: data === true });
    }

    if (body.action === "list") {
      if (isSuperAdmin !== true) return json({ error: "super_admin_required" }, 403);
      const [policies, overrides, revenue, collections] = await Promise.all([
        admin.from("mamnoon_commission_policies").select("*").order("created_at", { ascending: false }).limit(100),
        admin.from("mamnoon_user_fee_overrides").select("*").is("revoked_at", null).order("created_at", { ascending: false }).limit(200),
        admin.from("mamnoon_revenue_ledger").select("*").order("created_at", { ascending: false }).limit(200),
        admin.from("mamnoon_revenue_collections").select("id,revenue_ledger_id,payment_id,amount_iqd,provider_reference,created_at").order("created_at", { ascending: false }).limit(300),
      ]);
      if (policies.error || overrides.error || revenue.error || collections.error) return json({ error: "rights_data_load_failed" }, 500);
      const ids = [...new Set((overrides.data ?? []).map((r:any)=>r.user_id).concat((revenue.data ?? []).map((r:any)=>r.user_id)))];
      const { data: profiles } = ids.length ? await admin.from("profiles").select("id,full_name,phone").in("id",ids) : { data: [] };
      const byId = new Map((profiles ?? []).map((p:any)=>[p.id,p]));
      const { data: summary, error: summaryError } = await caller.rpc("admin_get_revenue_summary");
      if (summaryError) return json({ error: "revenue_summary_load_failed" }, 500);
      return json({
        summary: summary ?? {},
        policies: policies.data ?? [],
        overrides: (overrides.data ?? []).map((r:any)=>({...r,profile:byId.get(r.user_id) ?? null})),
        revenue: (revenue.data ?? []).map((r:any)=>({...r,profile:byId.get(r.user_id) ?? null})),
        collections: collections.data ?? [],
      });
    }

    if (body.action === "save_policy") {
      if (isSuperAdmin !== true) return json({ error: "super_admin_required" }, 403);
      const { data, error } = await caller.rpc("admin_save_commission_policy", {
        p_scope_type: body.scope_type, p_scope_key: body.scope_key ?? null,
        p_commission_rate_percent: body.commission_rate_percent,
        p_commission_charge_percent: body.commission_charge_percent,
        p_collection_event: body.collection_event,
        p_free_trial_enabled: body.free_trial_enabled === true,
        p_free_trial_days: body.free_trial_days,
        p_new_users_only: body.new_users_only === true,
        p_is_enabled: body.is_enabled === true,
        p_starts_at: body.starts_at ?? null, p_ends_at: body.ends_at ?? null,
      });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, policy_id: data });
    }

    return json({ error: "unknown_action" }, 400);
  } catch {
    return json({ error: "internal_error" }, 500);
  }
});
