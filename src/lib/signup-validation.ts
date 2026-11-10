import { z } from "zod";
import { isValidPhone, normalizePhone } from "./phone";

export const signupSchema = z.object({
  name: z.string().trim().min(2, "الرجاء إدخال الاسم الكامل").max(100, "الاسم طويل جدًا"),
  phone: z.string().max(30).refine(isValidPhone, "رقم الهاتف غير صالح").transform(normalizePhone),
  email: z.string().trim().min(1, "البريد الإلكتروني مطلوب").email("البريد الإلكتروني غير صالح").max(255).transform(value => value.toLowerCase()),
  password: z.string().min(6, "كلمة المرور يجب أن تكون ٦ أحرف على الأقل").max(128),
});

export function requiresEmailConfirmation(session: unknown): boolean {
  return session == null;
}