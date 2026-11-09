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

if (!process.env.EXPO_PUBLIC_SUPABASE_URL.startsWith("https://")) {
  console.error("EXPO_PUBLIC_SUPABASE_URL يجب أن يبدأ بـ https://");
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

console.log("Production environment validation passed.");
