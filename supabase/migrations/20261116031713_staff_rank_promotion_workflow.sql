create or replace function public.staff_list_department()
returns table (
  user_id uuid,
  full_name text,
  phone text,
  email text,
  rank text,
  department text,
  display_title text,
  active boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor_rank text;
  v_actor_department text;
  v_actor_level integer;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if public.is_super_admin(auth.uid()) then
    return query
      select a.user_id,p.full_name,p.phone,p.email,a.rank,a.department,a.display_title,a.active
      from public.staff_assignments a
      left join public.profiles p on p.id=a.user_id
      order by a.department,a.rank desc,p.full_name;
    return;
  end if;

  select a.rank,a.department into v_actor_rank,v_actor_department
  from public.staff_assignments a
  where a.user_id=auth.uid() and a.active=true;

  v_actor_level := case v_actor_rank
    when 'owner' then 5 when 'general_manager' then 4 when 'department_manager' then 3
    when 'supervisor' then 2 when 'employee' then 1 else 0 end;

  if v_actor_level < 2 then raise exception 'forbidden'; end if;

  return query
    select a.user_id,p.full_name,p.phone,p.email,a.rank,a.department,a.display_title,a.active
    from public.staff_assignments a
    left join public.profiles p on p.id=a.user_id
    where a.department=v_actor_department
      and (case a.rank when 'owner' then 5 when 'general_manager' then 4 when 'department_manager' then 3 when 'supervisor' then 2 when 'employee' then 1 else 0 end) < v_actor_level
    order by a.rank desc,p.full_name;
end;
$$;

create or replace function public.staff_promote_one_level(p_target_user uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_rank text;
  v_actor_department text;
  v_actor_level integer;
  v_target_rank text;
  v_target_department text;
  v_target_level integer;
  v_new_rank text;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  select rank,department into v_actor_rank,v_actor_department
  from public.staff_assignments where user_id=auth.uid() and active=true;
  if public.is_super_admin(auth.uid()) then
    v_actor_rank := 'owner';
    v_actor_level := 5;
  else
    v_actor_level := case v_actor_rank
      when 'owner' then 5 when 'general_manager' then 4 when 'department_manager' then 3
      when 'supervisor' then 2 when 'employee' then 1 else 0 end;
  end if;
  if v_actor_level < 2 then raise exception 'forbidden'; end if;

  select rank,department into v_target_rank,v_target_department
  from public.staff_assignments where user_id=p_target_user and active=true;
  if v_target_rank is null then raise exception 'target_staff_not_found'; end if;
  if v_target_rank='owner' then raise exception 'cannot_promote_owner'; end if;
  if not public.is_super_admin(auth.uid()) and v_target_department is distinct from v_actor_department then
    raise exception 'different_department';
  end if;

  v_target_level := case v_target_rank
    when 'general_manager' then 4 when 'department_manager' then 3
    when 'supervisor' then 2 when 'employee' then 1 else 0 end;
  if v_target_level + 1 >= v_actor_level then raise exception 'promotion_reaches_or_exceeds_manager_rank'; end if;

  v_new_rank := case v_target_level + 1
    when 2 then 'supervisor' when 3 then 'department_manager' when 4 then 'general_manager' else v_target_rank end;
  if v_new_rank = v_target_rank then raise exception 'maximum_rank'; end if;

  update public.staff_assignments
  set rank=v_new_rank,assigned_by=auth.uid(),updated_at=now()
  where user_id=p_target_user;

  insert into public.staff_activity_log(staff_user_id,actor_user_id,activity,details)
  values (p_target_user,auth.uid(),'rank_changed',
    jsonb_build_object('old_rank',v_target_rank,'new_rank',v_new_rank,'department',v_target_department,'method','one_level_promotion'));

  return v_new_rank;
end;
$$;

revoke all on function public.staff_list_department() from public,anon;
revoke all on function public.staff_promote_one_level(uuid) from public,anon;
grant execute on function public.staff_list_department() to authenticated;
grant execute on function public.staff_promote_one_level(uuid) to authenticated;
