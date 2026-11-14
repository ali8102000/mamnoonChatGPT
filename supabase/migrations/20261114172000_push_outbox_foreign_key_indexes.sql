create index if not exists idx_push_delivery_outbox_request_id
  on public.push_delivery_outbox (request_id);
create index if not exists idx_push_delivery_outbox_provider_id
  on public.push_delivery_outbox (provider_id);
