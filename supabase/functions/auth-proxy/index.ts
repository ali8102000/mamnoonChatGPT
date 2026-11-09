import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN");

function createSupabaseFetch(apiKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    if (
      (apiKey.startsWith("sb_publishable_") || apiKey.startsWith("sb_secret_")) &&
      headers.get("Authorization") === `Bearer ${apiKey}`
    ) headers.delete("Authorization");
    headers.set("apikey", apiKey);
    return fetch(input, { ...init, headers });
  };
}
const corsHeaders = {
  ...(allowedOrigin ? { "Access-Control-Allow-Origin": allowedOrigin } : {}),
  "Vary": "Origin",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeError(msg: string): string {
  const known = [
    "Invalid login credentials",
    "User already registered",
    "Password should be at least 6 characters",
    "Email rate limit exceeded",
  ];
  return known.some((k) => msg.includes(k)) ? msg : "Request could not be processed";
}

function isAllowedRedirect(url: string): boolean {
  try {
    const parsed = new URL(url);
    const allowed = (Deno.env.get("ALLOWED_REDIRECT_ORIGINS") ?? "").split(",").map((s) => s.trim());
    if (allowed.length === 1 && allowed[0] === "") return false;
    return allowed.some((o) => parsed.origin === o);
  } catch {
    return false;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = (Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY"))!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json({ error: "Server configuration error" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      global: { fetch: createSupabaseFetch(serviceRoleKey) },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const url = new URL(req.url);
    const path = url.pathname.replace("/auth-proxy", "");

    if (path === "/signup" && req.method === "POST") {
      const body = await req.json();
      const email = typeof body?.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) ? body.email : null;
      const password = typeof body?.password === "string" && body.password.length >= 6 && body.password.length <= 128 ? body.password : null;
      const phone = typeof body?.phone === "string" && body.phone.trim().length >= 3 && body.phone.trim().length <= 255 ? body.phone.trim() : null;
      const full_name = typeof body?.full_name === "string" && body.full_name.trim().length >= 2 && body.full_name.trim().length <= 255 ? body.full_name.trim() : null;
      if (!email || !password || !phone || !full_name) return json({ error: "Invalid input" }, 400);

      const client = createClient(supabaseUrl, anonKey, {
        global: { fetch: createSupabaseFetch(anonKey) },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      // Do not use the admin API to auto-confirm synthetic phone emails:
      // that would let anyone claim a phone number without proving ownership.
      if (email.endsWith("@mamnoon.app")) {
        return json({ error: "Phone verification is not configured. Register with a real email address until SMS verification is enabled." }, 503);
      }

      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: { data: { full_name, phone } },
      });
      if (error) return json({ error: safeError(error.message) }, 400);
      if (data.user) {
        const { error: profileError } = await supabase.from("profiles").upsert({
          id: data.user.id,
          phone,
          full_name,
          email,
        });
        if (profileError) return json({ error: "Account created but profile setup failed" }, 500);
      }
      return json({ user: data.user, session: data.session });
    }

    if (path === "/login" && req.method === "POST") {
      const body = await req.json();
      const suppliedEmail = typeof body?.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)
        ? body.email.trim().toLowerCase()
        : null;
      const phone = typeof body?.phone === "string" && /^\+\d{8,15}$/.test(body.phone.trim())
        ? body.phone.trim()
        : null;
      const password = typeof body?.password === "string" && body.password.length >= 6 && body.password.length <= 128 ? body.password : null;
      if ((!suppliedEmail && !phone) || !password) return json({ error: "Invalid input" }, 400);

      let email = suppliedEmail;
      if (phone) {
        const { data: foundEmail, error: lookupError } = await supabase.rpc("lookup_email_by_phone", { _phone: phone });
        if (lookupError) return json({ error: safeError(lookupError.message) }, 400);
        const digits = phone.replace(/[^\d]/g, "");
        email = foundEmail ? String(foundEmail).toLowerCase() : `phone${digits}@mamnoon.app`;
      }

      const client = createClient(supabaseUrl, anonKey, {
        global: { fetch: createSupabaseFetch(anonKey) },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await client.auth.signInWithPassword({ email: email!, password });
      if (error) return json({ error: safeError(error.message) }, 400);
      return json({ session: data.session, user: data.user });
    }

    if (path === "/reset-password" && req.method === "POST") {
      const body = await req.json();
      const email = typeof body?.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) ? body.email : null;
      const redirectTo = typeof body?.redirectTo === "string" ? body.redirectTo : null;
      if (!email || !redirectTo) return json({ error: "Invalid input" }, 400);
      if (!isAllowedRedirect(redirectTo)) return json({ error: "Invalid redirect URL" }, 400);

      const client = createClient(supabaseUrl, anonKey, {
        global: { fetch: createSupabaseFetch(anonKey) },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) return json({ error: safeError(error.message) }, 400);
      return json({ ok: true });
    }

    return json({ error: "Not found" }, 404);
  } catch {
    return json({ error: "Internal error" }, 500);
  }
});
