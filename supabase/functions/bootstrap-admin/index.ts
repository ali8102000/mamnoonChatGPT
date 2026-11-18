import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
const constantTimeEqual = (left: string, right: string) => {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
};

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

    const admin = createClient(url, service, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const body = await req.json().catch(() => null);
    if (!body || !["check", "bootstrap"].includes(body.action)) {
      return json({ error: "invalid_request" }, 400);
    }

    if (body.action === "check") {
      const { count, error } = await admin.from("user_roles")
        .select("id", { count: "exact", head: true })
        .eq("role", "super_admin");
      if (error) return json({ error: "super_admin_check_failed" }, 500);
      return json({ exists: (count ?? 0) > 0 });
    }

    const expectedEmail = required("MAMNOON_BOOTSTRAP_ADMIN_EMAIL").trim().toLowerCase();
    const expectedSecret = required("MAMNOON_BOOTSTRAP_SECRET");
    if (expectedSecret.length < 32 || expectedSecret.length > 256) {
      return json({ error: "bootstrap_configuration_invalid" }, 503);
    }
    if (String(auth.user.email ?? "").trim().toLowerCase() !== expectedEmail) {
      return json({ error: "bootstrap_email_not_authorized" }, 403);
    }
    if (typeof body.secret !== "string" || body.secret.length < 32 ||
        body.secret.length > 256 || !constantTimeEqual(body.secret, expectedSecret)) {
      return json({ error: "bootstrap_secret_invalid" }, 403);
    }
    const { data: created, error } = await admin.rpc("bootstrap_first_super_admin", {
      p_user_id: auth.user.id,
    });
    if (error) return json({ error: "bootstrap_failed" }, 500);
    if (created !== true) return json({ error: "super_admin_already_exists" }, 409);
    return json({ ok: true });
  } catch (error) {
    const message = String(error);
    if (message.includes("missing_MAMNO_BOOTSTRAP")) {
      return json({ error: "bootstrap_configuration_incomplete" }, 503);
    }
    if (message.includes("missing_")) return json({ error: "server_configuration_incomplete" }, 503);
    return json({ error: "internal_error" }, 500);
  }
});
