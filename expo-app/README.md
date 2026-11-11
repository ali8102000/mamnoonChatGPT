# Kafo mobile app

This folder contains the Expo Router Android/iOS app in the `mamnoonChatGPT` repository.

## App identity

- Expo name: كفو
- Expo slug: `kfw` (linked to the current EAS project)
- Android package: `com.mamnoon.app` (kept stable for existing installations)
- Deep-link scheme: `mamnoon` (kept stable for existing authentication callbacks)
- EAS project ID: `a6c763c4-3a5c-4725-b370-81967e3c0aab`

Keep the EAS project ID in `app.json`, `app.config.ts`, and `.github/workflows/android-aab.yml` aligned. The root `eas.json` is a compatibility copy; the actual mobile build runs from this directory.

## Local checks

```sh
bun install --frozen-lockfile
bunx tsc --noEmit
bunx expo config --type public
```

## Android production AAB

The production build requires these EAS environment variables in the `production` environment:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`

The URL and publishable key must belong to the same verified production Supabase project. The root `config/public-backend.json` currently contains a different legacy project URL and key pair; replace that pair from the correct Supabase Dashboard before using it for deployment.

For the GitHub Android AAB workflow, add the Expo access token as a GitHub Actions secret named `EXPO_TOKEN`. CI checks the fixed EAS project ID against `app.json`.

The Supabase service-role key must never be included in this mobile app or any `EXPO_PUBLIC_*` variable.

Phone OTP/SMS verification is intentionally deferred. Until SMS is configured, registration requires a real email address; a phone number alone is not treated as verified.

A successful Expo export or CI run does not prove that GPS, Google Maps, Supabase policies, notifications, or real taxi/service requests work on physical devices. Complete the Arabic deployment checklist before store submission.
