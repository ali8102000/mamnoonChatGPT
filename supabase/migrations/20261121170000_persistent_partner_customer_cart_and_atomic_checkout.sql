-- Persistent customer carts and atomic partner checkout for restaurants, stores and malls.
create table if not exists public.partner_customer_cart_items (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  business_profile_id uuid not null references public.partner_business_profiles(id) on delete cascade,
  catalog_item_id uuid not null references public.partner_catalog_items(id) on delete cascade,
  quantity integer not null default 1 check (quantity between 1 and 9999),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partner_customer_cart_items_unique unique (customer_id, catalog_item_id)
);
create index if not exists idx_partner_customer_cart_customer_business
  on public.partner_customer_cart_items(customer_id, business_profile_id, created_at desc);
alter table public.partner_customer_cart_items enable row level security;
grant select, insert, update, delete on public.partner_customer_cart_items to authenticated;

drop policy if exists partner_customer_cart_read_own on public.partner_customer_cart_items;
create policy partner_customer_cart_read_own on public.partner_customer_cart_items
for select to authenticated using (customer_id = (select auth.uid()));

drop policy if exists partner_customer_cart_insert_own on public.partner_customer_cart_items;
create policy partner_customer_cart_insert_own on public.partner_customer_cart_items
for insert to authenticated with check (
  customer_id = (select auth.uid())
  and exists (
    select 1
    from public.partner_business_profiles p
    join public.partner_catalog_items i on i.business_profile_id = p.id
    where p.id = partner_customer_cart_items.business_profile_id
      and i.id = partner_customer_cart_items.catalog_item_id
      and p.is_published = true
      and p.partner_type in ('restaurant','store','mall')
      and i.is_active = true
      and i.item_type = case when p.partner_type = 'restaurant' then 'menu_item' else 'product' end
  )
);

drop policy if exists partner_customer_cart_update_own on public.partner_customer_cart_items;
create policy partner_customer_cart_update_own on public.partner_customer_cart_items
for update to authenticated
using (customer_id = (select auth.uid()))
with check (
  customer_id = (select auth.uid())
  and exists (
    select 1
    from public.partner_business_profiles p
    join public.partner_catalog_items i on i.business_profile_id = p.id
    where p.id = partner_customer_cart_items.business_profile_id
      and i.id = partner_customer_cart_items.catalog_item_id
      and p.is_published = true
      and p.partner_type in ('restaurant','store','mall')
      and i.is_active = true
      and i.item_type = case when p.partner_type = 'restaurant' then 'menu_item' else 'product' end
  )
);

drop policy if exists partner_customer_cart_delete_own on public.partner_customer_cart_items;
create policy partner_customer_cart_delete_own on public.partner_customer_cart_items
for delete to authenticated using (customer_id = (select auth.uid()));

