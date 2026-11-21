-- Allow the governed assignment workflow to reactivate an inactive staff record safely.
-- Active assignments remain protected from duplicate assignment. Existing grants/delegations
-- are not restored; a reactivated employee starts with the role's normal base permissions.
create or replace function public.admin_assign_staff(
  p_target_user uuid,
  p_rank text,
  p_department text,
  p_display_title text default null,
  p_scope_type text default 'global',
  p_scope_governorate text default null
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $function$
declare
  v_actor uuid := auth.uid();
  v_actor_rank text;
  v_actor_department text;
  v_actor_scope_type text;
  v_actor_scope_governorate text;
  v_existing public.staff_assignments%rowtype;
  v_had_existing boolean := false;
begin
  if v_actor is null then raise exception 'unauthorized'; end if;
  if p_target_user is null or p_target_user = v_actor then raise exception 'invalid_target'; end if;
  if p_rank not in ('general_manager','department_manager','supervisor','employee') then
    raise exception 'invalid_rank';
  end if;
  if p_department not in ('executive','customer_service','finance','operations','monitoring') then
    raise exception 'invalid_department';
  end if;
  if p_scope_type not in ('global','governorate')
    or (p_scope_type='global' and p_scope_governorate is not null)
    or (p_scope_type='governorate' and nullif(trim(p_scope_governorate),'') is null) then
    raise exception 'invalid_scope';
  end if;
  if exists(select 1 from public.user_roles where user_id=p_target_user and role::text='super_admin') then
    raise exception 'cannot_assign_super_admin';
  end if;

  select * into v_existing
  from public.staff_assignments
  where user_id=p_target_user
  for update;
  if found then
    v_had_existing := true;
    if v_existing.active then
      raise exception 'staff_assignment_already_exists_owner_review_required';
    end if;
    if v_existing.rank = 'owner' then
      raise exception 'protected_staff_account';
    end if;
  end if;

  if not public.is_super_admin(v_actor) then
    if not public.admin_has_permission('staff.assign',p_scope_type,p_scope_governorate) then
      raise exception 'missing_staff_assign_permission';
    end if;
    select rank,department,scope_type,scope_governorate
      into v_actor_rank,v_actor_department,v_actor_scope_type,v_actor_scope_governorate
      from public.staff_assignments where user_id=v_actor and active=true;
    if v_actor_rank is null or public.admin_permission_level(p_rank)>=public.admin_permission_level(v_actor_rank) then
      raise exception 'rank_escalation_denied';
    end if;
    if p_department is distinct from v_actor_department then raise exception 'department_scope_denied'; end if;
    if v_actor_scope_type='governorate'
      and (p_scope_type<>'governorate' or p_scope_governorate is distinct from v_actor_scope_governorate) then
      raise exception 'governorate_scope_denied';
    end if;
    if v_actor_scope_type is null then raise exception 'legacy_staff_scope_requires_owner_review'; end if;
    if v_had_existing and (
      v_existing.department is distinct from p_department
      or (v_actor_scope_type='governorate' and
        (v_existing.scope_type<>'governorate' or v_existing.scope_governorate is distinct from v_actor_scope_governorate))
    ) then
      raise exception 'existing_staff_scope_requires_owner_review';
    end if;
  end if;

  insert into public.staff_assignments
    (user_id,rank,department,display_title,active,assigned_by,created_by,scope_type,scope_governorate,updated_at)
  values
    (p_target_user,p_rank,p_department,nullif(trim(p_display_title),''),true,v_actor,v_actor,p_scope_type,
     case when p_scope_type='global' then null else p_scope_governorate end,now())
  on conflict (user_id) do update
    set rank=excluded.rank,
        department=excluded.department,
        display_title=excluded.display_title,
        active=true,
        assigned_by=v_actor,
        scope_type=excluded.scope_type,
        scope_governorate=excluded.scope_governorate,
        updated_at=now();

  insert into public.staff_activity_log(staff_user_id,actor_user_id,activity,details)
  values(p_target_user,v_actor,'staff_activated',
    jsonb_build_object('previous_rank',v_existing.rank,'rank',p_rank,
      'previous_department',v_existing.department,'department',p_department,
      'scope_type',p_scope_type,'scope_governorate',p_scope_governorate,
      'display_title',p_display_title));

  insert into public.audit_logs(user_id,action,target_type,target_id,details)
  values(v_actor,case when v_had_existing then 'staff.reactivated' else 'staff.assigned' end,
    'staff',p_target_user::text,
    jsonb_build_object('previous_rank',v_existing.rank,'rank',p_rank,
      'previous_department',v_existing.department,'department',p_department,
      'scope_type',p_scope_type,'scope_governorate',p_scope_governorate,
      'display_title',p_display_title));
end;
$function$;
revoke all on function public.admin_assign_staff(uuid,text,text,text,text,text) from public, anon;
grant execute on function public.admin_assign_staff(uuid,text,text,text,text,text) to authenticated;
