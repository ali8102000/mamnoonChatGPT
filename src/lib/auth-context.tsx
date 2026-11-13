import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export const SUPER_ADMIN_EMAIL = "a7md0555666@gmail.com";

export type AppRole =
  | "customer"
  | "driver"
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
  email?: string | null;
}

export interface BanStatus {
  isBanned: boolean;
  reason: string | null;
  expiresAt: string | null;
  blockedAt?: string | null;
}

interface AuthCtx {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  roles: AppRole[];
  activeRole: AppRole | null;
  setActiveRole: (role: AppRole) => void;
  isSuperAdmin: boolean;
  banStatus: BanStatus | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [banStatus, setBanStatus] = useState<BanStatus | null>(null);
  const [activeRole, setActiveRoleState] = useState<AppRole | null>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("mumnun-active-role") as AppRole | null) || null;
    }
    return null;
  });
  const [loading, setLoading] = useState(true);

  const setActiveRole = (newRole: AppRole) => {
    setActiveRoleState(newRole);
    if (typeof window !== "undefined") {
      localStorage.setItem("mumnun-active-role", newRole);
    }
  };

  const isSuperAdmin = roles.includes("super_admin");

  const loadProfile = useCallback(async (uid: string) => {
    try {
      const [{ data: prof }, { data: roleRows }, { data: blockRow }, { data: driverProfile }, { data: workerProfile }] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, phone, full_name, avatar_url, email")
          .eq("id", uid)
          .maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", uid),
        supabase.from("user_blocks").select("*").eq("user_id", uid).maybeSingle(),
        supabase.from("driver_profiles").select("user_id").eq("user_id", uid).maybeSingle(),
        supabase.from("worker_profiles").select("user_id").eq("user_id", uid).maybeSingle(),
      ]);

      // Provider applications are selectable even while awaiting admin approval.
      // Actual provider permissions remain enforced by database policies/status checks.
      const mappedRoles = (roleRows ?? []).map((r: any) => r.role as AppRole);
      if (driverProfile && !mappedRoles.includes("driver")) mappedRoles.push("driver");
      if (workerProfile && !mappedRoles.includes("worker")) mappedRoles.push("worker");
      if (!mappedRoles.includes("customer")) mappedRoles.unshift("customer");

      setProfile(prof ?? null);
      setRoles(mappedRoles);

      // Check Ban (Super Admin cannot be banned)
      if (!mappedRoles.includes("super_admin") && blockRow) {
        const isExpired = blockRow.expires_at && new Date(blockRow.expires_at) < new Date();
        if (!isExpired) {
          setBanStatus({
            isBanned: true,
            reason: blockRow.reason ?? "مخالفة شروط الاستخدام",
            expiresAt: blockRow.expires_at ?? null,
            blockedAt: blockRow.blocked_at ?? null,
          });
        } else {
          setBanStatus(null);
        }
      } else {
        setBanStatus(null);
      }

      setActiveRoleState((current) => {
        if (current && mappedRoles.includes(current)) return current;
        const saved =
          typeof window !== "undefined"
            ? (localStorage.getItem("mumnun-active-role") as AppRole | null)
            : null;
        if (saved && mappedRoles.includes(saved)) return saved;
        return mappedRoles[0] ?? null;
      });
    } catch {
      setProfile(null);
      setRoles([]);
      setBanStatus(null);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const { data } = await supabase.auth.getSession();
      setSession(data.session);
      if (data.session?.user) {
        await loadProfile(data.session.user.id);
      } else {
        setProfile(null);
        setRoles([]);
        setBanStatus(null);
      }
    } catch {
      setProfile(null);
      setRoles([]);
      setBanStatus(null);
    }
  }, [loadProfile]);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (s?.user) {
        setTimeout(() => loadProfile(s.user.id), 0);
      } else {
        setProfile(null);
        setRoles([]);
        setBanStatus(null);
      }
    });
    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        setSession(data.session);
        if (data.session?.user) {
          await loadProfile(data.session.user.id);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch {}
    setProfile(null);
    setRoles([]);
    setSession(null);
    setBanStatus(null);
  };

  return (
    <Ctx.Provider
      value={{
        session,
        user: session?.user ?? null,
        profile,
        roles,
        activeRole,
        setActiveRole,
        isSuperAdmin,
        banStatus,
        loading,
        refresh,
        signOut,
      }}
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
