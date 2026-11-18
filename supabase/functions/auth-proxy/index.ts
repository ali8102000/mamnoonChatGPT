import { withSupabase } from "npm:@supabase/server@1.6.1";

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

const authenticatedHandler = withSupabase(
  { auth: "publishable" },
  async (req, ctx) => {
    if (req.method !== "POST") return json({ error: "الطريقة غير مدعومة" }, 405);

    const contentLength = Number(req.headers.get("content-length") || "0");
    if (contentLength > 16000) return json({ error: "حجم الطلب كبير" }, 413);

    const url = new URL(req.url);
    const body = await req.json().catch(() => null);
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
      const accountEmail = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const contactEmail = typeof body.contact_email === "string" ? body.contact_email.trim().toLowerCase() : "";

      if (fullName.length < 2 || fullName.length > 100) return json({ error: "الاسم غير صالح" }, 400);
      if (!isValidPhone(phone)) return json({ error: "رقم الهاتف غير صالح" }, 400);
      if (contactEmail && (contactEmail.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail))) {
        return json({ error: "البريد الإلكتروني غير صالح" }, 400);
      }
      const expectedAccountEmail = contactEmail || "phone" + phone.replace(/\D/g, "") + "@mamnoon.app";
      if (!accountEmail || accountEmail !== expectedAccountEmail) {
        return json({ error: "بيانات الحساب غير متطابقة" }, 400);
      }

      const { data: created, error: createError } = await ctx.supabaseAdmin.auth.admin.createUser({
        email: accountEmail,
        password,
        email_confirm: true,
        user_metadata: { phone, full_name: fullName, contact_email: contactEmail || null },
      });

      if (createError || !created?.user) {
        const message = createError?.message || "";
        if (/already registered|already been registered|already exists|duplicate/i.test(message)) {
          const { data: usersPage, error: usersError } = await ctx.supabaseAdmin.auth.admin.listUsers({
            page: 1,
            perPage: 1000,
          });
          if (!usersError) {
            const existingUser = usersPage.users.find(
              (user) => user.email?.toLowerCase() === accountEmail.toLowerCase(),
            );
            const existingPhone = String(existingUser?.user_metadata?.phone || "");
            if (existingUser && existingPhone === phone) {
              const { data: recovered, error: recoveryError } = await ctx.supabase.auth.signInWithPassword({
                email: accountEmail,
                password,
              });
              if (!recoveryError && recovered.session) {
                return json({
                  session: {
                    access_token: recovered.session.access_token,
                    refresh_token: recovered.session.refresh_token,
                  },
                  isSuperAdmin: await hasSuperAdminRole(ctx.supabase, recovered.user?.id),
                });
              }
              return json({ error: "existing_account_password_mismatch" }, 409);
            }
          } else {
            console.error("[auth-proxy] duplicate account verification failed:", usersError.code || "unknown");
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
