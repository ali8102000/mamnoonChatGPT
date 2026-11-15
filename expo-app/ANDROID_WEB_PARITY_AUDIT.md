# Mamnoon Android ↔ Web parity audit

Baseline audited: `main` at commit `2fd6c99e942688541c2e55eaf6bab5c1ddf7504f`. Android app source was built from `93973e65ac9db926424036186f0d16a112ae90e3`; audit documentation was subsequently updated on `feat/android-parity-rebased` at `9f1d0778d9ea1896cabc13d4c0a0ffa1bd124c93`. The debug APK passed archive validation but has not been installed and device-verified.

This is a living migration checklist. A matching route name or a successful TypeScript/build check does **not** establish visual or functional parity. A screen is complete only after comparing the same signed-in role, data state, viewport, and interaction on the running web and Android apps.

## Findings

- Web route inventory: 30 route files under `src/routes/`.
- Current Expo route inventory: 30 route files under `expo-app/app/` (re-counted on 2026-11-15). This corrects the earlier 21-route figure, which was stale. Matching route counts do not prove matching page content or behavior.
- Confirmed implementation gap: web `src/routes/admin.tsx` is about 2,580 lines and exposes 16 management sections (overview, stats, users, providers, requests, chat, friends, reports, subscriptions, coupons, wallet, live map, notifications, roles, company, audit). Expo `expo-app/app/admin.tsx` is a smaller subset of the admin workflows. The Android dashboard now includes total/active driver and worker counts, request-status counts, and commission totals for day/month/year; it also displays a warning when one or more metric queries fail rather than silently implying zero values. This improves overview metrics but does not port the other management sections. The Expo subscription route explicitly says plan and financial grant/edit actions are not enabled; monitoring/subscription views are not equivalent to the full web management surface.
- The native app is a separate React Native implementation, not a WebView of the web app; its screen layouts and styling are independently maintained.
- The web design system uses Tajawal (400/500/700/800/900), CSS OKLCH tokens, glass surfaces, gradients, shadows, and a 112.5% root font scale.
- Expo previously used a green palette (`#174C3C`) that visibly diverged from the web blue/amber palette. The palette has now been moved to sRGB approximations of the web light/dark tokens. This is a first alignment step, not a pixel-perfect certification.
- Android continuation now adds `@expo-google-fonts/tajawal` and loads weights 400/500/700/800/900 before rendering. Device typography comparison is still required.
- Android continuation adds a persisted `system`/`light`/`dark` preference in SecureStore and a live native palette; compare against web persistence and theme tokens on device.

## Route inventory

