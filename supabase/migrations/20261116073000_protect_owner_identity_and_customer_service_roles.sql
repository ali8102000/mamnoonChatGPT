-- Keep the owner title and rank unique to the existing super-admin account.
create or replace function public.staff_set_rank(
  p_target_user uuid,
  p_new_rank text,
  p_department text,
  p_display_title text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_rank text;
  v_old_department text;
  v_owner_id uuid := 'a06c0102-c5c8-488c-9309-8a320b400df1'::uuid;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if not public.is_super_admin(auth.uid()) then raise exception 'forbidden'; end if;
  if p_new_rank not in ('owner','general_manager','department_manager','supervisor','employee') then raise exception 'invalid_rank'; end if;
  if p_department not in ('executive','customer_service','finance','operations','monitoring') then raise exception 'invalid_department'; end if;
  if p_new_rank = 'owner' and p_target_user <> v_owner_id then raise exception 'owner_rank_reserved'; end if;
  if p_target_user = auth.uid() and p_new_rank <> 'owner' then raise exception 'cannot_demote_self'; end if;

  select rank, department into v_old_rank, v_old_department
  from public.staff_assignments where user_id = p_target_user;

  insert into public.staff_assignments(user_id,rank,department,display_title,active,assigned_by,updated_at)
  values (p_target_user,p_new_rank,p_department,nullif(trim(p_display_title),''),true,auth.uid(),now())
  on conflict(user_id) do update set rank=excluded.rank,department=excluded.department,
    display_title=excluded.display_title,active=true,assigned_by=auth.uid(),updated_at=now();

  -- Dedicated customer-service accounts must not retain legacy broad staff roles.
  if p_department = 'customer_service' then
    delete from public.user_roles
    where user_id = p_target_user and role::text in ('admin','support','finance','moderator');
  end if;

  insert into public.staff_activity_log(staff_user_id,actor_user_id,activity,details)
  values (p_target_user,auth.uid(),
    case when v_old_rank is distinct from p_new_rank then 'rank_changed'
         when v_old_department is distinct from p_department then 'department_changed'
         else 'staff_activated' end,
    jsonb_build_object('old_rank',v_old_rank,'new_rank',p_new_rank,'old_department',v_old_department,
      'new_department',p_department,'display_title',p_display_title));
end;
$$;

create or replace function public.is_customer_service_staff(p_user_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1 from public.staff_assignments a
    where a.user_id = p_user_id and a.active = true and a.department = 'customer_service'
  );
$$;
revoke all on function public.is_customer_service_staff(uuid) from public, anon;
grant execute on function public.is_customer_service_staff(uuid) to authenticated;

update public.profiles
set full_name = 'الرئيس المؤسس الأعلى', updated_at = now()
where id = 'a06c0102-c5c8-488c-9309-8a320b400df1';
