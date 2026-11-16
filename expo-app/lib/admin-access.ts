import { supabase } from "@/lib/supabase";

/**
 * Returns the same effective role vocabulary used by the web admin menu.
 * Department/rank assignments are read-only metadata here; the server remains
 * authoritative for every privileged operation.
 */
export async function getAdminStaffRoles(userId: string): Promise<string[]> {
  const [{ data: roleRows, error: roleError }, { data: assignment }] = await Promise.all([
    supabase.rpc("get_staff_roles", { p_user_id: userId }),
    (supabase as any).from("staff_assignments")
      .select("rank,department").eq("user_id", userId).eq("active", true).maybeSingle(),
  ]);
  if (roleError) throw roleError;
  const roles = (roleRows ?? []).map((entry: any) => typeof entry === "string" ? entry : entry.role);
  if (assignment?.rank) roles.push(`rank:${assignment.rank}`);
  if (assignment?.department) roles.push(`department_${assignment.department}`);
  return [...new Set(roles)];
}
