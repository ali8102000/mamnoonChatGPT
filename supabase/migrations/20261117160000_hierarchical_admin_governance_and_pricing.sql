-- Mamnoon unified administration governance foundation.
-- Uses one permission catalog, one grants table, one delegation table,
-- and one approval queue. Platform-wide changes are audited in audit_logs.
begin;

alter table public.staff_assignments
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists scope_type text
    check (scope_type in ('global','governorate')),
  add column if not exists scope_governorate text;

-- Legacy creator is intentionally NULL: assigned_by is mutable and cannot
-- prove who originally created an existing staff assignment.
alter table public.staff_assignments
  drop constraint if exists staff_assignments_scope_governorate_check;
alter table public.staff_assignments
  add constraint staff_assignments_scope_governorate_check
  check (
    (scope_type is null and scope_governorate is null)
    or (scope_type = 'global' and scope_governorate is null)
    or (scope_type = 'governorate' and scope_governorate in
      ('baghdad','basra','nineveh','erbil','sulaymaniyah','duhok','kirkuk',
       'najaf','karbala','babil','anbar','diyala','saladin','wasit',
       'dhiqar','maysan','muthanna','qadisiyah'))
  );
create index if not exists staff_assignments_created_by_idx
  on public.staff_assignments(created_by);
create index if not exists staff_assignments_scope_idx
  on public.staff_assignments(scope_type, scope_governorate);

-- One normalized catalog for every administration capability.
create table if not exists public.admin_permission_catalog (
  permission_key text primary key,
  domain text not null,
  label_ar text not null,
  risk_level text not null default 'normal'
    check (risk_level in ('normal','sensitive','critical')),
  description text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.admin_permission_catalog
  (permission_key, domain, label_ar, risk_level, description)
values
 ('dashboard.view','overview','عرض لوحة القيادة','normal','قراءة مؤشرات لوحة القيادة'),
 ('users.read','users','عرض العملاء','normal','قراءة بيانات العملاء المسموح بها'),
 ('users.block','users','حظر العملاء','sensitive','حظر أو رفع حظر مستخدم مع سبب'),
 ('users.profile.edit','users','تعديل بيانات العملاء','sensitive','تعديل بيانات الملف الشخصي المسموح بها'),
 ('providers.read','providers','عرض مقدمي الخدمة','normal','قراءة ملفات السائقين والفنيين'),
 ('providers.verify','providers','توثيق مقدمي الخدمة','sensitive','قبول أو رفض التوثيق مع سبب'),
 ('providers.suspend','providers','إيقاف مقدمي الخدمة','sensitive','إيقاف أو إعادة تفعيل مقدم خدمة'),
 ('orders.read','orders','عرض الطلبات','normal','قراءة الطلبات ضمن النطاق'),
 ('orders.assign','orders','إدارة التعيين','sensitive','تعيين أو إعادة توزيع الطلبات'),
 ('orders.override','orders','التدخل بالطلبات','critical','تعديل حالة أو إلغاء طلب مع تسجيل السبب'),
 ('pricing.taxi.read','pricing','عرض تعرفة التاكسي','normal','قراءة تعرفة التاكسي'),
 ('pricing.taxi.edit','pricing','تعديل تعرفة التاكسي','critical','تعديل أجور الانطلاق والكيلومتر والدقيقة والحد الأدنى'),
 ('pricing.peak.edit','pricing','إدارة الذروة والاستعجال','critical','تفعيل وتعديل الذروة والاستعجال ضمن النطاق'),
 ('pricing.services.edit','pricing','تسعير الخدمات','critical','تعديل تعرفة الخدمات غير التاكسي'),
 ('pricing.commission.edit','pricing','إدارة العمولات','critical','تعديل عمولات المنصة ومقدم الخدمة'),
 ('promotions.read','promotions','عرض الخصومات','normal','قراءة الكوبونات والحملات'),
 ('promotions.manage','promotions','إدارة الخصومات','sensitive','إنشاء وتعديل وإيقاف الكوبونات والحملات'),
 ('finance.read','finance','عرض التقارير المالية','sensitive','قراءة السجلات المالية ضمن النطاق'),
 ('finance.wallet.adjust','finance','تسوية المحفظة','critical','إجراء قيد تسوية مسبب في دفتر الأستاذ'),
 ('finance.refund','finance','إرجاع المدفوعات','critical','إجراء استرداد مدفوعات'),
 ('subscriptions.manage','subscriptions','إدارة الاشتراكات','sensitive','إدارة الخطط والاستحقاقات'),
 ('support.manage','support','إدارة الدعم','normal','إدارة التذاكر والمحادثات المصرح بها'),
 ('notifications.send','communications','إرسال الإشعارات','sensitive','إنشاء وإرسال حملات الإشعارات'),
 ('regions.manage','regions','إدارة المحافظات','critical','تفعيل أو إيقاف الخدمات والإعدادات الإقليمية'),
 ('staff.read','staff','عرض الموظفين','normal','عرض الموظفين ضمن نطاق الإدارة'),
 ('staff.assign','staff','إضافة الموظفين','critical','إضافة موظف بصلاحيات لا تتجاوز صلاحيات المانح'),
 ('staff.manage_created','staff','إدارة الموظفين الذين أضافهم','critical','إدارة الموظفين الذين أنشأهم المدير حصراً'),
 ('staff.delegate','staff','تفويض الصلاحيات','critical','تفويض مجموعة صلاحيات محددة ضمن النطاق'),
 ('staff.approve','staff','مراجعة طلبات الموظفين','critical','الموافقة أو الرفض وفق صلاحية التفويض'),
 ('settings.manage','platform','إعدادات المنصة','critical','إدارة الإعدادات التشغيلية غير السرية'),
 ('audit.read','audit','قراءة سجل التدقيق','sensitive','قراءة سجل العمليات ضمن النطاق'),
 ('reports.export','reports','تصدير التقارير','sensitive','تصدير البيانات المسموح بها')
on conflict (permission_key) do update set
 domain=excluded.domain, label_ar=excluded.label_ar,
 risk_level=excluded.risk_level, description=excluded.description, active=true;

-- Grants are explicit, scoped, time-bounded and revocable.
create table if not exists public.admin_staff_permission_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  permission_key text not null references public.admin_permission_catalog(permission_key),
  scope_type text not null check (scope_type in ('global','governorate')),
  scope_governorate text,
  granted_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  check ((scope_type='global' and scope_governorate is null) or
         (scope_type='governorate' and scope_governorate in
          ('baghdad','basra','nineveh','erbil','sulaymaniyah','duhok','kirkuk',
           'najaf','karbala','babil','anbar','diyala','saladin','wasit',
           'dhiqar','maysan','muthanna','qadisiyah')))
);
create unique index if not exists admin_staff_permission_grants_active_unique
  on public.admin_staff_permission_grants
  (user_id, permission_key, scope_type, coalesce(scope_governorate,''))
  where revoked_at is null;
