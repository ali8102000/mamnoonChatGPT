# Mamnoon Admin Control Center — Architecture & Gap Audit

Audit date: 2026-11-17
Repository: `ali8102000/mamnoonChatGPT`
Supabase project: `enteiolvirenbhkyskgb`
Working branch: `feat/hierarchical-admin-governance-pricing`

## Goal

Build one real, auditable administration control center for the whole Mamnoon platform. The owner has ultimate authority; delegated staff receive explicit, scoped permissions. UI visibility is never authorization: every write and sensitive read must be enforced by server-side RPC/Edge Function plus RLS.

## Current database inventory (verified)

The current public schema already contains domain tables. Do not create parallel copies of these entities:

- Identity & roles: `profiles`, `user_roles`, `staff_assignments`, `staff_activity_log`, `audit_logs`.
- Provider operations: `driver_profiles`, `worker_profiles`, `provider_verifications`, `provider_presence`, `provider_vehicle_public`, `worker_services`, `services`, `vehicle_models`.
- Orders & dispatch: `service_requests`, `request_offers`, `taxi_dispatch_queue`, `service_dispatch_queue`, `live_locations`.
- Pricing: `pricing_settings`, `pricing_rules`, `taxi_pricing_controls`, `regional_service_controls`.
- Discounts: `coupons`, `coupon_assignments`, `coupon_redemptions`, `coupon_subsidy_ledger`.
- Wallet & payments: `driver_wallets`, `transactions`, `payment_transactions`, `subscription_payments`.
- Subscriptions: `subscription_plans`, `subscription_settings`, `user_subscriptions`.
- Support & trust: `support_tickets`, `support_ticket_messages`, `support_conversations`, `support_messages`, `user_reports`, `user_blocks`, `ratings`.
- Communications: `notifications`, `user_push_tokens`, `push_delivery_outbox`.
- Company/config: `company_settings`.

All of the above are already in the live schema. Several have existing RLS and production functions. Their policies and write paths must be audited before granting administration access.

## Critical architecture decisions

1. Keep `profiles` as the single customer/provider identity record. Provider-specific attributes remain in `driver_profiles` and `worker_profiles`.
2. Keep `user_roles` for app personas (customer, driver, worker, etc.) and `staff_assignments` for internal staff rank, department, scope, and capabilities. These serve different purposes and must not be merged.
3. Use one permission catalog and staff-role/permission assignments, not a new boolean column for every future feature. Permission keys are stable identifiers (for example `pricing.taxi.edit`, `pricing.peak.edit`, `users.block`, `providers.verify`, `finance.refund`, `staff.assign`, `reports.export`).
4. Model scope separately from permission: global, governorate, and (if required later) service/category. A grant can only narrow the grantor's authority. The backend derives the request governorate from trusted coordinates/server data; never trust a client-supplied governorate for enforcement.
5. Record immutable `created_by` for each staff assignment. Do not backfill it from `assigned_by`: existing code changes `assigned_by` during rank changes, so it is not reliable proof of the original creator. Legacy records with unknown creator must remain unmanageable by delegated staff until owner resolves them.
6. Every admin write is atomic with its audit event. Audit rows are append-only and record actor, target, action, scope, before/after values, reason, request ID, timestamp, and correlation ID. Sensitive actions can additionally create an approval request.
7. Separate configuration (current effective value) from history (immutable revisions) and approvals (proposed change waiting for reviewer). Do not store multiple competing active sources of truth.
8. Use server-side RPCs/Edge Functions for writes. Never allow direct browser/mobile table upserts for pricing, roles, staff permissions, wallet balances, refunds, or account status.
9. Use soft deactivation for operational records; preserve financial and order history. Hard deletion is restricted to legally required/privacy workflows and must not cascade away accounting evidence.
10. Owner recovery and emergency access must be independent of ordinary staff delegation. Protect owner identity from modification/deactivation and require strong authentication for destructive or financial operations.

## Proposed control-center navigation

### A. Overview
Live counters, orders, active drivers/workers, pending reviews, gross/net revenue, incidents, service health, queue latency, failed payments, and changes requiring owner attention. Metrics must be derived from source tables/views, not manually duplicated counters.

### B. Staff, roles & delegation
- Staff directory, rank/department, employment status, immutable creator, supervisor, governorate scope.
- Permission catalog and per-staff grants.
- Owner delegation with explicit permissions, scope, expiry, revocation and approval authority.
- Staff requests: assignment, rank change, permission grant/revoke, scope change, deactivation.
- "Only people I personally added" enforced by immutable creator relationship in the database.
- Every action logged; sensitive changes may require owner/delegate approval.
- Delegates cannot approve their own requests or grant permissions they do not hold.

