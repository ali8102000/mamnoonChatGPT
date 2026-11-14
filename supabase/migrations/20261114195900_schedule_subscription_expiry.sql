-- Run subscription expiry and reminder processing once per day.
do $$
begin
  if not exists (select 1 from cron.job where jobname='mamnoon-expire-subscriptions') then
    perform cron.schedule(
      'mamnoon-expire-subscriptions',
      '10 0 * * *',
      'select public.handle_expired_subscriptions();'
    );
  end if;
end
$$;