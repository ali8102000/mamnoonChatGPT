-- Customer-owned reusable destination shortcuts for taxi requests.
create table if not exists public.customer_favorite_places (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 60),
  address text not null default '',
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  governorate_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customer_favorite_places_user_created_idx
  on public.customer_favorite_places (user_id, created_at desc);
create unique index if not exists customer_favorite_places_user_label_uidx
  on public.customer_favorite_places (user_id, lower(btrim(label)));

alter table public.customer_favorite_places enable row level security;
revoke all on public.customer_favorite_places from anon, public;
grant select, insert, update, delete on public.customer_favorite_places to authenticated;

drop policy if exists "Customers read own favorite places" on public.customer_favorite_places;
create policy "Customers read own favorite places"
  on public.customer_favorite_places for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Customers add own favorite places" on public.customer_favorite_places;
create policy "Customers add own favorite places"
  on public.customer_favorite_places for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.user_roles
      where user_id = (select auth.uid()) and role = 'customer'::public.app_role
    )
  );

drop policy if exists "Customers update own favorite places" on public.customer_favorite_places;
create policy "Customers update own favorite places"
  on public.customer_favorite_places for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.user_roles
      where user_id = (select auth.uid()) and role = 'customer'::public.app_role
    )
  );

drop policy if exists "Customers delete own favorite places" on public.customer_favorite_places;
create policy "Customers delete own favorite places"
  on public.customer_favorite_places for delete to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.set_customer_favorite_place_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_customer_favorite_place_updated_at on public.customer_favorite_places;
create trigger set_customer_favorite_place_updated_at
before update on public.customer_favorite_places
for each row execute function public.set_customer_favorite_place_updated_at();
