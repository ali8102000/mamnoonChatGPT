-- Coupon service targeting and customer coupon visibility.
-- Production migration applied 2026-11-25.
alter table public.coupons
 add column if not exists applicable_request_types text[] not null default array['taxi']::text[],
 add column if not exists applicable_vehicle_categories text[] not null default array['economy','premium','luxury']::text[],
 add column if not exists applicable_service_slugs text[] not null default '{}'::text[];
alter table public.mamnoon_growth_campaigns
 add column if not exists coupon_request_types text[] not null default array['taxi']::text[],
 add column if not exists coupon_vehicle_categories text[] not null default array['economy','premium','luxury']::text[],
 add column if not exists coupon_service_slugs text[] not null default '{}'::text[];
do $constraints$ begin
 if not exists(select 1 from pg_constraint where conname='coupons_applicable_request_types_check') then
  alter table public.coupons add constraint coupons_applicable_request_types_check check(cardinality(applicable_request_types)>0 and applicable_request_types <@ array['taxi','service']::text[]);
 end if;
 if not exists(select 1 from pg_constraint where conname='coupons_applicable_vehicle_categories_check') then
  alter table public.coupons add constraint coupons_applicable_vehicle_categories_check check(applicable_vehicle_categories <@ array['economy','premium','luxury','large']::text[]);
 end if;
 if not exists(select 1 from pg_constraint where conname='growth_coupon_request_types_check') then
  alter table public.mamnoon_growth_campaigns add constraint growth_coupon_request_types_check check(cardinality(coupon_request_types)>0 and coupon_request_types <@ array['taxi','service']::text[]);
 end if;
 if not exists(select 1 from pg_constraint where conname='growth_coupon_vehicle_categories_check') then
  alter table public.mamnoon_growth_campaigns add constraint growth_coupon_vehicle_categories_check check(coupon_vehicle_categories <@ array['economy','premium','luxury','large']::text[]);
 end if;
