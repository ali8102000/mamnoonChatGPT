import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors });
const required = (key: string) => {
  const value = Deno.env.get(key);
  if (!value) throw new Error("missing_" + key);
  return value;
};
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const targets = ["customers", "single", "customers_1", "customers_2", "customers_3", "customers_4", "customers_5"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const url = required("SUPABASE_URL");
    const anon = required("SUPABASE_ANON_KEY");
    const service = required("SUPABASE_SERVICE_ROLE_KEY");
    const authorization = req.headers.get("Authorization") || "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!token) return json({ error: "unauthorized" }, 401);

    const caller = createClient(url, anon, {
      global: { headers: { Authorization: "Bearer " + token } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth, error: authError } = await caller.auth.getUser(token);
    if (authError || !auth.user) return json({ error: "unauthorized" }, 401);
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const body = await req.json().catch(() => null);
    if (!body || typeof body.action !== "string") return json({ error: "invalid_request" }, 400);
    const requirePermission = async (permissionKey: string, scopeType = "global", scopeGovernorate: string | null = null) => {
      const { data: permission, error: permissionError } = await caller.rpc("admin_has_permission", {
        p_permission_key: permissionKey, p_scope_type: scopeType, p_scope_governorate: scopeGovernorate,
      });
      if (permissionError || permission !== true) throw new Error("permission_required:" + permissionKey);
    };
    const rpc = async (name: string, args: Record<string, unknown>) => {
      const { data, error } = await caller.rpc(name, args);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, data });
    };

    if (body.action === "search_users") {
      const { data: assignment } = await caller.from("staff_assignments")
        .select("scope_type,scope_governorate").eq("user_id", auth.user.id).eq("active", true).maybeSingle();
      const scopeType = assignment?.scope_type === "governorate" ? "governorate" : "global";
      const scopeGovernorate = scopeType === "governorate" ? assignment?.scope_governorate ?? null : null;
      await requirePermission("finance.wallet.adjust", scopeType, scopeGovernorate);
      const query = typeof body.query === "string" ? body.query.trim().slice(0, 80) : "";
      if (query.length < 2) return json({ error: "query_too_short" }, 400);
      const safe = query.replace(/[,%()]/g, " ");
      let search = admin.from("profiles").select("id,full_name,phone,email")
        .or(`full_name.ilike.%${safe}%,phone.ilike.%${safe}%,email.ilike.%${safe}%`);
      if (scopeType === "governorate" && scopeGovernorate) search = search.eq("governorate_key", scopeGovernorate);
      const { data, error } = await search.order("created_at", { ascending: false }).limit(30);
      if (error) return json({ error: "user_search_failed" }, 500);
      return json({ users: data ?? [] });
    }

    if (body.action === "list") {
      await requirePermission("finance.read");
      await requirePermission("promotions.read");
      const [transactions, coupons] = await Promise.all([
        admin.from("transactions").select("*, profiles!inner(full_name,phone)")
          .order("created_at", { ascending: false }).limit(200),
        admin.from("coupons").select("*").order("created_at", { ascending: false }).limit(200),
      ]);
      if (transactions.error || coupons.error) return json({ error: "finance_data_load_failed" }, 500);
      return json({ transactions: transactions.data ?? [], coupons: coupons.data ?? [] });
    }

    if (body.action === "adjust_wallet") {
      await requirePermission("finance.wallet.adjust");
      if (!uuid(body.user_id) || typeof body.amount !== "number" || !Number.isFinite(body.amount) ||
          body.amount <= 0 || body.amount > 1000000000 ||
          !["credit", "debit"].includes(body.type) ||
          (body.note !== undefined && (typeof body.note !== "string" || body.note.length > 500))) {
        return json({ error: "invalid_request" }, 400);
      }
      return await rpc("admin_adjust_wallet", {
        p_user_id: body.user_id, p_amount: body.amount,
        p_note: typeof body.note === "string" ? body.note.trim() || null : null,
        p_type: body.type,
      });
    }

    if (body.action === "save_coupon") {
      await requirePermission(body.id ? "promotions.edit" : "promotions.create");
      if ((body.id !== undefined && !uuid(body.id)) ||
          typeof body.code !== "string" || body.code.trim().length < 2 || body.code.length > 50 ||
          !["percentage", "fixed"].includes(body.type) ||
          typeof body.value !== "number" || !Number.isFinite(body.value) || body.value < 0 ||
          !Number.isInteger(body.max_uses) || body.max_uses < 1 || body.max_uses > 10000000 ||
          typeof body.active !== "boolean" ||
          typeof body.min_amount !== "number" || !Number.isFinite(body.min_amount) || body.min_amount < 0 ||
          (body.expires_at !== null && body.expires_at !== undefined &&
            (typeof body.expires_at !== "string" || !Number.isFinite(Date.parse(body.expires_at))))) {
        return json({ error: "invalid_request" }, 400);
      }
      return await rpc("admin_save_coupon", {
        p_id: body.id ?? null, p_code: body.code.trim().toUpperCase(),
        p_type: body.type, p_value: body.value, p_max_uses: body.max_uses,
        p_expires_at: body.expires_at ?? null, p_active: body.active,
        p_min_amount: body.min_amount,
      });
    }

    if (body.action === "audience_count") {
      await requirePermission("promotions.read");
      if (!targets.includes(body.target)) return json({ error: "invalid_target" }, 400);
      const { data, error } = await caller.rpc("admin_coupon_audience_count", { p_target: body.target });
      if (error) return json({ error: error.message }, 400);
      return json({ count: Number(data ?? 0) });
    }

    if (body.action === "distribute_coupon") {
      await requirePermission("promotions.publish");
      if (!uuid(body.coupon_id) || !targets.includes(body.target) ||
          (body.target === "single" ? !uuid(body.single_user_id) :
            (body.single_user_id !== undefined && !uuid(body.single_user_id)))) {
        return json({ error: "invalid_request" }, 400);
      }
      const { data, error } = await caller.rpc("admin_distribute_coupon", {
        p_coupon_id: body.coupon_id, p_target: body.target,
        p_single_user_id: body.single_user_id ?? null,
      });
      if (error) return json({ error: error.message }, 400);
      return json({ sent: Number(data ?? 0) });
    }

    if (body.action === "subsidy_report") {
      await requirePermission("promotions.read");
      const { data, error } = await caller.rpc("admin_coupon_subsidy_report");
      if (error) return json({ error: error.message }, 400);
      return json({ report: Array.isArray(data) ? data[0] ?? null : data });
    }

    if (body.action === "delete_coupon") {
      await requirePermission("promotions.delete");
      if (!uuid(body.coupon_id)) return json({ error: "invalid_coupon_id" }, 400);
      return await rpc("admin_delete_coupon", { p_coupon_id: body.coupon_id });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (error) {
    const message = String(error);
    if (message.includes("missing_")) return json({ error: "server_configuration_incomplete" }, 503);
    if (message.includes("permission_required:")) return json({ error: "permission_required" }, 403);
    return json({ error: "internal_error" }, 500);
  }
});
