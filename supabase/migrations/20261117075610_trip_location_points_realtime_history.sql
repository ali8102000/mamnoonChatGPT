create table if not exists public.trip_location_points (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.service_requests(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('customer', 'provider')),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  heading double precision null check (heading is null or heading between 0 and 360),
  accuracy_m double precision null check (accuracy_m is null or accuracy_m between 0 and 1000),
  recorded_at timestamptz not null default now()
);

create index if not exists trip_location_points_request_time_idx
  on public.trip_location_points (request_id, recorded_at, id);

create index if not exists trip_location_points_user_time_idx
  on public.trip_location_points (user_id, recorded_at desc);

alter table public.trip_location_points enable row level security;

revoke all on table public.trip_location_points from anon, authenticated;
grant select, insert on table public.trip_location_points to authenticated;

drop policy if exists "Trip parties read active route points" on public.trip_location_points;
create policy "Trip parties read active route points"
  on public.trip_location_points
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.service_requests r
      where r.id = trip_location_points.request_id
        and r.status in ('accepted', 'in_progress')
        and (select auth.uid()) in (r.customer_id, r.provider_id)
        and trip_location_points.user_id in (r.customer_id, r.provider_id)
    )
  );

drop policy if exists "Provider records own active route points" on public.trip_location_points;
create policy "Provider records own active route points"
  on public.trip_location_points
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_request_party(request_id, (select auth.uid()))
    and exists (
      select 1
      from public.service_requests r
      where r.id = trip_location_points.request_id
        and r.status in ('accepted', 'in_progress')
        and (
          (r.customer_id = (select auth.uid()) and role = 'customer')
          or
          (r.provider_id = (select auth.uid()) and role = 'provider')
        )
    )
  );

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'trip_location_points'
  ) then
    alter publication supabase_realtime add table public.trip_location_points;
  end if;
end
$$;
