# Multi-provider service staffing

## Behavior

- `service_requests.workers_count` is the total number of people requested, including the lead specialist.
- Each provider chooses the total size of their team (provider included) before accepting an offer.
- The database snapshots that team size in `service_request_providers`; later profile edits do not change an accepted request.
- A request remains in `searching` while the accepted headcount is below the target.
- The first accepted provider remains the legacy `service_requests.provider_id` lead; all accepted providers are members of the request's shared chat and can see the customer and other accepted team profiles.
- Web and Android inbox/history queries include team membership, not just the legacy lead provider id.
- Acceptance is serialized by request row lock plus provider advisory lock. The final accepted team size is clamped to the remaining headcount.
- Reaching the target automatically changes the request to `accepted`, removes the dispatch queue, and cancels outstanding offers.
- The customer may stop a partial search with `stop_service_request_acceptance`. The current accepted team is retained and the request moves to `accepted`.
- If an accepted provider withdraws before arrival, their membership and offer are removed. If the remaining headcount is short, dispatch resumes.
- Multi-person requests repeat dispatch cycles until staffed or explicitly stopped by the customer. Single-person requests keep their previous six-stage timeout.
- Provider offer expiry and the customer-facing initial search timer scale linearly with the requested headcount (60 seconds and 360 seconds per requested person respectively).

## Compatibility and security

- Taxi dispatch and taxi offer timing are unchanged.
- Existing active service assignments are backfilled as a single legacy team covering their already-committed headcount.
- The membership table is read-only to authenticated clients; writes occur through security-definer RPCs.
- RLS grants membership visibility to the customer, current accepted providers, operations, and providers with a live offer.
- Request chat and messages are visible to the customer and current accepted service providers; taxi chat retains its existing provider access.

## Required staging acceptance tests

1. Target 3; provider A selects team size 3: request becomes accepted, accepted count is 3, all other pending offers are cancelled.
2. Target 3; provider A selects 2: request remains searching, UI and provider offer details show 2 confirmed / 1 remaining. Provider B selects 1: request becomes accepted.
3. Target 4; provider A selects 3 and provider B selects 2: B is counted as only the remaining 1; accepted count never exceeds 4.
4. Target 4; after A accepts 2, customer selects “اكتفيت بالعدد”: request becomes accepted with 2 confirmed / 2 remaining, dispatch queue is removed, and outstanding offers are cancelled.
5. Two providers accept concurrently: accepted headcount never exceeds the target and each provider appears once.
6. A provider already assigned to a searching/accepted service team cannot accept another active service or taxi request.
7. An accepted provider withdraws before arrival: their team is removed, the customer is notified, and dispatch resumes if the remaining team is short.
8. A provider who withdrew cannot keep accessing the shared service chat; remaining members and customer can.
9. A single-person service request with no acceptance retains its prior six-stage cancellation behavior.
10. Taxi request creation, offer acceptance, chat, arrival, start, completion, and cancellation remain unchanged.

## Deployment note

This migration is intentionally kept in the feature branch. Apply it to a staging Supabase project first, run the acceptance tests above, and only then consider production migration and app deployment.
