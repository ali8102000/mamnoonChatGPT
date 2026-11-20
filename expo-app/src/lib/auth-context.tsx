import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { supabase } from "./supabase";

export type AppRole =
  | "customer"
  | "driver"
  | "large_driver"
  | "worker"
  | "admin"
  | "super_admin"
  | "support"
  | "finance"
  | "moderator";

export interface Profile {
  id: string;
  phone: string;
  full_name: string;
  avatar_url: string | null;
}

interface AuthCtx {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  roles: AppRole[];
  isAdmin: boolean;
  activeRole: AppRole | null;
  setActiveRole: (role: AppRole) => Promise<void>;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

interface CachedAuthProfile {
  profile: Profile | null;
  roles: AppRole[];
  cachedAt: number;
}

const Ctx = createContext<AuthCtx | null>(null);
const CACHE_VERSION = "mamnoon-auth-profile-v1";
const knownRoles = new Set<AppRole>([
  "customer", "driver", "large_driver", "worker", "admin",
  "super_admin", "support", "finance", "moderator",
]);
// SecureStore keys must contain only [A-Za-z0-9._-]. The previous colon
// separator caused native role switching to fail on Android.
const secureStoreKey = (value: string, fallback: string) => {
  const safe = String(value ?? "").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 200);
  return safe || fallback;
};
const authCacheKey = (uid: string) => secureStoreKey(`${CACHE_VERSION}_${uid}`, "mamnoon-auth-profile-v1");
const rolePreferenceKey = (uid: string) => secureStoreKey(`mamnoon-active-role-v1_${uid}`, "mamnoon-active-role-v1");

function withStartupTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    operation,
    new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); }),
  ]).finally(() => { if (timer) clearTimeout(timer); });
}

