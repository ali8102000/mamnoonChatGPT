import { Alert, Linking } from "react-native";
import { isValidPhone, normalizePhone } from "@/lib/phone";

/**
 * Opens a direct phone call or one-to-one WhatsApp chat.
 * WhatsApp opens the conversation; sending a message remains the user's choice.
 */
export function showContactOptions(rawPhone: string): void {
  const normalized = normalizePhone(rawPhone);
  if (!isValidPhone(normalized)) {
    Alert.alert("تعذر الاتصال", "رقم الهاتف غير صالح أو غير متوفر.");
    return;
  }

  const digits = normalized.slice(1);
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
