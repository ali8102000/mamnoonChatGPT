# Mamnoon Android ↔ Web parity audit

Baseline audited: `main` at commit `65b0d6340270447ee7d89cf92f9fc13d57085352`. Native parity continuation is being prepared on branch `feat/android-parity-continuation`; this branch has not yet been merged or device-verified.

This is a living migration checklist. A matching route name or a successful TypeScript/build check does **not** establish visual or functional parity. A screen is complete only after comparing the same signed-in role, data state, viewport, and interaction on the running web and Android apps.

## Findings

- Web route inventory: 30 route files under `src/routes/`.
- Expo route inventory: 21 route files under `expo-app/app/`.
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
| `/$` (not found) | — | Missing equivalent |

## Priority implementation plan

### P0 — release blockers
- [ ] Run Android typecheck, Expo Doctor, dependency compatibility check, and Android export on this exact commit.
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
- [ ] Complete monitoring moderation actions and subscription administration server functions. Bootstrap/import remain deliberately locked on Android because they are one-time or high-impact operations and their server-side web functions are not yet available in Expo.

### P2 — visual and interaction parity
- [x] Bundle and load Tajawal 400/500/700/800/900 assets in the native bundle; verify weight-to-style mapping and glyph rendering on device.
- [ ] Match web theme persistence and live light/dark switching.
- [ ] Compare every route at the same Android viewport, light/dark mode, and account role; record screenshots and fix spacing, typography, radii, borders, gradients, shadows, icons, and safe-area differences.
- [ ] Verify RTL, keyboard resize, scrolling, back navigation, dialogs, toasts, loading/empty/error states, and accessibility text scaling.
- [ ] Replace remaining one-off native colors/styles with shared tokens only after comparing against their web equivalents.

## Verification evidence

- [ ] Android TypeScript check
- [ ] `expo install --check`
- [ ] `expo-doctor`
- [ ] Android export
- [ ] Installable APK build from the audited commit
- [ ] Device-level screen and flow tests
- [ ] Screenshot comparison report

Do not mark this audit complete or claim 100% parity until every required route and flow above has evidence from a running Android build. A successful web CI run alone is not Android verification.
