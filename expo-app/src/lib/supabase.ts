import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { AppState, Platform } from "react-native";
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

// Expo SecureStore rejects empty keys and characters outside [A-Za-z0-9._-].
// Use a stable, explicit Supabase auth storage key below and defensively
// normalize any key supplied by auth-js before it reaches the native module.
function secureStorageKey(key: string): string {
  const normalized = String(key ?? "").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 200);
  return normalized || "mamnoon-auth-session-v1";
}

const storageAdapter =
  Platform.OS === "web"
    ? undefined
    : {
        getItem: (key: string) => SecureStore.getItemAsync(secureStorageKey(key)),
        setItem: (key: string, value: string) =>
          SecureStore.setItemAsync(secureStorageKey(key), value),
        removeItem: (key: string) => SecureStore.deleteItemAsync(secureStorageKey(key)),
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
    storageKey: "mamnoon-auth-session-v1",
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Supabase cannot reliably infer foreground/background state in React Native.
// Keep token refresh active while the app is visible and pause it in background.
// Register this once beside the singleton client, not from individual screens.
if (Platform.OS !== "web") {
  const syncAuthRefreshWithAppState = (state: string | null) => {
    if (state === "active") {
      void supabase.auth.startAutoRefresh().catch((error) => {
        console.warn("[auth] Could not start token auto-refresh:", error);
      });
    } else {
      void supabase.auth.stopAutoRefresh().catch((error) => {
        console.warn("[auth] Could not stop token auto-refresh:", error);
      });
    }
  };

  AppState.addEventListener("change", syncAuthRefreshWithAppState);
  syncAuthRefreshWithAppState(AppState.currentState);
}

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