| Web route | Expo route | Status |
|---|---|---|
| `/` | `index` | Needs live comparison |
| `/welcome` | `welcome` | Added on continuation branch; compare visually |
| `/auth` | `auth` | Needs live comparison |
| `/auth/callback` | `auth/callback` | Needs live comparison |
| `/account-settings` | `account-settings` | Needs live comparison |
| `/select-role` | `select-role` | Needs live comparison |
| `/home` | `home` | Needs live comparison |
| `/request/new` | `request/new` | Needs live comparison |
| `/request/$id` | `request/[id]` | Needs live comparison |
| `/messages` | `messages` | Needs live comparison |
| `/support-chat` | `support-chat` | Needs live comparison |
| `/friends` | `friends` | Needs live comparison |
| `/history` | `history` | Needs live comparison |
| `/profile` | `profile` | Needs live comparison |
| `/admin` | `admin` | Needs live comparison |
| `/admin/monitoring` | `admin/monitoring` | Read-only staff-gated metrics; full moderation actions not ported |
| `/admin/subscriptions` | `admin/subscriptions` | Native management workspace added; backend Edge Function committed but not deployed or runtime-verified |
| `/admin/bootstrap` | `admin/bootstrap` | Intentionally locked on Android; one-time privilege bootstrap stays web-only |
| `/admin/import` | `admin/import` | Intentionally locked on Android; import mutations not ported |
| `/onboarding/driver` | `onboarding/driver` | Needs live comparison |
| `/onboarding/worker` | `onboarding/worker` | Needs live comparison |
| `/forgot-password` | `forgot-password` | Needs live comparison |
| `/reset-password` | `reset-password` | Needs live comparison |
| `/subscriptions` | `subscriptions` | Needs live comparison |
| `/coupons` | `coupons` | Added using `get_my_coupons` RPC; sharing used instead of clipboard |
| `/privacy` | `privacy` | Added legal content; confirm approved policy wording |
| `/terms` | `terms` | Added legal content; Zain Cash only stated |
| `/support` | `support` | Added ticket creation/list/realtime replies; test RLS on device |
| `/request/chat/$id` | `request/chat/[id]` | Needs live comparison |
| `/# Mamnoon Android ↔ Web parity audit

Baseline audited: `main` at commit `2fd6c99e942688541c2e55eaf6bab5c1ddf7504f`. Android app source was built from `93973e65ac9db926424036186f0d16a112ae90e3`; audit documentation was subsequently updated on `feat/android-parity-rebased` at `9f1d0778d9ea1896cabc13d4c0a0ffa1bd124c93`. The debug APK passed archive validation but has not been installed and device-verified.

This is a living migration checklist. A matching route name or a successful TypeScript/build check does **not** establish visual or functional parity. A screen is complete only after comparing the same signed-in role, data state, viewport, and interaction on the running web and Android apps.

## Findings

- Web route inventory: 30 route files under `src/routes/`.
- Current Expo route inventory: 30 route files under `expo-app/app/` (re-counted on 2026-11-15). This corrects the earlier 21-route figure, which was stale. Matching route counts do not prove matching page content or behavior.
- Confirmed implementation gap: web `src/routes/admin.tsx` is about 2,580 lines and exposes 16 management sections (overview, stats, users, providers, requests, chat, friends, reports, subscriptions, coupons, wallet, live map, notifications, roles, company, audit). Expo `expo-app/app/admin.tsx` is about 362 lines and implements only a subset of the admin workflows. The Expo subscription route explicitly says plan and financial grant/edit actions are not enabled; monitoring/subscription views are not equivalent to the full web management surface.
- The native app is a separate React Native implementation, not a WebView of the web app; its screen layouts and styling are independently maintained.
- The web design system uses Tajawal (400/500/700/800/900), CSS OKLCH tokens, glass surfaces, gradients, shadows, and a 112.5% root font scale.
- Expo previously used a green palette (`#174C3C`) that visibly diverged from the web blue/amber palette. The palette has now been moved to sRGB approximations of the web light/dark tokens. This is a first alignment step, not a pixel-perfect certification.
- Android continuation now adds `@expo-google-fonts/tajawal` and loads weights 400/500/700/800/900 before rendering. Device typography comparison is still required.
- Android continuation adds a persisted `system`/`light`/`dark` preference in SecureStore and a live native palette; compare against web persistence and theme tokens on device.

## Route inventory

| Web route | Expo route | Status |
|---|---|---|
| `/` | `index` | Needs live comparison |
| `/welcome` | `welcome` | Added on continuation branch; compare visually |
| `/auth` | `auth` | Needs live comparison |
| `/auth/callback` | `auth/callback` | Needs live comparison |
| `/account-settings` | `account-settings` | Needs live comparison |
| `/select-role` | `select-role` | Needs live comparison |
| `/home` | `home` | Needs live comparison |
| `/request/new` | `request/new` | Needs live comparison |
| `/request/$id` | `request/[id]` | Needs live comparison |
| `/messages` | `messages` | Needs live comparison |
| `/support-chat` | `support-chat` | Needs live comparison |
| `/friends` | `friends` | Needs live comparison |
| `/history` | `history` | Needs live comparison |
| `/profile` | `profile` | Needs live comparison |
| `/admin` | `admin` | Needs live comparison |
| `/admin/monitoring` | `admin/monitoring` | Read-only staff-gated metrics; full moderation actions not ported |
| `/admin/subscriptions` | `admin/subscriptions` | Read-only authorized view; management actions not ported |
| `/admin/bootstrap` | `admin/bootstrap` | Intentionally locked on Android; one-time privilege bootstrap stays web-only |
| `/admin/import` | `admin/import` | Intentionally locked on Android; import mutations not ported |
| `/onboarding/driver` | `onboarding/driver` | Needs live comparison |
| `/onboarding/worker` | `onboarding/worker` | Needs live comparison |
| `/forgot-password` | `forgot-password` | Needs live comparison |
| `/reset-password` | `reset-password` | Needs live comparison |
| `/subscriptions` | `subscriptions` | Needs live comparison |
| `/coupons` | `coupons` | Added using `get_my_coupons` RPC; sharing used instead of clipboard |
| `/privacy` | `privacy` | Added legal content; confirm approved policy wording |
| `/terms` | `terms` | Added legal content; Zain Cash only stated |
| `/support` | `support` | Added ticket creation/list/realtime replies; test RLS on device |
| `/request/chat/$id` | `request/chat/[id]` | Needs live comparison |
 (not found) | — | Missing equivalent |

