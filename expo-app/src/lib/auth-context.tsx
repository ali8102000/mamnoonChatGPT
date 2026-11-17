import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
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
const authCacheKey = (uid: string) => `${CACHE_VERSION}:${uid}`;
const rolePreferenceKey = (uid: string) => `mamnoon-active-role-v1:${uid}`;

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
      SecureStore.deleteItemAsync(`mamnoon-history-v1:${uid}`),
      SecureStore.deleteItemAsync(`mamnoon-wallet-v1:${uid}`),
      SecureStore.deleteItemAsync(`mamnoon-chats-v1:${uid}`),
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

  async function restoreActiveRole(uid: string, availableRoles: AppRole[]) {
    const fallback = availableRoles.includes("customer")
      ? "customer"
      : availableRoles[0] ?? null;
    try {
      const preferenceKey = rolePreferenceKey(uid);
      let saved = await SecureStore.getItemAsync(preferenceKey);
      const legacy = await SecureStore.getItemAsync("mamnoon_active_role");
      if (!saved && legacy && availableRoles.includes(legacy as AppRole)) {
        saved = legacy;
        await SecureStore.setItemAsync(preferenceKey, legacy);
      }
      if (legacy) await SecureStore.deleteItemAsync("mamnoon_active_role");
      const selected = saved && availableRoles.includes(saved as AppRole)
        ? saved as AppRole
        : fallback;
      setActiveRoleState(selected);
      if (selected) await SecureStore.setItemAsync(preferenceKey, selected);
    } catch (error) {
      console.warn("[Mamnoon] Could not restore the saved role:", error);
      setActiveRoleState(fallback);
    }
  }

  async function setActiveRole(role: AppRole) {
    if (!roles.includes(role)) return;
    setActiveRoleState(role);
    const uid = session?.user.id;
    if (uid) {
      try {
        await SecureStore.setItemAsync(rolePreferenceKey(uid), role);
      } catch (error) {
        console.warn("[Mamnoon] Could not persist the selected role:", error);
      }
    }
  }

  async function loadProfile(uid: string) {
    const cached = await readCachedAuthProfile(uid);
    try {
      const [profileResult, rolesResult, driverResult, workerResult] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, phone, full_name, avatar_url")
          .eq("id", uid)
          .maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", uid),
        supabase.from("driver_profiles").select("user_id,vehicle_category").eq("user_id", uid).maybeSingle(),
        supabase.from("worker_profiles").select("user_id").eq("user_id", uid).maybeSingle(),
      ]);

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
      await restoreActiveRole(uid, mappedRoles);

      if (
        !profileResult.error &&
        !rolesResult.error &&
        !driverResult.error &&
        !workerResult.error
      ) {
        await writeCachedAuthProfile(uid, {
          profile: resolvedProfile,
          roles: mappedRoles,
          cachedAt: Date.now(),
        });
      }
    } catch (error) {
      console.warn("[offline] Account lookup failed; using the last saved account snapshot.", error);
      setProfile(cached?.profile ?? null);
      const fallbackRoles: AppRole[] = cached?.roles?.length ? cached.roles : ["customer"];
      setRoles(fallbackRoles);
      await restoreActiveRole(uid, fallbackRoles);
    }
  }

  async function refresh() {
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      setSession(data.session);
      const uid = data.session?.user.id ?? null;
      if (uid) {
        const previousId = lastUserId.current;
        if (previousId && previousId !== uid) void clearCachedAuthProfile(previousId);
        lastUserId.current = uid;
        await loadProfile(uid);
      } else {
        const previousId = lastUserId.current;
        lastUserId.current = null;
        setProfile(null);
        setRoles([]);
        setActiveRoleState(null);
        await clearCachedAuthProfile(previousId);
      }
    } catch (error) {
      console.warn("[offline] Could not refresh the account session:", error);
      const uid = lastUserId.current;
      if (uid) await loadProfile(uid);
    }
  }

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      const nextUserId = nextSession?.user.id ?? null;
      const previousId = lastUserId.current;
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
    supabase.auth
      .getSession()
      .then(async ({ data, error }) => {
        if (error) throw error;
        if (!active) return;
        setSession(data.session);
        const uid = data.session?.user.id ?? null;
        lastUserId.current = uid;
        if (uid) await loadProfile(uid);
      })
      .catch(async () => {
        if (!active) return;
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
    await supabase.auth.signOut();
  };

  return (
    <Ctx.Provider
      value={{ session, user: session?.user ?? null, profile, roles, activeRole, setActiveRole, loading, refresh, signOut }}
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
