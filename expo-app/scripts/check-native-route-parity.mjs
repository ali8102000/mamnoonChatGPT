import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const routePairs = [
  ["app/index.tsx", "../src/routes/index.tsx"],
  ["app/auth.tsx", "../src/routes/auth.tsx"],
  ["app/auth/callback.tsx", "../src/routes/auth.callback.tsx"],
  ["app/account-settings.tsx", "../src/routes/account-settings.tsx"],
  ["app/select-role.tsx", "../src/routes/select-role.tsx"],
  ["app/home.tsx", "../src/routes/home.tsx"],
  ["app/request/new.tsx", "../src/routes/request.new.tsx"],
  ["app/request/[id].tsx", "../src/routes/request.$id.tsx"],
  ["app/messages.tsx", "../src/routes/messages.tsx"],
  ["app/support-chat.tsx", "../src/routes/support-chat.tsx"],
  ["app/friends.tsx", "../src/routes/friends.tsx"],
  ["app/history.tsx", "../src/routes/history.tsx"],
  ["app/profile.tsx", "../src/routes/profile.tsx"],
  ["app/coupons.tsx", "../src/routes/coupons.tsx"],
  ["app/subscriptions.tsx", "../src/routes/subscriptions.tsx"],
  ["app/support.tsx", "../src/routes/support.tsx"],
  ["app/forgot-password.tsx", "../src/routes/forgot-password.tsx"],
  ["app/reset-password.tsx", "../src/routes/reset-password.tsx"],
  ["app/privacy.tsx", "../src/routes/privacy.tsx"],
  ["app/terms.tsx", "../src/routes/terms.tsx"],
  ["app/welcome.tsx", "../src/routes/welcome.tsx"],
  ["app/onboarding/driver.tsx", "../src/routes/onboarding.driver.tsx"],
  ["app/onboarding/worker.tsx", "../src/routes/onboarding.worker.tsx"],
  ["app/admin.tsx", "../src/routes/admin.tsx"],
  ["app/admin/bootstrap.tsx", "../src/routes/admin/bootstrap.tsx"],
  ["app/admin/monitoring.tsx", "../src/routes/admin/monitoring.tsx"],
  ["app/admin/subscriptions.tsx", "../src/routes/admin/subscriptions.tsx"],
  ["app/admin/import.tsx", "../src/routes/admin_.import.tsx"],
];

const nativeAdminSections = [
  "app/admin/users.tsx",
  "app/admin/providers.tsx",
  "app/admin/requests.tsx",
  "app/admin/finance.tsx",
  "app/admin/governance.tsx",
  "app/admin/friends.tsx",
  "app/admin/live-map.tsx",
  "app/admin/notifications.tsx",
  "app/admin/staff.tsx",
  "app/admin/staff-hierarchy.tsx",
];

const missing = [];
for (const [nativePath, webPath] of routePairs) {
  if (!existsSync(resolve(root, nativePath))) missing.push(`Android route missing: ${nativePath}`);
  if (!existsSync(resolve(root, webPath))) missing.push(`Web counterpart missing: ${webPath}`);
}
for (const path of nativeAdminSections) {
  if (!existsSync(resolve(root, path))) missing.push(`Native admin section missing: ${path}`);
}
const staffHubSource = await import("node:fs/promises").then(({ readFile }) => readFile(resolve(root, "app/admin/staff.tsx"), "utf8"));
const managerChatRoute = staffHubSource.match(/route:\s*"\/support-chat",\s*roles:\s*\[([^\]]+)\]/);
if (!managerChatRoute?.[1].includes("rank:general_manager")) {
  missing.push("Native staff hub must expose read-only support conversations to general managers.");
}

for (const [path, kind] of [["app/terms.tsx", "terms"], ["app/privacy.tsx", "privacy"]]) {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(resolve(root, path), "utf8"));
  if (!source.includes(`kind="${kind}"`) || !source.includes("LegalPage")) {
    missing.push(`Android ${kind} screen must use the shared legal content component.`);
  }
}

const readSource = async (path) =>
  import("node:fs/promises").then(({ readFile }) => readFile(resolve(root, path), "utf8"));
const nativeAuthContextSource = await readSource("src/lib/auth-context.tsx");
const nativeMessagesSource = await readSource("app/messages.tsx");
if (!nativeMessagesSource.includes("mamnoon-chats-v1") ||
    !nativeMessagesSource.includes("usingCachedData")) {
  missing.push("Native messages list must restore and label cached chats when offline.");
}
if (!nativeAuthContextSource.includes("mamnoon-chats-v1")) {
  missing.push("Native sign-out must clear the locally cached chat list.");
}

