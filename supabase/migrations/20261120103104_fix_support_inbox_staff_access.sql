-- Restore authenticated staff access to support inbox without broadening customer access.
-- The previous helper called a missing is_customer_service_staff(uuid) function,
-- causing RLS evaluation to fail for staff inbox reads.
create or replace function public.has_chat_moderation_access(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when auth.uid() is null or p_user_id is distinct from auth.uid() then false
    else (
      exists (
        select 1
        from public.user_roles ur
        where ur.user_id = auth.uid()
          and ur.role::text in ('super_admin', 'admin', 'support', 'moderator')
      )
      or exists (
        select 1
        from public.staff_assignments sa
        where sa.user_id = auth.uid()
          and sa.active = true
          and (sa.department = 'customer_service' or sa.rank = 'general_manager')
      )
    )
  end;
$function$;

revoke all on function public.has_chat_moderation_access(uuid) from public;
grant execute on function public.has_chat_moderation_access(uuid) to authenticated;
