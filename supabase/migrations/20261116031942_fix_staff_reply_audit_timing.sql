drop trigger if exists staff_log_support_activity on public.support_messages;
drop trigger if exists staff_log_support_activity_insert on public.support_messages;
drop trigger if exists staff_log_support_activity_read on public.support_messages;

create trigger staff_log_support_activity_insert
after insert on public.support_messages
for each row execute function public.staff_log_support_activity();

create trigger staff_log_support_activity_read
before update of read_at on public.support_messages
for each row execute function public.staff_log_support_activity();

