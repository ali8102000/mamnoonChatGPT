-- Admin-controlled signup rewards and delayed customer coupons.
-- Campaigns remain inactive until an administrator explicitly enables them.

create table if not exists public.mamnoon_growth_campaigns (
  id uuid primary key default gen_random_uuid(),
  campaign_type text not null check (campaign_type in ('provider_wallet_signup','customer_delayed_coupon')),
  title text not null check (length(btrim(title)) between 3 and 120),
  provider_type text,
  service_slug text,
  target_governorates text[] not null default '{}'::text[],
  amount_iqd bigint not null check (amount_iqd between 1 and 100000000),
  budget_iqd bigint not null default 100000000 check (budget_iqd between 1 and 1000000000000),
  spent_iqd bigint not null default 0 check (spent_iqd >= 0 and spent_iqd <= budget_iqd),
  delay_days integer not null default 0 check (delay_days between 0 and 3650),
  coupon_valid_days integer not null default 0 check (coupon_valid_days between 0 and 3650),
  max_awards integer not null default 100000 check (max_awards between 1 and 1000000),
  issued_count integer not null default 0 check (issued_count >= 0),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  active boolean not null default false,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mamnoon_growth_campaign_window check (ends_at > starts_at),
  constraint mamnoon_growth_campaign_budget check (budget_iqd >= amount_iqd),
  constraint mamnoon_growth_provider_type check (
    (campaign_type='provider_wallet_signup' and provider_type in ('all','driver','large_driver','worker'))
    or (campaign_type='customer_delayed_coupon' and provider_type is null)
  ),
  constraint mamnoon_growth_delay_check check (
    (campaign_type='provider_wallet_signup' and delay_days=0)
    or (campaign_type='customer_delayed_coupon' and delay_days between 1 and 3650)
  ),
  constraint mamnoon_growth_coupon_validity_check check (
    campaign_type='provider_wallet_signup' or coupon_valid_days between 0 and 3650
  ),
  constraint mamnoon_growth_service_check check (
    service_slug is null or (campaign_type='provider_wallet_signup' and provider_type in ('worker','all'))
  ),
  constraint mamnoon_growth_governorates_check check (
    target_governorates <@ array['baghdad','basra','nineveh','erbil','sulaymaniyah','duhok','kirkuk','najaf','karbala','babil','anbar','diyala','saladin','wasit','dhiqar','maysan','muthanna','qadisiyah']::text[]
  )
);

create table if not exists public.mamnoon_growth_campaign_awards (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.mamnoon_growth_campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  award_type text not null check (award_type in ('wallet_credit','customer_coupon')),
  amount_iqd bigint not null check (amount_iqd > 0),
  wallet_transaction_id uuid references public.account_wallet_transactions(id),
  coupon_id uuid references public.coupons(id),
  created_at timestamptz not null default now(),
  unique(campaign_id,user_id)
);

create index if not exists mamnoon_growth_campaigns_active_window_idx
  on public.mamnoon_growth_campaigns(active,starts_at,ends_at);
create index if not exists mamnoon_growth_awards_user_idx
  on public.mamnoon_growth_campaign_awards(user_id,created_at desc);

alter table public.mamnoon_growth_campaigns enable row level security;
alter table public.mamnoon_growth_campaign_awards enable row level security;
revoke all on public.mamnoon_growth_campaigns,public.mamnoon_growth_campaign_awards from public,anon,authenticated;

create or replace function public.admin_save_growth_campaign(
  p_campaign_id uuid,
  p_campaign_type text,
  p_title text,
  p_provider_type text,
  p_service_slug text,
  p_target_governorates text[],
  p_amount_iqd bigint,
  p_budget_iqd bigint,
  p_delay_days integer,
  p_coupon_valid_days integer,
  p_max_awards integer,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_active boolean
)
returns uuid
language plpgsql
security definer
set search_path=public
as $function$
declare
  v_id uuid;
  v_gov text;