create or replace function public.add_partner_customer_cart_item(
  p_business_profile_id uuid,
  p_catalog_item_id uuid,
  p_quantity integer default 1
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_customer uuid := auth.uid();
  v_partner_type text;
  v_item public.partner_catalog_items%rowtype;
  v_quantity integer;
begin
  if v_customer is null then raise exception 'unauthorized'; end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 9999 then raise exception 'invalid_quantity'; end if;

  select partner_type into v_partner_type
  from public.partner_business_profiles
  where id = p_business_profile_id and is_published = true
    and partner_type in ('restaurant','store','mall');
  if not found then raise exception 'business_unavailable'; end if;

  select * into v_item
  from public.partner_catalog_items
  where id = p_catalog_item_id
    and business_profile_id = p_business_profile_id
    and is_active = true
    and item_type = case when v_partner_type = 'restaurant' then 'menu_item' else 'product' end
  for update;
  if not found then raise exception 'item_unavailable'; end if;
  if v_item.quantity_available is not null and p_quantity > v_item.quantity_available then
    raise exception 'quantity_unavailable';
  end if;

  insert into public.partner_customer_cart_items(customer_id,business_profile_id,catalog_item_id,quantity,updated_at)
  values(v_customer,p_business_profile_id,p_catalog_item_id,p_quantity,now())
  on conflict(customer_id,catalog_item_id) do update
    set quantity = public.partner_customer_cart_items.quantity + excluded.quantity,
        updated_at = now()
    where public.partner_customer_cart_items.business_profile_id = excluded.business_profile_id
      and (v_item.quantity_available is null
        or public.partner_customer_cart_items.quantity + excluded.quantity <= v_item.quantity_available)
  returning quantity into v_quantity;

  if v_quantity is null then raise exception 'quantity_unavailable_or_cart_conflict'; end if;
  return v_quantity;
end;
$function$;
revoke all on function public.add_partner_customer_cart_item(uuid,uuid,integer) from public, anon;
grant execute on function public.add_partner_customer_cart_item(uuid,uuid,integer) to authenticated;

create or replace function public.place_partner_customer_order(
  p_business_profile_id uuid,
  p_delivery_address text default null,
  p_customer_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_customer uuid := auth.uid();
  v_partner public.partner_business_profiles%rowtype;
  v_order_id uuid;
  v_order_type text;
  v_expected_item_type text;
  v_items jsonb := '[]'::jsonb;
  v_total numeric(14,2) := 0;
  v_currency text := null;
  v_cart_count integer := 0;
  v_valid_count integer := 0;
  v_line record;
begin
  if v_customer is null then raise exception 'unauthorized'; end if;
  if p_business_profile_id is null then raise exception 'business_required'; end if;
  if nullif(trim(coalesce(p_delivery_address,'')), '') is null then raise exception 'delivery_address_required'; end if;
  if length(trim(coalesce(p_delivery_address,''))) > 500 then raise exception 'delivery_address_too_long'; end if;
  if length(trim(coalesce(p_customer_note,''))) > 1000 then raise exception 'customer_note_too_long'; end if;

  select * into v_partner
  from public.partner_business_profiles
  where id = p_business_profile_id and is_published = true
    and partner_type in ('restaurant','store','mall')
  for share;
  if not found then raise exception 'business_unavailable'; end if;

  select count(*)::integer into v_cart_count
  from public.partner_customer_cart_items
  where customer_id = v_customer and business_profile_id = p_business_profile_id;

  v_order_type := case when v_partner.partner_type = 'restaurant' then 'restaurant' else 'store' end;
  v_expected_item_type := case when v_order_type = 'restaurant' then 'menu_item' else 'product' end;

  for v_line in
    select ci.id as cart_id, ci.catalog_item_id, ci.quantity,
           i.name, i.price_amount, i.currency, i.quantity_available
    from public.partner_customer_cart_items ci
    join public.partner_catalog_items i
      on i.id = ci.catalog_item_id and i.business_profile_id = ci.business_profile_id
    where ci.customer_id = v_customer
      and ci.business_profile_id = p_business_profile_id
      and i.is_active = true
      and i.item_type = v_expected_item_type
    order by ci.id
    for update of ci, i
  loop
    v_valid_count := v_valid_count + 1;
    if v_line.quantity_available is not null and v_line.quantity > v_line.quantity_available then
      raise exception 'الكمية المطلوبة من % غير متوفرة حالياً', v_line.name;
    end if;
    if v_currency is null then
      v_currency := v_line.currency;
    elsif v_currency <> v_line.currency then
      raise exception 'لا يمكن جمع منتجات بعملات مختلفة في سلة واحدة';
    end if;
    v_total := v_total + (v_line.price_amount * v_line.quantity);
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'item_id', v_line.catalog_item_id,
      'name', v_line.name,
      'quantity', v_line.quantity,
      'unit_price', v_line.price_amount,
      'line_total', v_line.price_amount * v_line.quantity,
      'currency', v_line.currency
    ));
  end loop;

  if v_cart_count = 0 or jsonb_array_length(v_items) = 0 then raise exception 'السلة فارغة أو لم تعد تحتوي على منتجات متاحة'; end if;
  if v_valid_count <> v_cart_count then raise exception 'بعض منتجات السلة لم تعد متاحة. حدّث السلة قبل تأكيد الطلب'; end if;

  insert into public.partner_customer_orders(
    business_profile_id, customer_id, order_type, requested_items,
    delivery_address, customer_note, status, partner_total, currency
  ) values (
    p_business_profile_id, v_customer, v_order_type, v_items,
    nullif(trim(coalesce(p_delivery_address,'')), ''),
    nullif(trim(coalesce(p_customer_note,'')), ''),
    'pending', v_total, coalesce(v_currency, 'IQD')
  ) returning id into v_order_id;

  -- Stock rows are locked above; reserve quantities in the same transaction as order creation.
  for v_line in
    select (entry.value->>'item_id')::uuid as item_id, (entry.value->>'quantity')::integer as quantity
    from jsonb_array_elements(v_items) as entry(value)
  loop
    update public.partner_catalog_items
      set quantity_available = quantity_available - v_line.quantity,
          updated_at = now()
    where id = v_line.item_id and quantity_available is not null;
  end loop;

  delete from public.partner_customer_cart_items
  where customer_id = v_customer and business_profile_id = p_business_profile_id;

  return v_order_id;
