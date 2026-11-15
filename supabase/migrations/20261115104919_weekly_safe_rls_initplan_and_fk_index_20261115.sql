-- Recovered verbatim from the Supabase Postgres statement log for migration
-- 20261115104919 (weekly_safe_rls_initplan_and_fk_index_20261115).
-- This migration is already present in the linked production migration history.
-- It is tracked here for reproducible source control; do not re-apply manually.

CREATE INDEX IF NOT EXISTS idx_payment_transactions_plan_id
ON public.payment_transactions (plan_id);

DO $$
DECLARE
  r record;
  v_using text;
  v_check text;
  v_sql text;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (
        (qual IS NOT NULL
          AND position('auth.uid()' IN replace(qual, '( SELECT auth.uid() AS uid)', '')) > 0)
        OR
        (with_check IS NOT NULL
          AND position('auth.uid()' IN replace(with_check, '( SELECT auth.uid() AS uid)', '')) > 0)
      )
  LOOP
    v_using := CASE WHEN r.qual IS NULL THEN NULL ELSE
      replace(
        replace(r.qual, '( SELECT auth.uid() AS uid)', '__MAMNOON_AUTH_UID_WRAPPED__'),
        'auth.uid()', '( SELECT auth.uid() AS uid)'
      ) END;
    v_check := CASE WHEN r.with_check IS NULL THEN NULL ELSE
      replace(
        replace(r.with_check, '( SELECT auth.uid() AS uid)', '__MAMNOON_AUTH_UID_WRAPPED__'),
        'auth.uid()', '( SELECT auth.uid() AS uid)'
      ) END;

    v_using := replace(v_using, '__MAMNOON_AUTH_UID_WRAPPED__', '( SELECT auth.uid() AS uid)');
    v_check := replace(v_check, '__MAMNOON_AUTH_UID_WRAPPED__', '( SELECT auth.uid() AS uid)');

    v_sql := format('ALTER POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    IF v_using IS NOT NULL THEN
      v_sql := v_sql || format(' USING (%s)', v_using);
    END IF;
    IF v_check IS NOT NULL THEN
      v_sql := v_sql || format(' WITH CHECK (%s)', v_check);
    END IF;
    EXECUTE v_sql;
  END LOOP;
END
$$;