begin
  if auth.uid() is null or not (
    public.has_admin_access(auth.uid())
    or public.admin_has_permission('promotions.manage','global',null)
  ) then
    raise exception 'missing_promotions_manage_permission';
  end if;
  if p_campaign_type not in ('provider_wallet_signup','customer_delayed_coupon')
     or length(btrim(coalesce(p_title,''))) not between 3 and 120
     or p_amount_iqd not between 1 and 100000000
     or p_budget_iqd is null or p_budget_iqd not between p_amount_iqd and 1000000000000
     or p_max_awards not between 1 and 1000000
     or p_starts_at is null or p_ends_at is null or p_ends_at<=p_starts_at
     or coalesce(cardinality(p_target_governorates),0)>18
     or exists(select 1 from unnest(coalesce(p_target_governorates,'{}'::text[])) g
       where g not in ('baghdad','basra','nineveh','erbil','sulaymaniyah','duhok','kirkuk','najaf','karbala','babil','anbar','diyala','saladin','wasit','dhiqar','maysan','muthanna','qadisiyah')) then
    raise exception 'invalid_growth_campaign';
  end if;
  if p_campaign_type='provider_wallet_signup' then
    if p_provider_type is null or p_provider_type not in ('all','driver','large_driver','worker')
       or coalesce(p_delay_days,0)<>0
       or (p_service_slug is not null and p_provider_type not in ('worker','all'))
       or (p_service_slug is not null and not exists(select 1 from public.services where slug=p_service_slug)) then
      raise exception 'invalid_provider_signup_campaign';
    end if;
  elsif p_provider_type is not null or p_service_slug is not null
        or p_delay_days is null or p_delay_days not between 1 and 3650
        or p_coupon_valid_days not between 0 and 3650 then
    raise exception 'invalid_customer_coupon_campaign';
  end if;

  if coalesce(cardinality(p_target_governorates),0)=0 then
    if not public.has_admin_access(auth.uid()) then
      raise exception 'global_campaign_requires_admin';
    end if;
  else
    foreach v_gov in array p_target_governorates loop
      if not (public.has_admin_access(auth.uid()) or
        public.admin_has_permission('promotions.manage','governorate',v_gov)) then
        raise exception 'missing_promotions_manage_permission:%',v_gov;
      end if;
    end loop;
  end if;

  if p_campaign_id is null then
    insert into public.mamnoon_growth_campaigns(
      campaign_type,title,provider_type,service_slug,target_governorates,amount_iqd,budget_iqd,
      delay_days,coupon_valid_days,max_awards,starts_at,ends_at,active,created_by
    ) values (
      p_campaign_type,btrim(p_title),p_provider_type,p_service_slug,
      coalesce(p_target_governorates,'{}'::text[]),p_amount_iqd,p_budget_iqd,
      coalesce(p_delay_days,0),coalesce(p_coupon_valid_days,0),p_max_awards,
      p_starts_at,p_ends_at,coalesce(p_active,false),auth.uid()
    ) returning id into v_id;
  else
    select id into v_id from public.mamnoon_growth_campaigns where id=p_campaign_id for update;
    if not found then raise exception 'growth_campaign_not_found'; end if;
    if exists(select 1 from public.mamnoon_growth_campaign_awards where campaign_id=v_id)
       and (p_campaign_type <> (select campaign_type from public.mamnoon_growth_campaigns where id=v_id)
         or p_amount_iqd <> (select amount_iqd from public.mamnoon_growth_campaigns where id=v_id)) then
      raise exception 'cannot_change_campaign_type_or_amount_after_awards';
    end if;
    update public.mamnoon_growth_campaigns set
      campaign_type=p_campaign_type,title=btrim(p_title),provider_type=p_provider_type,service_slug=p_service_slug,
      target_governorates=coalesce(p_target_governorates,'{}'::text[]),
      amount_iqd=p_amount_iqd,budget_iqd=p_budget_iqd,delay_days=coalesce(p_delay_days,0),
      coupon_valid_days=coalesce(p_coupon_valid_days,0),max_awards=p_max_awards,
      starts_at=p_starts_at,ends_at=p_ends_at,active=coalesce(p_active,false),updated_at=now()
    where id=v_id;
  end if;

  perform public.log_admin_action(
    case when p_campaign_id is null then 'create_growth_campaign' else 'update_growth_campaign' end,
    'growth_campaign',v_id::text,
    jsonb_build_object('campaign_type',p_campaign_type,'amount_iqd',p_amount_iqd,'budget_iqd',p_budget_iqd,
      'delay_days',p_delay_days,'governorates',coalesce(p_target_governorates,'{}'::text[]),
      'provider_type',p_provider_type,'active',p_active)
  );
  return v_id;
