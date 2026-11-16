# Mamnoon Android ↔ Web Screen Parity Audit

**Snapshot:** 2026-11-16  
**Repository base:** `main` at `a17798afeecc0f79dfecd41cbb942eaeb3b79aa4`

## Audit rule

A matching route or a passing TypeScript/build check is **not** proof of screen parity. Each paired screen must be checked at the same viewport/device density for layout, typography, colors, spacing, icons, imagery, RTL behavior, loading/empty/error states, and then each visible action must be exercised with the correct account role. Do not mark a screen complete until both visual and functional checks have evidence.

## Current automated route coverage

The existing `expo-app/scripts/check-native-route-parity.mjs` declares 28 Android-to-web route pairs. These are route-presence checks and selected source guards only; they do not compare screenshots or prove that every web feature works on Android.

| Android Native route | Web route | Current audit status |
|---|---|---|
| `app/index.tsx` | `src/routes/index.tsx` | Route pair declared; visual/functional comparison pending |
| `app/auth.tsx` | `src/routes/auth.tsx` | Route pair declared; visual/functional comparison pending |
| `app/auth/callback.tsx` | `src/routes/auth.callback.tsx` | Route pair declared; visual/functional comparison pending |
| `app/account-settings.tsx` | `src/routes/account-settings.tsx` | Route pair declared; visual/functional comparison pending |
| `app/select-role.tsx` | `src/routes/select-role.tsx` | Route pair declared; visual/functional comparison pending |
| `app/home.tsx` | `src/routes/home.tsx` | Route pair declared; visual/functional comparison pending |
| `app/request/new.tsx` | `src/routes/request.new.tsx` | Route pair declared; visual/functional comparison pending |
| `app/request/[id].tsx` | `src/routes/request.$id.tsx` | Route pair declared; visual/functional comparison pending |
| `app/messages.tsx` | `src/routes/messages.tsx` | Route pair declared; visual/functional comparison pending |
| `app/support-chat.tsx` | `src/routes/support-chat.tsx` | Route pair declared; visual/functional comparison pending |
| `app/friends.tsx` | `src/routes/friends.tsx` | Route pair declared; visual/functional comparison pending |
| `app/history.tsx` | `src/routes/history.tsx` | Route pair declared; visual/functional comparison pending |
| `app/profile.tsx` | `src/routes/profile.tsx` | Route pair declared; visual/functional comparison pending |
| `app/coupons.tsx` | `src/routes/coupons.tsx` | Route pair declared; visual/functional comparison pending |
| `app/subscriptions.tsx` | `src/routes/subscriptions.tsx` | Route pair declared; visual/functional comparison pending |
| `app/support.tsx` | `src/routes/support.tsx` | Route pair declared; visual/functional comparison pending |
| `app/forgot-password.tsx` | `src/routes/forgot-password.tsx` | Route pair declared; visual/functional comparison pending |
| `app/reset-password.tsx` | `src/routes/reset-password.tsx` | Route pair declared; visual/functional comparison pending |
| `app/privacy.tsx` | `src/routes/privacy.tsx` | Route pair declared; visual/functional comparison pending |
| `app/terms.tsx` | `src/routes/terms.tsx` | Route pair declared; visual/functional comparison pending |
| `app/welcome.tsx` | `src/routes/welcome.tsx` | Route pair declared; visual/functional comparison pending |
| `app/onboarding/driver.tsx` | `src/routes/onboarding.driver.tsx` | Route pair declared; visual/functional comparison pending |
| `app/onboarding/worker.tsx` | `src/routes/onboarding.worker.tsx` | Route pair declared; visual/functional comparison pending |
| `app/admin.tsx` | `src/routes/admin.tsx` | Route pair declared; admin parity audit required |
| `app/admin/bootstrap.tsx` | `src/routes/admin/bootstrap.tsx` | Route pair declared; protected/initial setup parity pending |
| `app/admin/monitoring.tsx` | `src/routes/admin/monitoring.tsx` | Route pair declared; data and permission parity pending |
| `app/admin/subscriptions.tsx` | `src/routes/admin/subscriptions.tsx` | Route pair declared; backend readiness and UI parity pending |
| `app/admin/import.tsx` | `src/routes/admin_.import.tsx` | **Known feature gap:** Android route is deliberately disabled; web CSV analysis is active |

## Additional Native admin routes to reconcile with Web admin sections

Native routes currently present:
- `app/admin/users.tsx`
- `app/admin/providers.tsx`
- `app/admin/requests.tsx`
- `app/admin/finance.tsx`
- `app/admin/governance.tsx`
- `app/admin/friends.tsx`
- `app/admin/live-map.tsx`
- `app/admin/notifications.tsx`
- `app/admin/staff.tsx`
- `app/admin/staff-hierarchy.tsx`

The Web admin shell exposes sections for overview, statistics, users, providers, requests, support chat, friends, reports, subscriptions, coupons, wallet, map, notifications, roles, staff, company settings, and audit. Each section must be mapped to its Native destination or recorded as missing. Similar names do not establish equivalent data, controls, or permissions.

## Confirmed issues / items requiring live verification

1. **CSV import:** Web `src/routes/admin_.import.tsx` parses CSV, analyzes sample rows and calls `suggestCsvMapping`; Native `expo-app/app/admin/import.tsx` currently renders a disabled `ProtectedAdminTool`. This is a real feature gap. Do not enable data import until preview, mapping validation, authorization, and safe commit/rollback behavior are implemented and tested.
2. **Admin backend:** Native finance, governance, subscriptions and other admin tools depend on privileged Edge Functions. Verify production deployment and authorization before claiming operational parity; do not deploy or change production permissions as part of a visual-only task.
3. **Messages:** The project contains support-conversation messaging and a separate support-ticket flow. Keep their purposes, role access and read-only general-manager rules distinct during comparisons.
4. **Push notifications:** Source registers Expo push tokens and sound preference. End-to-end delivery, tap routing, mute behavior and background/terminated-app behavior still require device tests.
5. **Maps/location:** Native and web map, place search, route distance and location-sharing behavior require real-device checks with permissions and production API configuration.
6. **Theme/fonts:** Tajawal font loading and theme preference exist in Native source. Verify every screen and every custom-styled text element; root defaults alone do not prove consistent font usage.
7. **Legal pages:** Terms and privacy use a shared Native legal component, but exact text, formatting and placement still require comparison against Web and the previously approved APK.

## Required completion evidence

For every screen and every account type:
- Web and Android screenshots at matched viewport dimensions / density.
- Visual checklist: colors, font family/weight/size, spacing, dimensions, border/radius, icons, images, RTL, scroll and responsive behavior.
- Functional checklist: every button, field, filter, tab, upload, modal, notification and navigation path.
- Role/permission checklist: customer, driver, large driver, worker, super admin, general manager, department manager, supervisor and support roles where applicable.
- Loading, empty, offline, error and success state checks.
- Data consistency check against the same Supabase account/records.
- CI checks plus Android emulator launch; physical-device verification for camera, notifications, location and maps.

**Completion status:** Not yet certified. The 28 route declarations are a starting inventory only. No overall parity percentage is assigned until the screen-by-screen evidence above exists.
