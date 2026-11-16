-- Make staff department assignment the source of scoped permissions.
create or replace function public.has_staff_role(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null or p_user_id is distinct from auth.uid() then false
    else (
      exists (select 1 from public.user_roles where user_id=auth.uid()
        and role::text in ('super_admin','admin','support','finance','moderator'))
      or exists (select 1 from public.staff_assignments where user_id=auth.uid() and active=true)
    )
  end;
$$;

create or replace function public.get_staff_roles(p_user_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_roles text[];
  v_department text;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if p_user_id is distinct from auth.uid() and not public.is_super_admin(auth.uid()) then raise exception 'forbidden'; end if;
  select coalesce(array_agg(role::text order by role::text),array[]::text[]) into v_roles
  from public.user_roles where user_id=p_user_id
    and role::text in ('super_admin','admin','support','finance','moderator');
  select department into v_department from public.staff_assignments where user_id=p_user_id and active=true;
  if v_department is not null then
    v_roles := array_append(v_roles, case v_department
      when 'customer_service' then 'customer_service'
      when 'finance' then 'department_finance'
      when 'operations' then 'department_operations'
      when 'monitoring' then 'department_monitoring'
      when 'executive' then 'department_executive'
      else 'department_unknown' end);
  end if;
  return v_roles;
end;
$$;

create or replace function public.has_finance_access(p_user_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select case when auth.uid() is null or p_user_id is distinct from auth.uid() then false
  else exists(select 1 from public.user_roles where user_id=auth.uid() and role::text in ('super_admin','admin','finance'))
    or exists(select 1 from public.staff_assignments where user_id=auth.uid() and active=true and department='finance') end;
$$;

create or replace function public.has_subscription_admin_access(p_user_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select case when auth.uid() is null or p_user_id is distinct from auth.uid() then false
  else exists(select 1 from public.user_roles where user_id=auth.uid() and role::text in ('super_admin','admin','finance'))
    or exists(select 1 from public.staff_assignments where user_id=auth.uid() and active=true and department='finance') end;
$$;

create or replace function public.has_provider_ops_access(p_user_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select case when auth.uid() is null or p_user_id is distinct from auth.uid() then false
  else exists(select 1 from public.user_roles where user_id=auth.uid() and role::text in ('super_admin','admin','support'))
    or exists(select 1 from public.staff_assignments where user_id=auth.uid() and active=true and department='operations') end;
$$;

create or replace function public.has_live_ops_access(p_user_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select case when auth.uid() is null or p_user_id is distinct from auth.uid() then false
  else exists(select 1 from public.user_roles where user_id=auth.uid() and role::text in ('super_admin','admin','support'))
    or exists(select 1 from public.staff_assignments where user_id=auth.uid() and active=true and department in ('operations','monitoring')) end;
$$;

create or replace function public.has_user_moderation_access(p_user_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select case when auth.uid() is null or p_user_id is distinct from auth.uid() then false
  else exists(select 1 from public.user_roles where user_id=auth.uid() and role::text in ('super_admin','admin','support','moderator'))
    or exists(select 1 from public.staff_assignments where user_id=auth.uid() and active=true and department='monitoring') end;
$$;

create or replace function public.has_friend_admin_access(p_user_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select case when auth.uid() is null or p_user_id is distinct from auth.uid() then false
  else exists(select 1 from public.user_roles where user_id=auth.uid() and role::text in ('super_admin','admin','moderator'))
    or exists(select 1 from public.staff_assignments where user_id=auth.uid() and active=true and department='monitoring') end;
$$;

-- An assigned employee receives department-scoped access, never inherited legacy staff roles.
create or replace function public.staff_set_rank(
  p_target_user uuid,p_new_rank text,p_department text,p_display_title text default null
)
returns void language plpgsql security definer set search_path=public as $$
declare
  v_old_rank text;
  v_old_department text;
  v_owner_id uuid := 'a06c0102-c5c8-488c-9309-8a320b400df1'::uuid;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if not public.is_super_admin(auth.uid()) then raise exception 'forbidden'; end if;
  if p_new_rank not in ('owner','general_manager','department_manager','supervisor','employee') then raise exception 'invalid_rank'; end if;
  if p_department not in ('executive','customer_service','finance','operations','monitoring') then raise exception 'invalid_department'; end if;
  if p_new_rank='owner' and p_target_user<>v_owner_id then raise exception 'owner_rank_reserved'; end if;
  if p_target_user=auth.uid() and p_new_rank<>'owner' then raise exception 'cannot_demote_self'; end if;
  if p_target_user<>v_owner_id and exists(select 1 from public.user_roles where user_id=p_target_user and role::text='super_admin') then
    raise exception 'cannot_reassign_super_admin';
  end if;
  select rank,department into v_old_rank,v_old_department from public.staff_assignments where user_id=p_target_user;
  insert into public.staff_assignments(user_id,rank,department,display_title,active,assigned_by,updated_at)
  values(p_target_user,p_new_rank,p_department,nullif(trim(p_display_title),''),true,auth.uid(),now())
  on conflict(user_id) do update set rank=excluded.rank,department=excluded.department,display_title=excluded.display_title,
    active=true,assigned_by=auth.uid(),updated_at=now();
  delete from public.user_roles where user_id=p_target_user and role::text in ('admin','support','finance','moderator');
  insert into public.staff_activity_log(staff_user_id,actor_user_id,activity,details)
  values(p_target_user,auth.uid(),
    case when v_old_rank is distinct from p_new_rank then 'rank_changed'
      when v_old_department is distinct from p_department then 'department_changed' else 'staff_activated' end,
    jsonb_build_object('old_rank',v_old_rank,'new_rank',p_new_rank,'old_department',v_old_department,'new_department',p_department,'display_title',p_display_title));
end;
$$;

revoke all on function public.has_staff_role(uuid) from public,anon;
revoke all on function public.get_staff_roles(uuid) from public,anon;
revoke all on function public.has_finance_access(uuid) from public,anon;
revoke all on function public.has_subscription_admin_access(uuid) from public,anon;
revoke all on function public.has_provider_ops_access(uuid) from public,anon;
revoke all on function public.has_live_ops_access(uuid) from public,anon;
revoke all on function public.has_user_moderation_access(uuid) from public,anon;
revoke all on function public.has_friend_admin_access(uuid) from public,anon;
grant execute on function public.has_staff_role(uuid),public.get_staff_roles(uuid),public.has_finance_access(uuid),
  public.has_subscription_admin_access(uuid),public.has_provider_ops_access(uuid),public.has_live_ops_access(uuid),
  public.has_user_moderation_access(uuid),public.has_friend_admin_access(uuid) to authenticated;
