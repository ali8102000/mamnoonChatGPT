import { z } from "zod";
import { isValidPhone, normalizePhone } from "./phone";

export const signupSchema = z.object({
  name: z.string().trim().min(2, "الرجاء إدخال الاسم الكامل").max(100, "الاسم طويل جدًا"),
  phone: z.string().max(30).refine(isValidPhone, "رقم الهاتف غير صالح").transform(normalizePhone),
  email: z.string().trim().max(255).optional().default("").refine(value => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), "البريد الإلكتروني غير صالح").transform(value => value.toLowerCase()),
  password: z.string().min(6, "كلمة المرور يجب أن تكون ٦ أحرف على الأقل").max(128),
});

export function requiresEmailConfirmation(session: unknown): boolean {
  return session == null;
}