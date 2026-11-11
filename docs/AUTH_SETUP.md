# Authentication setup for Mamnoon

The app now handles confirmation callbacks at these paths:

- Web: `https://YOUR_PRODUCTION_DOMAIN/auth/callback`
- Expo app: `mamnoon://auth/callback`

## Supabase Auth URL configuration

In Supabase Dashboard, open **Authentication → URL Configuration** and add the exact production web callback URL and `mamnoon://auth/callback` to the Redirect URLs allow list. Add the deployed web origin as the Site URL. Do not use a wildcard for production when the exact domain is available.

The email confirmation template should use Supabase's `{{ .ConfirmationURL }}` link. If a custom template builds its own redirect, use `{{ .RedirectTo }}` rather than hard-coding `{{ .SiteURL }}`.

## Reliable email delivery

In **Authentication → SMTP Settings**, configure a verified sender/domain with a transactional SMTP provider (for example Resend or Brevo). Verify the sender domain and keep the SMTP credentials only in the Supabase dashboard; never put them in app code, Expo public variables, or GitHub source.

The built-in Supabase mail service is intended for testing and has strict sending limits. A custom SMTP provider is required for production delivery to arbitrary users.

## Phone number changes

The account settings screen uses Supabase's `updateUser({ phone })` and `verifyOtp({ type: "phone_change" })` flow. Enable Phone Auth, configure an SMS provider and test delivery to Iraqi +964 numbers before enabling phone changes for production users.

The database migration `0007_sync_verified_auth_contacts.sql` updates `profiles.email` and `profiles.phone` only after Supabase Auth confirms the contact change. Apply the Drizzle migration with the configured `LOVABLE_DB_MIGRATION_URL` before relying on the profile contact sync.
