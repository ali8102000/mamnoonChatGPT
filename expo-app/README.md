# Mamnoon mobile app

This folder contains the Expo Router app ported into the `mamnoonChatGPT` repository.

## Local checks

```sh
bun install --frozen-lockfile
bunx tsc --noEmit
bunx expo config --type public
```

## Android production AAB

Configure the EAS `production` environment with:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`
- `EAS_PROJECT_ID`

Then run:

```sh
bun run build:android
```

For the GitHub Android AAB workflow, add the GitHub Actions secret `EXPO_TOKEN`.

The app intentionally does not contain a Supabase service-role key. Authentication and taxi-request creation use the deployed Edge Functions.

Phone OTP/SMS verification is not enabled in this port; until SMS is configured, account registration requires a real email address. Do not treat a phone number alone as verified.
