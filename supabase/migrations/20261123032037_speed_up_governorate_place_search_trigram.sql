-- Speed up substring autocomplete for governorate-scoped map places.
-- pg_trgm is already installed in the Supabase extensions schema.
create index if not exists map_place_suggestions_name_trgm_idx
  on public.map_place_suggestions using gin (lower(name_ar) extensions.gin_trgm_ops);
create index if not exists map_place_suggestions_address_trgm_idx
  on public.map_place_suggestions using gin (lower(address) extensions.gin_trgm_ops);
create index if not exists map_place_suggestions_terms_trgm_idx
  on public.map_place_suggestions using gin (lower(search_terms) extensions.gin_trgm_ops);

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
set search_path = public, extensions
as $$
  select s.id, s.name_ar, s.address, s.latitude, s.longitude
  from public.map_place_suggestions s
  where s.governorate_key = p_governorate_key
    and s.is_active = true
    and length(trim(coalesce(p_query, ''))) >= 2
    and (
      lower(s.name_ar) like '%' || lower(trim(p_query)) || '%'
      or lower(s.address) like '%' || lower(trim(p_query)) || '%'
      or lower(s.search_terms) like '%' || lower(trim(p_query)) || '%'
    )
  order by
    case when lower(s.name_ar) like lower(trim(p_query)) || '%' then 0 else 1 end,
    case when lower(s.address) like lower(trim(p_query)) || '%' then 0 else 1 end,
    s.name_ar asc
  limit greatest(1, least(coalesce(p_limit, 20), 30));
$$;

revoke all on function public.search_map_place_suggestions(text, text, integer) from public, anon, authenticated;
grant execute on function public.search_map_place_suggestions(text, text, integer) to service_role;
