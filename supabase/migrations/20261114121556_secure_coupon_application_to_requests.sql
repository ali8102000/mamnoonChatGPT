alter table public.service_requests
  add column if not exists coupon_code text,
  add column if not exists coupon_id uuid references public.coupons(id) on delete set null,
  add column if not exists coupon_discount numeric(12,2) not null default 0,
  add column if not exists customer_payable numeric(12,2);

create index if not exists service_requests_coupon_id_idx
  on public.service_requests(coupon_id) where coupon_id is not null;

create or replace function public.preview_my_coupon(p_code text, p_amount numeric)
returns table(coupon_id uuid, code text, discount numeric, payable numeric, type text, value numeric)
language plpgsql
security definer
stable
set search_path = public
as $function$
declare
  c public.coupons%rowtype;
  v_discount numeric;
begin
  if auth.uid() is null then raise exception 'يجب تسجيل الدخول'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'قيمة الطلب غير صالحة'; end if;

  select cp.* into c
  from public.coupons cp
  join public.coupon_assignments ca on ca.coupon_id=cp.id
  where ca.user_id=auth.uid()
    and upper(cp.code)=upper(trim(p_code))
    and cp.active=true
    and (cp.expires_at is null or cp.expires_at>now())
    and cp.used_count<cp.max_uses
    and p_amount>=cp.min_amount
    and not exists (
      select 1 from public.coupon_redemptions cr
      where cr.coupon_id=cp.id and cr.user_id=auth.uid()
    )
  limit 1;

  if not found then raise exception 'الكوبون غير متاح لحسابك أو منتهي أو لا يطابق شروط الطلب'; end if;

  v_discount := case
    when c.type='percentage' then round(p_amount * c.value / 100,2)
    else least(p_amount,c.value)
  end;
  v_discount := greatest(0,least(p_amount,v_discount));

  return query select c.id,c.code,v_discount,p_amount-v_discount,c.type,c.value;
end;
$function$;

create or replace function public.apply_coupon_to_new_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  c public.coupons%rowtype;
  v_amount numeric;
  v_discount numeric;
begin
  if nullif(trim(new.coupon_code),'') is null then
    new.coupon_code := null;
    new.coupon_id := null;
    new.coupon_discount := 0;
    new.customer_payable := coalesce(new.price_estimate,new.customer_price);
    return new;
  end if;

  if auth.uid() is null or auth.uid() is distinct from new.customer_id then
    raise exception 'غير مخوّل لاستخدام الكوبون';
  end if;

  v_amount := coalesce(new.price_estimate,new.customer_price);
  if v_amount is null or v_amount <= 0 then
    raise exception 'لا يمكن تطبيق كوبون قبل تحديد سعر الطلب';
  end if;

  select cp.* into c
  from public.coupons cp
  join public.coupon_assignments ca on ca.coupon_id=cp.id
  where ca.user_id=new.customer_id
    and upper(cp.code)=upper(trim(new.coupon_code))
    and cp.active=true
    and (cp.expires_at is null or cp.expires_at>now())
    and cp.used_count<cp.max_uses
    and v_amount>=cp.min_amount
    and not exists (
      select 1 from public.coupon_redemptions cr
      where cr.coupon_id=cp.id and cr.user_id=new.customer_id
    )
  for update of cp;

  if not found then raise exception 'الكوبون غير متاح لحسابك أو منتهي أو لا يطابق شروط الطلب'; end if;

  v_discount := case
    when c.type='percentage' then round(v_amount*c.value/100,2)
    else least(v_amount,c.value)
  end;
  v_discount := greatest(0,least(v_amount,v_discount));

  new.coupon_code := c.code;
  new.coupon_id := c.id;
  new.coupon_discount := v_discount;
  new.customer_payable := v_amount-v_discount;
  return new;
end;
$function$;

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

drop trigger if exists z_apply_coupon_to_new_request on public.service_requests;
create trigger z_apply_coupon_to_new_request
before insert on public.service_requests
for each row execute function public.apply_coupon_to_new_request();

drop trigger if exists z_record_new_request_coupon on public.service_requests;
create trigger z_record_new_request_coupon
after insert on public.service_requests
for each row execute function public.record_new_request_coupon();

revoke all on function public.preview_my_coupon(text,numeric) from public,anon;
grant execute on function public.preview_my_coupon(text,numeric) to authenticated;
