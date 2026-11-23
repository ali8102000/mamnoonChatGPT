-- Scope trigram search by governorate in the same GIN index.
-- This avoids scanning matches from every Iraqi governorate for each keystroke.
create extension if not exists btree_gin with schema extensions;

create index if not exists map_place_suggestions_gov_terms_trgm_idx
  on public.map_place_suggestions
  using gin (governorate_key extensions.text_ops, lower(search_terms) extensions.gin_trgm_ops)
  where is_active = true;

create index if not exists map_place_suggestions_gov_address_trgm_idx
  on public.map_place_suggestions
  using gin (governorate_key extensions.text_ops, lower(address) extensions.gin_trgm_ops)
  where is_active = true;

-- Ensure every displayed name is also searchable through the unified terms field.
update public.map_place_suggestions
set search_terms = concat_ws(' ', nullif(search_terms, ''), name_ar)
where coalesce(name_ar, '') <> ''
  and position(lower(name_ar) in lower(coalesce(search_terms, ''))) = 0;

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
      lower(s.address) like '%' || lower(trim(p_query)) || '%'
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

-- Remove the three global trigram indexes; the governorate-scoped composite
-- indexes replace them and substantially reduce unrelated-index work.
drop index if exists public.map_place_suggestions_name_trgm_idx;
drop index if exists public.map_place_suggestions_address_trgm_idx;
drop index if exists public.map_place_suggestions_terms_trgm_idx;