create index if not exists admin_staff_permission_grants_user_idx
  on public.admin_staff_permission_grants(user_id, permission_key)
  where revoked_at is null;

-- Delegations are permission-by-permission; they cannot widen the delegator's scope.
create table if not exists public.admin_staff_delegations (
  id uuid primary key default gen_random_uuid(),
  delegator_id uuid not null references auth.users(id) on delete restrict,
  delegate_id uuid not null references auth.users(id) on delete cascade,
  permission_key text not null references public.admin_permission_catalog(permission_key),
  scope_type text not null check (scope_type in ('global','governorate')),
  scope_governorate text,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  check (delegator_id <> delegate_id),
  check ((scope_type='global' and scope_governorate is null) or
         (scope_type='governorate' and scope_governorate in
          ('baghdad','basra','nineveh','erbil','sulaymaniyah','duhok','kirkuk',
           'najaf','karbala','babil','anbar','diyala','saladin','wasit',
           'dhiqar','maysan','muthanna','qadisiyah')))
);
create unique index if not exists admin_staff_delegations_active_unique
  on public.admin_staff_delegations
  (delegator_id, delegate_id, permission_key, scope_type, coalesce(scope_governorate,''))
  where revoked_at is null;
create index if not exists admin_staff_delegations_delegate_idx
  on public.admin_staff_delegations(delegate_id, permission_key)
  where revoked_at is null;

-- One queue for staff, pricing, finance, moderation and configuration approvals.
create table if not exists public.admin_approval_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete restrict,
  request_type text not null check (request_type in (
    'staff_assign','staff_rank_change','staff_permission_change','staff_scope_change',
    'staff_deactivate','pricing_change','promotion_publish','wallet_adjustment',
    'payment_refund','provider_action','order_override','platform_setting_change'
  )),
  target_user_id uuid references auth.users(id) on delete restrict,
  scope_type text not null default 'global' check (scope_type in ('global','governorate')),
  scope_governorate text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','cancelled','applied','failed')),
  reviewed_by uuid references auth.users(id) on delete set null,
  decision_note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  applied_at timestamptz,
  check ((scope_type='global' and scope_governorate is null) or
         (scope_type='governorate' and scope_governorate in
          ('baghdad','basra','nineveh','erbil','sulaymaniyah','duhok','kirkuk',
           'najaf','karbala','babil','anbar','diyala','saladin','wasit',
           'dhiqar','maysan','muthanna','qadisiyah')))
);
create index if not exists admin_approval_requests_status_idx
  on public.admin_approval_requests(status, created_at desc);
