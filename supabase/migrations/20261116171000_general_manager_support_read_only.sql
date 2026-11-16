-- General managers can inspect complaints and correspondence, but cannot write.
-- Explicitly block INSERT even when a general manager is also assigned to customer
-- service or has a moderation role. Existing table grants already omit UPDATE/DELETE.
drop policy if exists "Users open own support conversation" on public.support_conversations;
create policy "Users open own support conversation"
on public.support_conversations
for insert
to authenticated
with check (
  not exists (
    select 1
    from public.staff_assignments sa
    where sa.user_id = (select auth.uid())
      and sa.active = true
      and sa.rank = 'general_manager'
  )
  and (
    (user_id = (select auth.uid()) and created_by = (select auth.uid()))
    or (
      public.has_chat_moderation_access((select auth.uid()))
      and created_by = (select auth.uid())
    )
  )
);

drop policy if exists "Support participants send messages" on public.support_messages;
create policy "Support participants send messages"
on public.support_messages
for insert
to authenticated
with check (
  not exists (
    select 1
    from public.staff_assignments sa
    where sa.user_id = (select auth.uid())
      and sa.active = true
      and sa.rank = 'general_manager'
  )
  and sender_id = (select auth.uid())
  and exists (
    select 1
    from public.support_conversations c
    where c.id = support_messages.conversation_id
      and (
        c.user_id = (select auth.uid())
        or public.has_chat_moderation_access((select auth.uid()))
      )
      and c.status = 'open'
  )
);

-- Reports/complaints are visible to every active general manager, independent
-- of department. This is SELECT-only; no UPDATE or DELETE grant is added.
drop policy if exists "General managers can view user reports" on public.user_reports;
create policy "General managers can view user reports"
on public.user_reports
for select
to authenticated
using (
  exists (
    select 1
    from public.staff_assignments sa
    where sa.user_id = (select auth.uid())
      and sa.active = true
      and sa.rank = 'general_manager'
  )
);
