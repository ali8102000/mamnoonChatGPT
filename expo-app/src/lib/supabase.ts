import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import Constants from "expo-constants";
import "react-native-url-polyfill/auto";

// These are public client values only. Never place a Supabase service-role key here.
const configuredUrl =
  String(Constants.expoConfig?.extra?.supabaseUrl ?? "").trim() ||
  process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const configuredPublishableKey =
  String(Constants.expoConfig?.extra?.supabasePublishableKey ?? "").trim() ||
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

export const isSupabaseConfigured = Boolean(
  configuredUrl && configuredPublishableKey,
);

// Keep the app shell renderable when a developer preview is missing its
// environment. Requests will fail against this reserved invalid host rather
// than crashing the entire app during module initialization.
const supabaseUrl = configuredUrl || "https://missing-config.invalid";
const supabaseAnonKey = configuredPublishableKey || "missing-publishable-key";

const storageAdapter =
  Platform.OS === "web"
    ? undefined
    : {
        getItem: (key: string) => SecureStore.getItemAsync(key),
        setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
        removeItem: (key: string) => SecureStore.deleteItemAsync(key),
      };

function createSupabaseFetch(apiKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    if (
      (apiKey.startsWith("sb_publishable_") || apiKey.startsWith("sb_secret_")) &&
      headers.get("Authorization") === `Bearer ${apiKey}`
    ) {
      headers.delete("Authorization");
    }
    headers.set("apikey", apiKey);
    return fetch(input, { ...init, headers });
  };
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: createSupabaseFetch(supabaseAnonKey) },
  auth: {
    storage: storageAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export async function authProxy<T>(path: string, body: Record<string, unknown>): Promise<T> {
  if (!isSupabaseConfigured) {
    throw new Error(
      "إعدادات الاتصال غير مكتملة. أضف رابط Supabase ومفتاح النشر إلى بيئة التطبيق ثم أعد تشغيله.",
    );
  }
  const response = await fetch(`${supabaseUrl}/functions/v1/auth-proxy${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: supabaseAnonKey },
    body: JSON.stringify(body),
  });
  const responseText = await response.text();
  let result: any = null;
  try {
    result = responseText ? JSON.parse(responseText) : null;
  } catch {
    result = null;
  }
  if (!response.ok) {
    const serverMessage = typeof result?.error === "string" ? result.error.trim() : "";
    throw new Error(serverMessage || `تعذر تنفيذ الطلب (رمز ${response.status})`);
  }
  if (!result || typeof result !== "object") {
    throw new Error("استجابة خادم المصادقة غير صالحة. حاول مرة أخرى.");
  }
  return result as T;
}
