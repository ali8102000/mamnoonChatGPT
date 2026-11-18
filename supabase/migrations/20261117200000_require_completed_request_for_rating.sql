-- A rating is valid only after the related trip/service request is completed.
-- The UI already hides rating submission until completion; enforce the same rule
-- at the database boundary so direct API calls cannot rate in-progress requests.
DROP POLICY IF EXISTS "Participant rates counterparty" ON public.ratings;

CREATE POLICY "Participant rates completed counterparty"
ON public.ratings
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = rater_id
  AND EXISTS (
    SELECT 1
    FROM public.service_requests r
    WHERE r.id = ratings.request_id
      AND r.status = 'completed'
      AND (
        (r.customer_id = auth.uid() AND r.provider_id = ratings.ratee_id)
        OR
        (r.provider_id = auth.uid() AND r.customer_id = ratings.ratee_id)
      )
  )
);
