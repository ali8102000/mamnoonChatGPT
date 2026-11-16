create or replace function public.staff_list_department()
returns table(user_id uuid,full_name text,phone text,email text,rank text,department text,display_title text,active boolean)
language plpgsql stable security definer set search_path=public as $$
declare v_actor_rank text; v_actor_department text; v_actor_level integer;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if public.is_super_admin(auth.uid()) then
    return query select a.user_id,p.full_name,p.phone,p.email,a.rank,a.department,a.display_title,a.active
      from public.staff_assignments a left join public.profiles p on p.id=a.user_id
      order by a.department,a.rank desc,p.full_name;
    return;
  end if;
  select a.rank,a.department into v_actor_rank,v_actor_department
    from public.staff_assignments a where a.user_id=auth.uid() and a.active=true;
  v_actor_level := case v_actor_rank when 'owner' then 5 when 'general_manager' then 4
    when 'department_manager' then 3 when 'supervisor' then 2 when 'employee' then 1 else 0 end;
  if v_actor_level < 2 then raise exception 'forbidden'; end if;
  return query select a.user_id,p.full_name,p.phone,p.email,a.rank,a.department,a.display_title,a.active
    from public.staff_assignments a left join public.profiles p on p.id=a.user_id
    where a.department=v_actor_department
      and (case a.rank when 'owner' then 5 when 'general_manager' then 4 when 'department_manager' then 3 when 'supervisor' then 2 when 'employee' then 1 else 0 end) + 1 < v_actor_level
    order by a.rank desc,p.full_name;
end;
$$;
revoke all on function public.staff_list_department() from public,anon;
grant execute on function public.staff_list_department() to authenticated;