end;
$function$;
revoke all on function public.admin_save_growth_campaign(uuid,text,text,text,text,text[],bigint,bigint,integer,integer,integer,timestamptz,timestamptz,boolean) from public,anon;
grant execute on function public.admin_save_growth_campaign(uuid,text,text,text,text,text[],bigint,bigint,integer,integer,integer,timestamptz,timestamptz,boolean) to authenticated;

create or replace function public.admin_list_growth_campaigns()
returns table(
  campaign_id uuid,campaign_type text,title text,provider_type text,service_slug text,
  target_governorates text[],amount_iqd bigint,budget_iqd bigint,spent_iqd bigint,delay_days integer,coupon_valid_days integer,
  max_awards integer,issued_count integer,starts_at timestamptz,ends_at timestamptz,active boolean,
  created_at timestamptz
)
language plpgsql stable security definer
set search_path=public
as $function$
begin
  if auth.uid() is null or not (
    public.has_admin_access(auth.uid())
    or public.admin_has_permission('promotions.manage','global',null)
  ) then raise exception 'missing_promotions_manage_permission'; end if;
  return query
    select c.id,c.campaign_type,c.title,c.provider_type,c.service_slug,c.target_governorates,
      c.amount_iqd,c.budget_iqd,c.spent_iqd,c.delay_days,c.coupon_valid_days,c.max_awards,c.issued_count,
      c.starts_at,c.ends_at,c.active,c.created_at
    from public.mamnoon_growth_campaigns c
    order by c.created_at desc;
end;
$function$;
revoke all on function public.admin_list_growth_campaigns() from public,anon;
grant execute on function public.admin_list_growth_campaigns() to authenticated;

create or replace function public.admin_list_growth_awards(p_limit integer default 100)
returns table(
  award_id uuid,campaign_id uuid,campaign_title text,user_id uuid,full_name text,phone text,
  governorate_key text,award_type text,amount_iqd bigint,wallet_transaction_id uuid,
  coupon_code text,created_at timestamptz
)
language plpgsql stable security definer
set search_path=public
as $function$
begin
  if auth.uid() is null or not (
    public.has_admin_access(auth.uid())
    or public.admin_has_permission('promotions.manage','global',null)
  ) then raise exception 'missing_promotions_manage_permission'; end if;
  return query
    select a.id,a.campaign_id,c.title,a.user_id,p.full_name,p.phone,p.governorate_key,
      a.award_type,a.amount_iqd,a.wallet_transaction_id,cp.code,a.created_at
    from public.mamnoon_growth_campaign_awards a
    join public.mamnoon_growth_campaigns c on c.id=a.campaign_id
    join public.profiles p on p.id=a.user_id
    left join public.coupons cp on cp.id=a.coupon_id
    order by a.created_at desc
    limit greatest(1,least(coalesce(p_limit,100),500));
end;
$function$;
revoke all on function public.admin_list_growth_awards(integer) from public,anon;
grant execute on function public.admin_list_growth_awards(integer) to authenticated;

