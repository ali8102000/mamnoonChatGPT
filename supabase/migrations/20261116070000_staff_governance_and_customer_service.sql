-- Staff governance: independent rank and department axes, least-privilege customer service.
create table if not exists public.staff_assignments (
  user_id uuid primary key references auth.users(id) on delete cascade,
  rank text not null check (rank in ('owner','general_manager','department_manager','supervisor','employee')),
  department text not null check (department in ('executive','customer_service','finance','operations','monitoring')),
  display_title text,
  active boolean not null default true,
  assigned_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.staff_activity_log (
  id uuid primary key default gen_random_uuid(),
  staff_user_id uuid not null references auth.users(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id),
  activity text not null check (activity in ('view_support_message','reply_support_message','rank_changed','department_changed','staff_activated','staff_deactivated')),
  conversation_id uuid references public.support_conversations(id) on delete set null,
  message_id uuid references public.support_messages(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.support_messages
  add column if not exists read_by uuid references auth.users(id);

alter table public.staff_assignments enable row level security;
alter table public.staff_activity_log enable row level security;

drop policy if exists "Staff can read own assignment or super admin" on public.staff_assignments;
create policy "Staff can read own assignment or super admin"
on public.staff_assignments for select to authenticated
using (user_id = (select auth.uid()) or public.is_super_admin((select auth.uid())));

drop policy if exists "Only super admins manage staff assignments" on public.staff_assignments;
create policy "Only super admins manage staff assignments"
on public.staff_assignments for all to authenticated
using (public.is_super_admin((select auth.uid())))
with check (public.is_super_admin((select auth.uid())));

drop policy if exists "Staff activity visible to owner or subject" on public.staff_activity_log;
create policy "Staff activity visible to owner or subject"
on public.staff_activity_log for select to authenticated
using (public.is_super_admin((select auth.uid())) or staff_user_id = (select auth.uid()));

revoke insert, update, delete on public.staff_activity_log from anon, authenticated;
grant select on public.staff_assignments, public.staff_activity_log to authenticated;

create or replace function public.is_customer_service_staff(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff_assignments a
    where a.user_id = p_user_id
      and a.active = true
      and a.department = 'customer_service'
  );
$$;

create or replace function public.has_chat_moderation_access(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null or p_user_id is distinct from auth.uid() then false
    else (
      public.is_customer_service_staff(auth.uid())
      or exists (
        select 1 from public.user_roles
        where user_id = auth.uid()
          and role::text in ('super_admin','admin','support','moderator')
      )
    )
  end;
$$;

create or replace function public.get_staff_roles(p_user_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_roles text[];
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if p_user_id is distinct from auth.uid() and not public.is_super_admin(auth.uid()) then
    raise exception 'forbidden';
  end if;
  select coalesce(array_agg(role::text order by role::text), array[]::text[])
    into v_roles
  from public.user_roles
  where user_id = p_user_id
    and role::text in ('super_admin','admin','support','finance','moderator');
  if public.is_customer_service_staff(p_user_id) then
    v_roles := array_append(v_roles, 'customer_service');
  end if;
  return v_roles;
end;
$$;

create or replace function public.staff_set_rank(
  p_target_user uuid,
  p_new_rank text,
  p_department text,
  p_display_title text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_rank text;
  v_old_department text;
  v_actor_rank text;
  v_old_level integer;
  v_new_level integer;
  v_actor_level integer;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if not public.is_super_admin(auth.uid()) then raise exception 'forbidden'; end if;
  if p_new_rank not in ('owner','general_manager','department_manager','supervisor','employee') then
    raise exception 'invalid_rank';
  end if;
  if p_department not in ('executive','customer_service','finance','operations','monitoring') then
    raise exception 'invalid_department';
  end if;
  if p_target_user = auth.uid() and p_new_rank <> 'owner' then
    raise exception 'cannot_demote_self';
  end if;

  select rank, department into v_old_rank, v_old_department
  from public.staff_assignments where user_id = p_target_user;

  insert into public.staff_assignments(user_id, rank, department, display_title, active, assigned_by, updated_at)
  values (p_target_user, p_new_rank, p_department, nullif(trim(p_display_title), ''), true, auth.uid(), now())
  on conflict (user_id) do update
    set rank = excluded.rank,
        department = excluded.department,
        display_title = excluded.display_title,
        active = true,
        assigned_by = auth.uid(),
        updated_at = now();

  insert into public.staff_activity_log(staff_user_id, actor_user_id, activity, details)
  values (
    p_target_user, auth.uid(),
    case when v_old_rank is distinct from p_new_rank then 'rank_changed'
         when v_old_department is distinct from p_department then 'department_changed'
         else 'staff_activated' end,
    jsonb_build_object('old_rank',v_old_rank,'new_rank',p_new_rank,'old_department',v_old_department,'new_department',p_department,'display_title',p_display_title)
  );
end;
$$;

create or replace function public.staff_log_support_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if public.is_customer_service_staff(new.sender_id) then
      insert into public.staff_activity_log(staff_user_id, actor_user_id, activity, conversation_id, message_id)
      values (new.sender_id, new.sender_id, 'reply_support_message', new.conversation_id, new.id);
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' and old.read_at is null and new.read_at is not null
     and public.is_customer_service_staff(auth.uid()) then
    new.read_by := auth.uid();
    insert into public.staff_activity_log(staff_user_id, actor_user_id, activity, conversation_id, message_id)
    values (auth.uid(), auth.uid(), 'view_support_message', new.conversation_id, new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists staff_log_support_activity on public.support_messages;
create trigger staff_log_support_activity
before insert or update of read_at on public.support_messages
for each row execute function public.staff_log_support_activity();

-- Keep read receipts attributable to the actual staff account.
create or replace function public.guard_support_message_read_receipt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if new.id is distinct from old.id
     or new.conversation_id is distinct from old.conversation_id
     or new.sender_id is distinct from old.sender_id
     or new.body is distinct from old.body
     or new.created_at is distinct from old.created_at then
    raise exception 'support_message_content_is_immutable';
  end if;
  if old.sender_id = auth.uid() then raise exception 'sender_cannot_mark_own_support_message_read'; end if;
  if not exists (
    select 1 from public.support_conversations c
    where c.id = old.conversation_id
      and (c.user_id = auth.uid() or public.has_chat_moderation_access(auth.uid()))
  ) then raise exception 'forbidden'; end if;
  if old.read_at is not null then
    if new.read_at is distinct from old.read_at or new.read_by is distinct from old.read_by then
      raise exception 'support_message_already_marked_read';
    end if;
    return new;
  end if;
  if new.read_at is null then raise exception 'support_message_read_at_required'; end if;
  new.read_at := now();
  new.read_by := auth.uid();
  return new;
end;
$$;

revoke all on function public.is_customer_service_staff(uuid) from public, anon;
revoke all on function public.staff_set_rank(uuid,text,text,text) from public, anon;
grant execute on function public.is_customer_service_staff(uuid) to authenticated;
grant execute on function public.staff_set_rank(uuid,text,text,text) to authenticated;

-- Allow dedicated customer-service accounts into the staff shell, without granting any other module.
create or replace function public.has_staff_role(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null or p_user_id is distinct from auth.uid() then false
    else (
      public.is_customer_service_staff(auth.uid())
      or exists (
        select 1 from public.user_roles
        where user_id = auth.uid()
          and role::text in ('super_admin','admin','support','finance','moderator')
      )
    )
  end;
$$;
revoke all on function public.has_staff_role(uuid) from public, anon;
grant execute on function public.has_staff_role(uuid) to authenticated;
