-- Keep poll totals private from response identities and avoid an exposed SECURITY DEFINER RPC.
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

create table if not exists public.app_campaign_option_results (
  campaign_id uuid not null references public.app_campaigns(id) on delete cascade,
  option_id uuid not null references public.app_campaign_options(id) on delete cascade,
  vote_count bigint not null default 0 check (vote_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (campaign_id, option_id)
);

alter table public.app_campaign_option_results enable row level security;
grant select on public.app_campaign_option_results to anon, authenticated;

drop policy if exists "Public campaign totals are readable" on public.app_campaign_option_results;
create policy "Public campaign totals are readable" on public.app_campaign_option_results
  for select to anon, authenticated using (
    exists (
      select 1 from public.app_campaigns c
      where c.id = campaign_id and c.status = 'published'
        and (
          c.result_visibility = 'public'
          or (c.result_visibility = 'after_end' and c.ends_at is not null and c.ends_at <= now())
        )
    )
  );
drop policy if exists "Super admins read all campaign totals" on public.app_campaign_option_results;
create policy "Super admins read all campaign totals" on public.app_campaign_option_results
  for select to authenticated using (public.is_super_admin((select auth.uid())));

create or replace function app_private.maintain_app_campaign_option_results()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if tg_op = 'INSERT' then
    insert into public.app_campaign_option_results (campaign_id, option_id, vote_count)
    values (new.campaign_id, new.option_id, 1)
    on conflict (campaign_id, option_id)
    do update set vote_count = public.app_campaign_option_results.vote_count + 1,
                  updated_at = now();
    return new;
  elsif tg_op = 'DELETE' then
    update public.app_campaign_option_results
      set vote_count = greatest(0, vote_count - 1), updated_at = now()
      where campaign_id = old.campaign_id and option_id = old.option_id;
    return old;
  elsif tg_op = 'UPDATE' then
    if old.campaign_id is distinct from new.campaign_id or old.option_id is distinct from new.option_id then
      update public.app_campaign_option_results
        set vote_count = greatest(0, vote_count - 1), updated_at = now()
        where campaign_id = old.campaign_id and option_id = old.option_id;
      insert into public.app_campaign_option_results (campaign_id, option_id, vote_count)
      values (new.campaign_id, new.option_id, 1)
      on conflict (campaign_id, option_id)
      do update set vote_count = public.app_campaign_option_results.vote_count + 1,
                    updated_at = now();
    end if;
    return new;
  end if;
  return null;
end;
$function$;

revoke all on function app_private.maintain_app_campaign_option_results() from public, anon, authenticated;
drop trigger if exists maintain_app_campaign_option_results on public.app_campaign_responses;
create trigger maintain_app_campaign_option_results
after insert or update or delete on public.app_campaign_responses
for each row execute function app_private.maintain_app_campaign_option_results();

insert into public.app_campaign_option_results (campaign_id, option_id, vote_count)
select r.campaign_id, r.option_id, count(*)::bigint
from public.app_campaign_responses r
group by r.campaign_id, r.option_id
on conflict (campaign_id, option_id)
do update set vote_count = excluded.vote_count, updated_at = now();

drop function if exists public.get_app_campaign_results(uuid);
