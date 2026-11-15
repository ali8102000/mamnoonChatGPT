# Mamnoon Android ↔ Web parity audit

Last code snapshot reviewed: `feat/android-parity-rebased` at `a8a9487005530f442b9ab3d4afcb2a737010e7ea` (2026-11-15).
Base branch: `main` at `2fd6c99e942688541c2e55eaf6bab5c1ddf7504f`.
Pull request: [#39](https://github.com/ali8102000/mamnoonChatGPT/pull/39) — open, not merged. All work in this continuation remains on the PR branch; `main` and production data have not been changed.

## Architecture and scope

- Web app: React + TanStack Start, with the admin workspace primarily composed inside `src/routes/admin.tsx` and supporting server functions in `src/lib/admin.functions.ts`.
- Android app: Expo SDK 53 / React Native 0.79.6 with Expo Router. It is a separate native implementation, not a WebView wrapper.
- The repository contains 30 web route modules (excluding the root route layout) and 38 Expo screen modules (excluding `_layout.tsx`). These counts are not one-to-one: several web admin sections are separate native routes.
- A successful typecheck or bundle export proves code compiles; it does not prove the screen is visually or functionally identical on a real device.
- The web design uses Tajawal, blue/amber tokens, glass surfaces, gradients and shadows. Expo now loads Tajawal weights 400/500/700/800/900 and uses native equivalents of the web color tokens. Pixel-perfect comparison is not yet certified.

## Admin parity status

| Web admin capability | Native implementation | Current status / remaining verification |
|---|---|---|
| Overview and statistics | `admin.tsx` | Core dashboard metrics are present; verify values against production data on device. |
| Users | `admin/users.tsx` | Search, list, detail, block and unblock. Server and screen role checks added. |
| Providers | `admin/providers.tsx` | Driver / large-driver / worker filters, verification documents, approve, reject with required reason, and timed/permanent suspension. Requires deployed Edge Function and live notification verification. |
| Requests | `admin/requests.tsx` | List, cancel and reopen; destructive actions remain admin-gated and confirmation-based. |
| Monitoring | `admin/monitoring.tsx` | Live metrics, reports, blocked users and support tickets; refreshes every 15 seconds. |
| Live locations | `admin/live-map.tsx` | Lists provider coordinates and active requests, refreshed every 15 seconds. Like the current web section, this is a location/request list rather than a rendered map-tile view. |
| Friends | `admin/friends.tsx` | Friendship and friend-request lists with confirmed deletion. |
| Notifications | `admin/notifications.tsx` | Broadcast to all users, drivers, workers or one UUID; confirmation appears before sending. |
| Wallet and coupons | `admin/finance.tsx` | Finance workspace added; finance reads are restricted to finance/admin/super-admin, and wallet/user search is admin-gated. |
| Subscriptions | `admin/subscriptions.tsx` | Native subscription workspace exists. Production use depends on the matching Edge Function being deployed and runtime-tested. |
| Staff roles and audit | `admin/governance.tsx` | Role changes are super-admin-only; audit log is read-only and admin-gated. |
| Staff navigation | `admin/staff.tsx` | Role-aware entry point linked from the profile screen. |
| Company name and dashboard tools | `admin.tsx` | Company-name editing, pricing/dashboard tools, support inbox, reports and provider-change review are present; compare all fields and actions with web. |
| Bootstrap and bulk import | `admin/bootstrap.tsx`, `admin/import.tsx` | Intentionally locked on Android; one-time privilege bootstrap and bulk import remain web-only until separately reviewed. |

## Backend and security

- The native admin screens call Supabase Edge Functions; the service-role key is kept server-side and is not bundled into the Android app.
- `admin-users` now contains role-gated actions for user administration, provider review, requests, monitoring, live locations, friends and notification broadcasts.
- `admin-finance` restricts financial reads to the finance/admin/super-admin role set and gates wallet-user search behind admin access.
- `admin-subscriptions` and `admin-governance` remain separate server-side functions.
- Role checks are enforced by the Edge Functions as well as by the native screens. Live locations, provider documents, financial data and moderation controls have explicit role gates.
- The Deno Edge Function check passed on the reviewed code snapshot. These source changes have **not** been deployed to production Supabase. Screens that call new or updated functions will not be production-operational until deployment and live verification are approved.
- No production database data was changed and no production deployment was performed during this continuation.

## Automated validation snapshot

For code snapshot `a8a9487005530f442b9ab3d4afcb2a737010e7ea`:

- Web CI: passed.
- Mobile CI: passed — TypeScript, production-configuration guards, Expo dependency compatibility, Expo Doctor and Android JS export.
- Admin Edge Function Deno check: passed.
- Installable APK: the current run is queued behind an earlier APK build. A previous APK from commit `d1deafd634dbd5d0e08b709b1b130fadc20750ed` succeeded, but it predates the changes listed above and must not be treated as the current build.
- No APK from the reviewed snapshot has yet been installed on a physical Android device.

## Remaining release blockers

1. Wait for the current installable APK build, validate the APK artifact, then install it on a real Android device.
2. Compare the same user role, data state and viewport on web and Android for every route. Capture screenshots and test interactions; do not claim 100% pixel parity before this is done.
3. Test authentication, request creation and lifecycle, chat, RTL, keyboard behavior, GPS/location permission, map rendering, push registration and delivery, provider approval/rejection/suspension, financial screens and staff-role restrictions on a real device.
4. Production SMS/OTP is still deferred; the current deployment checklist says registration relies on email.
5. Qi Card payment integration is not active because production credentials/configuration are not available.
6. Push delivery cannot be certified until a real device registers a push token and receives a test notification.
7. The production AAB/EAS build was previously blocked by the account's EAS build quota until 2026-12-01. The GitHub Actions debug APK workflow builds without consuming EAS build credits.

## Completion rule

“100% parity” is a target, not a current claim. A route is complete only after its content, permissions, data behavior, error/loading states and interactions have been compared on running web and Android apps. Compilation and a successful APK archive alone are insufficient.


## File consolidation review (2026-11-15, branch head `0b07e3e532d42c5ec7ee5edd5069118527be9ca1`)

- The Android route inventory was checked against the web route inventory. The extra native routes are separate admin workspaces and request chat; they are not duplicate route files.
- Privacy and terms screens already share `src/components/legal-page.tsx`; the web-only bootstrap and bulk-import placeholders share `src/components/protected-admin-tool.tsx`. Keep these shared components rather than duplicating their screen markup.
- `src/lib/phone.ts` and `expo-app/src/lib/phone.ts` have identical contents but belong to separate web and Expo app bundles with separate TypeScript/import roots. They were retained to avoid introducing cross-app build coupling.
- Service image files are mirrored between `src/assets` and `expo-app/assets/services` because each app bundle consumes its own local asset set. Migration copies under `docs/manual-setup` are retained as documented manual-setup instructions.
- The default-template `expo-app/assets/icon.png` and `expo-app/assets/splash-icon.png` were byte-identical and neither is referenced by the active Expo config; the configured icon, adaptive icon, splash image and web favicon all use `assets/favicon.png`. The two unused duplicate files are removed.
- No route or feature source file was deleted. The native screens and reusable components are retained.

## Runtime and production dependency review (2026-11-15)

- GitHub Actions on the tested Android source commit passed: web CI run [43687403691](https://github.com/ali8102000/mamnoonChatGPT/actions/runs/43687403691), mobile CI run [43687403650](https://github.com/ali8102000/mamnoonChatGPT/actions/runs/43687403650), admin Deno checks run [43687403695](https://github.com/ali8102000/mamnoonChatGPT/actions/runs/43687403695), and Android APK run [43687403635](https://github.com/ali8102000/mamnoonChatGPT/actions/runs/43687403635). The APK artifact is a debug/test APK, not a Play Store release.
- Production Supabase currently has only `auth-proxy`, `zaincash-callback`, `zaincash-webhook`, and `zaincash-create-payment` active. The native admin workspaces that invoke `admin-users`, `admin-finance`, `admin-subscriptions`, and `admin-governance` are not production-operational until their deployment is separately approved and verified.
- Live database inspection confirms `live_locations` is included in `supabase_realtime`. Its RLS policies and `guard_live_location_ownership` trigger restrict writes to the authenticated customer/provider on an accepted or in-progress request and prevent changing row identity/role. The native request screen currently uses foreground `watchPositionAsync`; background tracking has not been implemented or certified.
- Native push registration creates an Android notification channel, requests permission, obtains an Expo push token, and stores it in `user_push_tokens`. Actual delivery and notification actions remain unverified on a real Android device.
- The production `main` version of `src/routes/api.mobile-maps.ts` does not yet accept `couponCode`, while the PR branch does. Until the PR branch is merged and the web backend deployment contains that route update, the native taxi request's coupon code can be stripped by request validation and not applied to the created request. Do not treat taxi-coupon parity as complete before deployment and a live redemption test.
- The live Supabase migration history includes `weekly_safe_rls_initplan_and_fk_index_20261115` (version `20261115104919`), which is absent from the PR branch migration journal. Its source must be recovered/reconciled before merging migration history; do not guess or recreate its SQL.
- The Google Maps key is required by the EAS production environment validator and is injected into Android native config. This proves key presence/configuration only; Google Maps tiles, Places autocomplete, reverse geocoding, and Directions still require live runtime testing.
- No physical-device or EAS simulator test was performed in this review. Authentication, request lifecycle, chat, live location updates, push delivery, payment handoff, and admin actions still need end-to-end device verification. Do not claim 100% parity based on CI or APK creation alone.

## Route inventory and admin parity review (2026-11-15, follow-up)

- Static route inventory: the web app has 31 route modules under `src/routes`; Expo has 39 route modules under `expo-app/app`. The additional Expo routes are mainly native admin sub-screens and request chat. The root route and the web catch-all redirect are handled differently by Expo Router and still need navigation testing.
- The web admin CSV import screen (`src/routes/admin_.import.tsx`) offers CSV parsing and AI-assisted column mapping without automatically importing records. Its native counterpart (`expo-app/app/admin/import.tsx`) is deliberately a protected, disabled screen with an explanation that import is not enabled on Android. This is a confirmed feature gap, even though it avoids risky record mutation.
- Native admin finance, governance, users, subscriptions, providers, requests, notifications, live-map, staff, and friends screens exist. Some call the admin Edge Functions `admin-finance`, `admin-governance`, `admin-users`, and `admin-subscriptions`; only the four previously listed production Edge Functions are currently active. These native screens cannot be certified end-to-end until the missing functions are separately approved for deployment and then tested with role-scoped accounts.
- Latest commit `896eb1e42af0c9a51ad9079deda5984085ce2729`: web CI, mobile CI, and admin Deno checks all passed (runs [43741806326](https://github.com/ali8102000/mamnoonChatGPT/actions/runs/43741806326), [43741806376](https://github.com/ali8102000/mamnoonChatGPT/actions/runs/43741806376), [43741806347](https://github.com/ali8102000/mamnoonChatGPT/actions/runs/43741806347)). The APK workflow [43741806400](https://github.com/ali8102000/mamnoonChatGPT/actions/runs/43741806400) was still running at the time of this audit update.
- The pull request remains open and unmerged. No production Edge Function was deployed, no database migration was applied, and no user/customer/payment data was modified during this follow-up.
