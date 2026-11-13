const required = [
  "EXPO_PUBLIC_SUPABASE_URL",
  "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "EXPO_PUBLIC_GOOGLE_MAPS_API_KEY",
  "EAS_PROJECT_ID",
];

const missing = required.filter((name) => !process.env[name]?.trim());
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

// The mobile app must use the same Supabase project as the Mamnoon web app.
const expectedSupabaseProjectRef = "enteiolvirenbhkyskgb";
if (supabaseHost.split(".")[0] !== expectedSupabaseProjectRef) {
  console.error(
    `EXPO_PUBLIC_SUPABASE_URL يجب أن يشير إلى مشروع ممنون الصحيح: ${expectedSupabaseProjectRef}.`,
  );
  process.exit(1);
}

if (process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.startsWith("sb_secret_")) {
  console.error("لا يجوز وضع Supabase secret key داخل تطبيق الهاتف؛ استخدم Publishable key.");
  process.exit(1);
}

if (
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    process.env.EAS_PROJECT_ID,
  )
) {
  console.error("EAS_PROJECT_ID ليس UUID صالحاً لمشروع Expo.");
  process.exit(1);
}

console.log("Mamnoon production environment validation passed.");