end;
$function$;
revoke all on function public.place_partner_customer_order(uuid,text,text) from public, anon;
grant execute on function public.place_partner_customer_order(uuid,text,text) to authenticated;

create or replace function public.restore_partner_order_stock()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_line jsonb;
begin
  if new.status in ('rejected','cancelled')
     and old.status in ('pending','accepted','preparing','ready') then
    for v_line in select value from jsonb_array_elements(new.requested_items)
    loop
      if coalesce(v_line->>'item_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         and coalesce(v_line->>'quantity','') ~ '^[1-9][0-9]{0,3}$' then
        update public.partner_catalog_items
        set quantity_available = quantity_available + (v_line->>'quantity')::integer,
            updated_at = now()
        where id = (v_line->>'item_id')::uuid
          and business_profile_id = new.business_profile_id
          and quantity_available is not null;
      end if;
    end loop;
  end if;
  return new;
end;
$function$;
revoke all on function public.restore_partner_order_stock() from public, anon, authenticated;
drop trigger if exists trg_restore_partner_order_stock on public.partner_customer_orders;
create trigger trg_restore_partner_order_stock
after update of status on public.partner_customer_orders
for each row execute function public.restore_partner_order_stock();


-- Enforce a one-way order lifecycle so terminal orders cannot be reopened or stock restored twice.
create or replace function public.guard_partner_order_status_transition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if new.status = old.status then return new; end if;

  if (old.status = 'pending' and new.status in ('accepted','rejected','cancelled'))
     or (old.status = 'accepted' and new.status in ('preparing','cancelled'))
     or (old.status = 'preparing' and new.status in ('ready','cancelled'))
     or (old.status = 'ready' and new.status in ('out_for_delivery','cancelled'))
     or (old.status = 'out_for_delivery' and new.status = 'completed') then
    return new;
  end if;

  raise exception 'invalid_partner_order_status_transition';
end;
$function$;
revoke all on function public.guard_partner_order_status_transition() from public, anon, authenticated;
drop trigger if exists trg_guard_partner_order_status_transition on public.partner_customer_orders;
create trigger trg_guard_partner_order_status_transition
before update of status on public.partner_customer_orders
for each row execute function public.guard_partner_order_status_transition();

-- Surface the grocery/supermarket category inside the unified stores-and-malls directory.
update public.partner_catalog_categories
set title = 'سوبر ماركت وبقالة', sort_order = 1, updated_at = now()
where vertical = 'grocery' and category_key = 'grocery';
