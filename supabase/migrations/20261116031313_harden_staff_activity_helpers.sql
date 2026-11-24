create or replace function public.is_customer_service_staff(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then false
    when p_user_id is distinct from auth.uid() and not public.is_super_admin(auth.uid()) then false
    else exists (
      select 1 from public.staff_assignments a
      where a.user_id = p_user_id and a.active = true and a.department = 'customer_service'
    )
  end;
$$;
revoke all on function public.staff_log_support_activity() from public, anon, authenticated;
revoke all on function public.is_customer_service_staff(uuid) from public, anon;
grant execute on function public.is_customer_service_staff(uuid) to authenticated;
