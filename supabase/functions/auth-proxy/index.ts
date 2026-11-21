import { withSupabase } from "npm:@supabase/server@1.9.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}

function normalizePhone(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, "");
  if (trimmed.startsWith("+")) return "+" + trimmed.slice(1).replace(/[^\d]/g, "");
  const digits = trimmed.replace(/[^\d]/g, "");
  if (digits.startsWith("964")) return "+" + digits;
  if (digits.startsWith("0")) return "+964" + digits.slice(1);
  if (digits.startsWith("7") && digits.length === 10) return "+964" + digits;
  return "+" + digits;
}

function isValidPhone(raw: string): boolean {
  return /^\+\d{8,15}$/.test(normalizePhone(raw));
}

async function hasSuperAdminRole(supabase: any, userId?: string): Promise<boolean> {
  if (!userId) return false;
  const { data, error } = await supabase.rpc("is_super_admin", { p_user_id: userId });
  return !error && data === true;
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return Array.from(new Uint8Array(signature)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function checkAuthRateLimit(ctx: any, req: Request, action: "signup" | "login" | "reset", subject: string): Promise<Response | null> {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) return json({ error: "rate_limit_unavailable" }, 503);
  const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0] || req.headers.get("x-real-ip") || "").trim();
  const config = action === "signup"
    ? { window: 3600, ipLimit: 8, subjectLimit: 3 }
    : action === "login"
      ? { window: 900, ipLimit: 20, subjectLimit: 10 }
      : { window: 3600, ipLimit: 5, subjectLimit: 3 };
  const checks: Array<{ action: string; value: string; max: number }> = [];
  if (ip) checks.push({ action: `${action}_ip`, value: ip, max: config.ipLimit });
  if (subject) checks.push({ action: `${action}_subject`, value: subject, max: config.subjectLimit });
  for (const check of checks) {
    const p_key_hash = await hmacHex(serviceKey, `${check.action}:${check.value}`);
    const { data, error } = await ctx.supabaseAdmin.rpc("consume_auth_proxy_rate_limit", {
      p_key_hash,
      p_action: check.action,
      p_max_attempts: check.max,
      p_window_seconds: config.window,
    });
    if (error) {
      console.error("[auth-proxy] rate limit check failed", error);
      return json({ error: "rate_limit_unavailable" }, 503);
    }
    if (data !== true) return json({ error: "too_many_attempts" }, 429);
  }
  return null;
}

