alter table public.app_campaigns
  add column if not exists sort_order integer not null default 0;

create index if not exists app_campaigns_placement_sort_idx
  on public.app_campaigns (status, placement_key, sort_order, created_at desc);
