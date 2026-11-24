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
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists z_restore_coupon_after_cancel on public.service_requests;
create trigger z_restore_coupon_after_cancel
after update of status on public.service_requests
for each row execute function public.restore_coupon_after_request_cancel();