### C. Pricing & promotions
- Taxi tariff matrix: base fare, per-km, per-minute, minimum, intercity and vehicle category.
- Existing category tiers and nearest-250 IQD rounding remain governed by the approved product rules.
- Peak pricing by governorate, urgency limits, effective dates/windows, activation switch.
- Separate service pricing for Kia cargo/passenger, buses, and home services; do not accidentally apply ordinary taxi multipliers to these.
- Commission and provider payout rules.
- Coupons, targeted assignments, redemption limits, budgets/subsidy ledger, campaign dates, eligibility and stacking rules.
- Preview/simulation before publish; versioned revisions and rollback.
- All live quote/create flows must read the same server-authoritative active pricing version.

**Existing-source conflict to resolve:** `pricing_settings` is read by `auto-taxi-pricing`; `taxi_pricing_controls` supplies urgency/peak. `pricing_rules` and `vehicle_models` also contain fare-like columns. Before changing schema, search all web/native/Edge Function consumers and classify those columns as active source, legacy compatibility, or display-only. Do not delete or migrate data until every consumer is accounted for. The new per-km admin screen must write through a server-authoritative audited operation, not direct client upsert.

### D. Customers & trust
Search and view user profile, role/persona, governorate, history, reports, ratings, blocks, privacy/export requests, support history, and controlled account restrictions. Sensitive PII and verification documents are separately permissioned and access-logged.

### E. Providers & fleet
Drivers, workers, large vehicles, buses, Kias, vehicle records, service qualifications, verification queues, availability, suspensions, service areas, documents, and performance. Distinguish profile status from auth account status.

### F. Orders & dispatch
Taxi/service orders, manual assignment, retry/dispatch queues, cancellation/reopen/refund workflows, live map, route/price snapshots, disputes and SLA monitoring. Any manual override records a reason and actor.

### G. Finance
Wallet ledger, provider earnings, commissions, payment gateway events, settlement batches, refunds, coupon subsidy liabilities, subscription payments, reconciliation and exports. Financial entries are append-only ledger movements; never edit balances directly.

### H. Subscriptions
Plans, feature entitlements, regional/provider limits, trials, renewals, pauses, payment state, and entitlement history. Keep `subscription_plans`, `subscription_settings`, and `user_subscriptions` as the existing core until consumers are audited.

### I. Support & moderation
Tickets, conversations, messages, reports, appeals, response templates, escalation and service-level timers. Staff access is department- and case-scoped.

### J. Communications & content
Push campaigns, governorate-targeted notices, in-app banners, templates, audience segments, delivery status, retries, opt-outs and campaign audit. Use the existing notifications and push outbox rather than another generic notification table.

### K. Platform configuration
Company profile, service availability by governorate, feature flags, app maintenance mode, minimum supported app versions, supported service categories, map/routing configuration status, and non-secret operational settings. Secrets stay in server environment/secret storage, never in public settings tables.

### L. Reports & audit
Filterable audit trail, staff activity, financial audit, pricing history, approval history, access-denied events, export jobs, and scheduled operational reports. Audit data is append-only and export permission is separate from read permission.

## Canonical table strategy (target, subject to consumer audit)

### Governance
- `admin_permission_catalog`: one row per permission key, domain, risk level, description.
- `admin_staff_permission_grants`: staff user, permission, scope type, governorate (nullable only for global), granted_by, immutable created_at, active/revoked_at.
- `admin_staff_delegations`: delegator, delegate, exact permission subset, scope, expiry, revoked_at.
- `admin_approval_requests`: unified approval queue with request type, requester, target, payload, scope, status, reviewer, decision reason and timestamps.
- Keep `staff_assignments` as the authoritative staff identity/rank/department record; add only essential immutable creator/supervisor/scope fields after legacy migration rules are proven.
- Keep `staff_activity_log` for staff workflow events and extend/use `audit_logs` for platform-wide administration audit, or deliberately consolidate after consumer audit; do not create a third overlapping audit log.

### Configuration & pricing
- One canonical versioned tariff/configuration model with effective_from/effective_to, scope, service/category and values.
- Keep the current `pricing_settings` interface compatible until all Edge Function and app readers are migrated.
- Keep peak/urgency controls as a separate modifier domain if their semantics remain distinct; connect them to the same version/audit/publish mechanism.
- `pricing_change_audit` may be unnecessary if the platform-wide append-only audit schema can record before/after and pricing version references. Decide only after auditing `audit_logs` and existing pricing history.

