-- Deactivating a staff member must revoke every path that could keep administrative access alive.
create or replace function public.admin_deactivate_staff(p_target_user uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_actor uuid := auth.uid();
  v_target public.staff_assignments%rowtype;
  v_actor_rank text;
  v_revoked_grants integer := 0;
  v_revoked_delegations integer := 0;
  v_removed_legacy_roles integer := 0;
begin
  if v_actor is null then raise exception 'unauthorized'; end if;
  if p_target_user is null or p_target_user = v_actor then raise exception 'cannot_deactivate_self'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'reason_required'; end if;

  select * into v_target
  from public.staff_assignments
  where user_id = p_target_user and active = true
  for update;

  if not found then raise exception 'active_staff_not_found'; end if;
  if v_target.rank = 'owner'
     or exists (select 1 from public.user_roles where user_id = p_target_user and role::text = 'super_admin') then
    raise exception 'protected_staff_account';
  end if;

  if not public.is_super_admin(v_actor) then
    if not public.admin_can_manage_staff(p_target_user) then raise exception 'staff_not_managed_by_actor'; end if;
    select rank into v_actor_rank
    from public.staff_assignments
    where user_id = v_actor and active = true;
    if public.admin_permission_level(v_target.rank) >= public.admin_permission_level(v_actor_rank) then
      raise exception 'rank_hierarchy_denied';
    end if;
  end if;

  update public.staff_assignments
  set active = false, assigned_by = v_actor, updated_at = now()
  where user_id = p_target_user;

  update public.admin_staff_permission_grants
  set revoked_at = now(), revoked_by = v_actor
  where revoked_at is null
    and (user_id = p_target_user or granted_by = p_target_user);
  get diagnostics v_revoked_grants = row_count;

  update public.admin_staff_delegations
  set revoked_at = now(), revoked_by = v_actor
  where revoked_at is null
    and (delegate_id = p_target_user or delegator_id = p_target_user);
  get diagnostics v_revoked_delegations = row_count;

  delete from public.user_roles
  where user_id = p_target_user
    and role::text in ('admin', 'support', 'finance', 'moderator');
  get diagnostics v_removed_legacy_roles = row_count;

  insert into public.staff_activity_log(staff_user_id, actor_user_id, activity, details)
  values (
    p_target_user, v_actor, 'staff_deactivated',
    jsonb_build_object(
      'previous_rank', v_target.rank,
      'department', v_target.department,
      'reason', trim(p_reason),
      'revoked_permission_grants', v_revoked_grants,
      'revoked_delegations', v_revoked_delegations,
      'removed_legacy_roles', v_removed_legacy_roles
    )
  );

  insert into public.audit_logs(user_id, action, target_type, target_id, details)
  values (
    v_actor, 'staff.deactivated', 'staff', p_target_user::text,
    jsonb_build_object(
      'previous_rank', v_target.rank,
      'department', v_target.department,
      'reason', trim(p_reason),
      'revoked_permission_grants', v_revoked_grants,
      'revoked_delegations', v_revoked_delegations,
      'removed_legacy_roles', v_removed_legacy_roles
    )
  );
end;
$function$;

-- Keep older owner-only screens on the same secure deactivation path.
create or replace function public.staff_deactivate(p_target_user uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if not public.is_super_admin(auth.uid()) then raise exception 'forbidden'; end if;
  perform public.admin_deactivate_staff(p_target_user, 'تم إيقاف الموظف من لوحة الإدارة');
end;
$function$;

revoke all on function public.admin_deactivate_staff(uuid, text) from public, anon;
revoke all on function public.staff_deactivate(uuid) from public, anon;
grant execute on function public.admin_deactivate_staff(uuid, text) to authenticated;
grant execute on function public.staff_deactivate(uuid) to authenticated;
