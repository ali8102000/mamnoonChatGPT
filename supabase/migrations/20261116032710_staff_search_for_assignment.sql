create or replace function public.staff_search_users(p_query text)
returns table(user_id uuid,full_name text,phone text,email text)
language plpgsql
stable
security definer
set search_path=public
as $$
begin
  if auth.uid() is null or not public.is_super_admin(auth.uid()) then raise exception 'forbidden'; end if;
  if length(trim(coalesce(p_query,''))) < 2 then raise exception 'search_query_too_short'; end if;
  return query
    select p.id,p.full_name,p.phone,p.email
    from public.profiles p
    where (coalesce(p.full_name,'') ilike '%'||trim(p_query)||'%'
       or coalesce(p.phone,'') ilike '%'||trim(p_query)||'%'
       or coalesce(p.email,'') ilike '%'||trim(p_query)||'%')
      and p.id <> 'a06c0102-c5c8-488c-9309-8a320b400df1'::uuid
      and not exists (select 1 from public.user_roles r where r.user_id=p.id and r.role::text='super_admin')
    order by p.created_at desc
    limit 30;
end;
$$;
revoke all on function public.staff_search_users(text) from public,anon;
grant execute on function public.staff_search_users(text) to authenticated;