## Priority implementation plan

### P0 — release blockers
- [x] Android TypeScript check and Expo dependency compatibility check passed on `93973e65ac9db926424036186f0d16a112ae90e3`.
- [ ] Run Expo Doctor and Android export on this exact commit. The Android prebuild/Gradle debug APK compile and APK archive validation passed in workflow run `43672764165`; Expo Doctor and a standalone Android export remain unverified.
- [ ] Run the app on an Android emulator/device and verify launch, auth restore, customer home, provider home, and role switching.
- [ ] Verify customer request creation for technician, expert, taxi, Kia cargo, Kia passenger, and bus against the production-safe test environment.
- [ ] Verify provider offer delivery, acceptance, customer/provider request details, realtime updates, push-notification open actions, and chat.
- [ ] Verify map permission denied/granted flows, automatic GPS pickup, governorate filtering, place search, route calculation, and manual pin selection.
- [ ] Verify subscription/trial restrictions, coupons, wallet, and Zain Cash handoff without initiating real payments.

### P1 — missing route parity
- [x] Add Android coupons screen using `get_my_coupons`; device/RLS verification remains.
- [x] Add Android privacy and terms routes; legal wording approval remains.
- [x] Add Android support tickets, replies, and realtime listener; device/RLS verification remains.
- [x] Add Android welcome route; confirm entry navigation and visual comparison.
- [ ] Complete remaining moderation and subscription parity, including live backend deployment only after explicit owner approval. The Android overview metrics, report moderation actions, user administration screen, and subscription workspace have been added in source; their production runtime behavior still requires authorized deployment/device verification. Bootstrap/import remain deliberately locked on Android because they are one-time or high-impact operations.

### P2 — visual and interaction parity
- [x] Bundle and load Tajawal 400/500/700/800/900 assets in the native bundle; verify weight-to-style mapping and glyph rendering on device.
- [ ] Match web theme persistence and live light/dark switching.
- [ ] Compare every route at the same Android viewport, light/dark mode, and account role; record screenshots and fix spacing, typography, radii, borders, gradients, shadows, icons, and safe-area differences.
- [ ] Verify RTL, keyboard resize, scrolling, back navigation, dialogs, toasts, loading/empty/error states, and accessibility text scaling.
- [ ] Replace remaining one-off native colors/styles with shared tokens only after comparing against their web equivalents.

## Verification evidence

- [x] Android TypeScript, production-configuration guards, Expo dependency compatibility, Expo Doctor, and Android bundle export passed on commit `b5059a20d1a3c52e7e934be6e795a9017ea7875f` (workflow run `43674996644`).
- [x] Deno type-check for the new `admin-subscriptions` Edge Function passed (workflow run `43674996608`).
- [x] Web unit tests, TypeScript, ESLint, and production build passed on commit `b5059a20d1a3c52e7e934be6e795a9017ea7875f` (workflow run `43674996658`).
- [x] Installable debug APK built, validated, and uploaded from commit `b5059a20d1a3c52e7e934be6e795a9017ea7875f` (workflow run `43674996629`; artifact `mamnoon-test-apk`, artifact ID `14146084960`, SHA-256 `79782924566240a0a8130d9290095319aff6f2e3879fab564bb06826d83e409a`, archive size 59,138,836 bytes; expires 2026-11-29).
- [ ] Install the APK on a physical Android device and complete device-level screen and flow tests.
- [ ] Device-level screen and flow tests
- [ ] Screenshot comparison report

Do not mark this audit complete or claim 100% parity until every required route and flow above has evidence from a running Android build. A successful web CI run alone is not Android verification.


## Re-audit note — 2026-11-15

- Route count corrected to 30 web / 30 Expo routes after enumerating the current branch trees.
- A focused code-size/feature inspection confirms that route count overstates parity: the web admin dashboard contains substantially more management logic than the Expo admin screen; Expo subscription management remains explicitly read-only. These are known functional blockers, not cosmetic differences.
- Main request creation screens both contain map/GPS and Supabase request logic, but source inspection alone cannot prove matching request types, validation, pricing, routing, realtime delivery, or successful production behavior. Those require controlled runtime tests.
- Android admin dashboard source was updated in commit `43007859dd611532f87d50adb5c300fcbfcf931f`; only client-side aggregate reads and display were added. No database schema, RLS, production data, payment settings, or secrets were changed. CI/device verification of this latest commit remains pending.


