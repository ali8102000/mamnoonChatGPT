create table if not exists public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  purpose text not null check (purpose in ('subscription','service_request')),
  plan_id uuid references public.subscription_plans(id),
  request_id uuid references public.service_requests(id),
  amount integer not null check (amount > 0),
  currency text not null default 'IQD' check (currency = 'IQD'),
  provider text not null default 'zaincash' check (provider = 'zaincash'),
  status text not null default 'pending' check (status in ('pending','paid','failed','expired','refunded','partially_refunded')),
  external_reference_id uuid not null unique default gen_random_uuid(),
  gateway_transaction_id text unique,
  gateway_status text,
  redirect_url text,
  paid_at timestamptz,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_transactions_purpose_ref_check check (
    (purpose='subscription' and plan_id is not null and request_id is null)
    or (purpose='service_request' and request_id is not null and plan_id is null)
  )
);
create index if not exists payment_transactions_user_created_idx on public.payment_transactions(user_id, created_at desc);
create index if not exists payment_transactions_request_idx on public.payment_transactions(request_id, created_at desc) where request_id is not null;
alter table public.payment_transactions enable row level security;
drop policy if exists "Users see own payment transactions" on public.payment_transactions;
create policy "Users see own payment transactions" on public.payment_transactions for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.payment_transactions from anon, authenticated;
grant select on public.payment_transactions to authenticated;
create table if not exists public.zaincash_webhook_events (
  event_id text primary key, transaction_id text, received_at timestamptz not null default now(), payload jsonb not null default '{}'::jsonb
);
alter table public.zaincash_webhook_events enable row level security;
revoke all on public.zaincash_webhook_events from anon, authenticated;
create or replace function public.finalize_zaincash_payment(p_payment_id uuid, p_gateway_transaction_id text, p_gateway_status text, p_confirmed_amount integer, p_currency text, p_payload jsonb default '{}'::jsonb)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_payment public.payment_transactions%rowtype; v_plan public.subscription_plans%rowtype; v_start timestamptz; v_end timestamptz;
begin
 if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service_role_required'; end if;
 select * into v_payment from public.payment_transactions where id=p_payment_id for update;
 if not found then raise exception 'payment_not_found'; end if;
 if v_payment.status='paid' then return true; end if;
 if v_payment.status <> 'pending' then return false; end if;
 if p_gateway_status <> 'SUCCESS' then
  update public.payment_transactions set gateway_status=p_gateway_status,status=case when p_gateway_status='EXPIRED' then 'expired' else 'failed' end,
   gateway_transaction_id=coalesce(gateway_transaction_id,p_gateway_transaction_id),metadata=metadata||coalesce(p_payload,'{}'::jsonb),updated_at=now() where id=v_payment.id;
  return false;
 end if;
 if p_confirmed_amount <> v_payment.amount or p_currency <> 'IQD' then raise exception 'payment_amount_or_currency_mismatch'; end if;
 if v_payment.purpose='subscription' then
  select * into v_plan from public.subscription_plans where id=v_payment.plan_id and is_active and monthly_price=v_payment.amount and currency='IQD';
  if not found then raise exception 'subscription_plan_unavailable_or_price_changed'; end if;
  if exists(select 1 from public.user_subscriptions where user_id=v_payment.user_id and grant_type='admin') then raise exception 'company_granted_subscription_managed_by_admin'; end if;
  select case when us.status='active' and not us.is_trial and us.current_period_end>now() then us.current_period_end else now() end
   into v_start from public.user_subscriptions us where us.user_id=v_payment.user_id for update;
  if v_start is null then v_start:=now(); end if;
  v_end:=v_start+interval '1 month';
  insert into public.user_subscriptions(user_id,plan_id,status,billing_cycle,current_period_start,current_period_end,request_count,resets_count_period_start,auto_renew,is_trial,trial_started_at,trial_ends_at,granted_by,grant_type,cancel_at_period_end,cancelled_at,provider_types)
  values(v_payment.user_id,v_payment.plan_id,'active','monthly',v_start,v_end,0,now(),false,false,null,null,null,'paid',false,null,public.mamnoon_provider_kinds(v_payment.user_id))
  on conflict(user_id) do update set plan_id=excluded.plan_id,status='active',billing_cycle='monthly',current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,request_count=0,resets_count_period_start=now(),auto_renew=false,is_trial=false,trial_started_at=null,trial_ends_at=null,granted_by=null,grant_type='paid',cancel_at_period_end=false,cancelled_at=null,provider_types=excluded.provider_types,updated_at=now();
  insert into public.notifications(user_id,type,title,body,link) values(v_payment.user_id,'subscription_activated','تم تفعيل اشتراكك','تم تأكيد الدفع عبر زين كاش وتفعيل الاشتراك لمدة شهر','/subscriptions');
 else
  update public.service_requests set payment_method='zaincash',updated_at=now() where id=v_payment.request_id and customer_id=v_payment.user_id and status in ('accepted','in_progress','completed');
  if not found then raise exception 'request_not_payable_or_not_owned'; end if;
 end if;
 update public.payment_transactions set status='paid',gateway_status='SUCCESS',gateway_transaction_id=p_gateway_transaction_id,paid_at=now(),metadata=metadata||coalesce(p_payload,'{}'::jsonb),updated_at=now() where id=v_payment.id;
 return true;
end; $$;
revoke all on function public.finalize_zaincash_payment(uuid,text,text,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.finalize_zaincash_payment(uuid,text,text,integer,text,jsonb) to service_role;
