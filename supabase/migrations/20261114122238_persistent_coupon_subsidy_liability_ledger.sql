create table if not exists public.coupon_subsidy_ledger (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.service_requests(id) on delete restrict,
  coupon_id uuid not null references public.coupons(id) on delete restrict,
  customer_id uuid not null references public.profiles(id) on delete restrict,
  provider_id uuid references public.profiles(id) on delete set null,
  discount_amount numeric(12,2) not null check (discount_amount > 0),
  currency text not null default 'IQD',
  status text not null default 'pending_completion'
    check (status in ('pending_completion','payable','void')),
  created_at timestamptz not null default now(),
  payable_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists coupon_subsidy_ledger_status_idx
  on public.coupon_subsidy_ledger(status, payable_at);

create index if not exists coupon_subsidy_ledger_provider_idx
  on public.coupon_subsidy_ledger(provider_id, status);

alter table public.coupon_subsidy_ledger enable row level security;

create or replace function public.record_new_request_coupon()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if new.coupon_id is not null then
    insert into public.coupon_redemptions(coupon_id,user_id,request_id,discount_amount)
    values(new.coupon_id,new.customer_id,new.id,new.coupon_discount);

    update public.coupons
      set used_count=used_count+1, updated_at=now()
      where id=new.coupon_id;

    insert into public.coupon_subsidy_ledger(
      request_id,coupon_id,customer_id,discount_amount,currency,status
    )
    values(new.id,new.coupon_id,new.customer_id,new.coupon_discount,'IQD','pending_completion');

    insert into public.notifications(user_id,type,title,body,link,data)
    values(
      new.customer_id,
      'coupon_redeemed',
      'تم تطبيق الكوبون 🎉',
      'تم خصم ' || trim(to_char(new.coupon_discount,'FM999999990.##')) || ' د.ع من طلبك',
      '/request/' || new.id,
      jsonb_build_object('coupon_id',new.coupon_id,'request_id',new.id,
        'discount',new.coupon_discount,'payable',new.customer_payable)
    );
  end if;
  return new;
end;
$function$;

create or replace function public.mark_coupon_subsidy_payable()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if new.status='completed' and old.status is distinct from 'completed'
     and new.coupon_id is not null then
    update public.coupon_subsidy_ledger
    set provider_id=new.provider_id,
        status='payable',
        payable_at=now(),
        updated_at=now()
    where request_id=new.id and status='pending_completion';
  end if;
  return new;
end;
$function$;

drop trigger if exists z_mark_coupon_subsidy_payable on public.service_requests;
create trigger z_mark_coupon_subsidy_payable
after update of status on public.service_requests
for each row execute function public.mark_coupon_subsidy_payable();

create or replace function public.restore_coupon_after_request_cancel()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if new.status='cancelled'
     and old.status is distinct from 'cancelled'
     and new.coupon_id is not null then
    delete from public.coupon_redemptions
    where coupon_id=new.coupon_id
      and user_id=new.customer_id
      and request_id=new.id;

    if found then
      update public.coupons
      set used_count=greatest(0,used_count-1),updated_at=now()
      where id=new.coupon_id;

      update public.coupon_subsidy_ledger
      set status='void',updated_at=now()
      where request_id=new.id and status in ('pending_completion','payable');
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.admin_coupon_subsidy_report()
returns table(
  payable_count bigint,
  payable_total numeric,
  pending_count bigint,
  pending_total numeric,
  void_count bigint
)
language plpgsql
security definer
set search_path = public
as $function$
begin
  perform public.assert_staff('admin');
  return query
  select
    count(*) filter (where l.status='payable'),
    coalesce(sum(l.discount_amount) filter (where l.status='payable'),0),
    count(*) filter (where l.status='pending_completion'),
    coalesce(sum(l.discount_amount) filter (where l.status='pending_completion'),0),
    count(*) filter (where l.status='void')
  from public.coupon_subsidy_ledger l;
end;
$function$;

revoke all on table public.coupon_subsidy_ledger from anon,authenticated;
revoke all on function public.admin_coupon_subsidy_report() from public,anon;
grant execute on function public.admin_coupon_subsidy_report() to authenticated;
