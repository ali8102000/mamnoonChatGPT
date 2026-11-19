-- Index foreign-key columns reported by the Supabase Performance Advisor.
-- These indexes improve joins and make parent-row UPDATE/DELETE checks cheaper.
-- CREATE INDEX IF NOT EXISTS keeps the migration safe to re-run.
CREATE INDEX IF NOT EXISTS idx_admin_approval_requests_reviewed_by_fk
  ON public.admin_approval_requests USING btree (reviewed_by);

CREATE INDEX IF NOT EXISTS idx_admin_approval_requests_target_user_id_fk
  ON public.admin_approval_requests USING btree (target_user_id);

CREATE INDEX IF NOT EXISTS idx_admin_staff_delegations_permission_key_fk
  ON public.admin_staff_delegations USING btree (permission_key);

CREATE INDEX IF NOT EXISTS idx_admin_staff_delegations_revoked_by_fk
  ON public.admin_staff_delegations USING btree (revoked_by);

CREATE INDEX IF NOT EXISTS idx_admin_staff_permission_grants_granted_by_fk
  ON public.admin_staff_permission_grants USING btree (granted_by);

CREATE INDEX IF NOT EXISTS idx_admin_staff_permission_grants_permission_key_fk
  ON public.admin_staff_permission_grants USING btree (permission_key);

CREATE INDEX IF NOT EXISTS idx_admin_staff_permission_grants_revoked_by_fk
  ON public.admin_staff_permission_grants USING btree (revoked_by);

CREATE INDEX IF NOT EXISTS idx_app_campaign_option_results_option_id_fk
  ON public.app_campaign_option_results USING btree (option_id);

CREATE INDEX IF NOT EXISTS idx_app_campaign_responses_option_id_fk
  ON public.app_campaign_responses USING btree (option_id);

CREATE INDEX IF NOT EXISTS idx_app_campaign_responses_user_id_fk
  ON public.app_campaign_responses USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_app_campaigns_created_by_fk
  ON public.app_campaigns USING btree (created_by);

CREATE INDEX IF NOT EXISTS idx_app_content_sections_created_by_fk
  ON public.app_content_sections USING btree (created_by);

CREATE INDEX IF NOT EXISTS idx_app_ui_elements_updated_by_fk
  ON public.app_ui_elements USING btree (updated_by);

CREATE INDEX IF NOT EXISTS idx_dispatch_zone_settings_updated_by_fk
  ON public.dispatch_zone_settings USING btree (updated_by);

CREATE INDEX IF NOT EXISTS idx_driver_performance_tier_rules_updated_by_fk
  ON public.driver_performance_tier_rules USING btree (updated_by);

CREATE INDEX IF NOT EXISTS idx_staff_activity_log_actor_user_id_fk
  ON public.staff_activity_log USING btree (actor_user_id);

CREATE INDEX IF NOT EXISTS idx_staff_activity_log_conversation_id_fk
  ON public.staff_activity_log USING btree (conversation_id);

CREATE INDEX IF NOT EXISTS idx_staff_activity_log_message_id_fk
  ON public.staff_activity_log USING btree (message_id);

CREATE INDEX IF NOT EXISTS idx_staff_activity_log_staff_user_id_fk
  ON public.staff_activity_log USING btree (staff_user_id);

CREATE INDEX IF NOT EXISTS idx_staff_assignments_assigned_by_fk
  ON public.staff_assignments USING btree (assigned_by);

CREATE INDEX IF NOT EXISTS idx_support_messages_read_by_fk
  ON public.support_messages USING btree (read_by);

-- Evaluate auth.uid() once per statement instead of once per row in RLS.
-- Predicates and role checks are otherwise unchanged.
ALTER POLICY "Providers insert own presence"
  ON public.provider_presence
  WITH CHECK (
    (select auth.uid()) = user_id
    AND (
      has_role((select auth.uid()), 'driver'::app_role)
      OR has_role((select auth.uid()), 'large_driver'::app_role)
      OR has_role((select auth.uid()), 'worker'::app_role)
    )
  );

ALTER POLICY "Providers update own presence"
  ON public.provider_presence
  USING (
    (select auth.uid()) = user_id
    AND (
      has_role((select auth.uid()), 'driver'::app_role)
      OR has_role((select auth.uid()), 'large_driver'::app_role)
      OR has_role((select auth.uid()), 'worker'::app_role)
    )
  )
  WITH CHECK (
    (select auth.uid()) = user_id
    AND (
      has_role((select auth.uid()), 'driver'::app_role)
      OR has_role((select auth.uid()), 'large_driver'::app_role)
      OR has_role((select auth.uid()), 'worker'::app_role)
    )
  );

ALTER POLICY "Admins manage regional controls"
  ON public.regional_service_controls
  USING (has_admin_access((select auth.uid())))
  WITH CHECK (has_admin_access((select auth.uid())));
