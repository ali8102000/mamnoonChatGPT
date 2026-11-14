alter table public.subscription_settings
  add column if not exists payment_gateway_enabled boolean not null default false;
update public.subscription_settings
set payment_gateway_enabled=false,updated_at=now()
where id=1;