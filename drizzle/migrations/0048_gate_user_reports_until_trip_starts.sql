-- Reports are allowed only after the request has moved to in_progress.
DROP POLICY IF EXISTS "Users file reports" ON public.user_reports;
DROP POLICY IF EXISTS "Users file reports after trip starts" ON public.user_reports;
CREATE POLICY "Users file reports after trip starts"
ON public.user_reports
FOR INSERT
TO authenticated
WITH CHECK (
  reporter_id = (SELECT auth.uid())
  AND status = 'pending'
  AND resolved_by IS NULL
  AND request_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.service_requests AS request
    WHERE request.id = user_reports.request_id
      AND request.status = 'in_progress'
      AND (
        (request.customer_id = (SELECT auth.uid()) AND request.provider_id = user_reports.reported_id)
        OR
        (request.provider_id = (SELECT auth.uid()) AND request.customer_id = user_reports.reported_id)
      )
  )
);
