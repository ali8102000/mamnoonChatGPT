-- General managers are read-only for support complaints and correspondence.
-- This helper is used by the support conversation/message RLS policies.
-- Exclude an active general_manager assignment before granting customer-service
-- or moderation capabilities, regardless of the staff member's department.
create or replace function public.has_chat_moderation_access(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select case
    when auth.uid() is null or p_user_id is distinct from auth.uid() then false
    when exists (
      select 1
      from public.staff_assignments sa
      where sa.user_id = auth.uid()
        and sa.active = true
        and sa.rank = 'general_manager'
    ) then false
    else (
      public.is_customer_service_staff(auth.uid())
      or exists (
        select 1
        from public.user_roles
        where user_id = auth.uid()
          and role::text in ('super_admin','admin','support','moderator')
      )
    )
  end;
$function$;
