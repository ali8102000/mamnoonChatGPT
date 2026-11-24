-- Per-category automatic peak bounds for every service and taxi vehicle class.
-- Deliberately OFF until the category-aware monitor and fare integrations are verified.
create table if not exists public.category_peak_pricing_settings (
  category_key text primary key,
  service_id uuid references public.services(id) on delete cascade,
  category_label_ar text not null,
  min_surcharge_percent numeric not null default 0 check (min_surcharge_percent between 0 and 100),
  max_surcharge_percent numeric not null default 0 check (max_surcharge_percent between 0 and 100),
  mode text not null default 'off' check (mode in ('auto','notify','off')),
  enabled boolean not null default false,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  constraint category_peak_bounds_valid check (min_surcharge_percent <= max_surcharge_percent),
  constraint category_peak_mode_enabled_valid check (mode <> 'off' or enabled = false)
);
create index if not exists category_peak_pricing_settings_service_idx
  on public.category_peak_pricing_settings(service_id);

-- Seed every currently configured service category, plus all taxi vehicle classes.
insert into public.category_peak_pricing_settings(category_key,service_id,category_label_ar)
select 'service:' || s.slug,s.id,s.name_ar from public.services s
on conflict(category_key) do update set service_id=excluded.service_id,category_label_ar=excluded.category_label_ar;

insert into public.category_peak_pricing_settings(category_key,category_label_ar)
values
 ('taxi:economy','تكسي اقتصادي'),
 ('taxi:premium','تكسي متميز'),
 ('taxi:luxury','تكسي فاخر'),
 ('taxi:large','مركبة كبيرة')
on conflict(category_key) do update set category_label_ar=excluded.category_label_ar;

alter table public.category_peak_pricing_settings enable row level security;
drop policy if exists "admins read category peak pricing settings" on public.category_peak_pricing_settings;
create policy "admins read category peak pricing settings"
on public.category_peak_pricing_settings for select to authenticated
using (public.admin_has_permission('pricing.peak.edit','global',null));

create or replace function public.admin_save_category_peak_pricing_settings(
  p_category_key text,
  p_min_surcharge_percent numeric,
  p_max_surcharge_percent numeric,
  p_mode text,
  p_enabled boolean
) returns public.category_peak_pricing_settings
language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_row public.category_peak_pricing_settings%rowtype; v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'unauthorized'; end if;
  if not public.admin_has_permission('pricing.peak.edit','global',null) then
    raise exception 'missing_pricing_permission';
  end if;
  if p_category_key is null or length(p_category_key) > 160 then raise exception 'invalid_category'; end if;
  if p_min_surcharge_percent is null or p_max_surcharge_percent is null
    or p_min_surcharge_percent < 0 or p_max_surcharge_percent > 100
    or p_min_surcharge_percent > p_max_surcharge_percent then raise exception 'invalid_surcharge_bounds'; end if;
  if p_mode not in ('auto','notify','off') then raise exception 'invalid_mode'; end if;
  -- This release records category supply/demand only; no notification or fare-decision engine is active.
  if p_mode<>'off' or p_enabled then raise exception 'category_peak_decision_engine_not_enabled'; end if;
  if left(p_category_key,8)='service:' and p_enabled then raise exception 'service_peak_quote_not_ready'; end if;
  update public.category_peak_pricing_settings
    set min_surcharge_percent=p_min_surcharge_percent,
        max_surcharge_percent=p_max_surcharge_percent,
        mode=p_mode,enabled=p_enabled,updated_by=v_actor,updated_at=now()
    where category_key=p_category_key
    returning * into v_row;
  if not found then raise exception 'unknown_category'; end if;
  insert into public.audit_logs(user_id,action,target_type,target_id,details)
  values(v_actor,'pricing.peak.category.settings.updated','category_peak_pricing_settings',
    p_category_key,to_jsonb(v_row));
  return v_row;
end $$;

revoke all on function public.admin_save_category_peak_pricing_settings(text,numeric,numeric,text,boolean) from public,anon;
grant execute on function public.admin_save_category_peak_pricing_settings(text,numeric,numeric,text,boolean) to authenticated;
grant select on public.category_peak_pricing_settings to authenticated;
