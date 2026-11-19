-- Gemini-assisted customer support replies with safe human handoff and idempotency.
begin;

alter table public.support_messages
  add column if not exists is_ai boolean not null default false,
  add column if not exists ai_reply_to uuid references public.support_messages(id) on delete set null;

create unique index if not exists support_messages_one_ai_reply_per_customer_message
  on public.support_messages(ai_reply_to)
  where ai_reply_to is not null;

alter table public.support_conversations
  add column if not exists ai_status text not null default 'active'
    check (ai_status in ('active', 'ai_answered', 'waiting_human')),
  add column if not exists ticket_status text not null default 'new'
    check (ticket_status in ('new', 'in_progress', 'resolved'));

-- AI replies are informational only. They must not generate a second staff alert
-- as though the customer had sent another message.
create or replace function public.notify_support_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid;
  v_sender_name text;
  v_staff record;
begin
  select user_id into v_user_id
  from public.support_conversations where id = new.conversation_id;

  if new.is_ai then
    return new;
  end if;

  select full_name into v_sender_name
  from public.profiles where id = new.sender_id;

  if new.sender_id = v_user_id then
    for v_staff in
      select distinct user_id from public.user_roles
      where role in ('super_admin', 'admin', 'support')
    loop
      insert into public.notifications(user_id, type, title, body, link, data)
      values (
        v_staff.user_id, 'support_message', 'رسالة جديدة إلى إدارة ممنون',
        coalesce(v_sender_name, 'مستخدم') || ' أرسل رسالة إلى الدعم',
        '/admin', jsonb_build_object('conversation_id', new.conversation_id)
      );
    end loop;
  else
    insert into public.notifications(user_id, type, title, body, link, data)
    values (
      v_user_id, 'support_message', 'رد جديد من إدارة ممنون',
      'وصلتك رسالة جديدة من فريق شركة ممنون',
      '/messages', jsonb_build_object('conversation_id', new.conversation_id)
    );
  end if;
  return new;
end;
$$;
revoke execute on function public.notify_support_message() from public, anon, authenticated;

commit;
