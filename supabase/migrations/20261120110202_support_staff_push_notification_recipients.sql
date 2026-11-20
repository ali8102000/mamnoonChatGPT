create or replace function public.notify_support_message()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid;
  v_sender_name text;
  v_staff record;
begin
  select user_id into v_user_id
  from public.support_conversations
  where id = new.conversation_id;

  if new.is_ai then
    return new;
  end if;

  select full_name into v_sender_name
  from public.profiles
  where id = new.sender_id;

  if new.sender_id = v_user_id then
    -- Match the support inbox authorization rules so every eligible staff
    -- member can receive the same database and push notification.
    for v_staff in
      select eligible.user_id
      from (
        select ur.user_id
        from public.user_roles ur
        where ur.role::text in ('super_admin', 'admin', 'support', 'moderator')
        union
        select sa.user_id
        from public.staff_assignments sa
        where sa.active = true
          and (sa.department = 'customer_service' or sa.rank = 'general_manager')
      ) as eligible
    loop
      insert into public.notifications(user_id, type, title, body, link, data)
      values (
        v_staff.user_id,
        'support_message',
        'رسالة جديدة إلى إدارة ممنون',
        coalesce(v_sender_name, 'مستخدم') || ' أرسل رسالة إلى الدعم',
        '/admin',
        jsonb_build_object('conversation_id', new.conversation_id)
      );
    end loop;
  else
    insert into public.notifications(user_id, type, title, body, link, data)
    values (
      v_user_id,
      'support_message',
      'رد جديد من إدارة ممنون',
      'وصلتك رسالة جديدة من فريق شركة ممنون',
      '/messages',
      jsonb_build_object('conversation_id', new.conversation_id)
    );
  end if;

  return new;
end;
$function$;
