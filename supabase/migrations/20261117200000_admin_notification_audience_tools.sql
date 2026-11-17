create or replace function public.admin_broadcast_notification(
  p_target text,
  p_title text,
  p_body text,
  p_single_user_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_count integer;
begin
  IF auth.uid() IS NULL OR NOT (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
        AND role::text IN ('super_admin','admin','support','finance','moderator')
    )
    OR EXISTS (
      SELECT 1 FROM public.staff_assignments
      WHERE user_id = auth.uid() AND active = true AND rank = 'general_manager'
    )
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  if p_target not in ('all','drivers','large_drivers','workers','customers','single') then
    raise exception 'invalid_notification_target';
  end if;
  if length(trim(coalesce(p_title,''))) < 1 or length(trim(p_title)) > 200
     or length(trim(coalesce(p_body,''))) < 1 or length(trim(p_body)) > 2000 then
    raise exception 'invalid_notification_content';
  end if;
  if p_target = 'single' and p_single_user_id is null then
    raise exception 'notification_user_required';
  end if;

  insert into public.notifications(user_id,type,title,body)
  select p.id,'broadcast',trim(p_title),trim(p_body)
  from public.profiles p
  where case p_target
    when 'all' then true
    when 'drivers' then exists(select 1 from public.user_roles r where r.user_id=p.id and r.role::text='driver')
    when 'large_drivers' then exists(select 1 from public.user_roles r where r.user_id=p.id and r.role::text='large_driver')
    when 'workers' then exists(select 1 from public.user_roles r where r.user_id=p.id and r.role::text='worker')
    when 'customers' then exists(select 1 from public.user_roles r where r.user_id=p.id and r.role::text='customer')
    when 'single' then p.id=p_single_user_id
    else false
  end;
  get diagnostics v_count = row_count;
  perform public.log_admin_action('broadcast_notification','notification',p_target,
    jsonb_build_object('title',trim(p_title),'sent',v_count));
  return v_count;
end;
$$;

create or replace function public.admin_broadcast_governorate_notification(
  p_governorate_key text,
  p_title text,
  p_body text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_count integer;
begin
  IF auth.uid() IS NULL OR NOT (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
        AND role::text IN ('super_admin','admin','support','moderator')
    )
    OR EXISTS (
      SELECT 1 FROM public.staff_assignments
      WHERE user_id = auth.uid() AND active = true AND rank = 'general_manager'
    )
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  if p_governorate_key not in ('baghdad','basra','nineveh','erbil','sulaymaniyah','duhok','kirkuk','najaf','karbala','babil','anbar','diyala','saladin','wasit','dhiqar','maysan','muthanna','qadisiyah') then
    raise exception 'invalid_governorate';
  end if;
  if length(trim(coalesce(p_title,''))) < 1 or length(trim(p_title)) > 200
     or length(trim(coalesce(p_body,''))) < 1 or length(trim(p_body)) > 2000 then
    raise exception 'invalid_notification_content';
  end if;
  insert into public.notifications(user_id,type,title,body,data)
  select p.id,'broadcast',trim(p_title),trim(p_body),
    jsonb_build_object('target','governorate','governorate_key',p_governorate_key)
  from public.profiles p
  where p.governorate_key = p_governorate_key;
  get diagnostics v_count = row_count;
  perform public.log_admin_action('broadcast_notification','governorate',p_governorate_key,
    jsonb_build_object('title',trim(p_title),'sent',v_count));
  return v_count;
end;
$$;

revoke all on function public.admin_broadcast_notification(text,text,text,uuid) from public,anon;
grant execute on function public.admin_broadcast_notification(text,text,text,uuid) to authenticated;
revoke all on function public.admin_broadcast_governorate_notification(text,text,text) from public,anon;
grant execute on function public.admin_broadcast_governorate_notification(text,text,text) to authenticated;