const nativeProfileSource = await readSource("app/profile.tsx");
if (!nativeProfileSource.includes("mamnoon-wallet-v1") ||
    !nativeProfileSource.includes("walletOffline")) {
  missing.push("Native provider wallet must restore and label cached values when offline.");
}
if (!nativeAuthContextSource.includes("mamnoon-wallet-v1")) {
  missing.push("Native sign-out must clear the locally cached wallet snapshot.");
}

const nativeHistorySource = await readSource("app/history.tsx");
if (!nativeHistorySource.includes("mamnoon-history-v1") ||
    !nativeHistorySource.includes("usingCachedData")) {
  missing.push("Native request history must restore and label cached entries when offline.");
}
if (!nativeAuthContextSource.includes("mamnoon-history-v1")) {
  missing.push("Native sign-out must clear the locally cached request history.");
}

const nativeIndexSource = await readSource("app/index.tsx");
if (!nativeIndexSource.includes("!profile || roles.length === 0")) {
  missing.push("Native startup must require the same cached profile and role checks as web.");
}

if (!nativeAuthContextSource.includes("mamnoon-auth-profile-v1") ||
    !nativeAuthContextSource.includes("readCachedAuthProfile")) {
  missing.push("Native auth must restore the last saved account profile and roles when offline.");
}
if (!nativeAuthContextSource.includes("clearCachedAuthProfile(previousId)")) {
  missing.push("Native auth must clear the local account snapshot on sign-out or account switch.");
}

const nativeAuthSource = await readSource("app/auth.tsx");
if (!nativeAuthSource.includes('useState<Mode>("signup")')) {
  missing.push("Native auth must open in the same default signup mode as web.");
}
if (nativeAuthSource.includes("loginMethod") || !nativeAuthSource.includes("رقم الهاتف أو البريد")) {
  missing.push("Native auth must use the web-equivalent combined phone/email sign-in field.");
}
if (!nativeAuthSource.includes('router.push("/welcome")')) {
  missing.push("Native auth must expose the web-equivalent language and welcome link.");
}

const apkWorkflowSource = await readSource("../.github/workflows/android-apk.yml");
const aabWorkflowSource = await readSource("../.github/workflows/android-aab.yml");
if (apkWorkflowSource.includes("  pull_request:")) {
  missing.push("Full APK builds should run on main only; PRs use the faster mobile CI export checks.");
}
if (!aabWorkflowSource.includes("cancel-in-progress: true")) {
  missing.push("AAB builds must cancel obsolete main builds when a newer release commit arrives.");
}

const notificationLayout = await readSource("app/_layout.tsx");
const notificationBell = await readSource("src/components/notifications-bell.tsx");
const pushSoundMigration = await readSource("../supabase/migrations/20261116065631_notification_sound_preferences.sql");
const supabaseTypes = await readSource("../src/integrations/supabase/types.ts");

if (!notificationLayout.includes('setNotificationChannelAsync("silent"')) {
  missing.push("Android must register the silent notification channel.");
}
if (!notificationLayout.includes("sound_enabled: soundEnabled")) {
  missing.push("Native push-token registration must persist the user's sound preference.");
}
if (!notificationBell.includes("<Switch") || !notificationBell.includes("setNotificationSoundPreference")) {
  missing.push("Native notification center must expose the sound mute control.");
}
if (!notificationBell.includes('channelId: isNotificationSoundEnabled() ? "default" : "silent"')) {
  missing.push("Foreground notifications must respect the selected sound channel.");
}
if (!pushSoundMigration.includes("ADD COLUMN IF NOT EXISTS sound_enabled") ||
    !pushSoundMigration.includes("ELSE 'silent' END")) {
  missing.push("Push delivery SQL must honor each user's sound preference.");
}
if (!supabaseTypes.includes("sound_enabled: boolean")) {
  missing.push("Generated Supabase types must include user_push_tokens.sound_enabled.");
}

if (missing.length) {
  console.error("Mamnoon native/web route parity check failed:");
  for (const item of missing) console.error(` - ${item}`);
  process.exitCode = 1;
} else {
  console.log(`Verified ${routePairs.length} Android-to-web route pairs, ${nativeAdminSections.length} native admin sections, and shared legal-page wiring.`);
}
