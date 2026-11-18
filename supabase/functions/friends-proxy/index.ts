import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.0";
import { getSupabasePublishableKey, getSupabaseSecretKey } from "../_shared/api-keys.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const required = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error("missing_" + name);
  return value;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const url = required("SUPABASE_URL");
    const anon = getSupabasePublishableKey();
    const service = getSupabaseSecretKey();
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
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

    if (body.action === "statuses") {
      // RLS restricts this query to the caller's own friend list. The privileged
      // status RPC is then called only for those verified friend IDs.
      const { data: friends, error } = await caller.from("friends").select("friend_id").eq("user_id", auth.user.id);
      if (error) return json({ error: "friends_load_failed" }, 500);
      const rows = await Promise.all((friends ?? []).map(async (friend: any) => {
        const { data, error: statusError } = await admin.rpc("get_friend_status", { p_friend_id: friend.friend_id });
        if (statusError || !data) return {
          friend_id: friend.friend_id, status: "inactive", full_name: null, avatar_url: null,
        };
        return {
          friend_id: friend.friend_id,
          status: data.status ?? "inactive",
          full_name: data.full_name ?? null,
          avatar_url: data.avatar_url ?? null,
        };
      }));
      return json({ friends: rows });
    }

    if (body.action === "search_by_phone") {
      if (typeof body.phone !== "string" || body.phone.trim().length < 1 || body.phone.length > 50) {
        return json({ error: "invalid_phone" }, 400);
      }
      const { data: rows, error } = await caller.rpc("search_profiles_for_friend", { _phone: body.phone });
      if (error) return json({ error: "profile_search_failed" }, 500);
      return json({ profiles: (rows ?? []).map((row: any) => ({ ...row, avatar_url: null })) });
    }
    return json({ error: "unknown_action" }, 400);
  } catch (error) {
    const message = String(error);
    if (message.includes("missing_")) return json({ error: "server_configuration_incomplete" }, 503);
    return json({ error: "internal_error" }, 500);
  }
});
