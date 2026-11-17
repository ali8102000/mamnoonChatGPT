-- Cache governorate-scoped map suggestions in Mamnoon Supabase.
create table if not exists public.map_place_suggestions (
  id uuid primary key default gen_random_uuid(),
  governorate_key text not null,
  source text not null default 'photon',
  source_key text not null,
  name_ar text not null,
  address text not null default '',
  search_terms text not null default '',
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (governorate_key, source_key)
);
create index if not exists map_place_suggestions_governorate_idx
  on public.map_place_suggestions (governorate_key, is_active);
create index if not exists map_place_suggestions_name_idx
  on public.map_place_suggestions (governorate_key, lower(name_ar));
create table if not exists public.map_place_search_cache (
  governorate_key text not null,
  normalized_query text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (governorate_key, normalized_query)
);
alter table public.map_place_suggestions enable row level security;
alter table public.map_place_search_cache enable row level security;
revoke all on public.map_place_suggestions from anon, authenticated;
revoke all on public.map_place_search_cache from anon, authenticated;
grant select, insert, update, delete on public.map_place_suggestions to service_role;
grant select, insert, update, delete on public.map_place_search_cache to service_role;
create or replace function public.search_map_place_suggestions(
  p_governorate_key text,
  p_query text,
  p_limit integer default 20
)
returns table (
  id uuid,
  name_ar text,
  address text,
  latitude double precision,
  longitude double precision
)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.name_ar, s.address, s.latitude, s.longitude
  from public.map_place_suggestions s
  where s.governorate_key = p_governorate_key
    and s.is_active = true
    and length(trim(coalesce(p_query, ''))) >= 2
    and (
      position(lower(trim(p_query)) in lower(s.name_ar)) > 0
      or position(lower(trim(p_query)) in lower(s.address)) > 0
      or position(lower(trim(p_query)) in lower(s.search_terms)) > 0
    )
  order by
    case when lower(s.name_ar) like lower(trim(p_query)) || '%' then 0 else 1 end,
    case when lower(s.address) like lower(trim(p_query)) || '%' then 0 else 1 end,
    s.name_ar asc
  limit greatest(1, least(coalesce(p_limit, 20), 30));
$$;
revoke all on function public.search_map_place_suggestions(text, text, integer) from public, anon, authenticated;
grant execute on function public.search_map_place_suggestions(text, text, integer) to service_role;
