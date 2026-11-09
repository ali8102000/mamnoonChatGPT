# Mamnoon mobile app

This folder contains the Expo Router Android/iOS app in the `mamnoonChatGPT` repository.

## Local checks

```sh
bun install --frozen-lockfile
bunx tsc --noEmit
bunx expo config --type public
```

## Android production AAB

The production build requires an Expo EAS project association and these EAS environment variables in the `production` environment:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`

Set `EAS_PROJECT_ID` in the local build environment before running `bun run build:android`. In GitHub, add it as a repository Actions variable named `EAS_PROJECT_ID` (Settings → Secrets and variables → Actions → Variables). It is a project identifier, not a secret.

For the GitHub Android AAB workflow, also add the Expo access token as a GitHub Actions secret named `EXPO_TOKEN`. The workflow validates the project ID and retrieves the EAS `production` environment before invoking the production build, so missing configuration fails early with a clear message.

The Supabase service-role key must never be included in this mobile app or any `EXPO_PUBLIC_*` variable.

Phone OTP/SMS verification is intentionally deferred. Until SMS is configured, registration requires a real email address; a phone number alone is not treated as verified.

A successful Expo export or CI run does not prove that GPS, Google Maps, Supabase policies, notifications, or real taxi/service requests work on physical devices. Complete the Arabic deployment checklist before store submission.
