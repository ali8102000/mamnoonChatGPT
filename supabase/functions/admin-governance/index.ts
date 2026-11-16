import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const required = (key: string) => {
  const value = Deno.env.get(key);
  if (!value) throw new Error("missing_" + key);
  return value;
};
const uuid = (v: unknown): v is string => typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const roles = ["admin", "support", "finance", "moderator"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const url = required("SUPABASE_URL"), anon = required("SUPABASE_ANON_KEY");
    const service = required("SUPABASE_SERVICE_ROLE_KEY");
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return json({ error: "unauthorized" }, 401);
    const caller = createClient(url, anon, {
      global: { headers: { Authorization: "Bearer " + token } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth, error: authError } = await caller.auth.getUser(token);
    if (authError || !auth.user) return json({ error: "unauthorized" }, 401);
    const { data: staff, error: staffError } = await caller.rpc("has_staff_role", { p_user_id: auth.user.id });
    if (staffError || staff !== true) return json({ error: "forbidden" }, 403);
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const body = await req.json().catch(() => null);
    if (!body || typeof body.action !== "string") return json({ error: "invalid_request" }, 400);
    const requireAdmin = async () => {
      const { data, error } = await caller.rpc("has_admin_access", { p_user_id: auth.user.id });
      if (error || data !== true) throw new Error("admin_required");
    };
    const requireSuperAdmin = async () => {
      const { data, error } = await caller.rpc("is_super_admin", { p_user_id: auth.user.id });
      if (error || data !== true) throw new Error("super_admin_required");
    };

    if (body.action === "audit_logs") {
      await requireAdmin();
      const limit = Number.isInteger(body.limit) ? Math.max(1, Math.min(200, body.limit)) : 100;
      const { data, error } = await admin.from("audit_logs")
        .select("*, admin:profiles!audit_logs_user_id_fkey(full_name,phone)")
        .order("created_at", { ascending: false }).limit(limit);
      if (error) return json({ error: "audit_logs_load_failed" }, 500);
      return json({ logs: data ?? [] });
    }

    if (body.action === "search_users") {
      await requireSuperAdmin();
      const q = typeof body.query === "string" ? body.query.trim().slice(0, 80) : "";
      if (q.length < 2) return json({ error: "query_too_short" }, 400);
      const safe = q.replace(/[,%()]/g, " ");
      const { data, error } = await admin.from("profiles")
        .select("id,full_name,phone,email").or(`full_name.ilike.%${safe}%,phone.ilike.%${safe}%,email.ilike.%${safe}%`)
        .order("created_at", { ascending: false }).limit(30);
      if (error) return json({ error: "user_search_failed" }, 500);
      return json({ users: data ?? [] });
    }

    if (body.action === "get_roles") {
      await requireSuperAdmin();
      if (!uuid(body.user_id)) return json({ error: "invalid_user_id" }, 400);
      const { data, error } = await caller.rpc("get_staff_roles", { p_user_id: body.user_id });
      if (error) return json({ error: error.message }, 400);
      return json({ roles: data ?? [] });
    }

    if (body.action === "grant_role" || body.action === "revoke_role") {
      await requireSuperAdmin();
      if (!uuid(body.user_id) || typeof body.role !== "string" || !roles.includes(body.role)) {
        return json({ error: "invalid_role_request" }, 400);
      }
      if (body.user_id === auth.user.id && body.role === "admin") {
        return json({ error: "self_role_change_blocked" }, 400);
      }
      const rpcName = body.action === "grant_role" ? "admin_grant_role" : "admin_revoke_role";
      const { error } = await caller.rpc(rpcName, { p_target_user: body.user_id, p_role: body.role });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }
    return json({ error: "unknown_action" }, 400);
  } catch (error) {
    const message = String(error);
    if (message.includes("missing_")) return json({ error: "server_configuration_incomplete" }, 503);
    if (message.includes("super_admin_required")) return json({ error: "super_admin_required" }, 403);
    if (message.includes("admin_required")) return json({ error: "admin_required" }, 403);
    return json({ error: "internal_error" }, 500);
  }
});
