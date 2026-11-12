import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { normalizePhone } from "@/lib/phone";

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
    let legacyPhoneEmail: string | null = null;
    if (!isEmail) {
      const normalizedPhone = normalizePhone(identifier);
      if (!/^\+\d{8,15}$/.test(normalizedPhone)) {
        throw new Error("أدخل رقم هاتف صحيحاً مع رمز البلد أو بدونه");
      }
      const legacyDigits = identifier.replace(/\D/g, "");
      legacyPhoneEmail = `phone${legacyDigits}@mamnoon.app`;
      const { data: mappedEmail, error: lookupError } = await (supabaseAdmin as any).rpc(
        "lookup_email_by_phone",
        { _phone: normalizedPhone },
      );
      if (lookupError) {
        // The RPC may be missing if the database migration has not been applied.
        // Fall back to the profile table so phone sign-in can still resolve the real email.
        console.error("[signInWithIdentifier] Phone lookup RPC failed:", lookupError.message);
      }
      if (mappedEmail) {
        email = String(mappedEmail).toLowerCase();
      } else {
        const { data: profile, error: profileLookupError } = await supabaseAdmin
          .from("profiles")
          .select("email")
          .in("phone", [identifier, normalizedPhone])
          .maybeSingle();
        if (profileLookupError) {
          console.error("[signInWithIdentifier] Profile phone lookup failed:", profileLookupError.message);
          throw new Error("تعذّر تسجيل الدخول حالياً");
        }
        if (profile?.email) {
          email = profile.email.toLowerCase();
        } else {
          const digits = normalizedPhone.replace(/\D/g, "");
          email = `phone${digits}@mamnoon.app`;
        }
      }
    }

    let { data: authData, error } = await supabaseAdmin.auth.signInWithPassword({
      email,
      password: data.password,
    });
    if ((error || !authData.session) && legacyPhoneEmail && legacyPhoneEmail !== email) {
      const legacyAttempt = await supabaseAdmin.auth.signInWithPassword({
        email: legacyPhoneEmail,
        password: data.password,
      });
      authData = legacyAttempt.data;
      error = legacyAttempt.error;
    }
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


const signupCredentialsSchema = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(8).max(30),
  email: z.string().trim().email().max(255).optional().or(z.literal("")),
  password: z.string().min(6).max(128),
});

export const signUpWithPhone = createServerFn({ method: "POST" })
  .inputValidator((d) => signupCredentialsSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const normalizedPhone = normalizePhone(data.phone);
    if (!/^\+\d{8,15}$/.test(normalizedPhone)) {
      throw new Error("رقم الهاتف غير صالح");
    }

    const contactEmail = (data.email || "").trim().toLowerCase();
    const isSuperAdmin = contactEmail === "a7md0555666@gmail.com";
    const accountEmail = isSuperAdmin ? contactEmail : `phone${normalizedPhone.replace(/\D/g, "")}@mamnoon.app`;

    // Create and confirm the internal login email on the trusted server.
    // The user's actual contact email remains optional metadata only.
    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: accountEmail,
      password: data.password,
      email_confirm: true,
      user_metadata: {
        phone: normalizedPhone,
        full_name: data.name.trim(),
        contact_email: contactEmail || null,
      },
    });

    if (createError || !created.user) {
      // Capture structured Supabase diagnostics on the server without exposing
      // credentials or raw request data to the browser.
      console.error("[signUpWithPhone] Account creation failed:", {
        message: createError?.message,
        code: createError?.code,
        status: (createError as any)?.status,
      });

      // Supabase may report a duplicate email or a database constraint failure.
      // Do not tell the user that their phone is registered unless the existing
      // Auth user is positively matched to this exact normalized phone.
      if (/already registered|already been registered|already exists|duplicate/i.test(createError?.message || "")) {
        const { data: usersPage, error: usersError } = await supabaseAdmin.auth.admin.listUsers({
          page: 1,
          perPage: 1000,
        });
        if (usersError) {
          console.error("[signUpWithPhone] Could not verify existing account:", usersError.message);
        } else {
          const existingUser = usersPage.users.find(
            (user) => user.email?.toLowerCase() === accountEmail.toLowerCase(),
          );
          const existingPhone = String(existingUser?.user_metadata?.phone || "");
          if (existingUser && existingPhone === normalizedPhone) {
            // Recover a prior partially completed signup when its password is valid.
            const { data: recovered, error: recoveryError } = await supabaseAdmin.auth.signInWithPassword({
              email: accountEmail,
              password: data.password,
            });
            if (!recoveryError && recovered.session) {
              return {
                accessToken: recovered.session.access_token,
                refreshToken: recovered.session.refresh_token,
                isSuperAdmin,
              };
            }
            throw new Error("هذا الرقم مرتبط بحساب سابق. استخدم كلمة المرور التي أدخلتها عند المحاولة السابقة أو استعد الحساب.");
          }
        }
      }

      throw new Error("تعذّر إنشاء الحساب بسبب تعارض في بيانات الخادم، ولم يتم التأكد أن رقمك مسجّل. أعد المحاولة أو تواصل مع الإدارة.");
    }

    const { data: signedIn, error: signInError } = await supabaseAdmin.auth.signInWithPassword({
      email: accountEmail,
      password: data.password,
    });

    if (signInError || !signedIn.session) {
      // Avoid leaving an unusable account if session issuance unexpectedly fails.
      const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(created.user.id);
      if (deleteError) {
        console.error("[signUpWithPhone] Cleanup failed:", deleteError.message);
      }
      console.error("[signUpWithPhone] Immediate sign-in failed:", signInError?.message);
      throw new Error("تم إنشاء الحساب لكن تعذّر تسجيل الدخول تلقائياً. حاول تسجيل الدخول.");
    }

    return {
      accessToken: signedIn.session.access_token,
      refreshToken: signedIn.session.refresh_token,
      isSuperAdmin,
    };
  });
