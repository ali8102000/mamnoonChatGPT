export function phoneToEmail(rawPhone: string): string {
  const normalized = normalizePhone(rawPhone);
  const digits = normalized.replace(/[^\d]/g, "");
  return `phone${digits}@mamnoon.app`;
}

export function normalizePhone(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, "");
  if (trimmed.startsWith("+")) return "+" + trimmed.slice(1).replace(/[^\d]/g, "");
  const digits = trimmed.replace(/[^\d]/g, "");
  if (digits.startsWith("964")) return "+" + digits;
  if (digits.startsWith("0")) return "+964" + digits.slice(1);
  if (digits.startsWith("7") && digits.length === 10) return "+964" + digits;
  return "+" + digits;
}

export function isValidPhone(raw: string): boolean {
  const n = normalizePhone(raw);
  return /^\+\d{8,15}$/.test(n);
}


import { Alert, Linking } from "react-native";

/**
 * Shows the available ways to contact an Iraqi phone number.
 * WhatsApp opens a direct one-to-one chat; the user still chooses whether to send a message.
 */
export function showContactOptions(rawPhone: string): void {
  const normalized = normalizePhone(rawPhone);
  if (!isValidPhone(normalized)) {
    Alert.alert("تعذر الاتصال", "رقم الهاتف غير صالح أو غير متوفر.");
    return;
  }

  const digits = normalized.replace(/\\D/g, "");
  const whatsappUrl = `https://wa.me/${digits}`;
  const phoneUrl = `tel:${normalized}`;

  Alert.alert("طريقة التواصل", "اختَر طريقة الاتصال", [
    {
      text: "اتصال هاتفي",
      onPress: () => {
        void Linking.openURL(phoneUrl).catch(() => {
          Alert.alert("تعذر الاتصال", "لم نتمكن من فتح تطبيق الهاتف على هذا الجهاز.");
        });
      },
    },
    {
      text: "محادثة واتساب",
      onPress: () => {
        void Linking.openURL(whatsappUrl).catch(() => {
          Alert.alert("تعذر فتح واتساب", "تأكد من تثبيت واتساب أو جرّب فتح الرابط من المتصفح.");
        });
      },
    },
    { text: "إلغاء", style: "cancel" },
  ]);
}