## Build verification update — 2026-11-15

- Latest branch head `f0d71478e0c0dcf91176df1d603420cae8f34c59` passed web CI (run `43672764183`), mobile CI (run `43672764189`), and Android test APK workflow (run `43672764165`).
- Android workflow steps all succeeded: dependency installation, TypeScript check, Expo dependency compatibility, environment access check, native prebuild/Gradle compile, APK validation, and artifact upload.
- Artifact: `mamnoon-test-apk` (ID `14145463192`), SHA-256 `435242399ffc757daae4c467e983779e48c067fd575c320d0246a1ae10a0d103`. This is a debug/test APK, not a Play Store release. Physical-device installation and interaction tests are still pending.
- PR #39 remains open and unmerged. No database schema, RLS, production data, payment settings, or secrets were changed.


## Subscription administration implementation update — 2026-11-15

- Added the native subscription-management screen and authenticated Edge Function bridge in PR #39.
- Edge Function source passed Deno type-check. It has not been deployed to the production Supabase project; subscription admin actions requiring this function are not yet live.
- The new screen and service have passed repository-level type/lint/build checks, but still need live authorization and role testing after deployment approval.
- Physical Android installation, screenshot parity, end-to-end user/provider workflows, real-time delivery, GPS/maps, notifications, and Zain Cash handoff are still pending.


## Admin reports parity update — 2026-11-15

- The Expo admin dashboard now includes report status filters (all/pending/resolved/closed/dismissed), loads up to 100 reports, and provides resolve/close/dismiss actions through the existing caller-authenticated `admin_resolve_report` RPC.
- The RPC definition was inspected in the linked Supabase project: it invokes `assert_staff('staff')`, writes the resolution fields, and records an admin audit event. The Android dashboard itself currently remains super-admin-only, so these actions are not exposed to unverified users.
- Code-level implementation is committed in the current PR head; mobile CI and debug APK validation are running. Live role testing and actual device verification remain pending.


## Native user administration update — 2026-11-15

- Added `expo-app/app/admin/users.tsx` and a dashboard entry for user administration: paginated user list, Arabic/phone/email search, user detail view, role/profile/transaction/request/rating summaries, block duration/reason, and unblock action.
- Added authenticated `supabase/functions/admin-users/index.ts`: staff-gated read operations, admin-gated block/unblock mutations through caller-scoped RPCs, and service-role access confined to the Edge Function runtime.
- Extended the Deno CI check to validate both `admin-subscriptions` and `admin-users` Edge Functions. The Edge Function type-check passed on the source commit before the workflow-only cleanup; the corrected workflow is running again on the current head.
- Neither new Edge Function has been deployed to production. No production data, database schema, RLS, payment configuration, or secrets were modified.
- The new Expo user screen still requires fresh mobile CI and physical-device verification. It is not yet certified as pixel-perfect or end-to-end equivalent to the web screen.


## Continuation update — 2026-11-15 (latest branch work)
- Added the native user administration screen at `expo-app/app/admin/users.tsx`: staff-only listing/search/details; admin-only block/unblock actions with duration and reason.
- Added authenticated `supabase/functions/admin-users/index.ts`; reads are gated by `has_staff_role`, mutations by `has_admin_access`, and mutations call caller-scoped RPCs. Service-role access remains server-side.
- The admin Edge Function workflow now type-checks both `admin-users` and `admin-subscriptions`; the latest run on the branch reported success.
- The latest mobile CI and web CI runs reported success before the most recent two UI/backend follow-up commits. A fresh APK workflow was queued; its completion for the exact latest source must be checked before calling the new APK verified.
- Improved user-detail transparency: the backend now reports when ratings failed to load, and the native detail view shows that warning instead of silently displaying an empty ratings list. Latest code commit: `9bcf35d2a457018b0c666b820eb10898745f16a7`.
- Still outstanding: full provider/request/wallet/coupon/live-map/notification/roles/company/audit parity; production deployment approval for privileged Edge Functions; physical-device testing; screenshot-by-screenshot visual comparison; end-to-end auth, GPS, realtime, notifications, and Zain Cash handoff verification.
- No production database, RLS, user records, payment settings, or secrets were changed. PR #39 remains open and unmerged.

- Latest continuation: `admin-users` now supports a staff-authenticated provider listing action with server-generated 10-minute signed verification-document URLs; `expo-app/app/admin/providers.tsx` presents filters and document review; the dashboard links to it. Commits: `1a7c7051`, `4cab7528`, `3bf51a4a`.
