CREATE OR REPLACE FUNCTION public.admin_save_coupon_v2(p_id uuid, p_code text, p_type text, p_value numeric, p_max_uses integer, p_expires_at timestamp with time zone, p_active boolean, p_min_amount numeric, p_applicable_request_types text[], p_applicable_vehicle_categories text[], p_applicable_service_slugs text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid;
begin
 if auth.uid() is null or not (
   public.has_admin_access(auth.uid()) or public.admin_has_permission('promotions.manage','global',null)
 ) then raise exception 'missing_promotions_manage_permission'; end if;
 if coalesce(cardinality(p_applicable_request_types),0)=0
  or not(p_applicable_request_types <@ array['taxi','service']::text[])
  or not(coalesce(p_applicable_vehicle_categories,'{}'::text[]) <@ array['economy','premium','luxury','large']::text[])
  or ('taxi'=any(p_applicable_request_types) and cardinality(coalesce(p_applicable_vehicle_categories,'{}'::text[]))=0)
  or (cardinality(coalesce(p_applicable_service_slugs,'{}'::text[]))>0 and not('service'=any(p_applicable_request_types)))
  or exists(select 1 from unnest(coalesce(p_applicable_service_slugs,'{}'::text[])) s where not exists(select 1 from public.services x where x.slug=s))
 then raise exception 'invalid_coupon_service_targeting'; end if;
 if p_id is not null and exists(select 1 from public.coupon_redemptions where coupon_id=p_id)
  and exists(select 1 from public.coupons c where c.id=p_id and (
   c.applicable_request_types is distinct from p_applicable_request_types
   or c.applicable_vehicle_categories is distinct from p_applicable_vehicle_categories
   or c.applicable_service_slugs is distinct from coalesce(p_applicable_service_slugs,'{}'::text[])
  ))
 then raise exception 'cannot_change_coupon_scope_after_redemption'; end if;
 v_id:=public.admin_save_coupon(p_id,p_code,p_type,p_value,p_max_uses,p_expires_at,p_active,p_min_amount);
 update public.coupons set applicable_request_types=p_applicable_request_types,
  applicable_vehicle_categories=coalesce(p_applicable_vehicle_categories,'{}'::text[]),
  applicable_service_slugs=coalesce(p_applicable_service_slugs,'{}'::text[]),updated_at=now()
 where id=v_id;
 return v_id;
end;
$function$;
revoke all on function public.admin_save_coupon_v2(uuid,text,text,numeric,integer,timestamptz,boolean,numeric,text[],text[],text[]) from public,anon;
grant execute on function public.admin_save_coupon_v2(uuid,text,text,numeric,integer,timestamptz,boolean,numeric,text[],text[],text[]) to authenticated;
