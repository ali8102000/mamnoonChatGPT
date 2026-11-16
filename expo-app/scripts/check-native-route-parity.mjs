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

if (missing.length) {
  console.error("Mamnoon native/web route parity check failed:");
  for (const item of missing) console.error(` - ${item}`);
  process.exitCode = 1;
} else {
  console.log(`Verified ${routePairs.length} Android-to-web route pairs, ${nativeAdminSections.length} native admin sections, and shared legal-page wiring.`);
}
