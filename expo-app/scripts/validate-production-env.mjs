const required = [
  "EXPO_PUBLIC_SUPABASE_URL",
  "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "EXPO_PUBLIC_GOOGLE_MAPS_API_KEY",
];

const easProjectId = process.env.EAS_PROJECT_ID || process.env.EAS_BUILD_PROJECT_ID;
const missing = required.filter((name) => !process.env[name]?.trim());
if (!easProjectId?.trim()) missing.push("EAS_PROJECT_ID (or EAS_BUILD_PROJECT_ID)");
if (missing.length) {
  console.error(
    `إعدادات الإنتاج ناقصة: ${missing.join(", ")}. أضفها إلى بيئة EAS production ثم أعد المحاولة.`,
  );
  process.exit(1);
}

let supabaseHost;
try {
  const parsed = new URL(process.env.EXPO_PUBLIC_SUPABASE_URL);
  if (parsed.protocol !== "https:") throw new Error("protocol");
  supabaseHost = parsed.hostname;
} catch {
  console.error("EXPO_PUBLIC_SUPABASE_URL يجب أن يكون رابط HTTPS صالحاً.");
  process.exit(1);
}

// Log only the public hostname (never the URL path, query, or API keys) to
// identify which EAS project/environment value reached the build.
console.log(`Supabase URL host loaded from EAS production: ${supabaseHost}`);

// The mobile app must use the same Supabase project as the Mamnoon web app.
const expectedSupabaseProjectRef = "enteiolvirenbhkyskgb";
if (supabaseHost.split(".")[0] !== expectedSupabaseProjectRef) {
  console.error(
    `قيمة Supabase التي وصلتنا من EAS تشير إلى المضيف "${supabaseHost}" بدلاً من مشروع ممنون الصحيح "${expectedSupabaseProjectRef}". راجع مشروع Expo المرتبط وبيئة Production والمتغيرات المكررة.`,
  );
  process.exit(1);
}

const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.trim();
if (process.env.MAMNOON_CI_CONFIG_ONLY === "true") {
  // CI uses a deliberately fake placeholder: validate the shape/project wiring
  // without sending that placeholder to the live Supabase Auth endpoint.
  console.log("CI configuration-only mode: skipped live Supabase key verification.");
} else {
  const authSettingsResponse = await fetch(`https://${supabaseHost}/auth/v1/settings`, {
    headers: { apikey: publishableKey },
  });
  if (!authSettingsResponse.ok) {
    const responseText = await authSettingsResponse.text();
    console.error(
      `Supabase rejected the Production publishable key (HTTP ${authSettingsResponse.status}). Update EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY in EAS Production; response: ${responseText.slice(0, 240)}`,
    );
    process.exit(1);
  }
  console.log("Supabase Production publishable key accepted by the project.");
}

if (process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.startsWith("sb_secret_")) {
  console.error("لا يجوز وضع Supabase secret key داخل تطبيق الهاتف؛ استخدم Publishable key.");
  process.exit(1);
}

if (
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    easProjectId,
  )
) {
  console.error("EAS_PROJECT_ID ليس UUID صالحاً لمشروع Expo.");
  process.exit(1);
}

console.log("Mamnoon production environment validation passed.");
