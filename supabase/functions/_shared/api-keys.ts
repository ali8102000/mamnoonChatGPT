type KeyDictionary = Record<string, unknown>;

function readKeyFromDictionary(variableName: "SUPABASE_PUBLISHABLE_KEYS" | "SUPABASE_SECRET_KEYS"): string | null {
  const raw = Deno.env.get(variableName);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const keys = parsed as KeyDictionary;
    const defaultKey = keys.default;
    if (typeof defaultKey === "string" && defaultKey.trim()) return defaultKey.trim();
    const firstActiveKey = Object.values(keys).find(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    );
    return firstActiveKey?.trim() ?? null;
  } catch {
    return null;
  }
}

/**
 * Prefer Supabase's modern publishable API key. The legacy anon key remains a
 * temporary fallback during the end-of-2026 key migration window.
 */
export function getSupabasePublishableKey(): string {
  const key =
    readKeyFromDictionary("SUPABASE_PUBLISHABLE_KEYS") ??
    Deno.env.get("SUPABASE_ANON_KEY")?.trim();
  if (!key) {
    throw new Error("missing_supabase_publishable_key");
  }
  return key;
}

/**
 * Prefer the modern secret API key for server-side privileged clients. The
 * legacy service_role key remains a fallback so deployments can migrate
 * without downtime while Edge Function secrets are rolled out.
 */
export function getSupabaseSecretKey(): string {
  const key =
    readKeyFromDictionary("SUPABASE_SECRET_KEYS") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!key) {
    throw new Error("missing_supabase_secret_key");
  }
  return key;
}

/**
 * Keeps modern opaque API keys in the apikey header. A caller's real user JWT
 * remains in Authorization unchanged; only a duplicate Bearer API-key value
 * is removed.
 */
export function createSupabaseFetch(apiKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }
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
