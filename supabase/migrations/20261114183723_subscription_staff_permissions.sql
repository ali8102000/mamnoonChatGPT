
CREATE OR REPLACE FUNCTION public.has_subscription_admin_access(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT CASE WHEN auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN false
 ELSE EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role::text IN ('super_admin','admin','finance')) END
$$;
REVOKE ALL ON FUNCTION public.has_subscription_admin_access(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.has_subscription_admin_access(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.get_subscription_stats_v2()
 RETURNS TABLE(total_subscribers bigint, active_subscriptions bigint, expired_subscriptions bigint, monthly_revenue bigint, yearly_revenue bigint, free_count bigint, bronze_count bigint, silver_count bigint, gold_count bigint, trial_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  IF NOT public.has_subscription_admin_access(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  return query
  select
    count(*)::bigint,
    count(*) filter (where us.status='active' and (us.current_period_end is null or us.current_period_end>now()))::bigint,
    count(*) filter (where us.status='expired' or (us.current_period_end is not null and us.current_period_end<=now()))::bigint,
    coalesce((select sum(sp.amount)::bigint from public.subscription_payments sp
      where sp.status='paid' and sp.paid_at>=date_trunc('month',now())),0),
    coalesce((select sum(sp.amount)::bigint from public.subscription_payments sp
      where sp.status='paid' and sp.paid_at>=date_trunc('year',now())),0),
    count(*) filter (where p.code='free')::bigint,
    count(*) filter (where p.code='bronze')::bigint,
    count(*) filter (where p.code='silver')::bigint,
    count(*) filter (where p.code='gold')::bigint,
    count(*) filter (where us.is_trial)::bigint
  from public.user_subscriptions us
  join public.subscription_plans p on p.id=us.plan_id;
end;
$function$;
