create or replace function public.search_map_place_suggestions_ranked(
  p_governorate_key text,
  p_query text,
  p_limit integer default 50,
  p_center_lat double precision default null,
  p_center_lng double precision default null
)
returns table(id uuid, name_ar text, address text, latitude double precision, longitude double precision)
language sql
stable
set search_path to 'public', 'pg_catalog'
as $function$
  with query_data as (
    select
      lower(trim(coalesce(p_query, ''))) as q,
      replace(lower(trim(coalesce(p_query, ''))), 'مرقد الامام', 'ضريح الامام') as q_synonym,
      regexp_split_to_array(lower(trim(coalesce(p_query, ''))), E'\\s+') as tokens
  ),
  candidates as (
    select s.*,
      (
        lower(coalesce(s.name_ar, '')) like '%' || qd.q || '%'
        or lower(coalesce(s.address, '')) like '%' || qd.q || '%'
        or lower(coalesce(s.search_terms, '')) like '%' || qd.q || '%'
        or (qd.q_synonym <> qd.q and (
          lower(coalesce(s.name_ar, '')) like '%' || qd.q_synonym || '%'
          or lower(coalesce(s.address, '')) like '%' || qd.q_synonym || '%'
          or lower(coalesce(s.search_terms, '')) like '%' || qd.q_synonym || '%'
        ))
        or (
          cardinality(qd.tokens) > 1
          and (
            not exists (select 1 from unnest(qd.tokens) t(value)
              where t.value <> '' and lower(coalesce(s.name_ar, '')) not like '%' || t.value || '%')
            or not exists (select 1 from unnest(qd.tokens) t(value)
              where t.value <> '' and lower(coalesce(s.address, '')) not like '%' || t.value || '%')
            or not exists (select 1 from unnest(qd.tokens) t(value)
              where t.value <> '' and lower(coalesce(s.search_terms, '')) not like '%' || t.value || '%')
          )
        )
      ) as matched
    from public.map_place_suggestions s
    cross join query_data qd
    where s.governorate_key = p_governorate_key
      and s.is_active = true
      and length(qd.q) >= 2
  )
  select c.id, c.name_ar, c.address, c.latitude, c.longitude
  from candidates c
  cross join query_data qd
  where c.matched
  order by
    case when c.source = 'openstreetmap' then 0 when c.source = 'photon' then 1 else 2 end,
    case
      when lower(c.name_ar) = qd.q or lower(c.name_ar) = qd.q_synonym then 0
      when lower(c.name_ar) like qd.q || '%' or lower(c.name_ar) like qd.q_synonym || '%' then 1
      when lower(coalesce(c.search_terms, '')) like '%' || qd.q || '%'
        or lower(coalesce(c.search_terms, '')) like '%' || qd.q_synonym || '%' then 2
      else 5
    end,
    case when p_center_lat is not null and p_center_lng is not null then
      power((c.latitude - p_center_lat) * cos(radians(p_center_lat)), 2)
      + power(c.longitude - p_center_lng, 2)
    else 0 end,
    length(c.name_ar), c.name_ar asc
  limit greatest(1, least(coalesce(p_limit, 50), 50));
$function$;
