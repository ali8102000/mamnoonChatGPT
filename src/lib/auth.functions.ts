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
        identifier: z.string().trim().email().max(255),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = data.identifier.trim().toLowerCase();

    // A recovery OTP uses the Supabase Reset Password email template's {{ .Token }}.
    // No redirect URL is needed for the OTP verification flow.
    const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email);
    if (error) {
      console.error("[sendPasswordReset] Supabase rejected recovery email:", error.message);
      throw new Error("تعذّر إرسال رمز الاستعادة. تحقق من إعدادات البريد في Supabase ثم حاول مجدداً.");
    }

    return { ok: true };
  });
