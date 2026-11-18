import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getSupabasePublishableKey, getSupabaseSecretKey, createSupabaseFetch } from "../_shared/api-keys.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

type TeamRole = "developer";
const ROLE_MAP: Record<TeamRole, { department: string; rank: string; display_title: string }> = {
  developer: { department: "operations", rank: "employee", display_title: "Developer" },
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isTeamRole(value: unknown): value is TeamRole {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ROLE_MAP, value);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = getSupabasePublishableKey();
    const serviceRoleKey = getSupabaseSecretKey();
    const authorization = req.headers.get("Authorization");
    if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization) {
      return json({ error: "إعدادات الخادم غير مكتملة" }, 500);
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { fetch: createSupabaseFetch(anonKey), headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser();
    const actor = authData.user;
    if (authError || !actor) {
      return json({ error: "هذه الميزة متاحة لصاحب المشروع فقط" }, 403);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      global: { fetch: createSupabaseFetch(serviceRoleKey) },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: ownerRole, error: ownerRoleError } = await admin
      .from("user_roles").select("role").eq("user_id", actor.id).eq("role", "super_admin").maybeSingle();
    if (ownerRoleError || !ownerRole) return json({ error: "تعذر التحقق من صلاحية المالك" }, 403);

    const body = await req.json();
    const action = body?.action;

    if (action === "list") {
      const { data: assignments, error } = await admin.from("staff_assignments")
        .select("user_id, rank, department, display_title, active, created_at, scope_type, scope_governorate")
        .or(`user_id.eq.${actor.id},display_title.eq.Developer`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const ids = (assignments ?? []).map((row) => row.user_id);
      const [{ data: profiles, error: profileError }, authResults] = await Promise.all([
        ids.length
          ? admin.from("profiles").select("id, full_name, email, phone, avatar_url").in("id", ids)
          : Promise.resolve({ data: [], error: null }),
        Promise.all(ids.map((id) => admin.auth.admin.getUserById(id))),
      ]);
      if (profileError) throw profileError;
      const authMap = new Map<string, NonNullable<(typeof authResults)[number]["data"]["user"]>>();
      for (const result of authResults) {
        if (result.error) throw result.error;
        if (result.data.user) authMap.set(result.data.user.id, result.data.user);
      }
      const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
      return json({
        members: (assignments ?? []).map((row) => {
          const profile = profileMap.get(row.user_id) ?? null;
          const authUser = authMap.get(row.user_id);
          return {
            ...row,
            profile: profile ? { ...profile, email: profile.email ?? authUser?.email ?? null } : {
              full_name: authUser?.user_metadata?.full_name ?? null,
              email: authUser?.email ?? null,
              phone: authUser?.phone ?? null,
            },
            is_owner: row.user_id === actor.id,
          };
        }),
      });
    }

    if (action === "invite") {
      const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
      const role = body?.role;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !isTeamRole(role)) {
        return json({ error: "يرجى إدخال بريد صحيح وصلاحية متاحة" }, 400);
      }

      let targetUserId: string | undefined;
      for (let page = 1; page <= 1000; page += 1) {
        const { data: authUsers, error: authUsersError } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
        if (authUsersError) throw authUsersError;
        targetUserId = authUsers.users.find((candidate) => candidate.email?.toLowerCase() === email)?.id;
        if (targetUserId || authUsers.users.length < 1000) break;
      }
      if (targetUserId === actor.id) return json({ error: "حساب المالك لا يمكن تغييره" }, 400);
      let invitationSent = false;
      if (targetUserId) {
        const { data: existingAssignment, error: assignmentError } = await admin.from("staff_assignments")
          .select("display_title").eq("user_id", targetUserId).maybeSingle();
        if (assignmentError) throw assignmentError;
        if (existingAssignment && existingAssignment.display_title !== "Developer") {
          return json({ error: "هذا الحساب عضو في فريق إداري آخر ولا يمكن استبدال صلاحياته من هنا" }, 409);
        }
        const { data: existingPrivilegedRole, error: existingRoleError } = await admin.from("user_roles")
          .select("role").eq("user_id", targetUserId)
          .in("role", ["admin", "support", "finance", "moderator", "super_admin"]).limit(1).maybeSingle();
        if (existingRoleError) throw existingRoleError;
        if (existingPrivilegedRole) return json({ error: "هذا الحساب يملك صلاحية إدارية مسبقاً؛ لا يمكن تحويله إلى Developer من هنا" }, 403);
      } else {
        const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email);
        if (inviteError || !inviteData.user) {
          return json({ error: inviteError?.message ?? "تعذر إرسال الدعوة. قد يكون الحساب مسجلاً مسبقاً." }, 400);
        }
        targetUserId = inviteData.user.id;
        invitationSent = true;
      }

      const roleConfig = ROLE_MAP[role];
      const { error: upsertError } = await admin.from("staff_assignments").upsert({
        user_id: targetUserId,
        rank: roleConfig.rank,
        department: roleConfig.department,
        display_title: roleConfig.display_title,
        active: true,
        assigned_by: actor.id,
        created_by: actor.id,
        scope_type: "global",
        scope_governorate: null,
      }, { onConflict: "user_id" });
      if (upsertError) throw upsertError;

      const { error: auditError } = await admin.from("audit_logs").insert({
        user_id: actor.id,
        action: invitationSent ? "staff_invited" : "staff_assigned",
        target_type: "staff",
        target_id: targetUserId,
        details: { email, role, department: roleConfig.department, invitation_sent: invitationSent },
      });
      return json({ ok: true, user_id: targetUserId, invitation_sent: invitationSent, audit_logged: !auditError });
    }

    if (action === "update") {
      const targetUserId = typeof body?.user_id === "string" ? body.user_id : "";
      const role = body?.role;
      if (!targetUserId || !isTeamRole(role)) return json({ error: "بيانات التعديل غير صحيحة" }, 400);
      if (targetUserId === actor.id) return json({ error: "لا يمكن تعديل صلاحيات المالك" }, 400);
      const { data: target, error: targetError } = await admin.auth.admin.getUserById(targetUserId);
      if (targetError || !target.user) {
        return json({ error: "هذا الحساب محمي ولا يمكن تعديله" }, 403);
      }
      const { data: existingAssignment, error: assignmentError } = await admin.from("staff_assignments")
        .select("display_title").eq("user_id", targetUserId).maybeSingle();
      if (assignmentError) throw assignmentError;
      if (existingAssignment?.display_title !== "Developer") return json({ error: "يمكن تعديل أعضاء فريق المطورين فقط" }, 403);
      const { data: targetRoles, error: rolesError } = await admin.from("user_roles")
        .select("role").eq("user_id", targetUserId)
        .in("role", ["admin", "support", "finance", "moderator", "super_admin"]).limit(1).maybeSingle();
      if (rolesError) throw rolesError;
      if (targetRoles) return json({ error: "لا يمكن تعديل حساب يملك صلاحية إدارية" }, 403);

      const roleConfig = ROLE_MAP[role];
      const { error } = await admin.from("staff_assignments").update({
        rank: roleConfig.rank,
        department: roleConfig.department,
        display_title: roleConfig.display_title,
        active: true,
        updated_at: new Date().toISOString(),
      }).eq("user_id", targetUserId);
      if (error) throw error;
      const { error: auditError } = await admin.from("audit_logs").insert({
        user_id: actor.id, action: "staff_role_updated", target_type: "staff", target_id: targetUserId,
        details: { role, department: roleConfig.department },
      });
      return json({ ok: true, audit_logged: !auditError });
    }

    if (action === "deactivate") {
      const targetUserId = typeof body?.user_id === "string" ? body.user_id : "";
      if (!targetUserId || targetUserId === actor.id) return json({ error: "لا يمكن إيقاف حساب المالك" }, 400);
      const { data: target, error: targetError } = await admin.auth.admin.getUserById(targetUserId);
      if (targetError || !target.user) {
        return json({ error: "هذا الحساب محمي ولا يمكن إيقافه" }, 403);
      }
      const { data: existingAssignment, error: assignmentError } = await admin.from("staff_assignments")
        .select("display_title").eq("user_id", targetUserId).maybeSingle();
      if (assignmentError) throw assignmentError;
      if (existingAssignment?.display_title !== "Developer") return json({ error: "يمكن إيقاف أعضاء فريق المطورين فقط" }, 403);
      const { data: targetRoles, error: rolesError } = await admin.from("user_roles")
        .select("role").eq("user_id", targetUserId)
        .in("role", ["admin", "support", "finance", "moderator", "super_admin"]).limit(1).maybeSingle();
      if (rolesError) throw rolesError;
      if (targetRoles) return json({ error: "لا يمكن إيقاف حساب يملك صلاحية إدارية" }, 403);
      const { error } = await admin.from("staff_assignments")
        .update({ active: false, updated_at: new Date().toISOString() }).eq("user_id", targetUserId);
      if (error) throw error;
      const { error: auditError } = await admin.from("audit_logs").insert({
        user_id: actor.id, action: "staff_deactivated", target_type: "staff", target_id: targetUserId,
        details: { active: false },
      });
      return json({ ok: true, audit_logged: !auditError });
    }

    return json({ error: "إجراء غير معروف" }, 400);
  } catch (error) {
    console.error("[team-management]", error);
    return json({ error: "تعذر تنفيذ العملية. حاول مرة أخرى." }, 500);
  }
});
