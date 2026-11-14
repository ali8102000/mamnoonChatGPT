create or replace function public.close_terminal_request_dispatch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('completed', 'cancelled')
     and old.status is distinct from new.status then
    delete from public.service_dispatch_queue
    where request_id = new.id;

    delete from public.taxi_dispatch_queue
    where request_id = new.id;

    update public.request_offers
       set status = 'cancelled',
           responded_at = coalesce(responded_at, now())
     where request_id = new.id
       and status = 'pending';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_close_terminal_request_dispatch on public.service_requests;
create trigger trg_close_terminal_request_dispatch
after update of status on public.service_requests
for each row
execute function public.close_terminal_request_dispatch();
