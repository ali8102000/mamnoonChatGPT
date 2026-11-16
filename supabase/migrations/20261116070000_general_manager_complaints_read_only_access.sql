create policy "General managers can view support conversations for complaints"
on public.support_conversations
for select
to authenticated
using (
  exists (
    select 1
    from public.staff_assignments sa
    where sa.user_id = (select auth.uid())
      and sa.rank = 'general_manager'
      and sa.active = true
  )
);

create policy "General managers can view support messages for complaints"
on public.support_messages
for select
to authenticated
using (
  exists (
    select 1
    from public.support_conversations c
    where c.id = support_messages.conversation_id
  )
  and exists (
    select 1
    from public.staff_assignments sa
    where sa.user_id = (select auth.uid())
      and sa.rank = 'general_manager'
      and sa.active = true
  )
);