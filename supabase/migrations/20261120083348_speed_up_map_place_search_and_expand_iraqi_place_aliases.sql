create extension if not exists pg_trgm with schema extensions;

create index if not exists map_place_suggestions_search_trgm_idx
on public.map_place_suggestions
using gin (lower(name_ar || ' ' || coalesce(address, '') || ' ' || coalesce(search_terms, '')) extensions.gin_trgm_ops);

create or replace function public.search_map_place_suggestions(
  p_governorate_key text,
  p_query text,
  p_limit integer default 50
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
      lower(s.name_ar || ' ' || coalesce(s.address, '') || ' ' || coalesce(s.search_terms, '')) like '%' || qd.q || '%'
      or (
        qd.q in ('جامع','جوامع','مسجد','مساجد','المسجد','المساجد')
        and lower(s.name_ar || ' ' || coalesce(s.address, '') || ' ' || coalesce(s.search_terms, '')) like any (array['%جامع%','%مسجد%','%mosque%'])
      )
      or (
        qd.q in ('مرقد','مراقد','مقام','مقامات','ضريح','اضرحة')
        and lower(s.name_ar || ' ' || coalesce(s.address, '') || ' ' || coalesce(s.search_terms, '')) like any (array['%مرقد%','%مقام%','%ضريح%','%shrine%'])
      )
      or (
        qd.q in ('سوق','اسواق','الاسواق','مول','مولات','بازار','بازارات')
        and lower(s.name_ar || ' ' || coalesce(s.address, '') || ' ' || coalesce(s.search_terms, '')) like any (array['%سوق%','%مول%','%بازار%','%market%','%mall%'])
      )
      or (
        cardinality(qd.tokens) > 0
        and not exists (
          select 1
          from unnest(qd.tokens) as token(value)
          where token.value <> ''
            and lower(s.name_ar || ' ' || coalesce(s.address, '') || ' ' || coalesce(s.search_terms, '')) not like '%' || token.value || '%'
        )
      )
    )
  order by
    case when lower(s.name_ar) = qd.q then 0
         when left(lower(s.name_ar), length(qd.q)) = qd.q then 1
         when left(lower(s.address), length(qd.q)) = qd.q then 2
         when lower(s.name_ar) like '%' || qd.q || '%' then 3
         else 4 end,
    length(s.name_ar),
    s.name_ar asc
  limit greatest(1, least(coalesce(p_limit, 50), 50));
$$;

revoke all on function public.search_map_place_suggestions(text, text, integer) from public, anon, authenticated;
grant execute on function public.search_map_place_suggestions(text, text, integer) to service_role;