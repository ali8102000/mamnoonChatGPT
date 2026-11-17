create or replace function public.admin_grant_pricing_permissions(
  p_target_user uuid,
  p_permission_keys text[],
  p_scope_type text,
  p_scope_governorates text[] default '{}'::text[],
  p_expires_at timestamptz default null
)
returns uuid[]
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_permission text;
  v_governorate text;
  v_grant_id uuid;
  v_ids uuid[] := '{}'::uuid[];
  v_allowed_governorates text[] := array[
    'baghdad','basra','nineveh','erbil','sulaymaniyah','duhok','kirkuk',
    'najaf','karbala','babil','anbar','diyala','saladin','wasit',
    'dhiqar','maysan','muthanna','qadisiyah'
  ];
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if p_target_user is null or p_target_user = auth.uid() then raise exception 'invalid_target'; end if;
  if coalesce(cardinality(p_permission_keys),0) < 1 or cardinality(p_permission_keys) > 2
     or cardinality(p_permission_keys) <> (select count(distinct x) from unnest(p_permission_keys) x)
     or exists (select 1 from unnest(p_permission_keys) x where x not in ('pricing.taxi.edit','pricing.peak.edit')) then
    raise exception 'invalid_pricing_permissions';
  end if;
  if p_scope_type not in ('global','governorate') then raise exception 'invalid_scope'; end if;
  if p_scope_type='global' then
    if coalesce(cardinality(p_scope_governorates),0) <> 0 then raise exception 'global_scope_must_not_include_governorates'; end if;
  else
    if coalesce(cardinality(p_scope_governorates),0) < 1 or cardinality(p_scope_governorates) > 18
       or cardinality(p_scope_governorates) <> (select count(distinct x) from unnest(p_scope_governorates) x)
       or exists (select 1 from unnest(p_scope_governorates) x where x is null or x not in (select unnest(v_allowed_governorates))) then
      raise exception 'invalid_governorate_selection';
    end if;
  end if;
  foreach v_permission in array p_permission_keys loop
    if p_scope_type='global' then
      v_grant_id := public.admin_grant_staff_permission(p_target_user,v_permission,'global',null,p_expires_at);
      v_ids := array_append(v_ids,v_grant_id);
    else
      foreach v_governorate in array p_scope_governorates loop
        v_grant_id := public.admin_grant_staff_permission(p_target_user,v_permission,'governorate',v_governorate,p_expires_at);
        v_ids := array_append(v_ids,v_grant_id);
      end loop;
    end if;
  end loop;
  return v_ids;
end;
$function$;
revoke all on function public.admin_grant_pricing_permissions(uuid,text[],text,text[],timestamptz) from public, anon;
grant execute on function public.admin_grant_pricing_permissions(uuid,text[],text,text[],timestamptz) to authenticated;