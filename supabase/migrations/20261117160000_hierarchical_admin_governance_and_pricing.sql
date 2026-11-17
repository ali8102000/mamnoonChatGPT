-- Mamnoon hierarchical administration, scoped delegation, and pricing governance.
-- Additive migration: preserves existing staff and pricing records.
begin;

alter table public.staff_assignments
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists scope_type text
    check (scope_type in ('global','governorate')),
  add column if not exists scope_governorate text,
  add column if not exists can_manage_pricing boolean not null default false,
  add column if not exists can_review_staff_requests boolean not null default false;

-- Existing rows intentionally keep created_by NULL: assigned_by is mutable
-- (rank changes overwrite it) and is not reliable proof of original creator.
-- NULL scope is fail-closed until an owner explicitly configures it.

create index if not exists staff_assignments_created_by_idx
  on public.staff_assignments(created_by);
create index if not exists staff_assignments_scope_idx
  on public.staff_assignments(scope_type, scope_governorate);

alter table public.staff_assignments
  drop constraint if exists staff_assignments_scope_governorate_check;
alter table public.staff_assignments
  add constraint staff_assignments_scope_governorate_check
  check (
    (scope_type is null and scope_governorate is null)
    or (scope_type = 'global' and scope_governorate is null)
    or
    (scope_type = 'governorate' and scope_governorate in
      ('baghdad','basra','nineveh','erbil','sulaymaniyah','duhok','kirkuk',
       'najaf','karbala','babil','anbar','diyala','saladin','wasit',
       'dhiqar','maysan','muthanna','qadisiyah'))
  );

create table if not exists public.staff_governance_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete restrict,
  target_user_id uuid references auth.users(id) on delete restrict,
  request_type text not null check (request_type in
    ('assign_staff','change_rank','deactivate_staff','change_scope','grant_permission','revoke_permission')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  reviewed_by uuid references auth.users(id) on delete set null,
  review_note text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_governance_review_consistency check (
    (status = 'pending' and reviewed_by is null and reviewed_at is null)
    or (status <> 'pending')
  )
);

create index if not exists staff_governance_requests_status_created_idx
  on public.staff_governance_requests(status, created_at desc);
create index if not exists staff_governance_requests_requester_idx
  on public.staff_governance_requests(requester_id, created_at desc);

create table if not exists public.staff_governance_delegations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  delegate_id uuid not null references auth.users(id) on delete cascade,
  can_review_staff_requests boolean not null default false,
  can_review_pricing_requests boolean not null default false,
  active boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, delegate_id),
  check (owner_id <> delegate_id)
);

create table if not exists public.pricing_change_audit (
  id uuid primary key default gen_random_uuid(),
  pricing_setting_id uuid references public.pricing_settings(id) on delete set null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  governorate_key text,
  before_values jsonb not null default '{}'::jsonb,
  after_values jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.pricing_governance_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete restrict,
  governorate_key text,
  pricing_setting_id uuid references public.pricing_settings(id) on delete set null,
  proposed_values jsonb not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  reviewed_by uuid references auth.users(id) on delete set null,
  review_note text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (governorate_key is null or governorate_key in
    ('baghdad','basra','nineveh','erbil','sulaymaniyah','duhok','kirkuk',
     'najaf','karbala','babil','anbar','diyala','saladin','wasit',
     'dhiqar','maysan','muthanna','qadisiyah'))
);

create index if not exists pricing_governance_requests_status_idx
  on public.pricing_governance_requests(status, created_at desc);

create or replace function public.staff_scope_allows(p_actor uuid, p_governorate text)
returns boolean
language sql stable security invoker
set search_path = public, pg_temp
as $$
  select p_actor = auth.uid() and (public.is_super_admin(auth.uid())
    or exists (
      select 1 from public.staff_assignments a
      where a.user_id = p_actor and a.active = true
        and (a.scope_type = 'global'
          or (a.scope_type = 'governorate' and a.scope_governorate = p_governorate))
    ));
$$;

create or replace function public.staff_can_review_requests(p_actor uuid, p_kind text)
returns boolean
language sql stable security invoker
set search_path = public, pg_temp
as $$
  select p_actor = auth.uid() and (public.is_super_admin(auth.uid())
    or exists (
      select 1 from public.staff_governance_delegations d
      where d.owner_id = 'a06c0102-c5c8-488c-9309-8a320b400df1'::uuid
        and d.delegate_id = p_actor and d.active = true
        and (d.expires_at is null or d.expires_at > now())
        and case p_kind
          when 'staff' then d.can_review_staff_requests
          when 'pricing' then d.can_review_pricing_requests
          else false end
    ));
$$;

alter table public.staff_governance_requests enable row level security;
alter table public.staff_governance_delegations enable row level security;
alter table public.pricing_change_audit enable row level security;
alter table public.pricing_governance_requests enable row level security;

drop policy if exists staff_governance_requests_read on public.staff_governance_requests;
create policy staff_governance_requests_read on public.staff_governance_requests
for select to authenticated
using (
  public.is_super_admin(auth.uid())
  or requester_id = auth.uid()
  or public.staff_can_review_requests(auth.uid(),'staff')
);

drop policy if exists staff_governance_delegations_owner_read on public.staff_governance_delegations;
create policy staff_governance_delegations_owner_read on public.staff_governance_delegations
for select to authenticated
using (owner_id = auth.uid() or delegate_id = auth.uid() or public.is_super_admin(auth.uid()));

drop policy if exists pricing_change_audit_read on public.pricing_change_audit;
create policy pricing_change_audit_read on public.pricing_change_audit
for select to authenticated
using (
  public.is_super_admin(auth.uid())
  or actor_id = auth.uid()
  or (governorate_key is not null and public.staff_scope_allows(auth.uid(),governorate_key))
);

drop policy if exists pricing_governance_requests_read on public.pricing_governance_requests;
create policy pricing_governance_requests_read on public.pricing_governance_requests
for select to authenticated
using (
  public.is_super_admin(auth.uid())
  or requester_id = auth.uid()
  or public.staff_can_review_requests(auth.uid(),'pricing')
);

revoke all on public.staff_governance_requests from anon, authenticated;
revoke all on public.staff_governance_delegations from anon, authenticated;
revoke all on public.pricing_change_audit from anon, authenticated;
revoke all on public.pricing_governance_requests from anon, authenticated;
grant select on public.staff_governance_requests to authenticated;
grant select on public.staff_governance_delegations to authenticated;
grant select on public.pricing_change_audit to authenticated;
grant select on public.pricing_governance_requests to authenticated;

revoke all on function public.staff_scope_allows(uuid,text) from public, anon;
revoke all on function public.staff_can_review_requests(uuid,text) from public, anon;
grant execute on function public.staff_scope_allows(uuid,text) to authenticated;
grant execute on function public.staff_can_review_requests(uuid,text) to authenticated;

commit;
