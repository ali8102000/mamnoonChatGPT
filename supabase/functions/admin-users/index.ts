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
const isUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

function searchTerms(raw: string) {
  const term = raw.trim().replace(/[,%()]/g, " ").slice(0, 100);
  const digits = term.replace(/[٠-٩۰-۹]/g, d => {
    const n = d.charCodeAt(0);
    return String(n >= 0x06f0 ? n - 0x06f0 : n - 0x0660);
  }).replace(/\D/g, "");
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
    const url = required("SUPABASE_URL");
    const anon = required("SUPABASE_ANON_KEY");
    const service = required("SUPABASE_SERVICE_ROLE_KEY");
    const header = req.headers.get("Authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return json({ error: "unauthorized" }, 401);
    const caller = createClient(url, anon, {
      global: { headers: { Authorization: "Bearer " + token } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth, error: authError } = await caller.auth.getUser(token);
    if (authError || !auth.user) return json({ error: "unauthorized" }, 401);
    const { data: staff, error: staffError } = await caller.rpc("has_staff_role", { p_user_id: auth.user.id });
    if (staffError || staff !== true) return json({ error: "forbidden" }, 403);
    const { data: staffRolesData, error: staffRolesError } = await caller.rpc("get_staff_roles", {
      p_user_id: auth.user.id,
    });
    if (staffRolesError || !Array.isArray(staffRolesData)) return json({ error: "forbidden" }, 403);
    const staffRoles = new Set(staffRolesData.map((entry: unknown) =>
      typeof entry === "string" ? entry : String((entry as { role?: unknown } | null)?.role ?? ""),
    ));
    const requireRoles = (allowed: string[]) => {
      if (!allowed.some((role) => staffRoles.has(role))) throw new Error("role_required");
    };
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const body = await req.json().catch(() => null);
    if (!body || typeof body.action !== "string") return json({ error: "invalid_request" }, 400);
    const requireAdmin = async () => {
      const { data, error } = await caller.rpc("has_admin_access", { p_user_id: auth.user.id });
      if (error || data !== true) throw new Error("admin_required");
    };

    if (body.action === "list" || body.action === "search") {
      requireRoles(["super_admin", "admin", "support", "moderator"]);
      const isSearch = body.action === "search";
      if (isSearch && (typeof body.query !== "string" || body.query.trim().length < 2)) {
        return json({ error: "query_too_short" }, 400);
      }
      const page = Number.isInteger(body.page) ? Math.max(1, Math.min(100000, body.page)) : 1;
      const limit = Number.isInteger(body.limit) ? Math.max(1, Math.min(50, body.limit)) : 50;
      let query = admin.from("profiles")
        .select("id,phone,full_name,email,created_at,avatar_url", { count: "exact" })
        .order("created_at", { ascending: false });
      if (isSearch) {
        const { term, digits, phones } = searchTerms(body.query);
        const filters = [
          `full_name.ilike.%${term}%`,
          `email.ilike.%${term}%`,
          ...phones.map(p => `phone.ilike.%${p}%`),
          ...(digits ? [`email.ilike.%phone${digits}%`] : []),
        ];
        query = query.or(filters.join(",")).limit(100);
      } else {
        query = query.range((page - 1) * limit, page * limit - 1);
      }
      const { data: users, count, error } = await query;
      if (error) return json({ error: "users_load_failed" }, 500);
      const ids = (users ?? []).map((u: any) => u.id);
      if (!ids.length) return json({ users: [], total: count ?? 0 });
      const { data: blocks, error: blocksError } = await admin.from("user_blocks")
        .select("user_id,reason,expires_at,blocked_at").in("user_id", ids);
      if (blocksError) return json({ error: "user_blocks_load_failed" }, 500);
      const blockMap = new Map((blocks ?? []).map((b: any) => [b.user_id, b]));
      return json({
        users: (users ?? []).map((u: any) => ({ ...u, blocked: blockMap.get(u.id) ?? null })),
        total: count ?? 0,
      });
    }

    if (body.action === "detail") {
      requireRoles(["super_admin", "admin", "support", "moderator"]);
      if (!isUuid(body.user_id)) return json({ error: "invalid_user_id" }, 400);
      const id = body.user_id;
      const [profile, roles, block, driver, worker, transactions, requests, ratings] = await Promise.all([
        admin.from("profiles").select("*").eq("id", id).maybeSingle(),
        admin.from("user_roles").select("role,created_at").eq("user_id", id),
        admin.from("user_blocks").select("*").eq("user_id", id).maybeSingle(),
        admin.from("driver_profiles").select("*").eq("user_id", id).maybeSingle(),
        admin.from("worker_profiles").select("*").eq("user_id", id).maybeSingle(),
        admin.from("transactions").select("*").eq("user_id", id).order("created_at", { ascending: false }).limit(20),
        admin.from("service_requests").select("id,type,status,created_at,price_estimate")
          .or(`customer_id.eq.${id},provider_id.eq.${id}`).order("created_at", { ascending: false }).limit(20),
        admin.from("ratings").select("id,stars,professionalism,punctuality,quality,comment,created_at,rater:profiles!ratings_rater_id_fkey(full_name,avatar_url)")
          .eq("ratee_id", id).order("created_at", { ascending: false }).limit(100),
      ]);
      const failed = [profile, roles, block, driver, worker, transactions, requests].find((r: any) => r.error);
      if (failed?.error) return json({ error: "user_detail_load_failed" }, 500);
      return json({
        profile: profile.data, roles: roles.data ?? [], block: block.data,
        driverProfile: driver.data, workerProfile: worker.data,
        transactions: transactions.data ?? [], requests: requests.data ?? [],
        ratings: ratings.error ? [] : ratings.data ?? [],
        ratings_error: !!ratings.error,
      });
    }

    if (body.action === "providers") {
      requireRoles(["super_admin", "admin", "support"]);
      const type = ["driver", "large_driver", "worker"].includes(body.type) ? body.type : "driver";
      const status = ["all", "approved", "pending", "suspended", "rejected"].includes(body.status) ? body.status : "all";
      const category = typeof body.category === "string" ? body.category.slice(0, 80) : "all";
      const table = type === "worker" ? "worker_profiles" : "driver_profiles";
      let providerQuery = admin.from(table)
        .select("*, profiles!inner(full_name,phone,email,avatar_url)", { count: "exact" });
      if (status !== "all") providerQuery = providerQuery.eq("status", status);
      if (category !== "all") providerQuery = providerQuery.eq(type === "worker" ? "level" : "vehicle_category", category);
      const { data: providers, count, error } = await providerQuery
        .order("created_at", { ascending: false }).limit(200);
      if (error) return json({ error: "providers_load_failed" }, 500);
      const userIds = (providers ?? []).map((provider: any) => provider.user_id).filter(isUuid);
      if (!userIds.length) return json({ providers: [], total: count ?? 0 });
      const { data: verifications, error: verificationError } = await admin.from("provider_verifications")
        .select("*").eq("provider_type", type).in("user_id", userIds);
      if (verificationError) return json({ error: "provider_verifications_load_failed" }, 500);
      const verificationByUser = new Map((verifications ?? []).map((row: any) => [row.user_id, row]));
      const enriched = await Promise.all((providers ?? []).map(async (provider: any) => {
        const verification: any = verificationByUser.get(provider.user_id);
        if (!verification) return { ...provider, verification: null };
        const sign = async (path: string | null | undefined) => {
          if (!path) return null;
          const { data, error } = await admin.storage.from("provider-verification").createSignedUrl(path, 600);
          return error ? null : data?.signedUrl ?? null;
        };
        const [face, front, back, vehicle] = await Promise.all([
          sign(verification.face_photo_path), sign(verification.id_card_photo_path),
          sign(verification.id_card_back_photo_path), sign(verification.vehicle_document_path),
        ]);
        return { ...provider, verification: {
          status: verification.status, rejection_reason: verification.rejection_reason,
          face_photo_url: face, id_card_photo_url: front,
          id_card_back_photo_url: back, vehicle_document_url: vehicle,
        } };
      }));
      return json({ providers: enriched, total: count ?? enriched.length });
    }

    if (body.action === "requests") {
      requireRoles(["super_admin", "admin", "support"]);
      const status = typeof body.status === "string" ? body.status.slice(0, 40) : "all";
      const limit = Number.isInteger(body.limit) ? Math.max(1, Math.min(200, body.limit)) : 100;
      let requestQuery = admin.from("service_requests")
        .select("id,type,status,price_estimate,created_at,pickup_text,dest_text,customer_id,provider_id")
        .order("created_at", { ascending: false }).limit(limit);
      if (status !== "all") requestQuery = requestQuery.eq("status", status);
      const { data: requests, error } = await requestQuery;
      if (error) return json({ error: "requests_load_failed" }, 500);
      return json({ requests: requests ?? [] });
    }

    if (body.action === "cancel_request") {
      await requireAdmin();
      if (!isUuid(body.request_id) || typeof body.reason !== "string" || body.reason.length > 500) {
        return json({ error: "invalid_request" }, 400);
      }
      const { error } = await caller.rpc("admin_cancel_request", {
        p_request_id: body.request_id, p_reason: body.reason.trim() || null,
      });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (body.action === "reopen_request") {
      await requireAdmin();
      if (!isUuid(body.request_id)) return json({ error: "invalid_request_id" }, 400);
      const { error } = await caller.rpc("admin_reopen_request", { p_request_id: body.request_id });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (body.action === "block") {
      await requireAdmin();
      if (!isUuid(body.user_id) || typeof body.reason !== "string" || body.reason.length > 500 ||
          !["1_hour", "1_day", "1_week", "1_month", "permanent"].includes(body.duration)) {
        return json({ error: "invalid_request" }, 400);
      }
      const minutes: Record<string, number> = { "1_hour": 60, "1_day": 1440, "1_week": 10080, "1_month": 43200 };
      const expiry = body.duration === "permanent" ? null : new Date(Date.now() + minutes[body.duration] * 60000).toISOString();
      const { error } = await caller.rpc("admin_block_user", {
        p_user_id: body.user_id, p_reason: body.reason.trim() || null, p_expires_at: expiry,
      });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, expires_at: expiry });
    }

    if (body.action === "unblock") {
      await requireAdmin();
      if (!isUuid(body.user_id)) return json({ error: "invalid_user_id" }, 400);
      const { error } = await caller.rpc("admin_unblock_user", { p_user_id: body.user_id });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (body.action === "friends" || body.action === "friend_requests") {
      requireRoles(["super_admin", "admin", "moderator"]);
      const limit = Number.isInteger(body.limit) ? Math.max(1, Math.min(200, body.limit)) : 100;
      if (body.action === "friends") {
        const { data, error } = await admin.from("friends")
          .select("*, user:profiles!friends_user_id_fkey(full_name,phone), friend:profiles!friends_friend_id_fkey(full_name,phone)")
          .order("created_at", { ascending: false }).limit(limit);
        if (error) return json({ error: "friends_load_failed" }, 500);
        return json({ friends: data ?? [] });
      }
      const { data, error } = await admin.from("friend_requests")
        .select("*, sender:profiles!friend_requests_sender_id_fkey(full_name,phone), receiver:profiles!friend_requests_receiver_id_fkey(full_name,phone)")
        .order("created_at", { ascending: false }).limit(limit);
      if (error) return json({ error: "friend_requests_load_failed" }, 500);
      return json({ requests: data ?? [] });
    }

    if (body.action === "delete_friendship") {
      requireRoles(["super_admin", "admin", "moderator"]);
      if (!isUuid(body.user1_id) || !isUuid(body.user2_id) || body.user1_id === body.user2_id) {
        return json({ error: "invalid_friendship" }, 400);
      }
      const { error } = await caller.rpc("admin_delete_friendship", {
        p_user1_id: body.user1_id,
        p_user2_id: body.user2_id,
      });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (body.action === "delete_friend_request") {
      requireRoles(["super_admin", "admin", "moderator"]);
      if (!isUuid(body.request_id)) return json({ error: "invalid_request_id" }, 400);
      const { error } = await caller.rpc("admin_delete_friend_request", {
        p_request_id: body.request_id,
      });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (body.action === "broadcast_notification") {
      requireRoles(["super_admin", "admin", "support", "finance", "moderator"]);
      const targets = ["all", "drivers", "workers", "single"];
      if (!targets.includes(body.target) || typeof body.title !== "string" ||
          body.title.trim().length < 1 || body.title.length > 200 ||
          typeof body.body !== "string" || body.body.trim().length < 1 ||
          body.body.length > 2000 ||
          (body.target === "single" ? !isUuid(body.user_id) :
            (body.user_id !== undefined && !isUuid(body.user_id)))) {
        return json({ error: "invalid_notification" }, 400);
      }
      const { data, error } = await caller.rpc("admin_broadcast_notification", {
        p_target: body.target,
        p_title: body.title.trim(),
        p_body: body.body.trim(),
        p_single_user_id: body.user_id ?? null,
      });
      if (error) return json({ error: error.message }, 400);
      return json({ sent: Number(data ?? 0) });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (error) {
    const message = String(error);
    if (message.includes("missing_")) return json({ error: "server_configuration_incomplete" }, 503);
    if (message.includes("admin_required")) return json({ error: "admin_required" }, 403);
    if (message.includes("role_required")) return json({ error: "forbidden" }, 403);
    return json({ error: "internal_error" }, 500);
  }
});
