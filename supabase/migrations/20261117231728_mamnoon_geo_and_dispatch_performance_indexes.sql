create extension if not exists postgis with schema extensions;

alter table public.provider_presence
  add column if not exists location extensions.geography(Point, 4326)
  generated always as (
    extensions.ST_SetSRID(extensions.ST_MakePoint(lng, lat), 4326)::extensions.geography
  ) stored;

alter table public.service_requests
  add column if not exists pickup_location extensions.geography(Point, 4326)
  generated always as (
    case
      when pickup_lat is not null and pickup_lng is not null
      then extensions.ST_SetSRID(
        extensions.ST_MakePoint(pickup_lng::double precision, pickup_lat::double precision),
        4326
      )::extensions.geography
      else null
    end
  ) stored;

alter table public.service_requests
  add column if not exists destination_location extensions.geography(Point, 4326)
  generated always as (
    case
      when dest_lat is not null and dest_lng is not null
      then extensions.ST_SetSRID(
        extensions.ST_MakePoint(dest_lng::double precision, dest_lat::double precision),
        4326
      )::extensions.geography
      else null
    end
  ) stored;

create index if not exists idx_provider_presence_location_gist
  on public.provider_presence using gist (location);

create index if not exists idx_service_requests_pickup_location_gist
  on public.service_requests using gist (pickup_location)
  where pickup_location is not null;

create index if not exists idx_service_requests_destination_location_gist
  on public.service_requests using gist (destination_location)
  where destination_location is not null;

create index if not exists idx_service_requests_dispatch_feed
  on public.service_requests (type, status, created_at desc);

create index if not exists idx_service_requests_customer_status_created
  on public.service_requests (customer_id, status, created_at desc);
