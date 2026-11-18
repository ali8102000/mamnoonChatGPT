import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.0";
import { getSupabasePublishableKey, getSupabaseSecretKey, createSupabaseFetch } from "../_shared/api-keys.ts";

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const url = required("SUPABASE_URL");
    const anon = getSupabasePublishableKey();
    const service = getSupabaseSecretKey();
    const authorization = req.headers.get("Authorization") || "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!token) return json({ error: "unauthorized" }, 401);

    const caller = createClient(url, anon, {
      global: { fetch: createSupabaseFetch(anon), headers: { Authorization: "Bearer " + token } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth, error: authError } = await caller.auth.getUser(token);
    if (authError || !auth.user) return json({ error: "unauthorized" }, 401);

    // The target user is derived only from the verified JWT. The client cannot
    // supply an arbitrary user_id to the service-role RPC.
    const admin = createClient(url, service, {
      global: { fetch: createSupabaseFetch(service) },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await admin.rpc("increment_request_count", { _user_id: auth.user.id });
    if (error) {
      console.error("increment_request_count_failed", error.message);
      return json({ error: "increment_failed" }, 500);
    }
    return json({ ok: true });
  } catch (error) {
    const message = String(error);
    if (message.includes("missing_")) return json({ error: "server_configuration_incomplete" }, 503);
    return json({ error: "internal_error" }, 500);
  }
});
