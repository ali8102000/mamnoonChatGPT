# Authentication setup for Mamnoon

The Mamnoon app handles confirmation callbacks at these paths:

- Web: `https://YOUR_PRODUCTION_DOMAIN/auth/callback`
- Expo app: `mamnoon://auth/callback` (legacy scheme retained for installed-app compatibility)

## Supabase Auth URL configuration

In Supabase Dashboard, open **Authentication → URL Configuration** and add the exact production web callback URL and `mamnoon://auth/callback` to the Redirect URLs allow list. Add the deployed web origin as the Site URL. Do not use a wildcard for production when the exact domain is available.

The email confirmation template should use Supabase's `{{ .ConfirmationURL }}` link. If a custom template builds its own redirect, use `{{ .RedirectTo }}` rather than hard-coding `{{ .SiteURL }}`.

## Reliable email delivery

In **Authentication → SMTP Settings**, configure a verified sender/domain with a transactional SMTP provider (for example Resend or Brevo). Verify the sender domain and keep the SMTP credentials only in the Supabase dashboard; never put them in app code, Expo public variables, or GitHub source.

The built-in Supabase mail service is intended for testing and has strict sending limits. A custom SMTP provider is required for production delivery to arbitrary users.

## Phone number changes

The account settings screen uses Supabase's `updateUser({ phone })` and `verifyOtp({ type: "phone_change" })` flow. Enable Phone Auth, configure an SMS provider and test delivery to Iraqi +964 numbers before enabling phone changes for production users.

The database migration `0007_sync_verified_auth_contacts.sql` updates `profiles.email` and `profiles.phone` only after Supabase Auth confirms the contact change. Apply the Drizzle migration with the configured `SUPABASE_DB_URL` before relying on the profile contact sync.


## Mobile session persistence

The Expo client stores the Supabase Auth session with `expo-secure-store` and enables `persistSession` plus automatic token refresh. This keeps a signed-in session available after the user closes the app or the operating system terminates its process, unless the user explicitly signs out or the refresh session is revoked.

A secure session cannot be guaranteed after uninstalling and reinstalling on Android: Android removes the app's private SecureStore data and its Keystore encryption key during uninstall. iOS Keychain items may survive reinstall, but this is platform behavior and should not be treated as a cross-platform guarantee. After an Android reinstall, the safe recovery path is signing in again with the account's verified phone OTP. Do not copy refresh tokens into AsyncStorage, ordinary preferences, or plaintext backup files to bypass this platform security boundary.
