import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const credentialsSchema = z.object({
  identifier: z.string().trim().min(3).max(255),
  password: z.string().min(6).max(128),
});

export const signInWithIdentifier = createServerFn({ method: "POST" })
  .inputValidator((d) => credentialsSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const identifier = data.identifier.trim();
    const isEmail = identifier.includes("@");

    let email = identifier.toLowerCase();
    if (!isEmail) {
      const { data: mappedEmail, error: lookupError } = await (supabaseAdmin as any).rpc(
        "lookup_email_by_phone",
        { _phone: identifier },
      );
      if (lookupError) throw new Error("تعذّر تسجيل الدخول حالياً");
      if (mappedEmail) {
        email = String(mappedEmail).toLowerCase();
      } else {
        const digits = identifier.replace(/[^\\d]/g, "");
        email = `phone${digits}@mamnoon.app`;
      }
    }

    const { data: authData, error } = await supabaseAdmin.auth.signInWithPassword({
      email,
      password: data.password,
    });
    if (error || !authData.session) {
      throw new Error("رقم الهاتف أو البريد الإلكتروني أو كلمة المرور غير صحيحة");
    }

    return {
      accessToken: authData.session.access_token,
      refreshToken: authData.session.refresh_token,
    };
  });

export const sendPasswordReset = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        identifier: z.string().trim().min(3).max(255),
        redirectTo: z.string().url().max(500),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const identifier = data.identifier.trim();
    const isEmail = identifier.includes("@");

    let email: string | null = isEmail ? identifier.toLowerCase() : null;
    if (!isEmail) {
      const { data: mappedEmail, error: lookupError } = await (supabaseAdmin as any).rpc(
        "lookup_email_by_phone",
        { _phone: identifier },
      );
      if (lookupError) {
        console.error("[sendPasswordReset] phone lookup failed:", lookupError.message);
        throw new Error("تعذّر العثور على البريد المرتبط برقم الهاتف. جرّب إدخال البريد المسجّل مباشرةً.");
      }
      email = mappedEmail ? String(mappedEmail).trim().toLowerCase() : null;
    }

    if (!email) {
      // Avoid revealing whether a phone number belongs to an account.
      return { ok: true };
    }

    const { getRequest } = await import("@tanstack/react-start/server");
    const request = getRequest();
    const requestOrigin = request?.url ? new URL(request.url).origin : null;
    const redirectUrl = new URL(data.redirectTo);
    const configuredOrigins = (process.env.ALLOWED_REDIRECT_ORIGINS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const allowedOrigins = configuredOrigins.length
      ? configuredOrigins
      : requestOrigin
        ? [requestOrigin]
        : [];

    if (!allowedOrigins.includes(redirectUrl.origin)) {
      console.error("[sendPasswordReset] redirect origin is not allow-listed:", redirectUrl.origin);
      throw new Error("رابط العودة غير مسموح به. راجع إعداد ALLOWED_REDIRECT_ORIGINS وإعدادات Redirect URLs في Supabase.");
    }

    const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email, {
      redirectTo: data.redirectTo,
    });
    if (error) {
      console.error("[sendPasswordReset] Supabase rejected recovery email:", error.message);
      throw new Error("تعذّر إرسال رسالة الاستعادة من خدمة البريد. تحقق من إعداد SMTP في Supabase ثم حاول مجدداً.");
    }

    return { ok: true };
  });