end $constraints$;
create index if not exists coupons_applicable_request_types_gin on public.coupons using gin(applicable_request_types);
create index if not exists coupons_applicable_vehicle_categories_gin on public.coupons using gin(applicable_vehicle_categories);
CREATE OR REPLACE FUNCTION public.admin_list_growth_campaigns_v2()
 RETURNS TABLE(campaign_id uuid, campaign_type text, title text, provider_type text, service_slug text, target_governorates text[], amount_iqd bigint, budget_iqd bigint, spent_iqd bigint, delay_days integer, coupon_valid_days integer, max_awards integer, issued_count integer, starts_at timestamp with time zone, ends_at timestamp with time zone, active boolean, created_at timestamp with time zone, coupon_request_types text[], coupon_vehicle_categories text[], coupon_service_slugs text[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
 if auth.uid() is null or not(public.has_admin_access(auth.uid()) or public.admin_has_permission('promotions.manage','global',null))
 then raise exception 'missing_promotions_manage_permission'; end if;
 return query select c.id,c.campaign_type,c.title,c.provider_type,c.service_slug,c.target_governorates,c.amount_iqd,c.budget_iqd,c.spent_iqd,
 c.delay_days,c.coupon_valid_days,c.max_awards,c.issued_count,c.starts_at,c.ends_at,c.active,c.created_at,
 c.coupon_request_types,c.coupon_vehicle_categories,c.coupon_service_slugs from public.mamnoon_growth_campaigns c order by c.created_at desc;
end $function$;
CREATE OR REPLACE FUNCTION public.admin_save_growth_campaign_v2(p_campaign_id uuid, p_campaign_type text, p_title text, p_provider_type text, p_service_slug text, p_target_governorates text[], p_amount_iqd bigint, p_budget_iqd bigint, p_delay_days integer, p_coupon_valid_days integer, p_max_awards integer, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_active boolean, p_coupon_request_types text[], p_coupon_vehicle_categories text[], p_coupon_service_slugs text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid;
begin
 if p_campaign_type='customer_delayed_coupon' then
  if coalesce(cardinality(p_coupon_request_types),0)=0 or not(p_coupon_request_types <@ array['taxi','service']::text[])
   or not(coalesce(p_coupon_vehicle_categories,'{}'::text[]) <@ array['economy','premium','luxury','large']::text[])
   or ('taxi'=any(p_coupon_request_types) and cardinality(coalesce(p_coupon_vehicle_categories,'{}'::text[]))=0)
   or (cardinality(coalesce(p_coupon_service_slugs,'{}'::text[]))>0 and not('service'=any(p_coupon_request_types)))
   or exists(select 1 from unnest(coalesce(p_coupon_service_slugs,'{}'::text[])) s where not exists(select 1 from public.services x where x.slug=s))
  then raise exception 'invalid_coupon_service_targeting'; end if;
  if p_campaign_id is not null and exists(select 1 from public.mamnoon_growth_campaign_awards where campaign_id=p_campaign_id)
   and exists(select 1 from public.mamnoon_growth_campaigns c where c.id=p_campaign_id and
    (c.coupon_request_types is distinct from p_coupon_request_types or c.coupon_vehicle_categories is distinct from p_coupon_vehicle_categories or c.coupon_service_slugs is distinct from p_coupon_service_slugs))
  then raise exception 'cannot_change_coupon_scope_after_awards'; end if;
 end if;
 v_id:=public.admin_save_growth_campaign(p_campaign_id,p_campaign_type,p_title,p_provider_type,p_service_slug,p_target_governorates,
  p_amount_iqd,p_budget_iqd,p_delay_days,p_coupon_valid_days,p_max_awards,p_starts_at,p_ends_at,p_active);
 if p_campaign_type='customer_delayed_coupon' then
  update public.mamnoon_growth_campaigns set coupon_request_types=p_coupon_request_types,
   coupon_vehicle_categories=coalesce(p_coupon_vehicle_categories,'{}'::text[]),
   coupon_service_slugs=coalesce(p_coupon_service_slugs,'{}'::text[]),updated_at=now() where id=v_id;
 end if;
 return v_id;
end $function$;
CREATE OR REPLACE FUNCTION public.apply_coupon_to_existing_request(p_request_id uuid, p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.service_requests%rowtype;c public.coupons%rowtype;amount numeric;d numeric;
begin
 if auth.uid() is null then raise exception 'سجّل الدخول أولاً';end if;
 select * into r from public.service_requests where id=p_request_id and customer_id=auth.uid() for update;
 if not found then raise exception 'الطلب غير موجود أو لا تملك صلاحية تعديله';end if;
 if r.status::text not in ('pending','searching') or r.coupon_id is not null then raise exception 'الكوبون غير متاح لهذا الطلب';end if;
 if not exists(select 1 from public.user_roles x where x.user_id=auth.uid() and x.role='customer')
  or exists(select 1 from public.user_roles x where x.user_id=auth.uid() and x.role in ('driver','worker','large_driver'))
 then raise exception 'الكوبونات مخصصة لحسابات الزبائن فقط';end if;
 amount:=coalesce(r.price_estimate,r.customer_price);
 if amount is null or amount<=0 then raise exception 'سعر الطلب غير صالح';end if;
 select cp.* into c from public.coupons cp join public.coupon_assignments ca on ca.coupon_id=cp.id
 where ca.user_id=auth.uid() and upper(cp.code)=upper(trim(p_code)) and cp.active
 and (cp.expires_at is null or cp.expires_at>now()) and cp.used_count<cp.max_uses and amount>=cp.min_amount
 and r.type::text=any(cp.applicable_request_types)
 and (r.type::text<>'taxi' or coalesce(r.vehicle_category::text,'')=any(cp.applicable_vehicle_categories))
 and (r.type::text<>'service' or cardinality(cp.applicable_service_slugs)=0 or exists(select 1 from public.services s where s.id=r.service_id and s.slug=any(cp.applicable_service_slugs)))
 and not exists(select 1 from public.coupon_redemptions cr where cr.coupon_id=cp.id and cr.user_id=auth.uid())
 for update of cp;
 if not found then raise exception 'الكوبون غير متاح لهذا النوع من الطلبات أو لا يطابق شروطه';end if;
 d:=greatest(0,least(amount,case when c.type='percentage' then round(amount*c.value/100,2) else least(amount,c.value) end));
 perform set_config('app.allow_coupon_update','on',true);
 update public.service_requests set coupon_code=c.code,coupon_id=c.id,coupon_discount=d,customer_payable=amount-d where id=p_request_id;
 insert into public.coupon_redemptions(coupon_id,user_id,request_id,discount_amount) values(c.id,auth.uid(),p_request_id,d);
 update public.coupons set used_count=used_count+1,updated_at=now() where id=c.id;
 insert into public.coupon_subsidy_ledger(request_id,coupon_id,customer_id,discount_amount,currency,status) values(p_request_id,c.id,auth.uid(),d,'IQD','pending_completion');
 insert into public.notifications(user_id,type,title,body,link,data) values(auth.uid(),'coupon_redeemed','تم تطبيق الكوبون 🎉','تم خصم '||trim(to_char(d,'FM999999990.##'))||' د.ع من طلبك','/request/'||p_request_id,jsonb_build_object('coupon_id',c.id,'request_id',p_request_id,'discount',d,'payable',amount-d));
 return jsonb_build_object('discount',d,'payable',amount-d,'coupon_id',c.id);
end $function$;
CREATE OR REPLACE FUNCTION public.apply_coupon_to_new_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c public.coupons%rowtype; amount numeric;
begin
 if nullif(trim(new.coupon_code),'') is null then new.coupon_code:=null;new.coupon_id:=null;new.coupon_discount:=0;new.customer_payable:=coalesce(new.price_estimate,new.customer_price);return new;end if;
 if auth.uid() is null or auth.uid() is distinct from new.customer_id then raise exception 'غير مخوّل لاستخدام الكوبون';end if;
 if not exists(select 1 from public.user_roles r where r.user_id=new.customer_id and r.role='customer')
  or exists(select 1 from public.user_roles r where r.user_id=new.customer_id and r.role in ('driver','worker','large_driver'))
 then raise exception 'الكوبونات مخصصة لحسابات الزبائن فقط';end if;
 amount:=coalesce(new.price_estimate,new.customer_price);
 if amount is null or amount<=0 then raise exception 'لا يمكن تطبيق كوبون قبل تحديد سعر الطلب';end if;
 select cp.* into c from public.coupons cp join public.coupon_assignments ca on ca.coupon_id=cp.id
 where ca.user_id=new.customer_id and upper(cp.code)=upper(trim(new.coupon_code)) and cp.active
 and (cp.expires_at is null or cp.expires_at>now()) and cp.used_count<cp.max_uses and amount>=cp.min_amount
 and new.type::text=any(cp.applicable_request_types)
 and (new.type::text<>'taxi' or coalesce(new.vehicle_category::text,'')=any(cp.applicable_vehicle_categories))
 and (new.type::text<>'service' or cardinality(cp.applicable_service_slugs)=0 or exists(select 1 from public.services s where s.id=new.service_id and s.slug=any(cp.applicable_service_slugs)))
 and not exists(select 1 from public.coupon_redemptions cr where cr.coupon_id=cp.id and cr.user_id=new.customer_id)
 for update of cp;
 if not found then raise exception 'الكوبون غير متاح لهذا النوع من الطلبات أو لا يطابق شروطه';end if;
 new.coupon_code:=c.code;new.coupon_id:=c.id;
 new.coupon_discount:=greatest(0,least(amount,case when c.type='percentage' then round(amount*c.value/100,2) else least(amount,c.value) end));
 new.customer_payable:=amount-new.coupon_discount;return new;
end $function$;
CREATE OR REPLACE FUNCTION public.get_my_coupons_v2()
 RETURNS TABLE(id uuid, code text, type text, value numeric, min_amount numeric, expires_at timestamp with time zone, active boolean, assigned_at timestamp with time zone, used boolean, applicable_request_types text[], applicable_vehicle_categories text[], applicable_service_slugs text[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 select c.id,c.code,c.type,c.value,c.min_amount,c.expires_at,c.active,a.assigned_at,
  exists(select 1 from public.coupon_redemptions r where r.coupon_id=c.id and r.user_id=auth.uid()),
  c.applicable_request_types,c.applicable_vehicle_categories,c.applicable_service_slugs
 from public.coupon_assignments a join public.coupons c on c.id=a.coupon_id
 where auth.uid() is not null and a.user_id=auth.uid()
 and exists(select 1 from public.user_roles ur where ur.user_id=auth.uid() and ur.role='customer')
 and not exists(select 1 from public.user_roles ur where ur.user_id=auth.uid() and ur.role in ('driver','worker','large_driver'))
 order by a.assigned_at desc;
$function$;
CREATE OR REPLACE FUNCTION public.preview_my_coupon_for_request(p_code text, p_amount numeric, p_request_type text, p_vehicle_category text DEFAULT NULL::text, p_service_slug text DEFAULT NULL::text)
 RETURNS TABLE(coupon_id uuid, code text, discount numeric, payable numeric, type text, value numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c public.coupons%rowtype; d numeric;
begin
 if auth.uid() is null then raise exception 'يجب تسجيل الدخول'; end if;
 if not exists(select 1 from public.user_roles r where r.user_id=auth.uid() and r.role='customer')
  or exists(select 1 from public.user_roles r where r.user_id=auth.uid() and r.role in ('driver','worker','large_driver'))
 then raise exception 'الكوبونات مخصصة لحسابات الزبائن فقط'; end if;
 if p_amount is null or p_amount<=0 or p_request_type not in ('taxi','service') then raise exception 'بيانات الطلب غير صالحة'; end if;
 select cp.* into c from public.coupons cp join public.coupon_assignments ca on ca.coupon_id=cp.id
 where ca.user_id=auth.uid() and upper(cp.code)=upper(trim(p_code)) and cp.active and (cp.expires_at is null or cp.expires_at>now())
 and cp.used_count<cp.max_uses and p_amount>=cp.min_amount and p_request_type=any(cp.applicable_request_types)
 and (p_request_type<>'taxi' or coalesce(p_vehicle_category,'')=any(cp.applicable_vehicle_categories))
 and (p_request_type<>'service' or cardinality(cp.applicable_service_slugs)=0 or coalesce(p_service_slug,'')=any(cp.applicable_service_slugs))
 and not exists(select 1 from public.coupon_redemptions cr where cr.coupon_id=cp.id and cr.user_id=auth.uid()) limit 1;
 if not found then raise exception 'الكوبون غير متاح لهذا النوع من الطلبات أو لا يطابق شروطه'; end if;
 d:=greatest(0,least(p_amount,case when c.type='percentage' then round(p_amount*c.value/100,2) else least(p_amount,c.value) end));
 return query select c.id,c.code,d,p_amount-d,c.type,c.value;
end $function$;
CREATE OR REPLACE FUNCTION public.process_mamnoon_growth_campaigns()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_campaign public.mamnoon_growth_campaigns%rowtype;
  v_profile record;
  v_award_id uuid;
  v_coupon_id uuid;
  v_code text;
  v_assigned integer:=0;
begin
  if not pg_try_advisory_xact_lock(hashtext('mamnoon-growth-campaign-processor')) then return 0; end if;

  for v_campaign in
    select * from public.mamnoon_growth_campaigns
    where campaign_type='customer_delayed_coupon' and active=true
      and starts_at<=now() and issued_count<max_awards and spent_iqd+amount_iqd<=budget_iqd
    order by created_at
    for update
  loop
    for v_profile in
      select p.id,p.created_at,p.governorate_key,p.full_name
      from public.profiles p
      where p.created_at between v_campaign.starts_at and v_campaign.ends_at
        and p.created_at+make_interval(days=>v_campaign.delay_days)<=now()
        and (cardinality(v_campaign.target_governorates)=0 or p.governorate_key=any(v_campaign.target_governorates))
        and exists(select 1 from public.user_roles r where r.user_id=p.id and r.role::text='customer')
        and not exists(select 1 from public.mamnoon_growth_campaign_awards a where a.campaign_id=v_campaign.id and a.user_id=p.id)
      order by p.created_at
      limit 500
    loop
      exit when v_campaign.issued_count>=v_campaign.max_awards or v_campaign.spent_iqd+v_campaign.amount_iqd>v_campaign.budget_iqd;
      insert into public.mamnoon_growth_campaign_awards(campaign_id,user_id,award_type,amount_iqd)
      values(v_campaign.id,v_profile.id,'customer_coupon',v_campaign.amount_iqd)
      on conflict(campaign_id,user_id) do nothing returning id into v_award_id;
      if v_award_id is null then continue; end if;

      v_code:='MN'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
      insert into public.coupons(code,type,value,max_uses,used_count,min_amount,expires_at,active,applicable_request_types,applicable_vehicle_categories,applicable_service_slugs)
      values(v_code,'fixed',v_campaign.amount_iqd,1,0,0,
        case when v_campaign.coupon_valid_days>0 then now()+make_interval(days=>v_campaign.coupon_valid_days) else null end,true,v_campaign.coupon_request_types,v_campaign.coupon_vehicle_categories,v_campaign.coupon_service_slugs)
      returning id into v_coupon_id;
      insert into public.coupon_assignments(coupon_id,user_id,assigned_by)
      values(v_coupon_id,v_profile.id,null);
      update public.mamnoon_growth_campaign_awards set coupon_id=v_coupon_id where id=v_award_id;
      update public.mamnoon_growth_campaigns set issued_count=issued_count+1,spent_iqd=spent_iqd+v_campaign.amount_iqd,updated_at=now() where id=v_campaign.id;
      v_campaign.issued_count:=v_campaign.issued_count+1;
      v_campaign.spent_iqd:=v_campaign.spent_iqd+v_campaign.amount_iqd;
      insert into public.notifications(user_id,type,title,body,link,data)
      values(
        v_profile.id,'coupon_received','مبروك! وصلك خصم من ممنون 🎁',
        'بعد مرور '||v_campaign.delay_days::text||' أيام على تسجيلك، حصلت على خصم بقيمة '||
          to_char(v_campaign.amount_iqd,'FM999G999G999G990')||' دينار. رمز الخصم: '||v_code,
        '/coupons',jsonb_build_object('campaign_id',v_campaign.id,'coupon_id',v_coupon_id,'code',v_code,'type','fixed','value',v_campaign.amount_iqd)
      );
      v_assigned:=v_assigned+1;
    end loop;
  end loop;
  return v_assigned;
end;
$function$;
revoke all on function public.admin_save_growth_campaign_v2(uuid,text,text,text,text,text[],bigint,bigint,integer,integer,integer,timestamptz,timestamptz,boolean,text[],text[],text[]) from public,anon;
grant execute on function public.admin_save_growth_campaign_v2(uuid,text,text,text,text,text[],bigint,bigint,integer,integer,integer,timestamptz,timestamptz,boolean,text[],text[],text[]) to authenticated;
revoke all on function public.admin_list_growth_campaigns_v2() from public,anon;
grant execute on function public.admin_list_growth_campaigns_v2() to authenticated;
revoke all on function public.get_my_coupons_v2() from public,anon;
grant execute on function public.get_my_coupons_v2() to authenticated;
revoke all on function public.preview_my_coupon_for_request(text,numeric,text,text,text) from public,anon;
grant execute on function public.preview_my_coupon_for_request(text,numeric,text,text,text) to authenticated;
revoke all on function public.apply_coupon_to_new_request() from public,anon,authenticated;
drop trigger if exists mamnoon_growth_provider_profile_signup on public.profiles;
create trigger mamnoon_growth_provider_profile_signup after insert on public.profiles
for each row execute function public.mamnoon_growth_provider_signup_trigger();
