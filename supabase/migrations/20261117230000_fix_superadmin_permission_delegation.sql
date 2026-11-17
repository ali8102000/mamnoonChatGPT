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
  -- Reject NULL explicitly: PL/pgSQL IF treats a NULL condition as not true,
  -- which could otherwise skip scope validation for a regional staff caller.
  if p_scope_type is null
     or p_scope_type not in ('global','governorate')
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
        exists (select 1 from public.user_roles delegator_role where delegator_role.user_id=d.delegator_id and delegator_role.role::text='super_admin')
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
        exists (select 1 from public.user_roles delegator_role where delegator_role.user_id=d.delegator_id and delegator_role.role::text='super_admin')
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



-- Remove legacy broad-role bypasses from financial and coupon SECURITY DEFINER RPCs.
-- These checks are enforced in PostgreSQL as well as in the Edge Function.
create or replace function public.admin_adjust_wallet(
  p_user_id uuid, p_amount numeric, p_note text, p_type text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_delta numeric;
  v_bal numeric;
  v_target_governorate text;
  v_scope_type text;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  select governorate_key into v_target_governorate
    from public.profiles where id=p_user_id;
  if not found then raise exception 'target_user_not_found'; end if;
  v_scope_type := case when v_target_governorate is null then 'global' else 'governorate' end;
  if not public.admin_has_permission('finance.wallet.adjust',v_scope_type,v_target_governorate) then
    raise exception 'missing_finance_wallet_permission';
  end if;
  if p_amount is null or p_amount<=0 or p_amount>1000000000 then
    raise exception 'invalid_amount';
  end if;
  if p_type is null or p_type not in ('credit','debit') then raise exception 'invalid_adjustment_type'; end if;
  if p_note is not null and length(p_note)>500 then raise exception 'note_too_long'; end if;

  v_delta := case when p_type='debit' then -p_amount else p_amount end;
  insert into public.driver_wallets(user_id,balance)
  values(p_user_id,v_delta)
  on conflict(user_id) do update
    set balance=driver_wallets.balance+v_delta,updated_at=now()
  returning balance into v_bal;
  insert into public.transactions(user_id,type,amount,balance_after,note)
  values(p_user_id,'adjustment',v_delta,v_bal,p_note);
  perform public.log_admin_action('adjust_wallet','user',p_user_id::text,
    jsonb_build_object('amount',v_delta,'note',p_note));
end;
$function$;

create or replace function public.admin_save_coupon(
  p_id uuid, p_code text, p_type text, p_value numeric, p_max_uses integer,
  p_expires_at timestamptz, p_active boolean, p_min_amount numeric
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_id uuid;
  v_code text := upper(trim(coalesce(p_code,'')));
  v_used integer := 0;
  v_permission text := case when p_id is null then 'promotions.create' else 'promotions.edit' end;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if not public.admin_has_permission(v_permission,'global',null) then
    raise exception 'missing_coupon_permission';
  end if;
  if length(v_code)<2 or length(v_code)>50 then raise exception 'invalid_coupon_code'; end if;
  if p_type is null or p_type not in ('percentage','fixed') then raise exception 'invalid_coupon_type'; end if;
  if p_value is null or p_value<=0 or (p_type='percentage' and p_value>100) then
    raise exception 'invalid_coupon_value';
  end if;
  if p_max_uses is null or p_max_uses<1 then raise exception 'invalid_coupon_max_uses'; end if;
  if p_min_amount is null or p_min_amount<0 then raise exception 'invalid_coupon_min_amount'; end if;
  if coalesce(p_active,true) and p_expires_at is not null and p_expires_at<=now() then
    raise exception 'coupon_expiry_must_be_future';
  end if;

  if p_id is null then
    insert into public.coupons(code,type,value,max_uses,expires_at,active,min_amount)
    values(v_code,p_type,p_value,p_max_uses,p_expires_at,coalesce(p_active,true),p_min_amount)
    returning id into v_id;
    perform public.log_admin_action('create_coupon','coupon',v_id::text,jsonb_build_object('code',v_code));
  else
    select used_count into v_used from public.coupons where id=p_id for update;
    if not found then raise exception 'coupon_not_found'; end if;
    if p_max_uses<v_used then raise exception 'max_uses_below_used_count'; end if;
    update public.coupons
      set code=v_code,type=p_type,value=p_value,max_uses=p_max_uses,
          expires_at=p_expires_at,active=coalesce(p_active,true),
          min_amount=p_min_amount,updated_at=now()
      where id=p_id returning id into v_id;
    perform public.log_admin_action('update_coupon','coupon',p_id::text,jsonb_build_object('code',v_code));
  end if;
  return v_id;
end;
$function$;

create or replace function public.admin_delete_coupon(p_coupon_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if not public.admin_has_permission('promotions.delete','global',null) then
    raise exception 'missing_coupon_delete_permission';
  end if;
  delete from public.coupons where id=p_coupon_id;
  if not found then raise exception 'coupon_not_found'; end if;
  perform public.log_admin_action('delete_coupon','coupon',p_coupon_id::text);
end;
$function$;

create or replace function public.admin_distribute_coupon(
  p_coupon_id uuid, p_target text default 'customers', p_single_user_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_coupon public.coupons%rowtype;
  v_count integer:=0;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if not public.admin_has_permission('promotions.publish','global',null) then
    raise exception 'missing_coupon_publish_permission';
  end if;
  if p_target is null or p_target not in ('customers','single','customers_1','customers_2','customers_3','customers_4','customers_5') then
    raise exception 'invalid_coupon_target';
  end if;
  if p_target='single' and p_single_user_id is null then raise exception 'single_customer_required'; end if;
  select * into v_coupon from public.coupons where id=p_coupon_id and active=true
    and (expires_at is null or expires_at>now()) and used_count<max_uses for update;
  if not found then raise exception 'coupon_not_active_or_exhausted'; end if;
  if p_target='single' and (
    not exists(select 1 from public.user_roles r where r.user_id=p_single_user_id and r.role='customer')
    or exists(select 1 from public.user_roles r where r.user_id=p_single_user_id and r.role in ('driver','worker'))
  ) then raise exception 'target_is_not_customer'; end if;

  with customer_activity as (
    select customer_id,count(*)::integer as request_count
    from public.service_requests
    where created_at>=now()-interval '7 days' and status::text<>'cancelled'
    group by customer_id
  ), targets as (
    select p.id from public.profiles p
    left join customer_activity ca on ca.customer_id=p.id
    where exists(select 1 from public.user_roles r where r.user_id=p.id and r.role='customer')
      and not exists(select 1 from public.user_roles r where r.user_id=p.id and r.role in ('driver','worker'))
      and case p_target
        when 'customers' then true
        when 'single' then p.id=p_single_user_id
        when 'customers_1' then coalesce(ca.request_count,0)=1
        when 'customers_2' then coalesce(ca.request_count,0)=2
        when 'customers_3' then coalesce(ca.request_count,0)=3
        when 'customers_4' then coalesce(ca.request_count,0)=4
        when 'customers_5' then coalesce(ca.request_count,0)>=5
        else false end
  ), inserted as (
    insert into public.coupon_assignments(coupon_id,user_id,assigned_by)
    select p_coupon_id,id,auth.uid() from targets
    on conflict(coupon_id,user_id) do nothing returning user_id
  ), notified as (
    insert into public.notifications(user_id,type,title,body,link,data)
    select i.user_id,'coupon_received','وصلك كوبون من ممنون 🎁',
      'الكود: '||v_coupon.code||' — '||
      case when v_coupon.type='percentage'
        then trim(to_char(v_coupon.value,'FM999990.##'))||'% خصم'
        else trim(to_char(v_coupon.value,'FM999999990'))||' دينار خصم' end,
      '/coupons',jsonb_build_object('coupon_id',v_coupon.id,'code',v_coupon.code,
        'type',v_coupon.type,'value',v_coupon.value,'expires_at',v_coupon.expires_at)
    from inserted i returning id
  )
  select count(*) into v_count from inserted;
  perform public.log_admin_action('distribute_coupon','coupon',p_coupon_id::text,
    jsonb_build_object('target',p_target,'sent',v_count,'activity_window','7 days'));
  return v_count;
end;
$function$;


create or replace function public.admin_coupon_audience_count(p_target text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare v_count integer;
begin
  if auth.uid() is null or not public.admin_has_permission('promotions.read','global',null) then
    raise exception 'missing_promotions_read_permission';
  end if;
  if p_target not in ('customers','single','customers_1','customers_2','customers_3','customers_4','customers_5') then
    raise exception 'invalid_coupon_audience';
  end if;
  if p_target='single' then return 1; end if;
  if p_target in ('customers_1','customers_2','customers_3','customers_4','customers_5') then
    select count(*) into v_count from public.profiles p
    where exists(select 1 from public.user_roles r where r.user_id=p.id and r.role='customer')
      and not exists(select 1 from public.user_roles r where r.user_id=p.id and r.role in ('driver','worker'))
      and case when p_target='customers_5' then
        (select count(*) from public.service_requests sr where sr.customer_id=p.id
          and sr.created_at>=now()-interval '7 days' and sr.status::text<>'cancelled')>=5
      else
        (select count(*) from public.service_requests sr where sr.customer_id=p.id
          and sr.created_at>=now()-interval '7 days' and sr.status::text<>'cancelled')=
        case p_target when 'customers_1' then 1 when 'customers_2' then 2
          when 'customers_3' then 3 else 4 end
      end;
  else
    select count(*) into v_count from public.profiles p
    where exists(select 1 from public.user_roles r where r.user_id=p.id and r.role='customer')
      and not exists(select 1 from public.user_roles r where r.user_id=p.id and r.role in ('driver','worker'));
  end if;
  return coalesce(v_count,0);
end;
$function$;

create or replace function public.admin_coupon_subsidy_report()
returns table(payable_count bigint,payable_total numeric,pending_count bigint,pending_total numeric,void_count bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if auth.uid() is null or not public.admin_has_permission('promotions.read','global',null) then
    raise exception 'missing_promotions_read_permission';
  end if;
  return query
  select count(*) filter(where l.status='payable'),
    coalesce(sum(l.discount_amount) filter(where l.status='payable'),0),
    count(*) filter(where l.status='pending_completion'),
    coalesce(sum(l.discount_amount) filter(where l.status='pending_completion'),0),
    count(*) filter(where l.status='void')
  from public.coupon_subsidy_ledger l;
end;
$function$;


-- Replace remaining legacy admin-role gates on SECURITY DEFINER RPCs with
-- operation-specific permissions and the target record's governorate scope.
do $granular_rpc_guards$
declare
  v_signature text;
  v_permission_expression text;
  v_scope_expression text;
  v_error text;
  v_definition text;
  v_new_definition text;
  v_check text;
begin
  for v_signature,v_permission_expression,v_scope_expression,v_error in
    select * from (values
      ('public.admin_block_user(uuid,text,timestamp with time zone)',
        '''users.block''',
        '(select governorate_key from public.profiles where id=p_user_id)',
        'missing_users_block_permission'),
      ('public.admin_unblock_user(uuid)',
        '''users.unblock''',
        '(select governorate_key from public.profiles where id=p_user_id)',
        'missing_users_unblock_permission'),
      ('public.admin_set_provider_status(uuid,text,text,timestamp with time zone)',
        'case when p_status=''suspended'' then ''providers.suspend'' else ''providers.verify'' end',
        '(select governorate_key from public.profiles where id=p_user_id)',
        'missing_provider_status_permission'),
      ('public.admin_review_provider_change_request(uuid,text,text)',
        '''providers.verify''',
        '(select governorate_key from public.profiles where id=(select user_id from public.provider_change_requests where id=_request_id))',
        'missing_provider_verify_permission'),
      ('public.admin_cancel_request(uuid,text)',
        '''orders.cancel''',
        '(select governorate_key from public.service_requests where id=p_request_id)',
        'missing_order_cancel_permission'),
      ('public.admin_reopen_request(uuid)',
        '''orders.reopen''',
        '(select governorate_key from public.service_requests where id=p_request_id)',
        'missing_order_reopen_permission'),
      ('public.admin_broadcast_announcement(text,text,text)',
        '''notifications.create''',
        'null',
        'missing_notifications_create_permission'),
      ('public.admin_cancel_free_subscription(uuid)',
        '''subscriptions.revoke''',
        '(select governorate_key from public.profiles where id=p_user_id)',
        'missing_subscription_revoke_permission'),
      ('public.admin_extend_subscription(uuid,integer)',
        '''subscriptions.grant''',
        '(select governorate_key from public.profiles where id=p_user_id)',
        'missing_subscription_grant_permission'),
      ('public.admin_grant_subscription(uuid,text,text)',
        '''subscriptions.grant''',
        '(select governorate_key from public.profiles where id=p_user_id)',
        'missing_subscription_grant_permission'),
      ('public.admin_grant_subscriptions_bulk(uuid[],text,text)',
        '''subscriptions.grant''',
        'null',
        'missing_subscription_grant_permission'),
      ('public.admin_pause_all_subscriptions()',
        '''subscriptions.plans.manage''',
        'null',
        'missing_subscription_manage_permission'),
      ('public.admin_set_subscription_status(uuid,text)',
        'case when p_status=''active'' then ''subscriptions.grant'' else ''subscriptions.revoke'' end',
        '(select governorate_key from public.profiles where id=p_user_id)',
        'missing_subscription_status_permission')
    ) as guards(signature,permission_expression,scope_expression,error_message)
  loop
    v_definition := pg_get_functiondef(v_signature::regprocedure);
    v_check := format(
      'IF NOT public.admin_has_permission(%s, CASE WHEN (%s) IS NULL THEN ''global'' ELSE ''governorate'' END, (%s)) THEN RAISE EXCEPTION %L; END IF;',
      v_permission_expression,v_scope_expression,v_scope_expression,v_error
    );
    v_new_definition := regexp_replace(
      v_definition,
      'perform\s+public\.assert_staff\(''admin''\);',
      v_check,
      'gi'
    );
    if v_new_definition=v_definition then
      raise exception 'granular_permission_anchor_missing_for_%',v_signature;
    end if;
    execute v_new_definition;
  end loop;
end;
$granular_rpc_guards$;

commit;