create index if not exists admin_approval_requests_requester_idx
  on public.admin_approval_requests(requester_id, created_at desc);

-- Existing audit_logs is the canonical platform-wide audit trail.
-- Pricing before/after, staff changes, approvals and financial actions belong there;
-- no duplicate pricing-specific or governance-specific audit tables are created.

alter table public.admin_permission_catalog enable row level security;
alter table public.admin_staff_permission_grants enable row level security;
alter table public.admin_staff_delegations enable row level security;
alter table public.admin_approval_requests enable row level security;

drop policy if exists admin_permission_catalog_read on public.admin_permission_catalog;
create policy admin_permission_catalog_read on public.admin_permission_catalog
for select to authenticated using (active = true);

drop policy if exists admin_staff_permission_grants_read on public.admin_staff_permission_grants;
create policy admin_staff_permission_grants_read on public.admin_staff_permission_grants
for select to authenticated
using (user_id = (select auth.uid()) or granted_by = (select auth.uid())
  or public.is_super_admin((select auth.uid())));

drop policy if exists admin_staff_delegations_read on public.admin_staff_delegations;
create policy admin_staff_delegations_read on public.admin_staff_delegations
for select to authenticated
using (delegator_id = (select auth.uid()) or delegate_id = (select auth.uid())
  or public.is_super_admin((select auth.uid())));

drop policy if exists admin_approval_requests_read on public.admin_approval_requests;
create policy admin_approval_requests_read on public.admin_approval_requests
for select to authenticated
using (requester_id = (select auth.uid()) or reviewed_by = (select auth.uid())
  or public.is_super_admin((select auth.uid())));

revoke all on public.admin_permission_catalog from anon, authenticated;
revoke all on public.admin_staff_permission_grants from anon, authenticated;
revoke all on public.admin_staff_delegations from anon, authenticated;
revoke all on public.admin_approval_requests from anon, authenticated;
grant select on public.admin_permission_catalog to authenticated;
grant select on public.admin_staff_permission_grants to authenticated;
grant select on public.admin_staff_delegations to authenticated;
grant select on public.admin_approval_requests to authenticated;


-- Server-side governance primitives. These functions are the only write path
-- for delegated staff administration; direct table writes remain revoked.
create or replace function public.admin_permission_level(p_rank text)
returns integer language sql immutable
set search_path = ''
as $function$
  select case p_rank
    when 'owner' then 5 when 'general_manager' then 4
    when 'department_manager' then 3 when 'supervisor' then 2
    when 'employee' then 1 else 0 end
$function$;

create or replace function public.admin_has_permission(
  p_permission_key text,
  p_scope_type text default 'global',
  p_scope_governorate text default null
)
returns boolean
language plpgsql stable security definer
set search_path = public, pg_temp
as $function$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then return false; end if;
  if public.is_super_admin(v_actor) then return true; end if;
  if p_scope_type not in ('global','governorate')
     or (p_scope_type='global' and p_scope_governorate is not null)
     or (p_scope_type='governorate' and nullif(trim(p_scope_governorate),'') is null)
  then return false; end if;

  return exists (
    select 1 from public.admin_staff_permission_grants g
    where g.user_id=v_actor and g.permission_key=p_permission_key
      and g.revoked_at is null and (g.expires_at is null or g.expires_at>now())
      and (g.scope_type='global'
        or (p_scope_type='governorate' and g.scope_type='governorate'
            and g.scope_governorate=p_scope_governorate))
  ) or exists (
    select 1 from public.admin_staff_delegations d
    join public.admin_staff_permission_grants g
      on g.user_id=d.delegator_id and g.permission_key=d.permission_key
    where d.delegate_id=v_actor and d.permission_key=p_permission_key
      and d.revoked_at is null and (d.expires_at is null or d.expires_at>now())
      and g.revoked_at is null and (g.expires_at is null or g.expires_at>now())
      and (d.scope_type='global'
        or (p_scope_type='governorate' and d.scope_type='governorate'
            and d.scope_governorate=p_scope_governorate))
      and (g.scope_type='global'
        or (d.scope_type='governorate' and g.scope_type='governorate'
            and g.scope_governorate=d.scope_governorate))
  );
end;
$function$;

