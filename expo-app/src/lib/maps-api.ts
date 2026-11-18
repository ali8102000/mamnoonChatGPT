import { supabase } from "./supabase";

export async function callMamnoonMapsApi<T>(payload: Record<string, unknown>): Promise<T> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData.session?.access_token) {
    throw new Error("انتهت جلسة الدخول. سجّل الدخول مرة ثانية.");
  }

  const { data, error } = await supabase.functions.invoke("maps-proxy", { body: payload });
  if (error) {
    const serverMessage = data && typeof data === "object" && "error" in data
      ? (data as { error?: unknown }).error
      : null;
    throw new Error(
      typeof serverMessage === "string"
        ? serverMessage
        : error.message || "تعذّر الاتصال بخدمة الخرائط.",
    );
  }
  if (data && typeof data === "object" && "error" in data && typeof (data as { error?: unknown }).error === "string") {
    throw new Error((data as { error: string }).error);
  }
  return data as T;
}
