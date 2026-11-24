create or replace function public.staff_deactivate(p_target_user uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_rank text;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if not public.is_super_admin(auth.uid()) then raise exception 'forbidden'; end if;
  if p_target_user=auth.uid() then raise exception 'cannot_deactivate_self'; end if;
  select rank into v_rank from public.staff_assignments where user_id=p_target_user and active=true;
  if v_rank is null then raise exception 'active_staff_not_found'; end if;
  if v_rank='owner' then raise exception 'cannot_deactivate_owner'; end if;
  update public.staff_assignments set active=false,assigned_by=auth.uid(),updated_at=now() where user_id=p_target_user;
  insert into public.staff_activity_log(staff_user_id,actor_user_id,activity,details)
  values(p_target_user,auth.uid(),'staff_deactivated',jsonb_build_object('previous_rank',v_rank));
end;
$$;
revoke all on function public.staff_deactivate(uuid) from public,anon;
grant execute on function public.staff_deactivate(uuid) to authenticated;
