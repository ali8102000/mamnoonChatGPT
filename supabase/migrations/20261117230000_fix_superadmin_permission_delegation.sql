-- Correct delegated permission evaluation when the delegator is the super admin.
-- A super admin has authority through is_super_admin(); they do not need a redundant
-- row in admin_staff_permission_grants for every permission they delegate.
begin;

create or replace function public.admin_has_permission(
  p_permission_key text,
  p_scope_type text default 'global',
  p_scope_governorate text default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_actor uuid := auth.uid();
  v_staff_scope_type text;
  v_staff_scope_governorate text;
begin
  if v_actor is null then return false; end if;
  if p_scope_type not in ('global','governorate')
     or (p_scope_type='global' and p_scope_governorate is not null)
     or (p_scope_type='governorate' and nullif(trim(p_scope_governorate),'') is null)
  then return false; end if;
  if public.is_super_admin(v_actor) then return true; end if;

  select scope_type,scope_governorate
    into v_staff_scope_type,v_staff_scope_governorate
  from public.staff_assignments
  where user_id=v_actor and active=true;

  if v_staff_scope_type is null then return false; end if;
  if v_staff_scope_type='governorate'
     and (p_scope_type<>'governorate'
       or p_scope_governorate is distinct from v_staff_scope_governorate) then
    return false;
  end if;

  return exists (
    select 1
    from public.admin_staff_permission_grants g
    where g.user_id=v_actor
      and g.permission_key=p_permission_key
      and g.revoked_at is null
      and (g.expires_at is null or g.expires_at>now())
      and (
        g.scope_type='global'
        or (p_scope_type='governorate'
          and g.scope_type='governorate'
          and g.scope_governorate=p_scope_governorate)
      )
  ) or exists (
    select 1
    from public.admin_staff_delegations d
    where d.delegate_id=v_actor
      and d.permission_key=p_permission_key
      and d.revoked_at is null
      and (d.expires_at is null or d.expires_at>now())
      and (
        d.scope_type='global'
        or (p_scope_type='governorate'
          and d.scope_type='governorate'
          and d.scope_governorate=p_scope_governorate)
      )
      and (
        public.is_super_admin(d.delegator_id)
        or exists (
          select 1
          from public.admin_staff_permission_grants source_grant
          where source_grant.user_id=d.delegator_id
            and source_grant.permission_key=d.permission_key
            and source_grant.revoked_at is null
            and (source_grant.expires_at is null or source_grant.expires_at>now())
            and (
              source_grant.scope_type='global'
              or (d.scope_type='governorate'
                and source_grant.scope_type='governorate'
                and source_grant.scope_governorate=d.scope_governorate)
            )
        )
      )
      and (
        public.is_super_admin(d.delegator_id)
        or exists (
          select 1
          from public.staff_assignments delegator_staff
          where delegator_staff.user_id=d.delegator_id
            and delegator_staff.active=true
            and (
              delegator_staff.scope_type='global'
              or (delegator_staff.scope_type='governorate'
                and d.scope_type='governorate'
                and delegator_staff.scope_governorate=d.scope_governorate)
            )
        )
      )
  );
end;
$function$;

commit;
