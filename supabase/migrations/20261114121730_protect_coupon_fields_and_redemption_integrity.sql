create or replace function public.prevent_request_coupon_tampering()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if new.coupon_code is distinct from old.coupon_code
     or new.coupon_id is distinct from old.coupon_id
     or new.coupon_discount is distinct from old.coupon_discount
     or new.customer_payable is distinct from old.customer_payable then
    raise exception 'لا يمكن تعديل الكوبون أو الخصم بعد إرسال الطلب';
  end if;
  return new;
end;
$function$;

drop trigger if exists z_prevent_request_coupon_tampering on public.service_requests;
create trigger z_prevent_request_coupon_tampering
before update on public.service_requests
for each row execute function public.prevent_request_coupon_tampering();
