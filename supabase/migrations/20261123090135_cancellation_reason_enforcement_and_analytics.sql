-- Require a meaningful cancellation reason and expose an admin-only cancellation breakdown.
create index if not exists service_requests_cancelled_analytics_idx
  on public.service_requests (cancelled_by, cancellation_reason)
  where cancelled_by is not null;

create or replace function public.cancel_service_request(_request_id uuid, _reason text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r public.service_requests%rowtype;
  v_people integer := 0;
  v_lead uuid;
  v_reason text := nullif(left(btrim(coalesce(_reason, '')), 500), '');
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if v_reason is null or length(v_reason) < 2 then
    raise exception 'cancellation_reason_required';
  end if;

  select * into r from public.service_requests where id = _request_id;
  if not found then raise exception 'request_not_found'; end if;
  if r.customer_id <> auth.uid()
     and r.provider_id is distinct from auth.uid()
     and not (r.type::text = 'service' and public.is_service_request_provider(_request_id, auth.uid())) then
    raise exception 'forbidden';
  end if;

  perform 1
  from public.payment_transactions
  where request_id = _request_id
    and purpose = 'service_request'
    and provider = 'zaincash'
    and status in ('pending','paid')
  order by id
  for update;

  select * into r from public.service_requests where id = _request_id for update;
  if not found then raise exception 'request_not_found'; end if;
  if r.customer_id <> auth.uid()
     and r.provider_id is distinct from auth.uid()
     and not (r.type::text = 'service' and public.is_service_request_provider(_request_id, auth.uid())) then
    raise exception 'forbidden';
  end if;
  if r.status in ('completed', 'cancelled') then raise exception 'request_finished'; end if;
  if r.provider_arrived_at is not null then raise exception 'provider_already_arrived'; end if;
  if r.type::text = 'service' and r.status = 'in_progress' then raise exception 'service_already_started'; end if;
  if r.type::text = 'taxi' and r.status = 'in_progress' then raise exception 'taxi_trip_already_started'; end if;

  if r.customer_id = auth.uid() then
    update public.service_requests
    set status = 'cancelled', cancelled_by = auth.uid(), cancellation_reason = v_reason
    where id = _request_id;
    delete from public.request_offers where request_id = _request_id;
    insert into public.notifications(user_id, type, title, body, link)
    select srp.provider_id, 'request_cancelled', 'أُلغي الطلب',
      left(v_reason, 200), '/request/' || _request_id
    from public.service_request_providers srp where srp.request_id = _request_id;
    if r.provider_id is not null
       and not exists (
         select 1 from public.service_request_providers srp
         where srp.request_id = _request_id and srp.provider_id = r.provider_id
       ) then
      insert into public.notifications(user_id, type, title, body, link)
      values (r.provider_id, 'request_cancelled', 'أُلغي الطلب',
        left(v_reason, 200), '/request/' || _request_id);
    end if;
    return 'cancelled';
  end if;

  if r.type::text = 'service'
     and public.is_service_request_provider(_request_id, auth.uid()) then
    delete from public.service_request_providers
    where request_id = _request_id and provider_id = auth.uid();
    delete from public.request_offers
    where request_id = _request_id and provider_id = auth.uid();
    select coalesce(sum(team_size), 0)::integer into v_people
    from public.service_request_providers where request_id = _request_id;
    select provider_id into v_lead
    from public.service_request_providers
    where request_id = _request_id
    order by accepted_at, provider_id limit 1;

    perform set_config('mamnoon.allow_provider_request_transition', 'true', true);
    update public.service_requests
    set provider_id = v_lead,
        status = case when v_people >= greatest(workers_count, 1)
                      then 'accepted'::public.request_status
                      else 'searching'::public.request_status end,
        accepted_at = case when v_people >= greatest(workers_count, 1)
                           then accepted_at else null end,
        cancelled_by = auth.uid(),
        cancellation_reason = v_reason
    where id = _request_id;
    perform set_config('mamnoon.allow_provider_request_transition', 'false', true);

    if v_lead is not null then
      update public.chats set provider_id = v_lead, updated_at = now()
      where request_id = _request_id;
    end if;
    insert into public.notifications(user_id, type, title, body, link, data)
    values (r.customer_id, 'provider_released', 'تغيّر عدد أفراد الفريق',
      case when v_people >= greatest(r.workers_count, 1)
        then 'اعتذر أحد الفنيين، لكن العدد المطلوب ما زال متوفراً.'
        else 'اعتذر أحد أفراد الفريق. نواصل البحث عن العدد المتبقي.' end,
      '/request/' || _request_id,
      jsonb_build_object('request_id', _request_id, 'accepted_people_count', v_people,
        'workers_count', r.workers_count,
        'remaining_people_count', greatest(r.workers_count - v_people, 0)));
    if v_people < greatest(r.workers_count, 1) then
      insert into public.service_dispatch_queue(request_id, stage, next_at)
      values (_request_id, 0, now())
      on conflict (request_id) do update set next_at = now();
      perform public.dispatch_service_request(_request_id);
    end if;
    return 'released';
  end if;

  if r.provider_id = auth.uid() and r.type::text = 'taxi' then
    perform set_config('mamnoon.allow_provider_request_transition', 'true', true);
    update public.service_requests
    set status = 'searching', provider_id = null, accepted_at = null,
        cancelled_by = auth.uid(), cancellation_reason = v_reason
    where id = _request_id;
    perform set_config('mamnoon.allow_provider_request_transition', 'false', true);
    delete from public.request_offers where request_id = _request_id and provider_id = auth.uid();
    insert into public.notifications(user_id, type, title, body, link)
    values (r.customer_id, 'provider_released', 'نبحث عن مقدّم خدمة آخر',
      left(v_reason, 200), '/request/' || _request_id);
    return 'released';
  end if;

  raise exception 'forbidden';
end;
$function$;

create or replace function public.admin_cancellation_analytics()
returns table (
  cancellation_reason text,
  cancelled_by_role text,
  cancellation_count bigint,
  percentage numeric
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_total bigint;
begin
  if auth.uid() is null or not public.has_provider_ops_access(auth.uid()) then
    raise exception 'forbidden';
  end if;

  select count(*) into v_total
  from public.service_requests
  where cancellation_reason is not null
    and (cancelled_by is not null or cancellation_reason = 'dispatch_no_provider');

  return query
  select
    case when sr.cancellation_reason = 'dispatch_no_provider' then 'لم يتوفر مقدم خدمة'
      else coalesce(sr.cancellation_reason, 'بدون سبب') end as cancellation_reason,
    case
      when sr.cancelled_by is null then 'system'
      when sr.cancelled_by = sr.customer_id then 'customer'
      else 'provider'
    end as cancelled_by_role,
    count(*) as cancellation_count,
    case when v_total = 0 then 0::numeric
      else round(count(*)::numeric * 100 / v_total, 2) end as percentage
  from public.service_requests sr
  where sr.cancellation_reason is not null
    and (sr.cancelled_by is not null or sr.cancellation_reason = 'dispatch_no_provider')
  group by 1, 2
  order by count(*) desc, 1;
end;
$function$;

revoke all on function public.admin_cancellation_analytics() from public, anon;
grant execute on function public.admin_cancellation_analytics() to authenticated;
