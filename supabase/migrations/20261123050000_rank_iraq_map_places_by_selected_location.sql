-- Rank local Iraq OSM place suggestions around the selected map location.
-- Match multi-word Arabic searches by requiring every token, not only the full phrase.
-- Keep the original RPC for backward compatibility; maps-proxy uses this variant.
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
  ),
  candidates as (
    select s.*, qd.q, qd.tokens,
      lower(coalesce(s.name_ar, '') || ' ' || coalesce(s.address, '') || ' ' || coalesce(s.search_terms, '')) as haystack
    from public.map_place_suggestions s
    cross join query_data qd
    where s.governorate_key = p_governorate_key
      and s.is_active = true
      and length(qd.q) >= 2
  )
  select c.id, c.name_ar, c.address, c.latitude, c.longitude
  from candidates c
  where c.haystack like '%' || c.q || '%'
     or (
       cardinality(c.tokens) > 1
       and not exists (
         select 1
         from unnest(c.tokens) as token(value)
         where token.value <> ''
           and c.haystack not like '%' || token.value || '%'
       )
     )
  order by
    case
      when lower(c.name_ar) = c.q then 0
      when lower(c.name_ar) like c.q || '%' then 1
      when lower(c.name_ar) like '%' || c.q || '%' then 2
      when c.haystack like c.q || '%' then 3
      else 4
    end,
    case
      when p_center_lat is not null and p_center_lng is not null then
        power((c.latitude - p_center_lat) * cos(radians(p_center_lat)), 2)
        + power(c.longitude - p_center_lng, 2)
      else 0
    end,
    length(c.name_ar),
    c.name_ar asc
  limit greatest(1, least(coalesce(p_limit, 50), 50));
$function$;

revoke all on function public.search_map_place_suggestions_ranked(text, text, integer, double precision, double precision)
  from public, anon, authenticated;
grant execute on function public.search_map_place_suggestions_ranked(text, text, integer, double precision, double precision)
  to service_role;
