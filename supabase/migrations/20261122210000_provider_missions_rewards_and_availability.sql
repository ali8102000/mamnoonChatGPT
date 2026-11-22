-- Provider availability presentation and operational missions/rewards.
-- This migration is branch-only until explicitly reviewed and applied to staging/production.

alter table public.admin_permission_catalog
  add column if not exists domain text;
insert into public.admin_permission_catalog(permission_key,domain,label_ar,risk_level,description,active)
values('operations.missions.manage','operations','إنشاء المهمات واعتماد مكافآتها','critical',
       'إنشاء مهمات حسب نوع مقدم الخدمة والمحافظة والفئة، ومراجعة المكافآت واعتمادها أو رفضها.',true)
on conflict(permission_key) do update set
  domain=excluded.domain,label_ar=excluded.label_ar,risk_level=excluded.risk_level,
  description=excluded.description,active=true;

create table if not exists public.provider_missions (
  id uuid primary key default gen_random_uuid(),
  title text not null check(length(btrim(title)) between 3 and 120),
  description text not null default '' check(length(description) <= 1000),
  provider_type text not null check(provider_type in ('driver','large_driver','worker')),
  service_slug text,
  target_governorates text[] not null default '{}'::text[],
  location_scope text not null default 'any' check(location_scope in ('any','inside_governorate','outside_governorate')),
  target_count integer not null check(target_count between 1 and 1000),
  reward_amount_iqd bigint not null check(reward_amount_iqd between 1 and 100000000),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  max_job_duration_hours numeric(7,2),
  status text not null default 'active' check(status in ('draft','active','paused','completed','cancelled')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint provider_missions_window_check check(ends_at > starts_at),
  constraint provider_missions_job_duration_check check(max_job_duration_hours is null or max_job_duration_hours between 0.1 and 720),
  constraint provider_missions_category_check check(service_slug is null or provider_type='worker'),
  constraint provider_missions_governorates_check check(
    target_governorates <@ array['baghdad','basra','nineveh','erbil','sulaymaniyah','duhok','kirkuk','najaf','karbala','babil','anbar','diyala','saladin','wasit','dhiqar','maysan','muthanna','qadisiyah']::text[]
  )
);

create table if not exists public.provider_mission_participants (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.provider_missions(id) on delete cascade,
  provider_id uuid not null references auth.users(id) on delete cascade,
  progress_count integer not null default 0 check(progress_count >= 0),
  reward_status text not null default 'in_progress'
    check(reward_status in ('in_progress','eligible','approved','rejected')),
  eligible_at timestamptz,
  decided_at timestamptz,
  decided_by uuid references auth.users(id),
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(mission_id,provider_id)
);

create table if not exists public.provider_mission_completions (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.provider_missions(id) on delete cascade,
  participant_id uuid not null references public.provider_mission_participants(id) on delete cascade,
  provider_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null references public.service_requests(id) on delete cascade,
  customer_id uuid references auth.users(id) on delete set null,
  request_created_at timestamptz not null,
  request_completed_at timestamptz not null,
  duration_minutes integer,
  origin_governorate text,
  destination_governorate text,
  created_at timestamptz not null default now(),
  unique(mission_id,provider_id,request_id)
);

create index if not exists provider_missions_active_idx
  on public.provider_missions(status,starts_at,ends_at);
create index if not exists provider_mission_participants_provider_idx
  on public.provider_mission_participants(provider_id,reward_status);
create index if not exists provider_mission_completions_participant_idx
  on public.provider_mission_completions(participant_id,request_completed_at desc);

alter table public.provider_missions enable row level security;
alter table public.provider_mission_participants enable row level security;
alter table public.provider_mission_completions enable row level security;
revoke all on public.provider_missions,public.provider_mission_participants,public.provider_mission_completions from public,anon,authenticated;

create or replace function public.can_manage_provider_mission(p_governorate text default null)
returns boolean
language plpgsql stable security definer
set search_path=public
as $function$
begin
  if auth.uid() is null then return false; end if;
  if public.has_admin_access(auth.uid()) then return true; end if;
  if p_governorate is null then
    return public.admin_has_permission('operations.missions.manage','global',null);
  end if;
  return public.admin_has_permission('operations.missions.manage','governorate',p_governorate);
end;
$function$;
revoke all on function public.can_manage_provider_mission(text) from public,anon;
grant execute on function public.can_manage_provider_mission(text) to authenticated;

create or replace function public.admin_create_provider_mission(
  p_title text,
  p_description text,
  p_provider_type text,
  p_service_slug text,
  p_target_governorates text[],
  p_location_scope text,
  p_target_count integer,
  p_reward_amount_iqd bigint,
  p_duration_hours integer,
  p_max_job_duration_hours numeric default null
)
returns uuid
language plpgsql security definer
set search_path=public
as $function$
declare
  v_id uuid;
  v_gov text;
  v_count integer;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if p_title is null or length(btrim(p_title)) not between 3 and 120
     or p_provider_type not in ('driver','large_driver','worker')
     or p_location_scope not in ('any','inside_governorate','outside_governorate')
     or p_target_count not between 1 and 1000
     or p_reward_amount_iqd not between 1 and 100000000
     or p_duration_hours not between 1 and 720
     or (p_max_job_duration_hours is not null and p_max_job_duration_hours not between 0.1 and 720)
     or (p_service_slug is not null and p_provider_type <> 'worker')
     or (p_service_slug is not null and not exists(select 1 from public.services where slug=p_service_slug)) then
    raise exception 'invalid_provider_mission';
  end if;
  if coalesce(cardinality(p_target_governorates),0)>18
     or exists(select 1 from unnest(coalesce(p_target_governorates,'{}'::text[])) g
       where g not in ('baghdad','basra','nineveh','erbil','sulaymaniyah','duhok','kirkuk','najaf','karbala','babil','anbar','diyala','saladin','wasit','dhiqar','maysan','muthanna','qadisiyah')) then
    raise exception 'invalid_mission_governorates';
  end if;
  if coalesce(cardinality(p_target_governorates),0)=0 then
    if not public.can_manage_provider_mission(null) then raise exception 'missing_mission_permission'; end if;
  else
    foreach v_gov in array p_target_governorates loop
      if not public.can_manage_provider_mission(v_gov) then raise exception 'missing_mission_permission:%',v_gov; end if;
    end loop;
  end if;

  insert into public.provider_missions(
    title,description,provider_type,service_slug,target_governorates,location_scope,
    target_count,reward_amount_iqd,starts_at,ends_at,max_job_duration_hours,status,created_by
  ) values(
    btrim(p_title),coalesce(p_description,''),p_provider_type,p_service_slug,
    coalesce(p_target_governorates,'{}'::text[]),p_location_scope,p_target_count,p_reward_amount_iqd,
    now(),now()+make_interval(hours=>p_duration_hours),p_max_job_duration_hours,'active',auth.uid()
  ) returning id into v_id;

  insert into public.provider_mission_participants(mission_id,provider_id)
  select v_id,ur.user_id
  from public.user_roles ur
  join public.profiles p on p.id=ur.user_id
  where ur.role::text=p_provider_type
    and (cardinality(coalesce(p_target_governorates,'{}'::text[]))=0 or p.governorate_key=any(p_target_governorates))
    and (
      (p_provider_type='driver' and exists(select 1 from public.driver_profiles dp where dp.user_id=ur.user_id and dp.status='approved'))
      or (p_provider_type='large_driver' and exists(select 1 from public.driver_profiles dp where dp.user_id=ur.user_id and dp.status='approved'))
      or (p_provider_type='worker' and exists(select 1 from public.worker_profiles wp where wp.user_id=ur.user_id and wp.status='approved'))
    )
    and (
      p_service_slug is null
      or exists(
        select 1 from public.worker_services ws join public.services s on s.id=ws.service_id
        where ws.worker_id=ur.user_id and s.slug=p_service_slug
      )
    )
  on conflict(mission_id,provider_id) do nothing;
  get diagnostics v_count=row_count;

  insert into public.notifications(user_id,type,title,body,link,data)
  select mp.provider_id,'mission_assigned','مهمة جديدة من إدارة ممنون',
    btrim(p_title)||' — أنجز '||p_target_count::text||' مهمة لتحصل على '||p_reward_amount_iqd::text||' د.ع.',
    '/home',
    jsonb_build_object('mission_id',v_id,'target_count',p_target_count,'reward_amount_iqd',p_reward_amount_iqd,'ends_at',now()+make_interval(hours=>p_duration_hours))
  from public.provider_mission_participants mp where mp.mission_id=v_id;

  perform public.log_admin_action(
    'create_provider_mission','provider_mission',v_id::text,
    jsonb_build_object('provider_type',p_provider_type,'governorates',coalesce(p_target_governorates,'{}'::text[]),
      'service_slug',p_service_slug,'target_count',p_target_count,'reward_amount_iqd',p_reward_amount_iqd,'participants',v_count)
  );
  return v_id;
end;
$function$;
revoke all on function public.admin_create_provider_mission(text,text,text,text,text[],text,integer,bigint,integer,numeric) from public,anon;
grant execute on function public.admin_create_provider_mission(text,text,text,text,text[],text,integer,bigint,integer,numeric) to authenticated;

create or replace function public.provider_get_missions()
returns table(
  mission_id uuid,title text,description text,provider_type text,service_slug text,
  location_scope text,target_count integer,reward_amount_iqd bigint,progress_count integer,
  reward_status text,starts_at timestamptz,ends_at timestamptz,max_job_duration_hours numeric
)
language sql stable security definer
set search_path=public
as $function$
  select m.id,m.title,m.description,m.provider_type,m.service_slug,m.location_scope,
         m.target_count,m.reward_amount_iqd,p.progress_count,p.reward_status,
         m.starts_at,m.ends_at,m.max_job_duration_hours
  from public.provider_mission_participants p
  join public.provider_missions m on m.id=p.mission_id
  where p.provider_id=auth.uid()
    and (m.ends_at>now() or p.reward_status in ('eligible','approved','rejected'))
  order by case when p.reward_status='eligible' then 0 when p.reward_status='in_progress' then 1 else 2 end,m.ends_at;
$function$;
revoke all on function public.provider_get_missions() from public,anon;
grant execute on function public.provider_get_missions() to authenticated;

create or replace function public.admin_list_provider_missions()
returns table(
  mission_id uuid,title text,provider_type text,service_slug text,target_governorates text[],
  location_scope text,target_count integer,reward_amount_iqd bigint,starts_at timestamptz,
  ends_at timestamptz,status text,participant_count bigint,eligible_count bigint,
  approved_count bigint,rejected_count bigint
)
language plpgsql stable security definer
set search_path=public
as $function$
begin
  if not public.can_manage_provider_mission(null) then raise exception 'missing_mission_permission'; end if;
  return query
    select m.id,m.title,m.provider_type,m.service_slug,m.target_governorates,m.location_scope,
      m.target_count,m.reward_amount_iqd,m.starts_at,m.ends_at,m.status,
      count(p.id),count(p.id) filter(where p.reward_status='eligible'),
      count(p.id) filter(where p.reward_status='approved'),
      count(p.id) filter(where p.reward_status='rejected')
    from public.provider_missions m
    left join public.provider_mission_participants p on p.mission_id=m.id
    group by m.id order by m.created_at desc;
end;
$function$;
revoke all on function public.admin_list_provider_missions() from public,anon;
grant execute on function public.admin_list_provider_missions() to authenticated;

create or replace function public.admin_list_provider_mission_rewards()
returns table(
  participant_id uuid,mission_id uuid,mission_title text,provider_id uuid,provider_name text,
  provider_phone text,governorate_key text,provider_type text,progress_count integer,
  target_count integer,reward_amount_iqd bigint,eligible_at timestamptz,reward_status text
)
language plpgsql stable security definer
set search_path=public
as $function$
begin
  if not public.can_manage_provider_mission(null) then raise exception 'missing_mission_permission'; end if;
  return query
    select p.id,m.id,m.title,p.provider_id,pr.full_name,pr.phone,pr.governorate_key,m.provider_type,
      p.progress_count,m.target_count,m.reward_amount_iqd,p.eligible_at,p.reward_status
    from public.provider_mission_participants p
    join public.provider_missions m on m.id=p.mission_id
    join public.profiles pr on pr.id=p.provider_id
    where p.reward_status in ('eligible','approved','rejected')
    order by case p.reward_status when 'eligible' then 0 when 'approved' then 1 else 2 end,p.eligible_at desc nulls last;
end;
$function$;
revoke all on function public.admin_list_provider_mission_rewards() from public,anon;
grant execute on function public.admin_list_provider_mission_rewards() to authenticated;

create or replace function public.admin_get_provider_mission_reward_details(p_participant_id uuid)
returns table(
  request_id uuid,request_type text,request_created_at timestamptz,request_completed_at timestamptz,
  duration_minutes integer,customer_name text,customer_phone text,origin_governorate text,
  destination_governorate text,pickup_text text,dest_text text
)
language plpgsql stable security definer
set search_path=public
as $function$
declare v_govs text[];
begin
  select m.target_governorates into v_govs
  from public.provider_mission_participants p join public.provider_missions m on m.id=p.mission_id
  where p.id=p_participant_id;
  if not found then raise exception 'mission_participant_not_found'; end if;
  if cardinality(coalesce(v_govs,'{}'::text[]))=0 then
    if not public.can_manage_provider_mission(null) then raise exception 'missing_mission_permission'; end if;
  else
    if exists(select 1 from unnest(v_govs) g where not public.can_manage_provider_mission(g)) then
      raise exception 'missing_mission_permission';
    end if;
  end if;
  return query
    select c.request_id,r.type::text,c.request_created_at,c.request_completed_at,c.duration_minutes,
      cp.full_name,cp.phone,c.origin_governorate,c.destination_governorate,r.pickup_text,r.dest_text
    from public.provider_mission_completions c
    join public.service_requests r on r.id=c.request_id
    left join public.profiles cp on cp.id=c.customer_id
    where c.participant_id=p_participant_id
    order by c.request_completed_at desc;
end;
$function$;
revoke all on function public.admin_get_provider_mission_reward_details(uuid) from public,anon;
grant execute on function public.admin_get_provider_mission_reward_details(uuid) to authenticated;

create or replace function public.admin_decide_provider_mission_rewards(
  p_participant_ids uuid[],p_decision text,p_note text default null
)
returns integer
language plpgsql security definer
set search_path=public
as $function$
declare
  v_id uuid;v_p public.provider_mission_participants%rowtype;v_m public.provider_missions%rowtype;
  v_balance numeric;v_count integer:=0;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if p_decision not in ('approve','reject') then raise exception 'invalid_mission_reward_decision'; end if;
  if coalesce(cardinality(p_participant_ids),0)<1 or cardinality(p_participant_ids)>500 then raise exception 'invalid_mission_reward_selection'; end if;
  if p_note is not null and length(p_note)>500 then raise exception 'mission_decision_note_too_long'; end if;
  for v_id in select distinct unnest(p_participant_ids) loop
    select * into v_p from public.provider_mission_participants where id=v_id for update;
    if not found or v_p.reward_status not in ('eligible','approved','rejected') then raise exception 'mission_reward_not_ready:%',v_id; end if;
    select * into v_m from public.provider_missions where id=v_p.mission_id;
    if cardinality(coalesce(v_m.target_governorates,'{}'::text[]))=0 then
      if not public.can_manage_provider_mission(null) then raise exception 'missing_mission_permission'; end if;
    else
      if exists(select 1 from unnest(v_m.target_governorates) g where not public.can_manage_provider_mission(g)) then raise exception 'missing_mission_permission'; end if;
    end if;
    if v_p.reward_status='approved' then
      if p_decision='approve' then continue; else raise exception 'approved_reward_cannot_be_rejected'; end if;
    end if;
    if p_decision='approve' then
      -- The provider wallet shown in the app is driver_wallets; update it
      -- and append the same earning ledger row used by completed rides/jobs.
      insert into public.driver_wallets(user_id,balance,total_earned,total_commission)
      values(v_p.provider_id,v_m.reward_amount_iqd,v_m.reward_amount_iqd,0)
      on conflict(user_id) do update set
        balance=public.driver_wallets.balance+excluded.balance,
        total_earned=public.driver_wallets.total_earned+excluded.total_earned,
        updated_at=now()
      returning balance into v_balance;
      insert into public.transactions(user_id,type,amount,balance_after,note)
      values(v_p.provider_id,'earning',v_m.reward_amount_iqd,v_balance,'مكافأة مهمة: '||v_m.title);
      update public.provider_mission_participants set reward_status='approved',decided_at=now(),
        decided_by=auth.uid(),decision_note=nullif(btrim(coalesce(p_note,'')),''),updated_at=now()
      where id=v_p.id;
      insert into public.notifications(user_id,type,title,body,link,data)
      values(v_p.provider_id,'mission_reward_approved','تمت الموافقة على مكافأتك',
        'أضيفت مكافأة قدرها '||v_m.reward_amount_iqd::text||' د.ع إلى محفظتك.',
        '/profile',jsonb_build_object('mission_id',v_m.id,'amount_iqd',v_m.reward_amount_iqd));
    else
      update public.provider_mission_participants set reward_status='rejected',decided_at=now(),
        decided_by=auth.uid(),decision_note=nullif(btrim(coalesce(p_note,'')),''),updated_at=now()
      where id=v_p.id;
      insert into public.notifications(user_id,type,title,body,link,data)
      values(v_p.provider_id,'mission_reward_rejected','تم رفض طلب المكافأة',
        coalesce(nullif(btrim(p_note),''),'راجعت الإدارة المهمة ولم تعتمد المكافأة.'),
        '/home',jsonb_build_object('mission_id',v_m.id));
    end if;
    perform public.log_admin_action(
      case when p_decision='approve' then 'approve_provider_mission_reward' else 'reject_provider_mission_reward' end,
      'provider_mission_participant',v_p.id::text,
      jsonb_build_object('mission_id',v_m.id,'provider_id',v_p.provider_id,'amount_iqd',v_m.reward_amount_iqd,'note',p_note)
    );
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$function$;
revoke all on function public.admin_decide_provider_mission_rewards(uuid[],text,text) from public,anon;
grant execute on function public.admin_decide_provider_mission_rewards(uuid[],text,text) to authenticated;

create or replace function public.record_provider_mission_completion()
returns trigger
language plpgsql security definer
set search_path=public
as $function$
declare
  v_provider uuid;v_provider_type text;v_providers uuid[];v_m public.provider_missions%rowtype;
  v_participant public.provider_mission_participants%rowtype;v_origin text;v_destination text;v_home text;
  v_duration numeric;v_new_count integer;v_provider_name text;
begin
  if new.status::text<>'completed' or old.status::text='completed' then return new; end if;
  if new.completed_at is null then return new; end if;

  v_origin:=public.infer_governorate_key(new.pickup_lat,new.pickup_lng);
  v_destination:=public.infer_governorate_key(new.dest_lat,new.dest_lng);
  v_duration:=extract(epoch from (new.completed_at-coalesce(new.started_at,new.provider_arrived_at,new.created_at)))/3600.0;

  if new.type::text='taxi' then
    v_providers:=case when new.provider_id is null then '{}'::uuid[] else array[new.provider_id] end;
    v_provider_type:=case when exists(select 1 from public.user_roles where user_id=new.provider_id and role::text='large_driver') then 'large_driver' else 'driver' end;
  elsif new.type::text='service' then
    select coalesce(array_agg(distinct x), '{}'::uuid[]) into v_providers
    from (
      select new.provider_id as x where new.provider_id is not null
      union all
      select sp.provider_id from public.service_request_providers sp where sp.request_id=new.id
    ) q;
    v_provider_type:='worker';
  else
    return new;
  end if;

  foreach v_provider in array v_providers loop
    select governorate_key,full_name into v_home,v_provider_name from public.profiles where id=v_provider;
    for v_m in
      select m.* from public.provider_missions m
      join public.provider_mission_participants p on p.mission_id=m.id and p.provider_id=v_provider
      where m.status='active' and m.starts_at<=new.completed_at and m.ends_at>=new.completed_at
        and m.provider_type=v_provider_type
        and (m.service_slug is null or exists(select 1 from public.services s where s.id=new.service_id and s.slug=m.service_slug))
        and (cardinality(m.target_governorates)=0 or exists(
          select 1 from public.profiles pr where pr.id=v_provider and pr.governorate_key=any(m.target_governorates)))
        and (m.max_job_duration_hours is null or v_duration<=m.max_job_duration_hours)
        and (m.location_scope='any'
          or (m.location_scope='inside_governorate' and v_home is not null and v_origin=v_home and (v_destination is null or v_destination=v_home))
          or (m.location_scope='outside_governorate' and v_home is not null and (v_origin is distinct from v_home or (v_destination is not null and v_destination<>v_home))))
    loop
      select * into v_participant from public.provider_mission_participants
      where mission_id=v_m.id and provider_id=v_provider for update;
      if not found or v_participant.reward_status<>'in_progress' then continue; end if;
      insert into public.provider_mission_completions(
        mission_id,participant_id,provider_id,request_id,customer_id,request_created_at,
        request_completed_at,duration_minutes,origin_governorate,destination_governorate
      ) values(
        v_m.id,v_participant.id,v_provider,new.id,new.customer_id,new.created_at,new.completed_at,
        greatest(0,round(extract(epoch from(new.completed_at-coalesce(new.started_at,new.provider_arrived_at,new.created_at)))/60)::integer),v_origin,v_destination
      ) on conflict(mission_id,provider_id,request_id) do nothing;
      get diagnostics v_new_count=row_count;
      if v_new_count=0 then continue; end if;
      update public.provider_mission_participants p
      set progress_count=(select count(*) from public.provider_mission_completions c where c.participant_id=p.id),
          reward_status=case when (select count(*) from public.provider_mission_completions c where c.participant_id=p.id)>=v_m.target_count then 'eligible' else 'in_progress' end,
          eligible_at=case when (select count(*) from public.provider_mission_completions c where c.participant_id=p.id)>=v_m.target_count then coalesce(p.eligible_at,now()) else p.eligible_at end,
          updated_at=now()
      where p.id=v_participant.id
      returning progress_count into v_new_count;
      if v_new_count>=v_m.target_count then
        insert into public.notifications(user_id,type,title,body,link,data)
        select ur.user_id,'mission_reward_pending','مكافأة مهمة بانتظار المراجعة',
          coalesce(v_provider_name,'أحد المستخدمين')||' أكمل مهمة «'||v_m.title||'» وأصبحت المكافأة بانتظار قرار الإدارة.',
          '/admin',jsonb_build_object('mission_id',v_m.id,'participant_id',v_participant.id,'provider_id',v_provider)
        from public.user_roles ur where ur.role::text in ('super_admin','admin');
      end if;
    end loop;
  end loop;
  return new;
end;
$function$;
revoke all on function public.record_provider_mission_completion() from public,anon,authenticated;
drop trigger if exists trg_record_provider_mission_completion on public.service_requests;
create trigger trg_record_provider_mission_completion
after update of status on public.service_requests
for each row execute function public.record_provider_mission_completion();

-- Mission notifications are delivered by the existing notifications push queue trigger.