const authenticatedHandler = withSupabase(
  { auth: "publishable" },
  async (req, ctx) => {
    if (req.method !== "POST") return json({ error: "الطريقة غير مدعومة" }, 405);

    const contentLength = Number(req.headers.get("content-length") || "0");
    if (Number.isFinite(contentLength) && contentLength > 16000) return json({ error: "حجم الطلب كبير" }, 413);

    const url = new URL(req.url);
    const rawBody = await req.clone().text();
    if (new TextEncoder().encode(rawBody).byteLength > 16000) return json({ error: "حجم الطلب كبير" }, 413);
    let body: Record<string, unknown> | null;
    try { body = rawBody ? JSON.parse(rawBody) as Record<string, unknown> : null; }
    catch { return json({ error: "بيانات الطلب غير صالحة" }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return json({ error: "بيانات الطلب غير صالحة" }, 400);
    }
    const action = typeof body.action === "string" ? body.action : url.pathname.split("/").filter(Boolean).at(-1);

    const password = typeof body.password === "string" ? body.password : "";

    if (action === "signup") {
      if (password.length < 6 || password.length > 128) {
        return json({ error: "كلمة المرور يجب أن تكون بين 6 و128 حرفاً" }, 400);
      }
      const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
      const phoneInput = typeof body.phone === "string" ? body.phone : "";
      const phone = normalizePhone(phoneInput);
      const accountEmail = "phone" + phone.replace(/\D/g, "") + "@mamnoon.app";
      const contactEmail = typeof body.contact_email === "string" ? body.contact_email.trim().toLowerCase() : "";
      const referralCode = typeof body.referral_code === "string" ? body.referral_code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) : "";

      if (fullName.length < 2 || fullName.length > 100) return json({ error: "الاسم غير صالح" }, 400);
      if (!isValidPhone(phone)) return json({ error: "رقم الهاتف غير صالح" }, 400);
      if (contactEmail && (contactEmail.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail))) {
        return json({ error: "البريد الإلكتروني غير صالح" }, 400);
      }
      // Contact email is profile metadata only; the account identity is always phone-derived.
      const rateLimitResponse = await checkAuthRateLimit(ctx, req, "signup", phone);
      if (rateLimitResponse) return rateLimitResponse;

      const { data: existingEmail, error: existingLookupError } = await ctx.supabaseAdmin.rpc("lookup_email_by_phone", { _phone: phone });
      if (existingLookupError) {
        console.error("[auth-proxy] existing phone lookup failed", existingLookupError);
        return json({ error: "signup_unavailable" }, 503);
      }
      if (typeof existingEmail === "string" && existingEmail) {
        const { data: existingLogin, error: existingLoginError } = await ctx.supabase.auth.signInWithPassword({ email: existingEmail, password });
        if (!existingLoginError && existingLogin.session) {
          return json({
            session: {
              access_token: existingLogin.session.access_token,
              refresh_token: existingLogin.session.refresh_token,
            },
            isSuperAdmin: await hasSuperAdminRole(ctx.supabase, existingLogin.user?.id),
          });
        }
        return json({ error: "invalid_credentials" }, 401);
      }

      const { data: created, error: createError } = await ctx.supabaseAdmin.auth.admin.createUser({
        email: accountEmail,
        password,
        email_confirm: true,
        user_metadata: { phone, full_name: fullName, contact_email: contactEmail || null, referral_code: referralCode || null },
      });

      if (createError || !created?.user) {
        const message = createError?.message || "";
        if (/already registered|already been registered|already exists|duplicate/i.test(message)) {
          const { data: existingEmail, error: lookupError } = await ctx.supabaseAdmin.rpc("lookup_email_by_phone", { _phone: phone });
          if (!lookupError && typeof existingEmail === "string" && existingEmail) {
            const { data: recovered, error: recoveryError } = await ctx.supabase.auth.signInWithPassword({ email: existingEmail, password });
            if (!recoveryError && recovered.session) {
              return json({
                session: {
                  access_token: recovered.session.access_token,
                  refresh_token: recovered.session.refresh_token,
                },
                isSuperAdmin: await hasSuperAdminRole(ctx.supabase, recovered.user?.id),
              });
            }
            return json({ error: "invalid_credentials" }, 401);
          }
        }
        console.error("[auth-proxy] signup createUser failed:", createError?.code || "unknown");
        return json({ error: "signup_failed" }, 400);
      }

      const { data: signedIn, error: signInError } = await ctx.supabase.auth.signInWithPassword({
        email: accountEmail,
        password,
      });
      if (signInError || !signedIn.session) {
        console.error("[auth-proxy] signup session creation failed:", signInError?.code || "unknown");
        return json({ error: "account_created_session_failed" }, 503);
      }
      return json({
        session: {
          access_token: signedIn.session.access_token,
          refresh_token: signedIn.session.refresh_token,
        },
        isSuperAdmin: await hasSuperAdminRole(ctx.supabase, signedIn.user?.id),
      });
    }

    if (action === "reset") {
      const email = typeof body.identifier === "string" ? body.identifier.trim().toLowerCase() : "";
      if (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return json({ error: "البريد الإلكتروني غير صالح" }, 400);
      }
      const rateLimitResponse = await checkAuthRateLimit(ctx, req, "reset", email);
      if (rateLimitResponse) return rateLimitResponse;
      const { error } = await ctx.supabase.auth.resetPasswordForEmail(email);
      if (error) {
        console.error("[auth-proxy] password reset failed:", error.code || "unknown");
        return json({ error: "تعذّر إرسال رمز الاستعادة" }, 400);
      }
      return json({ ok: true });
    }

    if (action === "login") {
      if (password.length < 6 || password.length > 128) {
        return json({ error: "كلمة المرور يجب أن تكون بين 6 و128 حرفاً" }, 400);
      }
      const identifier = typeof body.identifier === "string" ? body.identifier.trim() : "";
      const emailInput = typeof body.email === "string"
        ? body.email.trim().toLowerCase()
        : (identifier.includes("@") ? identifier.toLowerCase() : "");
      const phoneInput = typeof body.phone === "string" ? body.phone : (!emailInput ? identifier : "");
      const rateLimitSubject = phoneInput ? normalizePhone(phoneInput) : emailInput;
      const rateLimitResponse = await checkAuthRateLimit(ctx, req, "login", rateLimitSubject);
      if (rateLimitResponse) return rateLimitResponse;
      let accountEmail = emailInput;
      let legacyPhoneEmail: string | null = null;

      if (!accountEmail && phoneInput) {
        if (!isValidPhone(phoneInput)) return json({ error: "رقم الهاتف غير صالح" }, 400);
        const normalizedPhone = normalizePhone(phoneInput);
        legacyPhoneEmail = `phone${phoneInput.replace(/\D/g, "")}@mamnoon.app`;
        const { data: mappedEmail, error: lookupError } = await ctx.supabaseAdmin.rpc(
          "lookup_email_by_phone",
          { _phone: normalizedPhone },
        );
        if (lookupError) console.error("[auth-proxy] phone lookup failed:", lookupError.code || "unknown");
        if (mappedEmail) {
          accountEmail = String(mappedEmail).trim().toLowerCase();
        } else {
          const { data: profile, error: profileError } = await ctx.supabaseAdmin.from("profiles")
            .select("email").in("phone", [phoneInput, normalizedPhone]).maybeSingle();
          if (profileError) {
            console.error("[auth-proxy] profile phone lookup failed:", profileError.code || "unknown");
            return json({ error: "login_lookup_failed" }, 503);
          }
          if (profile?.email) accountEmail = String(profile.email).trim().toLowerCase();
          else accountEmail = `phone${normalizedPhone.replace(/\D/g, "")}@mamnoon.app`;
        }
      }

      if (!accountEmail || accountEmail.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountEmail)) {
        return json({ error: "أدخل رقم الهاتف أو البريد الإلكتروني بشكل صحيح" }, 400);
      }

      let { data: signedIn, error: signInError } = await ctx.supabase.auth.signInWithPassword({
        email: accountEmail,
        password,
      });
      if ((signInError || !signedIn.session) && legacyPhoneEmail && legacyPhoneEmail !== accountEmail) {
        const legacyAttempt = await ctx.supabase.auth.signInWithPassword({
          email: legacyPhoneEmail,
          password,
        });
        signedIn = legacyAttempt.data;
        signInError = legacyAttempt.error;
      }
      if (signInError || !signedIn.session) {
        return json({ error: "رقم الهاتف أو كلمة المرور غير صحيحة" }, 401);
      }

      return json({
        session: {
          access_token: signedIn.session.access_token,
          refresh_token: signedIn.session.refresh_token,
        },
        isSuperAdmin: await hasSuperAdminRole(ctx.supabase, signedIn.user?.id),
      });
    }

    return json({ error: "مسار المصادقة غير معروف" }, 404);
  },
);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const response = await authenticatedHandler(req);
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(corsHeaders)) headers.set(key, value);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (error) {
    console.error("[auth-proxy] request failed:", error instanceof Error ? error.name : "unknown");
    return json({ error: "تعذّر تنفيذ طلب المصادقة حالياً" }, 500);
  }
});
