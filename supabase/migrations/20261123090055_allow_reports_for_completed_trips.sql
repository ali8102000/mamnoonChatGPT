-- Allow either participant to report the other while a trip is active or after it is completed.
-- The request must still be the exact request linked to the report.
drop policy if exists "Users file reports after trip starts" on public.user_reports;

create policy "Users file reports during or after trip"
on public.user_reports
for insert
to authenticated
with check (
  reporter_id = (select auth.uid())
  and status = 'pending'
  and resolved_by is null
  and request_id is not null
  and exists (
    select 1
    from public.service_requests as request
    where request.id = user_reports.request_id
      and request.status in (
        'in_progress'::public.request_status,
        'completed'::public.request_status
      )
      and (
        (request.customer_id = (select auth.uid()) and request.provider_id = user_reports.reported_id)
        or
        (request.provider_id = (select auth.uid()) and request.customer_id = user_reports.reported_id)
        or
        (
          request.customer_id = user_reports.reported_id
          and exists (
            select 1
            from public.service_request_providers as team_member
            where team_member.request_id = request.id
              and team_member.provider_id = (select auth.uid())
          )
        )
      )
  )
);

comment on policy "Users file reports during or after trip" on public.user_reports
is 'Allows a trip participant to file a pending report about the other participant only for the linked active or completed trip.';
