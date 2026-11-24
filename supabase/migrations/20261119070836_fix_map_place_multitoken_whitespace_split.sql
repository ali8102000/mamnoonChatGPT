-- Ensure multi-word place queries split into individual whitespace-delimited tokens.
-- The initial expansion migration used an over-escaped regex; this corrects token matching.
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
      position(qd.q in lower(concat_ws(' ', s.name_ar, s.address, s.search_terms))) > 0
      or (
        cardinality(qd.tokens) > 0
        and not exists (
          select 1
          from unnest(qd.tokens) as token(value)
          where token.value <> ''
            and position(token.value in lower(concat_ws(' ', s.name_ar, s.address, s.search_terms))) = 0
        )
      )
    )
  order by
    case when lower(s.name_ar) = qd.q then 0
         when left(lower(s.name_ar), length(qd.q)) = qd.q then 1
         when left(lower(s.address), length(qd.q)) = qd.q then 2
         when position(qd.q in lower(s.name_ar)) > 0 then 3
         else 4 end,
    length(s.name_ar),
    s.name_ar asc
  limit greatest(1, least(coalesce(p_limit, 50), 50));
$$;

revoke all on function public.search_map_place_suggestions(text, text, integer) from public, anon, authenticated;
grant execute on function public.search_map_place_suggestions(text, text, integer) to service_role;
