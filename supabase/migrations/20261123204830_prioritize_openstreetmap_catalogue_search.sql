-- Prefer the 235k-place OpenStreetMap catalogue over incremental Photon enrichments.
-- Relevance and distance still rank results within each source tier.
create or replace function public.search_map_place_suggestions_ranked(
  p_governorate_key text,
  p_query text,
  p_limit integer default 50,
  p_center_lat double precision default null,
  p_center_lng double precision default null
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
security invoker
set search_path = public, pg_catalog
as $function$
  with query_data as (
    select
      lower(trim(coalesce(p_query, ''))) as q,
      regexp_split_to_array(lower(trim(coalesce(p_query, ''))), E'\\s+') as tokens
  )
  select s.id, s.name_ar, s.address, s.latitude, s.longitude
  from public.map_place_suggestions s
  cross join query_data qd
  where s.governorate_key = p_governorate_key
    and s.is_active = true
    and length(qd.q) >= 2
    and (
      lower(coalesce(s.name_ar, '')) like '%' || qd.q || '%'
      or lower(coalesce(s.address, '')) like '%' || qd.q || '%'
      or lower(coalesce(s.search_terms, '')) like '%' || qd.q || '%'
      or (
        cardinality(qd.tokens) > 1
        and not exists (
          select 1
          from unnest(qd.tokens) as token(value)
          where token.value <> ''
            and lower(coalesce(s.name_ar, '')) not like '%' || token.value || '%'
            and lower(coalesce(s.address, '')) not like '%' || token.value || '%'
            and lower(coalesce(s.search_terms, '')) not like '%' || token.value || '%'
        )
      )
    )
  order by
    case
      when s.source = 'openstreetmap' then 0
      when s.source = 'photon' then 1
      else 2
    end,
    case
      when lower(s.name_ar) = qd.q then 0
      when lower(s.name_ar) like qd.q || '%' then 1
      when lower(coalesce(s.search_terms, '')) like qd.q || '%' then 2
      when lower(coalesce(s.address, '')) like qd.q || '%' then 3
      when cardinality(qd.tokens) > 1
        and not exists (
          select 1 from unnest(qd.tokens) as token(value)
          where token.value <> '' and lower(coalesce(s.name_ar, '')) not like '%' || token.value || '%'
        ) then 4
      else 5
    end,
    case
      when p_center_lat is not null and p_center_lng is not null then
        power((s.latitude - p_center_lat) * cos(radians(p_center_lat)), 2)
        + power(s.longitude - p_center_lng, 2)
      else 0
    end,
    length(s.name_ar),
    s.name_ar asc
  limit greatest(1, least(coalesce(p_limit, 50), 50));
$function$;

revoke all on function public.search_map_place_suggestions_ranked(text, text, integer, double precision, double precision)
  from public, anon, authenticated;
grant execute on function public.search_map_place_suggestions_ranked(text, text, integer, double precision, double precision)
  to service_role;
