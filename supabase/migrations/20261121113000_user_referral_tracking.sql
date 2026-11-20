-- Per-user referral codes and attribution for successful account creation.
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;
create table if not exists public.user_referrals (
  user_id uuid primary key references auth.users(id) on delete cascade,
  referral_code text not null unique,
  referred_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint user_referrals_not_self check (referred_by is null or referred_by <> user_id)
);

create index if not exists user_referrals_referred_by_idx
  on public.user_referrals (referred_by) where referred_by is not null;

alter table public.user_referrals enable row level security;
drop policy if exists "Users can read their own referral summary" on public.user_referrals;
create policy "Users can read their own referral summary"
  on public.user_referrals for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.user_referrals from anon, authenticated;
grant select on public.user_referrals to authenticated;

create or replace function app_private.create_user_referral_profile()
returns trigger
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  v_code text;
  v_referrer uuid;
  v_input text;
begin
  v_input := nullif(upper(trim(coalesce(new.raw_user_meta_data->>'referral_code', ''))), '');
  if v_input is not null then
    select user_id into v_referrer
      from public.user_referrals
      where referral_code = v_input;
    if v_referrer = new.id then v_referrer := null; end if;
  end if;

  loop
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    exit when not exists (select 1 from public.user_referrals where referral_code = v_code);
  end loop;

  insert into public.user_referrals(user_id, referral_code, referred_by)
  values (new.id, v_code, v_referrer)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function app_private.create_user_referral_profile() from public, anon, authenticated;
drop trigger if exists create_user_referral_profile on auth.users;
create trigger create_user_referral_profile
after insert on auth.users
for each row execute function app_private.create_user_referral_profile();

create or replace function public.get_my_referral_summary()
returns table(referral_code text, successful_signups bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select mine.referral_code,
         (select count(*) from public.user_referrals invited where invited.referred_by = mine.user_id)
  from public.user_referrals mine
  where mine.user_id = (select auth.uid());
$$;

revoke all on function public.get_my_referral_summary() from public, anon;
grant execute on function public.get_my_referral_summary() to authenticated;

-- Backfill existing accounts with unique codes without attributing historical signups.
do $$
declare r record; v_code text;
begin
  for r in select u.id from auth.users u
           left join public.user_referrals p on p.user_id = u.id
           where p.user_id is null
  loop
    loop
      v_code := upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 10));
      exit when not exists (select 1 from public.user_referrals where referral_code = v_code);
    end loop;
    insert into public.user_referrals(user_id, referral_code)
    values (r.id, v_code) on conflict (user_id) do nothing;
  end loop;
end $$;
