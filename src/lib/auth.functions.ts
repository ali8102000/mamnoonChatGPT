import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { normalizePhone } from "@/lib/phone";

const credentialsSchema = z.object({
  identifier: z.string().trim().min(3).max(255),
  password: z.string().min(6).max(128),
});

export const signInWithIdentifier = async ({ data }: { data: z.infer<typeof credentialsSchema> }) => {
  const input = credentialsSchema.parse(data);
  const { data: result, error } = await supabase.functions.invoke("auth-proxy", {
    body: { action: "login", identifier: input.identifier, password: input.password },
  });
  if (error || result?.error) {
    const message = result?.error === "invalid_phone"
      ? "أدخل رقم هاتف صحيحاً مع رمز البلد أو بدونه"
      : "رقم الهاتف أو البريد الإلكتروني أو كلمة المرور غير صحيحة";
    throw new Error(message);
  }
  if (!result?.session?.access_token || !result?.session?.refresh_token) throw new Error("تعذّر تسجيل الدخول حالياً");
  return { accessToken: result.session.access_token, refreshToken: result.session.refresh_token };
};

export const sendPasswordReset = async ({ data }: { data: { identifier: string } }) => {
  const input = z.object({ identifier: z.string().trim().email().max(255) }).parse(data);
  const { data: result, error } = await supabase.functions.invoke("auth-proxy", {
    body: { action: "reset", identifier: input.identifier },
  });
  if (error || result?.error) {
    throw new Error("تعذّر إرسال رمز الاستعادة. تحقق من إعدادات البريد في Supabase ثم حاول مجدداً.");
  }
  return { ok: true };
};

const signupCredentialsSchema = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(8).max(30),
  email: z.string().trim().email().max(255).optional().or(z.literal("")),
  password: z.string().min(6).max(128),
});

export const signUpWithPhone = async ({ data }: { data: z.infer<typeof signupCredentialsSchema> }) => {
  const input = signupCredentialsSchema.parse(data);
  const normalizedPhone = normalizePhone(input.phone);
  if (!/^\+\d{8,15}$/.test(normalizedPhone)) throw new Error("رقم الهاتف غير صالح");
  const contactEmail = (input.email || "").trim().toLowerCase();
  const accountEmail = contactEmail || "phone" + normalizedPhone.replace(/\D/g, "") + "@mamnoon.app";
  const { data: result, error } = await supabase.functions.invoke("auth-proxy", {
    body: {
      action: "signup",
      full_name: input.name.trim(),
      phone: normalizedPhone,
      email: accountEmail,
      contact_email: contactEmail || null,
      password: input.password,
    },
  });
  if (error || result?.error) {
    if (result?.error === "existing_account_password_mismatch") {
      throw new Error("هذا الرقم مرتبط بحساب سابق. استخدم كلمة المرور التي أدخلتها عند المحاولة السابقة أو استعد الحساب.");
    }
    if (result?.error === "account_created_session_failed") {
      throw new Error("تم إنشاء الحساب لكن تعذّر تسجيل الدخول تلقائياً. حسابك محفوظ؛ جرّب تسجيل الدخول برقم الهاتف وكلمة المرور نفسها.");
    }
    throw new Error("تعذّر إنشاء الحساب بسبب تعارض في بيانات الخادم، ولم يتم التأكد أن رقمك مسجّل. أعد المحاولة أو تواصل مع الإدارة.");
  }
  if (!result?.session?.access_token || !result?.session?.refresh_token) throw new Error("تعذّر إنشاء الحساب حالياً");
  return {
    accessToken: result.session.access_token,
    refreshToken: result.session.refresh_token,
    isSuperAdmin: result.isSuperAdmin === true,
  };
};
