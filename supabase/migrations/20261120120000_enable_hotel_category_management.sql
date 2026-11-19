-- Permit admin-managed category groups for hotels as well as stores, restaurants and groceries.
begin;
alter table public.partner_catalog_categories drop constraint if exists partner_catalog_categories_vertical_check;
alter table public.partner_catalog_categories add constraint partner_catalog_categories_vertical_check check (vertical in ('store','restaurant','grocery','hotel'));
commit;
