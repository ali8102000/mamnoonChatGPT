create or replace function public.cancel_service_request(_request_id uuid, _reason text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  select id, customer_id, provider_id, status, type, provider_arrived_at
  into r from public.service_requests where id = _request_id for update;
  if not found then raise exception 'request_not_found'; end if;
  if r.customer_id <> auth.uid() and r.provider_id <> auth.uid() then
    raise exception 'forbidden';
  end if;
  if r.status in ('completed','cancelled') then raise exception 'request_finished'; end if;
  if r.provider_arrived_at is not null then raise exception 'provider_already_arrived'; end if;
  if r.type::text = 'taxi' and r.status = 'in_progress'
     and (r.customer_id = auth.uid() or r.provider_id = auth.uid()) then
    raise exception 'taxi_trip_already_started';
  end if;
  if r.customer_id = auth.uid() then
    update public.service_requests
    set status = 'cancelled', cancelled_by = auth.uid(), cancellation_reason = left(_reason, 500)
    where id = _request_id;
    delete from public.request_offers where request_id = _request_id;
    if r.provider_id is not null then
      insert into public.notifications (user_id, type, title, body, link)
      values (r.provider_id, 'request_cancelled', 'أُلغي الطلب',
        coalesce(left(_reason, 200), 'ألغى الزبون الطلب'), '/request/' || _request_id);
    end if;
    return 'cancelled';
  elsif r.provider_id = auth.uid() then
    perform set_config('mamnoon.allow_provider_request_transition', 'true', true);
    update public.service_requests
    set status = 'searching', provider_id = null, accepted_at = null,
        cancelled_by = auth.uid(), cancellation_reason = left(_reason, 500)
    where id = _request_id;
    perform set_config('mamnoon.allow_provider_request_transition', 'false', true);
    delete from public.request_offers where request_id = _request_id and provider_id = auth.uid();
    insert into public.notifications (user_id, type, title, body, link)
    values (r.customer_id, 'provider_released', 'نبحث عن مقدّم خدمة آخر',
      coalesce(left(_reason, 200), 'اعتذر مقدّم الخدمة'), '/request/' || _request_id);
    return 'released';
  end if;
  raise exception 'forbidden';
end;
$function$;