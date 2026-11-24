-- Allow dedicated customer-service accounts into the staff shell, without granting any other module.
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
      public.is_customer_service_staff(auth.uid())
      or exists (
        select 1 from public.user_roles
        where user_id = auth.uid()
          and role::text in ('super_admin','admin','support','finance','moderator')
      )
    )
  end;
$$;
revoke all on function public.has_staff_role(uuid) from public, anon;
grant execute on function public.has_staff_role(uuid) to authenticated;
