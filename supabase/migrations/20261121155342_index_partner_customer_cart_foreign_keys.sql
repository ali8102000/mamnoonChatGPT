-- Cover the two cart foreign keys identified by the Supabase performance advisor.
create index if not exists idx_partner_customer_cart_business
  on public.partner_customer_cart_items (business_profile_id);
create index if not exists idx_partner_customer_cart_catalog_item
  on public.partner_customer_cart_items (catalog_item_id);
