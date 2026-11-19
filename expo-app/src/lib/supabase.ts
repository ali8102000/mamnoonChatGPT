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

// SecureStore has a practical per-item size limit on Android. Supabase rotates
// refresh tokens and must persist the replacement token before the old one is
// reused. A large session written as one value can fail silently on some
// Android devices, leaving the revoked refresh token on disk and causing
// refresh_token_not_found on the next launch. Store bounded chunks and publish
// the manifest last so readers only see a complete generation.
const SECURE_CHUNK_CODEPOINTS = 400;
type SecureManifest = { version: 1; generation: string; count: number };

function splitSecureValue(value: string): string[] {
  const points = Array.from(value);
  const chunks: string[] = [];
  for (let index = 0; index < points.length; index += SECURE_CHUNK_CODEPOINTS) {
    chunks.push(points.slice(index, index + SECURE_CHUNK_CODEPOINTS).join(""));
  }
  return chunks.length ? chunks : [""];
}

function manifestKey(key: string): string {
  return `${secureStorageKey(key).slice(0, 140)}.manifest`;
}

function chunkKey(key: string, generation: string, index: number): string {
  return `${secureStorageKey(key).slice(0, 100)}.${generation}.${index}`;
}

const storageAdapter =
  Platform.OS === "web"
    ? undefined
    : {
        async getItem(key: string): Promise<string | null> {
          const safeKey = secureStorageKey(key);
          const rawManifest = await SecureStore.getItemAsync(manifestKey(safeKey));
          if (!rawManifest) {
            // Backward compatibility with sessions written by the previous
            // single-value adapter. The next refresh will migrate it to chunks.
            return SecureStore.getItemAsync(safeKey);
          }

          let manifest: SecureManifest;
          try {
            manifest = JSON.parse(rawManifest) as SecureManifest;
          } catch {
            return null;
          }
          if (
            manifest.version !== 1 ||
            typeof manifest.generation !== "string" ||
            !Number.isInteger(manifest.count) ||
            manifest.count < 1 ||
            manifest.count > 100
          ) {
            return null;
          }

          const parts = await Promise.all(
            Array.from({ length: manifest.count }, (_, index) =>
              SecureStore.getItemAsync(chunkKey(safeKey, manifest.generation, index)),
            ),
          );
          if (parts.some((part) => part === null)) return null;
          return (parts as string[]).join("");
        },

        async setItem(key: string, value: string): Promise<void> {
          const safeKey = secureStorageKey(key);
          const manifestName = manifestKey(safeKey);
          const previousRaw = await SecureStore.getItemAsync(manifestName);
          let previous: SecureManifest | null = null;
          if (previousRaw) {
            try {
              previous = JSON.parse(previousRaw) as SecureManifest;
            } catch {
              previous = null;
            }
          }

          const generation = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
          const chunks = splitSecureValue(value);
          if (chunks.length > 100) {
            throw new Error("Supabase auth session exceeds the secure storage capacity.");
          }

          // Write a new generation first. The manifest switch is the commit
          // point, so a process interruption cannot expose a half-written token.
          await Promise.all(
            chunks.map((chunk, index) =>
              SecureStore.setItemAsync(chunkKey(safeKey, generation, index), chunk),
            ),
          );
          await SecureStore.setItemAsync(
            manifestName,
            JSON.stringify({ version: 1, generation, count: chunks.length } satisfies SecureManifest),
          );

          if (previous?.generation && previous.generation !== generation) {
            await Promise.all(
              Array.from({ length: previous.count }, (_, index) =>
                SecureStore.deleteItemAsync(chunkKey(safeKey, previous!.generation, index)),
              ),
            );
          }
          // Remove the legacy single-item value only after the chunked value
          // has been committed successfully.
          await SecureStore.deleteItemAsync(safeKey);
        },

        async removeItem(key: string): Promise<void> {
          const safeKey = secureStorageKey(key);
          const manifestName = manifestKey(safeKey);
          const rawManifest = await SecureStore.getItemAsync(manifestName);
          if (rawManifest) {
            try {
              const manifest = JSON.parse(rawManifest) as SecureManifest;
              if (
                manifest.version === 1 &&
                typeof manifest.generation === "string" &&
                Number.isInteger(manifest.count) &&
                manifest.count > 0 &&
                manifest.count <= 100
              ) {
                await Promise.all(
                  Array.from({ length: manifest.count }, (_, index) =>
                    SecureStore.deleteItemAsync(chunkKey(safeKey, manifest.generation, index)),
                  ),
                );
              }
            } catch {
              // Continue removing the manifest and legacy key even if corrupt.
            }
          }
          await Promise.all([
            SecureStore.deleteItemAsync(manifestName),
            SecureStore.deleteItemAsync(safeKey),
          ]);
        },
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
