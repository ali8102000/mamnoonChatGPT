# Mamnoon mobile app

This folder contains the Expo Router Android/iOS app in the `mamnoonChatGPT` repository.

## App identity

- Expo name: ممنون
- Expo slug: `kfw` (kept unchanged because it is linked to the existing EAS project)
- Android package: `com.mamnoon.app` (kept stable for existing installations)
- Deep-link scheme: `mamnoon` (kept stable for existing authentication callbacks)
- EAS project ID: `a6c763c4-3a5c-4725-b370-81967e3c0aab`

Keep the EAS project ID in `app.json`, `app.config.ts`, and the Android build workflow aligned. The root `eas.json` is a compatibility copy; the actual mobile build runs from this directory.

## Local checks

```sh
bun install --frozen-lockfile
bunx tsc --noEmit
bunx expo config --type public
```

## Android production AAB

The EAS `production` environment must contain these variables, all belonging to the current Mamnoon Supabase project:

- `EXPO_PUBLIC_SUPABASE_URL=https://enteiolvirenbhkyskgb.supabase.co`
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (the Publishable key from the same Supabase project)
- `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` (the Google Maps key used by Mamnoon)
- `EAS_PROJECT_ID=a6c763c4-3a5c-4725-b370-81967e3c0aab`

The Supabase service-role key must never be included in this mobile app or any `EXPO_PUBLIC_*` variable.

For the GitHub Android AAB workflow, add the Expo access token as a GitHub Actions secret named `EXPO_TOKEN`. CI checks the fixed EAS project ID against `app.json`.

Phone OTP/SMS verification is intentionally deferred. Until SMS is configured, registration requires a real email address; a phone number alone is not treated as verified.

A successful Expo export or CI run does not prove that GPS, Google Maps, Supabase policies, notifications, or real taxi/service requests work on physical devices. Complete the Arabic deployment checklist before store submission.