async function readCachedAuthProfile(uid: string): Promise<CachedAuthProfile | null> {
  try {
    const raw = await SecureStore.getItemAsync(authCacheKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedAuthProfile>;
    if (!Array.isArray(parsed.roles)) return null;
    const profile =
      parsed.profile && typeof parsed.profile === "object" && parsed.profile.id === uid
        ? parsed.profile as Profile
        : null;
    const roles = parsed.roles.filter((role): role is AppRole =>
      typeof role === "string" && knownRoles.has(role as AppRole),
    );
    return { profile, roles, cachedAt: Number(parsed.cachedAt) || 0 };
  } catch {
    return null;
  }
}

async function writeCachedAuthProfile(uid: string, snapshot: CachedAuthProfile) {
  try {
    await SecureStore.setItemAsync(authCacheKey(uid), JSON.stringify(snapshot));
  } catch (error) {
    console.warn("[offline] Could not save the local account snapshot:", error);
  }
}

async function clearCachedAuthProfile(uid: string | null) {
  if (!uid) return;
  try {
    await Promise.all([
      SecureStore.deleteItemAsync(authCacheKey(uid)),
      SecureStore.deleteItemAsync(secureStoreKey(`mamnoon-history-v1_${uid}`, "mamnoon-history-v1")),
      SecureStore.deleteItemAsync(secureStoreKey(`mamnoon-wallet-v1_${uid}`, "mamnoon-wallet-v1")),
      SecureStore.deleteItemAsync(secureStoreKey(`mamnoon-chats-v1_${uid}`, "mamnoon-chats-v1")),
    ]);
  } catch (error) {
    console.warn("[offline] Could not clear the local account snapshot:", error);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [activeRole, setActiveRoleState] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);
  const lastUserId = useRef<string | null>(null);
  // Prevent an older getSession() response from overwriting a newer auth event.
  const authRevision = useRef(0);
  // A revision invalidates restores as soon as the user requests a role switch.
  const roleRevision = useRef(0);
  // Serialize SecureStore writes so an older switch cannot finish after a newer one.
  const roleWriteQueue = useRef<Promise<void>>(Promise.resolve());

  async function restoreActiveRole(uid: string, availableRoles: AppRole[]) {
    const revisionAtStart = roleRevision.current;
    const fallback = availableRoles.includes("customer")
      ? "customer"
      : availableRoles[0] ?? null;
    try {
      // Wait for any role switch already requested before reading the preference.
      await roleWriteQueue.current.catch(() => undefined);
      if (roleRevision.current !== revisionAtStart || lastUserId.current !== uid) return;

      const preferenceKey = rolePreferenceKey(uid);
      const saved = await SecureStore.getItemAsync(preferenceKey);
      const legacy = saved ? null : await SecureStore.getItemAsync("mamnoon_active_role");
      const selected = saved && availableRoles.includes(saved as AppRole)
        ? saved as AppRole
        : legacy && availableRoles.includes(legacy as AppRole)
          ? legacy as AppRole
          : fallback;

      // A profile refresh can finish after a manual role switch. Never let
      // that older restore operation replace the user's latest selection.
      if (roleRevision.current !== revisionAtStart || lastUserId.current !== uid) return;
      setActiveRoleState(selected);
    } catch (error) {
      console.warn("[Mamnoon] Could not restore the saved role:", error);
      if (roleRevision.current === revisionAtStart && lastUserId.current === uid) setActiveRoleState(fallback);
    }
  }

  async function setActiveRole(role: AppRole) {
    if (!roles.includes(role)) {
      throw new Error("هذا الدور غير مرتبط بحسابك.");
    }

    const uid = session?.user.id;
    if (!uid) {
      throw new Error("جلسة الدخول غير موجودة. سجّل الدخول من جديد.");
    }

    // Invalidate an in-flight restore immediately, then serialize writes.
    const revision = ++roleRevision.current;
    const write = roleWriteQueue.current
      .catch(() => undefined)
      .then(() => withStartupTimeout(SecureStore.setItemAsync(rolePreferenceKey(uid), role), 8000, "active_role_write_timeout"));
    roleWriteQueue.current = write;
    await write;

    // If a newer role was requested while this write was pending, its queued
    // write will become the persisted value and only it may update the UI.
    if (roleRevision.current !== revision || lastUserId.current !== uid) return;
    setActiveRoleState(role);
  }

  async function loadProfile(uid: string) {
    let cached: CachedAuthProfile | null = null;
    try {
      cached = await withStartupTimeout(readCachedAuthProfile(uid), 5000, "local_account_cache_timeout");
    } catch (error) {
      console.warn("[startup] Local account cache unavailable; continuing:", error);
    }
    // Restore the last known non-privileged session immediately while fresh
    // profile/role data is fetched in parallel in the background.
    if (cached && lastUserId.current === uid) {
      setProfile(cached.profile);
      setRoles(cached.roles);
      await withStartupTimeout(restoreActiveRole(uid, cached.roles), 5000, "cached_role_restore_timeout").catch((error) => {
        console.warn("[startup] Cached role restore timed out; retaining cached profile:", error);
      });
      const requiresFreshPrivilegeCheck = cached.roles.some((role) =>
        role === "admin" || role === "super_admin" || role === "support" ||
        role === "finance" || role === "moderator"
      );
      if (!requiresFreshPrivilegeCheck) setLoading(false);
    }
    try {
      const [profileResult, rolesResult, driverResult, workerResult] = await withStartupTimeout(Promise.all([
        supabase
          .from("profiles")
          .select("id, phone, full_name, avatar_url")
          .eq("id", uid)
          .maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", uid),
        supabase.from("driver_profiles").select("user_id,vehicle_category").eq("user_id", uid).maybeSingle(),
        supabase.from("worker_profiles").select("user_id").eq("user_id", uid).maybeSingle(),
      ]), 12000, "account_bootstrap_timeout");

      // Ignore stale lookups when a different account signed in while these
      // parallel Supabase requests were still running.
      if (lastUserId.current !== uid) return;

      const resolvedProfile = profileResult.error
        ? cached?.profile ?? null
        : profileResult.data ?? null;
      const mappedRoles: AppRole[] = rolesResult.error
        ? [...(cached?.roles ?? [])]
        : (rolesResult.data ?? []).map((row) => row.role as AppRole);

      // Preserve provider roles from the last successful online read if only
      // the provider-profile lookup is unavailable while the device is offline.
      if (driverResult.error) {
        for (const role of cached?.roles ?? []) {
          if ((role === "driver" || role === "large_driver") && !mappedRoles.includes(role)) {
            mappedRoles.push(role);
          }
        }
      } else if (driverResult.data?.vehicle_category === "large") {
        if (!mappedRoles.includes("large_driver")) mappedRoles.push("large_driver");
      } else if (driverResult.data && !mappedRoles.includes("driver")) {
        mappedRoles.push("driver");
      }

      if (workerResult.error) {
        if (cached?.roles.includes("worker") && !mappedRoles.includes("worker")) {
          mappedRoles.push("worker");
        }
      } else if (workerResult.data && !mappedRoles.includes("worker")) {
        mappedRoles.push("worker");
      }

      if (!mappedRoles.includes("customer")) mappedRoles.unshift("customer");
      setProfile(resolvedProfile);
      setRoles(mappedRoles);
      await withStartupTimeout(restoreActiveRole(uid, mappedRoles), 5000, "active_role_restore_timeout").catch((error) => {
        console.warn("[startup] Active role restore timed out; retaining safe role fallback:", error);
      });

      if (
        !profileResult.error &&
        !rolesResult.error &&
        !driverResult.error &&
        !workerResult.error
      ) {
        await withStartupTimeout(writeCachedAuthProfile(uid, {
          profile: resolvedProfile,
          roles: mappedRoles,
          cachedAt: Date.now(),
        }), 5000, "account_cache_write_timeout").catch((error) => {
          console.warn("[startup] Could not finish saving the account cache:", error);
        });
      }
    } catch (error) {
      if (lastUserId.current !== uid) return;
      console.warn("[offline] Account lookup failed; using the last saved account snapshot.", error);
      setProfile(cached?.profile ?? null);
      const fallbackRoles: AppRole[] = cached?.roles?.length ? cached.roles : ["customer"];
      setRoles(fallbackRoles);
      await withStartupTimeout(restoreActiveRole(uid, fallbackRoles), 5000, "active_role_fallback_timeout").catch((roleError) => {
        console.warn("[startup] Could not restore the active role; using customer fallback:", roleError);
        if (lastUserId.current === uid) setActiveRoleState("customer");
      });
    }
  }

  // Keep the context refresh function referentially stable. Screens use it
  // in effects; recreating it on every render can create an endless refresh loop.
  const refreshInFlight = useRef<Promise<void> | null>(null);
  const refresh = useCallback((): Promise<void> => {
    if (refreshInFlight.current) return refreshInFlight.current;

    const operation = (async () => {
      const revisionAtStart = authRevision.current;
      try {
        const { data, error } = await withStartupTimeout(supabase.auth.getSession(), 12000, "auth_session_restore_timeout");
        if (error) throw error;
        if (authRevision.current !== revisionAtStart) return;
        setSession(data.session);
        const uid = data.session?.user.id ?? null;
        if (uid) {
          const previousId = lastUserId.current;
          if (previousId !== uid) roleRevision.current += 1;
          if (previousId && previousId !== uid) void clearCachedAuthProfile(previousId);
          lastUserId.current = uid;
          await loadProfile(uid);
        } else {
          const previousId = lastUserId.current;
          if (previousId) roleRevision.current += 1;
          lastUserId.current = null;
          setProfile(null);
          setRoles([]);
          setActiveRoleState(null);
          await clearCachedAuthProfile(previousId);
        }
      } catch (error) {
        console.warn("[offline] Could not refresh the account session:", error);
        const uid = lastUserId.current;
        if (authRevision.current === revisionAtStart && uid) await loadProfile(uid);
      }
    })();

    refreshInFlight.current = operation;
    void operation.then(
      () => { if (refreshInFlight.current === operation) refreshInFlight.current = null; },
      (error) => {
        console.warn("[auth] Background refresh failed:", error);
        if (refreshInFlight.current === operation) refreshInFlight.current = null;
      },
    );
    return operation;
  }, []);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      authRevision.current += 1;
      setSession(nextSession);
      const nextUserId = nextSession?.user.id ?? null;
      const previousId = lastUserId.current;
      if (previousId !== nextUserId) roleRevision.current += 1;
      if (nextUserId) {
        if (previousId && previousId !== nextUserId) void clearCachedAuthProfile(previousId);
        lastUserId.current = nextUserId;
        setTimeout(() => { void loadProfile(nextUserId); }, 0);
      } else {
        lastUserId.current = null;
        setProfile(null);
        setRoles([]);
        setActiveRoleState(null);
        void clearCachedAuthProfile(previousId);
      }
    });

    let active = true;
    const initialAuthRevision = authRevision.current;
    withStartupTimeout(supabase.auth.getSession(), 12000, "auth_session_restore_timeout")
      .then(async ({ data, error }) => {
        if (error) throw error;
        if (!active || authRevision.current !== initialAuthRevision) return;
        setSession(data.session);
        const uid = data.session?.user.id ?? null;
        lastUserId.current = uid;
        if (uid) await loadProfile(uid);
      })
      .catch(async () => {
        if (!active || authRevision.current !== initialAuthRevision) return;
        // A transient network failure must not erase a locally persisted
        // Supabase session or the last known profile and role snapshot.
        const uid = lastUserId.current;
        if (uid) await loadProfile(uid);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut({ scope: "local" });
  };

  return (
    <Ctx.Provider
      value={{ session, user: session?.user ?? null, profile, roles, isAdmin: roles.includes("admin") || roles.includes("super_admin"), activeRole, setActiveRole, loading, refresh, signOut }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
