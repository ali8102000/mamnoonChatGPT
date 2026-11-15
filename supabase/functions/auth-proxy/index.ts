// Snapshot of the active Supabase auth-proxy Edge Function (version 1)
// Retrieved read-only on 2026-11-15. This file is for source control and review;
// it has NOT been deployed from this repository.
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

const authenticatedHandler = withSupabase(
  { auth: "publishable" },
  async (req, ctx) => {
    if (req.method !== "POST") return json({ error: "الطريقة غير مدعومة" }, 405);

    const contentLength = Number(req.headers.get("content-length") || "0");
    if (contentLength > 16000) return json({ error: "حجم الطلب كبير" }, 413);

    const url = new URL(req.url);
    const action = url.pathname.split("/").filter(Boolean).at(-1);
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return json({ error: "بيانات الطلب غير صالحة" }, 400);
    }

    const password = typeof body.password === "string" ? body.password : "";
    if (password.length < 6 || password.length > 128) {
      return json({ error: "كلمة المرور يجب أن تكون بين 6 و128 حرفاً" }, 400);
    }

    if (action === "signup") {
      const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
      const phoneInput = typeof body.phone === "string" ? body.phone : "";
      const phone = normalizePhone(phoneInput);
      const accountEmail = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const contactEmail = typeof body.contact_email === "string"
        ? body.contact_email.trim().toLowerCase()
        : "";

      if (fullName.length < 2 || fullName.length > 100) {
        return json({ error: "الاسم يجب أن يكون بين حرفين و100 حرف" }, 400);
      }
      if (!isValidPhone(phone)) return json({ error: "رقم الهاتف غير صالح" }, 400);
      if (!accountEmail || accountEmail.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountEmail)) {
        return json({ error: "البريد الإلكتروني للحساب غير صالح" }, 400);
      }
      if (contactEmail && (contactEmail.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail))) {
        return json({ error: "البريد الإلكتروني غير صالح" }, 400);
      }

      const { data: created, error: createError } = await ctx.supabaseAdmin.auth.admin.createUser({
        email: accountEmail,
        password,
        email_confirm: true,
        user_metadata: {
          phone,
          full_name: fullName,
          contact_email: contactEmail || null,
        },
      });

      if (createError || !created?.user) {
        const message = createError?.message || "تعذّر إنشاء الحساب";
        if (/already registered|already been registered|already exists|duplicate/i.test(message)) {
          return json({ error: "هذا الحساب مسجّل مسبقاً. حاول تسجيل الدخول." }, 409);
        }
        console.error("[auth-proxy] signup createUser failed:", createError?.code || "unknown");
        return json({ error: "تعذّر إنشاء الحساب حالياً. حاول مرة أخرى." }, 400);
      }

      const { data: signedIn, error: signInError } = await ctx.supabase.auth.signInWithPassword({
        email: accountEmail,
        password,
      });
      if (signInError || !signedIn.session) {
        console.error("[auth-proxy] signup session creation failed:", signInError?.code || "unknown");
        return json({
          error: "تم إنشاء الحساب لكن تعذّر تسجيل الدخول تلقائياً. حسابك محفوظ؛ جرّب الدخول بنفس الرقم وكلمة المرور.",
        }, 503);
      }

      return json({
        session: {
          access_token: signedIn.session.access_token,
          refresh_token: signedIn.session.refresh_token,
        },
      });
    }

    if (action === "login") {
      const emailInput = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const phoneInput = typeof body.phone === "string" ? body.phone : "";
      let accountEmail = emailInput;

      if (!accountEmail && phoneInput) {
        if (!isValidPhone(phoneInput)) return json({ error: "رقم الهاتف غير صالح" }, 400);
        const normalizedPhone = normalizePhone(phoneInput);
        const { data: mappedEmail, error: lookupError } = await ctx.supabaseAdmin.rpc(
          "lookup_email_by_phone",
          { _phone: normalizedPhone },
        );
        if (lookupError) {
          console.error("[auth-proxy] phone lookup failed:", lookupError.code || "unknown");
        }
        if (mappedEmail) {
          accountEmail = String(mappedEmail).trim().toLowerCase();
        } else {
          accountEmail = `phone${normalizedPhone.replace(/\D/g, "")}@mamnoon.app`;
        }
      }

      if (!accountEmail || accountEmail.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountEmail)) {
        return json({ error: "أدخل رقم الهاتف أو البريد الإلكتروني بشكل صحيح" }, 400);
      }

      const { data: signedIn, error: signInError } = await ctx.supabase.auth.signInWithPassword({
        email: accountEmail,
        password,
      });
      if (signInError || !signedIn.session) {
        return json({ error: "رقم الهاتف أو كلمة المرور غير صحيحة" }, 401);
      }

      return json({
        session: {
          access_token: signedIn.session.access_token,
          refresh_token: signedIn.session.refresh_token,
        },
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
