import { createClient } from "npm:@supabase/supabase-js@2.57.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const required = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error("missing_" + name);
  return value;
};
const isUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const url = required("SUPABASE_URL");
    const anon = required("SUPABASE_ANON_KEY");
    const authorization = req.headers.get("Authorization") || "";
    const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return json({ error: "unauthorized" }, 401);
    const caller = createClient(url, anon, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth, error: authError } = await caller.auth.getUser(token);
    if (authError || !auth.user) return json({ error: "unauthorized" }, 401);
    const body = await req.json().catch(() => null);
    if (!body || body.action !== "reviews" || !isUuid(body.user_id)) return json({ error: "invalid_request" }, 400);
    const { data: reviews, error } = await caller.from("ratings")
      .select("id,stars,professionalism,punctuality,quality,comment,created_at,rater:profiles!ratings_rater_id_fkey(full_name,avatar_url)")
      .eq("ratee_id", body.user_id)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) return json({ error: "reviews_load_failed" }, 500);
    return json({ reviews: reviews ?? [] });
  } catch (error) {
    const message = String(error);
    if (message.includes("missing_")) return json({ error: "server_configuration_incomplete" }, 503);
    return json({ error: "internal_error" }, 500);
  }
});
