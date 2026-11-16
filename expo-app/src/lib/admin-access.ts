import { supabase } from "@/lib/supabase";

/**
 * Resolves the effective staff role vocabulary used by the web admin menu.
 * This is for native navigation only; privileged operations are still
 * authorized by the server/Edge Function.
 */
export async function getAdminStaffRoles(userId: string): Promise<string[]> {
  const [{ data: roleRows, error: roleError }, { data: assignment }] = await Promise.all([
    supabase.rpc("get_staff_roles", { p_user_id: userId }),
    (supabase as any).from("staff_assignments")
      .select("rank,department").eq("user_id", userId).eq("active", true).maybeSingle(),
  ]);
  if (roleError) throw roleError;
  const roles: string[] = (roleRows ?? []).map((entry: any): string =>
    typeof entry === "string" ? entry : String(entry?.role ?? ""),
  ).filter(Boolean);
  if (assignment?.rank) roles.push(`rank:${assignment.rank}`);
  if (assignment?.department) roles.push(`department_${assignment.department}`);
  return [...new Set(roles)];
}
