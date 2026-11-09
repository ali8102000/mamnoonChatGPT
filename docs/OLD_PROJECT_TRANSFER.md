# Mamnoon transfer: old project to mamnoonChatGPT

## Branch and review

- Target repository: `ali8102000/mamnoonChatGPT`
- Working branch: `merge-old-hardening-2026-11-09`
- Base branch: `main` (not modified directly)
- Source repository: `ali8102000/mumnun`
- Pull request: https://github.com/ali8102000/mamnoonChatGPT/pull/1

All ported changes are kept on the working branch until CI and backend compatibility checks pass.

## Ported application work

- Added the Expo Router Android/iOS app under `expo-app/`, including the existing screens, auth context, location tracking, request history, chat, profiles, onboarding and EAS configuration.
- Reused the target repository's existing brand PNGs for the Expo app icon, adaptive icon, splash and favicon.
- Updated mobile presence publishing to use the target database's `provider_presence` table.
- Updated mobile fare estimates to the target tariff: 400 IQD/km, minimum 1,000 IQD, rounded to 250 IQD.
- Added the mobile `auth-proxy` and `create-taxi-request` Edge Functions.
- Updated the Edge Functions and Expo Supabase client for opaque Supabase publishable keys; service-role keys remain server-only.
- Routed web taxi request creation through a server function that calculates a trusted road route and fare.
- Replaced the old `dispatch_request` calls with the target's owner-checked `retry_taxi_dispatch` RPC.
- Added verified-provider presence publishing to the web provider dashboard.
- Removed the client-side administrator identity shortcut and role upserts; super-admin state is now derived from the database role.
- Ported hardened logger, offline queue, device fingerprint and reputation-review handling.
- Added web and Expo CI jobs.

## Database changes

The old repository and target repository use different Supabase projects:

- Old project: `zvfdymcalzqhvwnipuup`
- Target project: `tojqupbkqsnouhgioygq`

For that reason, old Supabase migrations were **not copied wholesale**. The target already has its own Drizzle schema and timed-dispatch implementation. Two target-specific migrations were added:

- `0003_atomic_taxi_request_rate_limit.sql`
- `0004_production_hardening.sql`

They add atomic taxi rate limiting, safe retry dispatch, provider verification, verified/fresh provider presence, nearby worker visibility, protected profile statistics, request mutation restrictions, active-request location privacy, completed-request rating checks and NULL-safe cancellation.

These migrations are committed but have **not been applied to the live database**. Before applying them, verify that `LOVABLE_DB_MIGRATION_URL` points to the target project database, not the old project. Then use the repository's `bun run db:migrate` command after taking a database backup and confirming the target migration history.

## Required deployment configuration

### Web/server environment

Set the variables listed in the root `.env.example`, including:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server only)
- `LOVABLE_API_KEY`
- `GOOGLE_MAPS_API_KEY`
- `LOVABLE_DB_MIGRATION_URL` (migration execution only)

### Supabase Edge Function secrets

Configure the target project's secrets for:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_MAPS_API_KEY`
- `ALLOWED_ORIGIN` and `ALLOWED_REDIRECT_ORIGINS` where required by the deployment domains

Deploy `auth-proxy` and `create-taxi-request` only after the target database migrations and secrets are ready.

### Expo EAS production environment

Set:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`
- `EAS_PROJECT_ID`

Never put `SUPABASE_SERVICE_ROLE_KEY` in Expo variables.

## Deliberately deferred

- OTP/SMS verification remains deferred as requested.
- `subscription-cron` was not ported because the target migration set does not yet include its required expiry-notification table and monthly-counter reset function.
- A production AAB has not yet been built or signed. The Expo CI job checks TypeScript and Expo configuration; an EAS production build still requires the EAS environment and credentials.
- No database migration has been applied to the live target project.

## Secret hygiene

A tracked `.env` file was removed from this working branch and `.env` files are now ignored. Its values were not opened or copied. Removing a file from a commit does not erase it from earlier Git history. If it contained real credentials, rotate those credentials in the relevant provider dashboards before merging or deploying.
