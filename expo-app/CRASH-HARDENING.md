# Native crash hardening

This change set adds defensive boundaries around native rendering, tab navigation,
auth lifecycle, role switching, and provider presence tracking.

## Changes
- `AppErrorBoundary` contains unexpected React render errors at the root Expo layout.
- `safeNavigate` and `safeBack` serialize rapid navigation attempts and provide a
  fallback route when the navigation stack has no previous screen.
- Auth provider teardown cancels queued profile-refresh timers.
- `cleanupSessionAndListeners` removes active Supabase Realtime channels and stops
  provider-presence background location before role changes and local sign-out.
- Approved driver and worker onboarding now use the per-user role preference flow
  instead of writing a legacy global SecureStore key.
- Chat and history cache keys use SecureStore-compatible characters and match the
  auth cache cleanup convention.
- Provider offer fallback polling runs once per minute; Realtime remains primary.

## Deliberate boundaries
- Active-request trip tracking is not stopped during a role change because it is
  attached to an in-progress request, not provider presence.
- No production database schema or RLS policies are changed by this patch.
- An Error Boundary catches React render/lifecycle errors, not native process
  crashes, out-of-memory termination, or rejected async operations. Those still
  require logs and explicit async error handling.

## Verification
GitHub Actions on the PR head perform web lint/tests/build/typecheck, Expo
TypeScript/doctor/export checks, Supabase Edge Function type checks, and an
Android preview APK build. A successful static build is not a substitute for
testing navigation and account switching on physical Android devices.
