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

commit;
