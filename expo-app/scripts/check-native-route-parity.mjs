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
  missing.push("Native staff hub must expose the writable support inbox to general managers.");
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
if (!nativeProfileSource.includes("isGeneralManager") ||
    !nativeProfileSource.includes("hasStaffRank") ||
    !nativeProfileSource.includes("مركز إدارة ممنون") ||
    !nativeProfileSource.includes("متابعة الشكاوى ومراسلات ممنون") ||
    !nativeProfileSource.includes('router.push("/support-chat"')) {
  missing.push("General managers must have a visible profile entry to their support inbox.");
}

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
const nativeWelcomeSource = await readSource("app/welcome.tsx");
if (!nativeIndexSource.includes('"/welcome"') ||
    !nativeIndexSource.includes('"/select-governorate"') ||
    !nativeIndexSource.includes("mamnoon_governorate") ||
    !existsSync(resolve(root, "app/select-governorate.tsx"))) {
  missing.push("Native startup must show the first-launch governorate selector, persist the choice, then continue to welcome.");
}
if (!nativeWelcomeSource.includes("!profile || roles.length === 0") ||
    !nativeWelcomeSource.includes('router.replace("/select-role")') ||
    !nativeWelcomeSource.includes('router.replace("/home")') ||
    !nativeWelcomeSource.includes('router.replace("/auth")')) {
  missing.push("Native welcome continuation must preserve signed-out, incomplete-profile, and signed-in routing.");
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

const nativeThemeSource = await readSource("src/styles/theme.ts");
if (!nativeThemeSource.includes('success:"#00B667"') ||
    !nativeThemeSource.includes('danger:"#EE343B"') ||
    !nativeThemeSource.includes('surfaceSoft:"#192431"') ||
    !nativeThemeSource.includes('success:"#2EC97A"') ||
    !nativeThemeSource.includes('danger:"#FC4447"')) {
  missing.push("Native semantic success/danger and dark surface colors must stay aligned with the Web CSS theme tokens.");
}

const notificationLayout = await readSource("app/_layout.tsx");
const notificationBell = await readSource("src/components/notifications-bell.tsx");
const notificationPreferences = await readSource("src/lib/notification-sound.ts");
const incomingRequestModal = await readSource("src/components/incoming-request-modal.tsx");
const supportChatSource = await readSource("app/support-chat.tsx");
const pushSoundMigration = await readSource("../supabase/migrations/20261116065631_notification_sound_preferences.sql");
const pushVibrationMigration = await readSource("../supabase/migrations/20261116183000_admin_permissions_and_notification_vibration.sql");
const supabaseTypes = await readSource("../src/integrations/supabase/types.ts");
const adminUsersFunction = await readSource("../supabase/functions/admin-users/index.ts");

for (const channelId of [
  "mamnoon_sound_vibrate",
  "mamnoon_sound_only",
  "mamnoon_vibrate_only",
  "mamnoon_silent",
]) {
  if (!notificationLayout.includes(`setNotificationChannelAsync("${channelId}"`)) {
    missing.push(`Android must register notification channel: ${channelId}.`);
  }
  if (!notificationPreferences.includes(`"${channelId}"`)) {
    missing.push(`Native notification preferences must map to channel: ${channelId}.`);
  }
}
if (!notificationLayout.includes("sound_enabled: soundEnabled") ||
    !notificationLayout.includes("vibration_enabled: vibrationEnabled")) {
  missing.push("Native push-token registration must persist independent sound and vibration preferences.");
}
if (!notificationBell.includes("<Switch") ||
    !notificationBell.includes("changeSoundPreference") ||
    !notificationBell.includes("changeVibrationPreference") ||
    !notificationBell.includes("setNotificationPreferences") ||
    !notificationBell.includes("صوت الإشعارات") ||
    !notificationBell.includes("اهتزاز الإشعارات")) {
  missing.push("Native notification center must expose independent sound and vibration controls.");
}
if (!notificationBell.includes("getNotificationChannelId()") ||
    !notificationBell.includes('sound: isNotificationSoundEnabled() ? "default" : false') ||
    !notificationBell.includes("isNotificationVibrationEnabled()")) {
  missing.push("Foreground notifications must honor the selected sound and vibration channel.");
}
if (!incomingRequestModal.includes("getNotificationChannelId(preferences.soundEnabled, preferences.vibrationEnabled)") ||
    !incomingRequestModal.includes("sound: preferences.soundEnabled ? \"default\" : false")) {
  missing.push("Incoming request alerts must honor independent sound and vibration preferences.");
}
if (!supportChatSource.includes("getNotificationChannelId()") ||
    !supportChatSource.includes('sound: isNotificationSoundEnabled() ? "default" : false') ||
    !supportChatSource.includes("vibrate: isNotificationVibrationEnabled()") ||
    supportChatSource.includes('setNotificationChannelAsync("support-messages"')) {
  missing.push("Support chat local notifications must use the global independent sound and vibration preferences.");
}
if (!pushSoundMigration.includes("ADD COLUMN IF NOT EXISTS sound_enabled") ||
    !pushSoundMigration.includes("ELSE 'silent' END")) {
  missing.push("Push delivery SQL must honor each user's sound preference.");
}
if (!/add column if not exists vibration_enabled/i.test(pushVibrationMigration) ||
    !pushVibrationMigration.includes("mamnoon_vibrate_only") ||
    !pushVibrationMigration.includes("mamnoon_sound_only") ||
    !pushVibrationMigration.includes("mamnoon_sound_vibrate")) {
  missing.push("Push delivery SQL must honor independent sound and vibration preferences.");
}
if (!adminUsersFunction.includes('select("expo_push_token,sound_enabled,vibration_enabled")') ||
    !adminUsersFunction.includes('row.expo_push_token.startsWith("ExpoPushToken[")') ||
    !adminUsersFunction.includes("notificationChannelId(soundEnabled, vibrationEnabled)") ||
    !adminUsersFunction.includes('sound: soundEnabled ? "default" : null')) {
  missing.push("Provider status push notifications must respect each device's independent sound and vibration preferences.");
}
if (!supabaseTypes.includes("sound_enabled: boolean") ||
    !supabaseTypes.includes("vibration_enabled: boolean")) {
  missing.push("Generated Supabase types must include both user_push_tokens notification preferences.");
}


const webStylesSource = await readSource("../src/styles.css");
const nativeRootLayoutSource = await readSource("app/_layout.tsx");
const nativeTypographySource = await readSource("src/styles/theme.ts");
if (!webStylesSource.includes('--font-sans: "Tajawal"') ||
    !webStylesSource.includes("font-family: var(--font-sans)") ||
    !webStylesSource.includes("font-size: 112.5%")) {
  missing.push("Web typography source must retain the Tajawal font and its 112.5% root text scale.");
}
for (const fontWeight of ["Tajawal_400Regular", "Tajawal_500Medium", "Tajawal_700Bold", "Tajawal_800ExtraBold", "Tajawal_900Black"]) {
  if (!nativeRootLayoutSource.includes(fontWeight)) {
    missing.push(`Android must load the matching Tajawal font weight: ${fontWeight}.`);
  }
}
if (!nativeRootLayoutSource.includes('fontFamily: "Tajawal_400Regular"') ||
    !nativeRootLayoutSource.includes("TextInput")) {
  missing.push("Android Text and TextInput must inherit the Tajawal base font.");
}
for (const token of ["hero:32", "title:25", "heading:18", "body:15", "caption:12", "micro:10"]) {
  if (!nativeTypographySource.includes(token)) {
    missing.push(`Android typography scale token is missing or changed: ${token}.`);
  }
}

if (missing.length) {
  console.error("Mamnoon native/web route parity check failed:");
  for (const item of missing) console.error(` - ${item}`);
  process.exitCode = 1;
} else {
  console.log(`Verified ${routePairs.length} Android-to-web route pairs, ${nativeAdminSections.length} native admin sections, and shared legal-page wiring.`);
}
