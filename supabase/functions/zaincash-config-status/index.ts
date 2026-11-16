import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response(JSON.stringify({ ready: false }), { status: 405, headers: cors });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const auth = req.headers.get("Authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!supabaseUrl || !anonKey || !token) return new Response(JSON.stringify({ ready: false }), { status: 401, headers: cors });
    const client = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: "Bearer " + token } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error } = await client.auth.getUser(token);
    if (error || !authData.user) return new Response(JSON.stringify({ ready: false }), { status: 401, headers: cors });
    const required = ["ZAINCASH_CLIENT_ID", "ZAINCASH_CLIENT_SECRET", "ZAINCASH_API_KEY", "ZAINCASH_BASE_URL", "MAMNOON_PUBLIC_URL"];
    const missing = required.filter((name) => !Deno.env.get(name)?.trim());
    const ready = Deno.env.get("ZAINCASH_ENABLED") === "true" && missing.length === 0;
    return new Response(JSON.stringify({ ready, missing: ready ? [] : missing }), { headers: cors });
  } catch {
    return new Response(JSON.stringify({ ready: false }), { status: 500, headers: cors });
  }
});
