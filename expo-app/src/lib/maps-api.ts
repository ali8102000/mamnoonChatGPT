import { supabase } from "./supabase";

const API_BASE =
  process.env.EXPO_PUBLIC_MAMNOON_API_URL?.trim().replace(/\/+$/, "") ||
  "https://existing-project-onrampadminbootstrap.lovable.app";

export async function callMamnoonMapsApi<T>(payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) {
    throw new Error("انتهت جلسة الدخول. سجّل الدخول مرة ثانية.");
  }

  const response = await fetch(`${API_BASE}/api/mobile-maps`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${data.session.access_token}`,
    },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof result?.error === "string" ? result.error : "تعذّر الاتصال بخدمة الخرائط.",
    );
  }
  return result as T;
}
