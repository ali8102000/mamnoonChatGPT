-- Category-wide supply/demand monitor. This computes a bounded recommendation only;
-- it intentionally does NOT mutate customer fares until the request-price integration
-- can persist and display a transparent, immutable quote.
alter table public.category_peak_pricing_settings
  add column if not exists auto_calculated_percent numeric not null default 0
    check (auto_calculated_percent between 0 and 100),
  add column if not exists active_providers integer not null default 0,
  add column if not exists observed_providers integer not null default 0,
  add column if not exists pending_requests integer not null default 0,
  add column if not exists demand_per_provider numeric not null default 0,
  add column if not exists last_reason text,
  add column if not exists last_calculated_at timestamptz;

create or replace function public.refresh_category_peak_pricing_monitor()
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $body$
declare
  v record;
  v_observed integer;
  v_active integer;
  v_pending integer;
  v_ratio numeric;
  v_percent numeric;
  v_span numeric;
  v_reason text;
begin
  for v in
    select s.category_key,s.service_id,s.min_surcharge_percent,s.max_surcharge_percent,
           s.mode,s.enabled
    from public.category_peak_pricing_settings s
    where s.category_key like 'service:%'
  loop
    select count(distinct wp.user_id)::integer
      into v_observed
    from public.worker_profiles wp
    join public.worker_services ws on ws.worker_id=wp.user_id and ws.service_id=v.service_id
    join public.provider_presence pp on pp.user_id=wp.user_id
    where wp.status='approved'
      and public.has_role(wp.user_id,'worker'::public.app_role)
      and (wp.suspended_until is null or wp.suspended_until<=now())
      and pp.updated_at>now()-interval '5 minutes'
      and pp.accuracy_m is not null and pp.accuracy_m<=100;

    select count(distinct wp.user_id)::integer
      into v_active
    from public.worker_profiles wp
    join public.worker_services ws on ws.worker_id=wp.user_id and ws.service_id=v.service_id
    join public.provider_presence pp on pp.user_id=wp.user_id
    where wp.status='approved' and wp.available=true
      and public.has_role(wp.user_id,'worker'::public.app_role)
      and (wp.suspended_until is null or wp.suspended_until<=now())
      and pp.updated_at>now()-interval '5 minutes'
      and pp.accuracy_m is not null and pp.accuracy_m<=100
      and not exists (
        select 1 from public.service_requests active
        where active.provider_id=wp.user_id and lower(active.status::text) in ('accepted','in_progress')
      )
      and not exists (
        select 1 from public.service_request_providers srp
        join public.service_requests active_team on active_team.id=srp.request_id
        where srp.provider_id=wp.user_id
          and lower(active_team.status::text) in ('pending','searching','accepted','in_progress')
      );

    select count(*)::integer into v_pending
    from public.service_requests sr
    where sr.type::text='service' and sr.service_id=v.service_id
      and lower(sr.status::text) in ('pending','searching')
      and sr.created_at>now()-interval '20 minutes';

    v_ratio := coalesce(v_pending,0)::numeric / greatest(coalesce(v_active,0),1);
    v_span := greatest(0,v.max_surcharge_percent-v.min_surcharge_percent);
    v_percent := 0;
    v_reason := 'الطلب ضمن الطاقة المتاحة؛ لا توجد زيادة حالياً';

    if not coalesce(v.enabled,false) or v.mode<>'auto' then
      v_reason := 'الفئة غير مفعّلة على الوضع التلقائي من الإدارة';
    elsif coalesce(v_observed,0)=0 then
      v_reason := 'بيانات GPS غير متوفرة أو قديمة؛ أُوقفت الزيادة للحماية';
    elsif coalesce(v_pending,0)=0 then
      v_reason := 'لا توجد طلبات معلّقة؛ السعر الأساسي مستمر';
    elsif v_ratio < 0.5 then
      v_reason := 'عدد مقدمي الخدمة كافٍ مقارنة بالطلبات';
    elsif v_ratio < 1 then
      v_percent := v.min_surcharge_percent;
      v_reason := 'ضغط طلب محدود؛ تطبيق الحد الأدنى المسموح';
    elsif v_ratio < 2 then
      v_percent := v.min_surcharge_percent + (v_span * (v_ratio-1));
      v_reason := 'الطلب أعلى من التوفر؛ زيادة متدرجة حسب الضغط';
    else
      v_percent := v.max_surcharge_percent;
      v_reason := 'ضغط طلب مرتفع؛ الوصول إلى الحد الأعلى المسموح';
    end if;

    update public.category_peak_pricing_settings
    set auto_calculated_percent=round(greatest(0,least(max_surcharge_percent,v_percent)),2),
        active_providers=coalesce(v_active,0),
        observed_providers=coalesce(v_observed,0),
        pending_requests=coalesce(v_pending,0),
        demand_per_provider=round(v_ratio,3),
        last_reason=v_reason,
        last_calculated_at=now()
    where category_key=v.category_key;
  end loop;

  -- Taxi demand is monitored separately for each supported vehicle class.
  for v in
    select category_key,min_surcharge_percent,max_surcharge_percent,mode,enabled
    from public.category_peak_pricing_settings
    where category_key in ('taxi:economy','taxi:premium','taxi:luxury','taxi:large')
  loop
    select count(distinct dp.user_id)::integer into v_observed
    from public.driver_profiles dp
    join public.provider_presence pp on pp.user_id=dp.user_id
    where dp.vehicle_category::text=split_part(v.category_key,':',2)
      and dp.status='approved'
      and public.has_role(dp.user_id,
        case when split_part(v.category_key,':',2)='large' then 'large_driver'::public.app_role
             else 'driver'::public.app_role end)
      and (dp.suspended_until is null or dp.suspended_until<=now())
      and pp.updated_at>now()-interval '5 minutes'
      and pp.accuracy_m is not null and pp.accuracy_m<=100;

    select count(distinct dp.user_id)::integer into v_active
    from public.driver_profiles dp
    join public.provider_presence pp on pp.user_id=dp.user_id
    where dp.vehicle_category::text=split_part(v.category_key,':',2)
      and dp.status='approved'
      and public.has_role(dp.user_id,
        case when split_part(v.category_key,':',2)='large' then 'large_driver'::public.app_role
             else 'driver'::public.app_role end) and dp.available=true
      and (dp.suspended_until is null or dp.suspended_until<=now())
      and pp.updated_at>now()-interval '5 minutes'
      and pp.accuracy_m is not null and pp.accuracy_m<=100
      and not exists (
        select 1 from public.service_requests active
        where active.provider_id=dp.user_id and lower(active.status::text) in ('accepted','in_progress')
      );

    select count(*)::integer into v_pending
    from public.service_requests sr
    where sr.type::text='taxi'
      and sr.vehicle_category::text=split_part(v.category_key,':',2)
      and lower(sr.status::text) in ('pending','searching')
      and sr.created_at>now()-interval '20 minutes';

    v_ratio := coalesce(v_pending,0)::numeric / greatest(coalesce(v_active,0),1);
    v_span := greatest(0,v.max_surcharge_percent-v.min_surcharge_percent);
    v_percent := 0;
    v_reason := 'الطلب ضمن الطاقة المتاحة؛ لا توجد زيادة حالياً';
    if not coalesce(v.enabled,false) or v.mode<>'auto' then
      v_reason := 'الفئة غير مفعّلة على الوضع التلقائي من الإدارة';
    elsif coalesce(v_observed,0)=0 then
      v_reason := 'بيانات GPS غير متوفرة أو قديمة؛ أُوقفت الزيادة للحماية';
    elsif coalesce(v_pending,0)=0 or v_ratio<0.5 then
      v_reason := 'عدد السائقين المتاحين كافٍ مقارنة بالطلبات';
    elsif v_ratio<1 then
      v_percent := v.min_surcharge_percent;
      v_reason := 'ضغط طلب محدود؛ تطبيق الحد الأدنى المسموح';
    elsif v_ratio<2 then
      v_percent := v.min_surcharge_percent+(v_span*(v_ratio-1));
      v_reason := 'الطلب أعلى من التوفر؛ زيادة متدرجة حسب الضغط';
    else
      v_percent := v.max_surcharge_percent;
      v_reason := 'ضغط طلب مرتفع؛ الوصول إلى الحد الأعلى المسموح';
    end if;
    update public.category_peak_pricing_settings
    set auto_calculated_percent=round(greatest(0,least(max_surcharge_percent,v_percent)),2),
        active_providers=coalesce(v_active,0),
        observed_providers=coalesce(v_observed,0),
        pending_requests=coalesce(v_pending,0),
        demand_per_provider=round(v_ratio,3),
        last_reason=v_reason,last_calculated_at=now()
    where category_key=v.category_key;
  end loop;
end;
$body$;

revoke all on function public.refresh_category_peak_pricing_monitor() from public,anon,authenticated;
grant execute on function public.refresh_category_peak_pricing_monitor() to service_role;

select cron.schedule('mamnoon-category-peak-monitor','* * * * *',
  'select public.refresh_category_peak_pricing_monitor()')
where not exists (select 1 from cron.job where jobname='mamnoon-category-peak-monitor');