### Promotions
- Keep `coupons`, `coupon_assignments`, `coupon_redemptions`, and `coupon_subsidy_ledger`. Add campaign/budget tables only if current coupons cannot represent the required campaign lifecycle. Coupon redemption and subsidy settlement must remain transactionally linked.

### Platform settings
- A typed setting registry/value table is suitable for non-secret feature switches and operational settings. Do not replace strongly typed domain tables (pricing, subscription, regional controls) with arbitrary JSON key/value blobs.

## Confirmed gaps before this work

- Staff scope, creator-bound management, permission delegation, and approval flow are not fully implemented end-to-end. The existing branch migration is only a schema foundation and is not deployed.
- Existing `staff_set_rank`, `staff_promote_one_level`, and `staff_deactivate` paths require a complete authorization review against creator, scope, hierarchy, and audit rules.
- Current web navigation is a fixed list of sections and fixed role arrays. It is not yet a permission-catalog-driven control center.
- The taxi peak/urgency component directly upserts `taxi_pricing_controls` from the client. Replace this with an authenticated server write that enforces scope and records an audit event.
- Current taxi fare reader uses `pricing_settings` and `taxi_pricing_controls`; the fare-like fields in `pricing_rules` and `vehicle_models` are potential competing sources that need a consumer audit.
- Existing coupon tables already support codes, assignments, redemptions and subsidy accounting, but the admin UI and backend need a capability audit for budgets, audience, service restrictions, expiry windows, stacking and approvals.
- Existing admin sections cover overview, users, providers, requests, chat, friends, reports, subscriptions, coupons, wallet, statistics, map, notifications, regions, roles, staff, company settings and audit. Missing/underdeveloped areas include centralized pricing, feature flags/app health, finance reconciliation, approval inbox, permission matrix, scoped audit, and operational analytics.
- Native Android admin parity must be verified separately; web admin UI is not proof of native parity.

## Delivery phases

1. **Read-only inventory & dependency map** — enumerate tables, RLS, policies, functions, Edge Function reads/writes, web/native admin sections, and identify duplicate/legacy columns.
2. **Governance foundation** — permission catalog, grants, immutable creator, scope, delegations, unified approval workflow, append-only audit, RLS tests.
3. **Pricing & promotion control** — one audited server write path, tariff preview/versioning, peak/urgency, coupons/campaigns and rollback.
4. **Operational domains** — customers/providers/orders/support/notifications/regions, with granular permissions and action logs.
5. **Finance & reporting** — ledger-safe adjustment/refund/settlement, reconciliation, exports and reports.
6. **Web + native parity** — shared permission definitions, same capabilities and labels, UI tests for every action.
7. **Security and release gates** — positive and negative tests for owner, global manager, regional manager, delegated reviewer, unrelated staff, and ordinary user; RLS advisors; migration rollback tests; Edge Function tests; web build; Android typecheck/export and device interaction checks.

## Release safety

- No production migration, RLS change, role grant, wallet change, refund, or destructive operation until its migration and negative authorization tests pass and the owner explicitly approves the production change.
- A green UI build is not proof of secure backend enforcement.
- Do not claim full admin control or web/native parity until each domain's read/write paths and negative authorization cases have been tested.


## Implemented on the working branch (not deployed)

The governance migration now includes the first server-side RPC layer:

- admin_has_permission intersects explicit permission grants/delegations with the caller's active staff assignment scope.
- admin_assign_staff creates a staff assignment with immutable created_by, rank ceiling, department and governorate-scope checks.
- admin_grant_staff_permission / admin_revoke_staff_permission manage explicit permission grants and audit each change.
- admin_create_delegation / admin_revoke_delegation create revocable, expiring, permission-by-permission delegations.
- admin_list_managed_staff, admin_change_staff_rank, and admin_deactivate_staff implement creator-bound staff visibility and management with hierarchy checks.
- admin_request_approval and admin_review_approval provide a unified, permission-checked, no-self-approval review queue. Approval currently records a decision; it does not automatically apply the requested business operation.

Verification so far: the full migration (including its functions, policies, grants and indexes) executed successfully inside a database transaction and was rolled back. A follow-up query confirmed that no new tables, columns or RPCs were left in production. This is a SQL syntax/DDL transaction test only, not a live authorization matrix test.

Still not implemented: permission-aware admin navigation and screens, pricing write RPC/Edge Function integration, coupons/campaign controls, and native Android parity. Existing legacy staff RPCs and the direct client upsert in the taxi peak/urgency screen still need to be retired or routed through these controls before release. Do not apply this migration to production yet.