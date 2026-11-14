import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
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
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadProfile(uid: string) {
    const [{ data: prof }, { data: roleRows }, { data: driverProfile }, { data: workerProfile }] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, phone, full_name, avatar_url")
        .eq("id", uid)
        .maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", uid),
      supabase.from("driver_profiles").select("user_id,vehicle_category").eq("user_id", uid).maybeSingle(),
      supabase.from("worker_profiles").select("user_id").eq("user_id", uid).maybeSingle(),
    ]);
    setProfile(prof ?? null);
    const mappedRoles = (roleRows ?? []).map((r) => r.role as AppRole);
    // Let a provider select their pending application while approval is in progress.
    // Provider access remains controlled by approval and database policies.
    if (driverProfile?.vehicle_category === "large") { if (!mappedRoles.includes("large_driver")) mappedRoles.push("large_driver"); }
    else if (driverProfile && !mappedRoles.includes("driver")) mappedRoles.push("driver");
    if (workerProfile && !mappedRoles.includes("worker")) mappedRoles.push("worker");
    if (!mappedRoles.includes("customer")) mappedRoles.unshift("customer");
    setRoles(mappedRoles);
  }

  async function refresh() {
    const { data } = await supabase.auth.getSession();
    setSession(data.session);
    if (data.session?.user) await loadProfile(data.session.user.id);
    else {
      setProfile(null);
      setRoles([]);
    }
  }

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (s?.user) {
        setTimeout(() => loadProfile(s.user.id), 0);
      } else {
        setProfile(null);
        setRoles([]);
      }
    });
    let active = true;
    supabase.auth
      .getSession()
      .then(async ({ data, error }) => {
        if (error) throw error;
        if (!active) return;
        setSession(data.session);
        if (data.session?.user) await loadProfile(data.session.user.id);
      })
      .catch(() => {
        if (!active) return;
        setSession(null);
        setProfile(null);
        setRoles([]);
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
      value={{ session, user: session?.user ?? null, profile, roles, loading, refresh, signOut }}
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