create or replace function public.mamnoon_apply_provider_signup_rewards(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path=public
as $function$
declare
  v_profile public.profiles%rowtype;
  v_campaign public.mamnoon_growth_campaigns%rowtype;
  v_award_id uuid;
  v_wallet_balance bigint;
  v_next_balance bigint;
  v_tx_id uuid;
  v_role_match boolean;
  v_count integer:=0;
begin
  if p_user_id is null then return 0; end if;
  select * into v_profile from public.profiles where id=p_user_id;
  if not found then return 0; end if;

  for v_campaign in
    select * from public.mamnoon_growth_campaigns
    where campaign_type='provider_wallet_signup' and active=true
      and v_profile.created_at between starts_at and ends_at
      and (cardinality(target_governorates)=0 or v_profile.governorate_key=any(target_governorates))
      and issued_count<max_awards and spent_iqd+amount_iqd<=budget_iqd
    order by created_at
    for update
  loop
    select exists(
      select 1 from public.user_roles r
      where r.user_id=p_user_id
        and case v_campaign.provider_type
          when 'all' then r.role::text in ('driver','large_driver','worker')
          else r.role::text=v_campaign.provider_type
        end
    ) into v_role_match;
    if not v_role_match then continue; end if;
    if v_campaign.service_slug is not null and not exists(
      select 1 from public.worker_services ws join public.services s on s.id=ws.service_id
      where ws.worker_id=p_user_id and s.slug=v_campaign.service_slug
    ) then continue; end if;

    insert into public.mamnoon_growth_campaign_awards(campaign_id,user_id,award_type,amount_iqd)
    values(v_campaign.id,p_user_id,'wallet_credit',v_campaign.amount_iqd)
    on conflict(campaign_id,user_id) do nothing returning id into v_award_id;
    if v_award_id is null then continue; end if;

    insert into public.account_wallets(user_id) values(p_user_id) on conflict(user_id) do nothing;
    select balance_iqd into v_wallet_balance from public.account_wallets where user_id=p_user_id for update;
    v_next_balance:=v_wallet_balance+v_campaign.amount_iqd;
    insert into public.account_wallet_transactions(
      user_id,transaction_type,amount_iqd,balance_after_iqd,provider,idempotency_key,description,metadata
    ) values(
      p_user_id,'adjustment',v_campaign.amount_iqd,v_next_balance,'mamnoon_growth_campaign',
      'growth:'||v_campaign.id::text||':'||p_user_id::text,
      'مكافأة تسجيل جديدة من ممنون: '||v_campaign.title,
      jsonb_build_object('campaign_id',v_campaign.id,'campaign_title',v_campaign.title,'award_type','signup_wallet_reward')
    ) returning id into v_tx_id;
    update public.account_wallets set balance_iqd=v_next_balance,updated_at=now() where user_id=p_user_id;
    update public.mamnoon_growth_campaign_awards set wallet_transaction_id=v_tx_id where id=v_award_id;
    update public.mamnoon_growth_campaigns set issued_count=issued_count+1,spent_iqd=spent_iqd+v_campaign.amount_iqd,updated_at=now() where id=v_campaign.id;
    insert into public.notifications(user_id,type,title,body,link,data)
    values(
      p_user_id,'wallet_bonus','مبروك! وصلتك مكافأة التسجيل 🎉',
      'تم إيداع '||to_char(v_campaign.amount_iqd,'FM999G999G999G990')||' دينار في محفظتك الرقمية.',
      '/profile',jsonb_build_object('campaign_id',v_campaign.id,'amount_iqd',v_campaign.amount_iqd,'wallet_transaction_id',v_tx_id)
    );
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$function$;
revoke all on function public.mamnoon_apply_provider_signup_rewards(uuid) from public,anon,authenticated;

create or replace function public.mamnoon_growth_provider_signup_trigger()
returns trigger
language plpgsql
security definer
set search_path=public
as $function$
declare
  v_user_id uuid;
begin
  if tg_table_name='profiles' then v_user_id:=new.id; else v_user_id:=new.user_id; end if;
  perform public.mamnoon_apply_provider_signup_rewards(v_user_id);
  return new;
end;
$function$;
revoke all on function public.mamnoon_growth_provider_signup_trigger() from public,anon,authenticated;

drop trigger if exists mamnoon_growth_provider_role_signup on public.user_roles;
create trigger mamnoon_growth_provider_role_signup
after insert on public.user_roles
for each row execute function public.mamnoon_growth_provider_signup_trigger();

drop trigger if exists mamnoon_growth_provider_profile_signup on public.profiles;
create trigger mamnoon_growth_provider_profile_signup
after insert or update of governorate_key on public.profiles
for each row execute function public.mamnoon_growth_provider_signup_trigger();

create or replace function public.process_mamnoon_growth_campaigns()
returns integer
language plpgsql
security definer
set search_path=public
as $function$
declare
  v_campaign public.mamnoon_growth_campaigns%rowtype;
  v_profile record;
  v_award_id uuid;
  v_coupon_id uuid;
  v_code text;
  v_assigned integer:=0;
begin
  if not pg_try_advisory_xact_lock(hashtext('mamnoon-growth-campaign-processor')) then return 0; end if;

  for v_campaign in
    select * from public.mamnoon_growth_campaigns
    where campaign_type='customer_delayed_coupon' and active=true
      and starts_at<=now() and issued_count<max_awards and spent_iqd+amount_iqd<=budget_iqd
    order by created_at
    for update
  loop
    for v_profile in
      select p.id,p.created_at,p.governorate_key,p.full_name
      from public.profiles p
      where p.created_at between v_campaign.starts_at and v_campaign.ends_at
        and p.created_at+make_interval(days=>v_campaign.delay_days)<=now()
        and (cardinality(v_campaign.target_governorates)=0 or p.governorate_key=any(v_campaign.target_governorates))
        and exists(select 1 from public.user_roles r where r.user_id=p.id and r.role::text='customer')
        and not exists(select 1 from public.mamnoon_growth_campaign_awards a where a.campaign_id=v_campaign.id and a.user_id=p.id)
      order by p.created_at
      limit 500
    loop
      exit when v_campaign.issued_count>=v_campaign.max_awards or v_campaign.spent_iqd+v_campaign.amount_iqd>v_campaign.budget_iqd;
      insert into public.mamnoon_growth_campaign_awards(campaign_id,user_id,award_type,amount_iqd)
      values(v_campaign.id,v_profile.id,'customer_coupon',v_campaign.amount_iqd)
      on conflict(campaign_id,user_id) do nothing returning id into v_award_id;
      if v_award_id is null then continue; end if;

      v_code:='MN'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
      insert into public.coupons(code,type,value,max_uses,used_count,min_amount,expires_at,active)
      values(v_code,'fixed',v_campaign.amount_iqd,1,0,0,
        case when v_campaign.coupon_valid_days>0 then now()+make_interval(days=>v_campaign.coupon_valid_days) else null end,true)
      returning id into v_coupon_id;
      insert into public.coupon_assignments(coupon_id,user_id,assigned_by)
      values(v_coupon_id,v_profile.id,null);
      update public.mamnoon_growth_campaign_awards set coupon_id=v_coupon_id where id=v_award_id;
      update public.mamnoon_growth_campaigns set issued_count=issued_count+1,spent_iqd=spent_iqd+v_campaign.amount_iqd,updated_at=now() where id=v_campaign.id;
      v_campaign.issued_count:=v_campaign.issued_count+1;
      v_campaign.spent_iqd:=v_campaign.spent_iqd+v_campaign.amount_iqd;
      insert into public.notifications(user_id,type,title,body,link,data)
      values(
        v_profile.id,'coupon_received','مبروك! وصلك خصم من ممنون 🎁',
        'بعد مرور '||v_campaign.delay_days::text||' أيام على تسجيلك، حصلت على خصم بقيمة '||
          to_char(v_campaign.amount_iqd,'FM999G999G999G990')||' دينار. رمز الخصم: '||v_code,
        '/coupons',jsonb_build_object('campaign_id',v_campaign.id,'coupon_id',v_coupon_id,'code',v_code,'type','fixed','value',v_campaign.amount_iqd)
      );
      v_assigned:=v_assigned+1;
    end loop;
  end loop;
  return v_assigned;
end;
$function$;
revoke all on function public.process_mamnoon_growth_campaigns() from public,anon,authenticated;

do $schedule$
declare v_job_id bigint;
begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    select jobid into v_job_id from cron.job where jobname='mamnoon-growth-campaign-processor' limit 1;
    if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
    perform cron.schedule('mamnoon-growth-campaign-processor','* * * * *',
      'select public.process_mamnoon_growth_campaigns();');
  end if;
end;
$schedule$;