create or replace function public.admin_can_manage_staff(p_target_user uuid)
returns boolean
language plpgsql stable security definer
set search_path = public, pg_temp
as $function$
declare v_actor uuid := auth.uid(); v_actor_rank text; v_target_rank text;
begin
  if v_actor is null or p_target_user is null or p_target_user=v_actor then return false; end if;
  if public.is_super_admin(v_actor) then return true; end if;
  if not public.admin_has_permission('staff.manage_created','global',null) then return false; end if;
  select rank into v_actor_rank from public.staff_assignments
    where user_id=v_actor and active=true;
  select rank into v_target_rank from public.staff_assignments
    where user_id=p_target_user and active=true and created_by=v_actor;
  return v_target_rank is not null
    and public.admin_permission_level(v_target_rank) < public.admin_permission_level(v_actor_rank);
end;
$function$;

create or replace function public.admin_assign_staff(
  p_target_user uuid,
  p_rank text,
  p_department text,
  p_display_title text default null,
  p_scope_type text default 'global',
  p_scope_governorate text default null
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $function$
declare
  v_actor uuid := auth.uid();
  v_actor_rank text;
  v_actor_department text;
  v_actor_scope_type text;
  v_actor_scope_governorate text;
begin
  if v_actor is null then raise exception 'unauthorized'; end if;
  if p_target_user is null or p_target_user=v_actor then raise exception 'invalid_target'; end if;
  if p_rank not in ('general_manager','department_manager','supervisor','employee') then
    raise exception 'invalid_rank';
  end if;
  if p_department not in ('executive','customer_service','finance','operations','monitoring') then
    raise exception 'invalid_department';
  end if;
  if p_scope_type not in ('global','governorate')
    or (p_scope_type='global' and p_scope_governorate is not null)
    or (p_scope_type='governorate' and nullif(trim(p_scope_governorate),'') is null) then
    raise exception 'invalid_scope';
  end if;
  if exists(select 1 from public.user_roles where user_id=p_target_user and role::text='super_admin') then
    raise exception 'cannot_assign_super_admin';
  end if;
  if exists(select 1 from public.staff_assignments where user_id=p_target_user) then
    raise exception 'staff_assignment_already_exists_owner_review_required';
  end if;

  if not public.is_super_admin(v_actor) then
    if not public.admin_has_permission('staff.assign',p_scope_type,p_scope_governorate) then
      raise exception 'missing_staff_assign_permission';
    end if;
    select rank,department,scope_type,scope_governorate
      into v_actor_rank,v_actor_department,v_actor_scope_type,v_actor_scope_governorate
      from public.staff_assignments where user_id=v_actor and active=true;
    if v_actor_rank is null or public.admin_permission_level(p_rank)>=public.admin_permission_level(v_actor_rank) then
      raise exception 'rank_escalation_denied';
    end if;
    if p_department is distinct from v_actor_department then raise exception 'department_scope_denied'; end if;
    if v_actor_scope_type='governorate'
      and (p_scope_type<>'governorate' or p_scope_governorate is distinct from v_actor_scope_governorate) then
      raise exception 'governorate_scope_denied';
    end if;
    if v_actor_scope_type is null then raise exception 'legacy_staff_scope_requires_owner_review'; end if;
  end if;

  insert into public.staff_assignments
    (user_id,rank,department,display_title,active,assigned_by,created_by,scope_type,scope_governorate,updated_at)
  values
    (p_target_user,p_rank,p_department,nullif(trim(p_display_title),''),true,v_actor,v_actor,p_scope_type,
     case when p_scope_type='global' then null else p_scope_governorate end,now());

  insert into public.audit_logs(user_id,action,target_type,target_id,details)
  values(v_actor,'staff.assigned','staff',p_target_user::text,
    jsonb_build_object('rank',p_rank,'department',p_department,'scope_type',p_scope_type,
      'scope_governorate',p_scope_governorate,'display_title',p_display_title));
end;
$function$;

create or replace function public.admin_grant_staff_permission(
  p_target_user uuid,
  p_permission_key text,
  p_scope_type text default 'global',
  p_scope_governorate text default null,
  p_expires_at timestamptz default null
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $function$
declare v_actor uuid := auth.uid(); v_id uuid; v_actor_scope_type text; v_actor_scope_governorate text;
begin
  if v_actor is null then raise exception 'unauthorized'; end if;
  if p_scope_type not in ('global','governorate')
    or (p_scope_type='global' and p_scope_governorate is not null)
    or (p_scope_type='governorate' and nullif(trim(p_scope_governorate),'') is null) then
    raise exception 'invalid_scope';
  end if;
  if not exists(select 1 from public.admin_permission_catalog where permission_key=p_permission_key and active) then
    raise exception 'unknown_permission';
  end if;
  if not exists(select 1 from public.staff_assignments where user_id=p_target_user and active=true and created_by=v_actor)
     and not public.is_super_admin(v_actor) then raise exception 'target_not_created_by_actor'; end if;
  if p_target_user=v_actor then raise exception 'cannot_grant_permission_to_self'; end if;
  if not public.is_super_admin(v_actor) then
    if not public.admin_has_permission('staff.delegate',p_scope_type,p_scope_governorate)
       or not public.admin_has_permission(p_permission_key,p_scope_type,p_scope_governorate) then
      raise exception 'delegation_exceeds_actor_permissions';
    end if;
    select scope_type,scope_governorate into v_actor_scope_type,v_actor_scope_governorate
      from public.staff_assignments where user_id=v_actor and active=true;
    if v_actor_scope_type='governorate'
      and (p_scope_type<>'governorate' or p_scope_governorate is distinct from v_actor_scope_governorate) then
      raise exception 'governorate_scope_denied';
    end if;
    if v_actor_scope_type is null then raise exception 'legacy_staff_scope_requires_owner_review'; end if;
  end if;
  insert into public.admin_staff_permission_grants
    (user_id,permission_key,scope_type,scope_governorate,granted_by,expires_at)
  values(p_target_user,p_permission_key,p_scope_type,p_scope_governorate,v_actor,p_expires_at)
  on conflict do nothing returning id into v_id;
  if v_id is null then raise exception 'active_grant_already_exists'; end if;
  insert into public.audit_logs(user_id,action,target_type,target_id,details)
  values(v_actor,'staff.permission.granted','staff',p_target_user::text,
    jsonb_build_object('permission_key',p_permission_key,'scope_type',p_scope_type,
      'scope_governorate',p_scope_governorate,'expires_at',p_expires_at));
  return v_id;
end;
$function$;

create or replace function public.admin_revoke_staff_permission(p_grant_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $function$
declare v_actor uuid := auth.uid(); v_row public.admin_staff_permission_grants%rowtype;
begin
  if v_actor is null then raise exception 'unauthorized'; end if;
  select * into v_row from public.admin_staff_permission_grants where id=p_grant_id and revoked_at is null for update;
  if not found then raise exception 'active_grant_not_found'; end if;
  if not public.is_super_admin(v_actor) and v_row.granted_by is distinct from v_actor then
    raise exception 'grant_not_created_by_actor';
  end if;
  update public.admin_staff_permission_grants set revoked_at=now(),revoked_by=v_actor where id=p_grant_id;
  insert into public.audit_logs(user_id,action,target_type,target_id,details)
  values(v_actor,'staff.permission.revoked','staff',v_row.user_id::text,
    jsonb_build_object('grant_id',p_grant_id,'permission_key',v_row.permission_key,
      'scope_type',v_row.scope_type,'scope_governorate',v_row.scope_governorate));
end;
$function$;

create or replace function public.admin_request_approval(
  p_request_type text,
  p_target_user_id uuid,
  p_scope_type text,
  p_scope_governorate text,
  p_payload jsonb
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $function$
declare v_actor uuid := auth.uid(); v_id uuid;
begin
  if v_actor is null then raise exception 'unauthorized'; end if;
  if p_request_type not in ('staff_assign','staff_rank_change','staff_permission_change','staff_scope_change',
    'staff_deactivate','pricing_change','promotion_publish','wallet_adjustment','payment_refund',
    'provider_action','order_override','platform_setting_change') then raise exception 'invalid_request_type'; end if;
  if p_scope_type not in ('global','governorate')
    or (p_scope_type='global' and p_scope_governorate is not null)
    or (p_scope_type='governorate' and nullif(trim(p_scope_governorate),'') is null) then
    raise exception 'invalid_scope';
  end if;
  if coalesce(p_payload,'{}'::jsonb)='{}'::jsonb then raise exception 'approval_payload_required'; end if;
  insert into public.admin_approval_requests
    (requester_id,request_type,target_user_id,scope_type,scope_governorate,payload)
  values(v_actor,p_request_type,p_target_user_id,p_scope_type,p_scope_governorate,p_payload)
  returning id into v_id;
  insert into public.audit_logs(user_id,action,target_type,target_id,details)
  values(v_actor,'admin.approval.requested','approval_request',v_id::text,
    jsonb_build_object('request_type',p_request_type,'target_user_id',p_target_user_id,
      'scope_type',p_scope_type,'scope_governorate',p_scope_governorate));
  return v_id;
end;
$function$;


create or replace function public.admin_create_delegation(
  p_delegate_id uuid,
  p_permission_key text,
  p_scope_type text default 'global',
  p_scope_governorate text default null,
  p_expires_at timestamptz default null
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $function$
declare v_actor uuid := auth.uid(); v_id uuid; v_actor_scope_type text; v_actor_scope_governorate text;
begin
  if v_actor is null then raise exception 'unauthorized'; end if;
  if p_delegate_id is null or p_delegate_id=v_actor then raise exception 'invalid_delegate'; end if;
  if p_scope_type not in ('global','governorate')
    or (p_scope_type='global' and p_scope_governorate is not null)
    or (p_scope_type='governorate' and nullif(trim(p_scope_governorate),'') is null) then
    raise exception 'invalid_scope';
  end if;
  if not exists(select 1 from public.staff_assignments where user_id=p_delegate_id and active=true) then
    raise exception 'delegate_must_be_active_staff';
  end if;
  if not exists(select 1 from public.admin_permission_catalog where permission_key=p_permission_key and active) then
    raise exception 'unknown_permission';
  end if;
  if not public.is_super_admin(v_actor) then
    if not public.admin_has_permission('staff.delegate',p_scope_type,p_scope_governorate)
       or not public.admin_has_permission(p_permission_key,p_scope_type,p_scope_governorate) then
      raise exception 'delegation_exceeds_actor_permissions';
    end if;
    if not exists(select 1 from public.staff_assignments where user_id=p_delegate_id and created_by=v_actor) then
      raise exception 'delegate_not_created_by_actor';
    end if;
    select scope_type,scope_governorate into v_actor_scope_type,v_actor_scope_governorate
      from public.staff_assignments where user_id=v_actor and active=true;
    if v_actor_scope_type='governorate'
      and (p_scope_type<>'governorate' or p_scope_governorate is distinct from v_actor_scope_governorate) then
      raise exception 'governorate_scope_denied';
    end if;
    if v_actor_scope_type is null then raise exception 'legacy_staff_scope_requires_owner_review'; end if;
  end if;
  insert into public.admin_staff_delegations
    (delegator_id,delegate_id,permission_key,scope_type,scope_governorate,expires_at)
  values(v_actor,p_delegate_id,p_permission_key,p_scope_type,p_scope_governorate,p_expires_at)
  returning id into v_id;
  insert into public.audit_logs(user_id,action,target_type,target_id,details)
  values(v_actor,'staff.delegation.created','staff',p_delegate_id::text,
    jsonb_build_object('delegation_id',v_id,'permission_key',p_permission_key,
      'scope_type',p_scope_type,'scope_governorate',p_scope_governorate,'expires_at',p_expires_at));
  return v_id;
end;
$function$;

create or replace function public.admin_revoke_delegation(p_delegation_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $function$
declare v_actor uuid := auth.uid(); v_row public.admin_staff_delegations%rowtype;
begin
  if v_actor is null then raise exception 'unauthorized'; end if;
  select * into v_row from public.admin_staff_delegations
    where id=p_delegation_id and revoked_at is null for update;
  if not found then raise exception 'active_delegation_not_found'; end if;
  if not public.is_super_admin(v_actor) and v_row.delegator_id is distinct from v_actor then
    raise exception 'delegation_not_created_by_actor';
  end if;
  update public.admin_staff_delegations set revoked_at=now(),revoked_by=v_actor where id=p_delegation_id;
  insert into public.audit_logs(user_id,action,target_type,target_id,details)
  values(v_actor,'staff.delegation.revoked','staff',v_row.delegate_id::text,
    jsonb_build_object('delegation_id',p_delegation_id,'permission_key',v_row.permission_key));
end;
$function$;

create or replace function public.admin_review_approval(
  p_request_id uuid,
  p_decision text,
  p_note text default null
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $function$
declare v_actor uuid := auth.uid(); v_row public.admin_approval_requests%rowtype; v_permission text;
begin
  if v_actor is null then raise exception 'unauthorized'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'invalid_decision'; end if;
  select * into v_row from public.admin_approval_requests where id=p_request_id and status='pending' for update;
  if not found then raise exception 'pending_request_not_found'; end if;
  if v_row.requester_id=v_actor then raise exception 'cannot_approve_own_request'; end if;
  v_permission := case
    when v_row.request_type like 'staff_%' then 'staff.approve'
    when v_row.request_type='pricing_change' then 'pricing.taxi.edit'
    when v_row.request_type='promotion_publish' then 'promotions.manage'
    when v_row.request_type in ('wallet_adjustment','payment_refund') then 'finance.refund'
    when v_row.request_type='provider_action' then 'providers.suspend'
    when v_row.request_type='order_override' then 'orders.override'
    else 'settings.manage' end;
  if not public.admin_has_permission(v_permission,v_row.scope_type,v_row.scope_governorate) then
    raise exception 'missing_approval_permission';
  end if;
  update public.admin_approval_requests
    set status=p_decision,reviewed_by=v_actor,decision_note=nullif(trim(p_note),''),
        reviewed_at=now()
    where id=p_request_id;
  insert into public.audit_logs(user_id,action,target_type,target_id,details)
  values(v_actor,'admin.approval.'||p_decision,'approval_request',p_request_id::text,
    jsonb_build_object('request_type',v_row.request_type,'requester_id',v_row.requester_id,
      'target_user_id',v_row.target_user_id,'decision_note',p_note));
end;
$function$;

drop policy if exists admin_approval_requests_read on public.admin_approval_requests;
create policy admin_approval_requests_read on public.admin_approval_requests
for select to authenticated
using (requester_id=(select auth.uid()) or reviewed_by=(select auth.uid())
  or public.is_super_admin((select auth.uid()))
  or public.admin_has_permission('staff.approve',scope_type,scope_governorate)
  or public.admin_has_permission('pricing.taxi.edit',scope_type,scope_governorate)
  or public.admin_has_permission('promotions.manage',scope_type,scope_governorate)
  or public.admin_has_permission('finance.refund',scope_type,scope_governorate)
  or public.admin_has_permission('providers.suspend',scope_type,scope_governorate)
  or public.admin_has_permission('orders.override',scope_type,scope_governorate)
  or public.admin_has_permission('settings.manage',scope_type,scope_governorate));


create or replace function public.admin_list_managed_staff()
returns table(
  user_id uuid, full_name text, phone text, email text, rank text, department text,
  display_title text, active boolean, scope_type text, scope_governorate text, created_by uuid
)
language plpgsql stable security definer
set search_path = public, pg_temp
as $function$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'unauthorized'; end if;
  if public.is_super_admin(v_actor) then
    return query
      select a.user_id,p.full_name,p.phone,p.email,a.rank,a.department,a.display_title,a.active,
             a.scope_type,a.scope_governorate,a.created_by
      from public.staff_assignments a left join public.profiles p on p.id=a.user_id
      order by a.department,public.admin_permission_level(a.rank) desc,p.full_name;
    return;
  end if;
  if not public.admin_has_permission('staff.read','global',null) then raise exception 'missing_staff_read_permission'; end if;
  return query
    select a.user_id,p.full_name,p.phone,p.email,a.rank,a.department,a.display_title,a.active,
           a.scope_type,a.scope_governorate,a.created_by
    from public.staff_assignments a left join public.profiles p on p.id=a.user_id
    where a.created_by=v_actor
    order by a.department,public.admin_permission_level(a.rank) desc,p.full_name;
end;
$function$;

create or replace function public.admin_change_staff_rank(
  p_target_user uuid,
  p_new_rank text,
  p_new_department text default null,
  p_new_display_title text default null
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $function$
declare
  v_actor uuid := auth.uid(); v_actor_rank text; v_actor_department text;
  v_target public.staff_assignments%rowtype; v_department text;
begin
  if v_actor is null then raise exception 'unauthorized'; end if;
  if p_target_user is null or p_target_user=v_actor then raise exception 'cannot_change_own_assignment'; end if;
  if p_new_rank not in ('general_manager','department_manager','supervisor','employee') then raise exception 'invalid_rank'; end if;
  select * into v_target from public.staff_assignments where user_id=p_target_user and active=true for update;
  if not found then raise exception 'active_staff_not_found'; end if;
  if v_target.rank='owner' or exists(select 1 from public.user_roles where user_id=p_target_user and role::text='super_admin') then
    raise exception 'protected_staff_account';
  end if;
  v_department := coalesce(p_new_department,v_target.department);
  if v_department not in ('executive','customer_service','finance','operations','monitoring') then raise exception 'invalid_department'; end if;

  if not public.is_super_admin(v_actor) then
    if not public.admin_can_manage_staff(p_target_user) then raise exception 'staff_not_managed_by_actor'; end if;
    select rank,department into v_actor_rank,v_actor_department from public.staff_assignments
      where user_id=v_actor and active=true;
    if public.admin_permission_level(p_new_rank)>=public.admin_permission_level(v_actor_rank)
      or public.admin_permission_level(v_target.rank)>=public.admin_permission_level(v_actor_rank) then
      raise exception 'rank_escalation_denied';
    end if;
    if v_department is distinct from v_actor_department then raise exception 'department_scope_denied'; end if;
  end if;

  update public.staff_assignments set rank=p_new_rank,department=v_department,
    display_title=nullif(trim(p_new_display_title),''),assigned_by=v_actor,updated_at=now()
    where user_id=p_target_user;
  insert into public.staff_activity_log(staff_user_id,actor_user_id,activity,details)
  values(p_target_user,v_actor,'rank_changed',jsonb_build_object(
    'old_rank',v_target.rank,'new_rank',p_new_rank,'old_department',v_target.department,
    'new_department',v_department,'old_display_title',v_target.display_title,
    'new_display_title',p_new_display_title));
  insert into public.audit_logs(user_id,action,target_type,target_id,details)
  values(v_actor,'staff.rank.changed','staff',p_target_user::text,
    jsonb_build_object('old_rank',v_target.rank,'new_rank',p_new_rank,
      'old_department',v_target.department,'new_department',v_department));
end;
$function$;

create or replace function public.admin_deactivate_staff(p_target_user uuid,p_reason text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $function$
declare v_actor uuid := auth.uid(); v_target public.staff_assignments%rowtype; v_actor_rank text;
begin
  if v_actor is null then raise exception 'unauthorized'; end if;
  if p_target_user is null or p_target_user=v_actor then raise exception 'cannot_deactivate_self'; end if;
  if nullif(trim(p_reason),'') is null then raise exception 'reason_required'; end if;
  select * into v_target from public.staff_assignments where user_id=p_target_user and active=true for update;
  if not found then raise exception 'active_staff_not_found'; end if;
  if v_target.rank='owner' or exists(select 1 from public.user_roles where user_id=p_target_user and role::text='super_admin') then
    raise exception 'protected_staff_account';
  end if;
  if not public.is_super_admin(v_actor) then
    if not public.admin_can_manage_staff(p_target_user) then raise exception 'staff_not_managed_by_actor'; end if;
    select rank into v_actor_rank from public.staff_assignments where user_id=v_actor and active=true;
    if public.admin_permission_level(v_target.rank)>=public.admin_permission_level(v_actor_rank) then
      raise exception 'rank_hierarchy_denied';
    end if;
  end if;
  update public.staff_assignments set active=false,assigned_by=v_actor,updated_at=now() where user_id=p_target_user;
  insert into public.staff_activity_log(staff_user_id,actor_user_id,activity,details)
  values(p_target_user,v_actor,'staff_deactivated',jsonb_build_object('previous_rank',v_target.rank,'reason',trim(p_reason)));
  insert into public.audit_logs(user_id,action,target_type,target_id,details)
  values(v_actor,'staff.deactivated','staff',p_target_user::text,
    jsonb_build_object('previous_rank',v_target.rank,'department',v_target.department,'reason',trim(p_reason)));
end;
$function$;

revoke all on function public.admin_permission_level(text) from public, anon;
revoke all on function public.admin_has_permission(text,text,text) from public, anon;
revoke all on function public.admin_can_manage_staff(uuid) from public, anon;
revoke all on function public.admin_assign_staff(uuid,text,text,text,text,text) from public, anon;
revoke all on function public.admin_grant_staff_permission(uuid,text,text,text,timestamptz) from public, anon;
revoke all on function public.admin_revoke_staff_permission(uuid) from public, anon;
revoke all on function public.admin_request_approval(text,uuid,text,text,jsonb) from public, anon;
grant execute on function public.admin_has_permission(text,text,text) to authenticated;
grant execute on function public.admin_can_manage_staff(uuid) to authenticated;
grant execute on function public.admin_assign_staff(uuid,text,text,text,text,text) to authenticated;
grant execute on function public.admin_grant_staff_permission(uuid,text,text,text,timestamptz) to authenticated;
grant execute on function public.admin_revoke_staff_permission(uuid) to authenticated;
grant execute on function public.admin_request_approval(text,uuid,text,text,jsonb) to authenticated;


revoke all on function public.admin_create_delegation(uuid,text,text,text,timestamptz) from public, anon;
revoke all on function public.admin_revoke_delegation(uuid) from public, anon;
revoke all on function public.admin_review_approval(uuid,text,text) from public, anon;
grant execute on function public.admin_create_delegation(uuid,text,text,text,timestamptz) to authenticated;
grant execute on function public.admin_revoke_delegation(uuid) to authenticated;
grant execute on function public.admin_review_approval(uuid,text,text) to authenticated;


revoke all on function public.admin_list_managed_staff() from public, anon;
revoke all on function public.admin_change_staff_rank(uuid,text,text,text) from public, anon;
revoke all on function public.admin_deactivate_staff(uuid,text) from public, anon;
grant execute on function public.admin_list_managed_staff() to authenticated;
grant execute on function public.admin_change_staff_rank(uuid,text,text,text) to authenticated;
grant execute on function public.admin_deactivate_staff(uuid,text) to authenticated;

commit;
