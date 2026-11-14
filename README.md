# ممنون (Mamnoon)

منصة عراقية لطلبات سيارات الأجرة والخدمات المنزلية، مبنية باستخدام React وTanStack Start وSupabase، ويحتوي المستودع أيضاً على تطبيق Android/iOS باستخدام Expo Router.

## مكونات المشروع

- تطبيق الويب وPWA في جذر المستودع.
- تطبيق الهاتف الأصلي في `expo-app/` باستخدام Expo Router.
- ترحيلات قاعدة البيانات في `drizzle/migrations/` وإعداد Supabase في `supabase/`.

## المتطلبات

- Bun 1.4 أو أحدث
- حساب Supabase للمشروع الصحيح
- مفاتيح Google Maps وFirebase عند تفعيل ميزاتهما
- حساب Expo/EAS لبناء نسخة Android الإنتاجية

## تشغيل الويب محلياً

```bash
git clone https://github.com/ali8102000/mamnoonChatGPT.git
cd mamnoonChatGPT
cp .env.example .env
bun install
bun run dev
```

املأ المتغيرات المطلوبة في `.env` من إعدادات الاستضافة وSupabase. لا ترفع ملف `.env` أو أي مفاتيح خدمة إلى GitHub.

## تشغيل تطبيق الهاتف

```bash
cd expo-app
bun install --frozen-lockfile
bunx expo start
```

لإنتاج Android App Bundle استخدم ملف `expo-app/eas.json` وسير عمل GitHub Actions المسمى `Mamnoon Android production AAB`. يتطلب ذلك إعداد `EXPO_TOKEN` في GitHub وإعداد متغيرات EAS production.

## فحوصات الجودة

من جذر المستودع:

```bash
bun run lint
bun run typecheck
bun run test
bun run build
```

ويشغّل GitHub Actions فحوصات مستقلة لتطبيق Expo أيضاً.

## ترحيلات قاعدة البيانات

بعد ضبط `LOVABLE_DB_MIGRATION_URL` في بيئة محلية آمنة، نفّذ:

```bash
bun run db:migrate
```

راجع ملفات `drizzle/migrations` قبل تطبيق أي ترحيل على قاعدة الإنتاج. لا تضع رابط اتصال قاعدة البيانات في المستودع أو في متغير يبدأ بـ `VITE_`.

## إعداد أول مدير أعلى

يتطلب الإعداد الأولي متغيرين على الخادم فقط:

- `MAMNOON_BOOTSTRAP_ADMIN_EMAIL`
- `MAMNOON_BOOTSTRAP_SECRET` — قيمة عشوائية لا تقل عن 32 حرفاً

هذه أسماء متغيرات خادم قديمة محفوظة للتوافق مع قاعدة البيانات والوظائف الحالية؛ لا تعني أن اسم التطبيق المعروض ما زال ممنون. يجب تطبيق ترحيل `0003_secure_super_admin_bootstrap.sql` على قاعدة Supabase قبل استخدام صفحة `/admin/bootstrap`. لا ترسل الرمز السري في المحادثات ولا تضعه في كود الواجهة.

## هوية تطبيق الهاتف

- الاسم المعروض: ممنون.
- Expo slug: `kfw`.
- Android package: `com.mamnoon.app` محفوظ للتوافق مع التثبيتات الحالية.
- Deep-link scheme: `mamnoon` محفوظ للتوافق مع روابط المصادقة الحالية.
- EAS project ID: `a6c763c4-3a5c-4725-b370-81967e3c0aab`.

راجع `docs/DEPLOYMENT_CHECKLIST_AR.md` قبل الإطلاق؛ نجاح الفحوصات أو البناء لا يغني عن اختبار المصادقة والخرائط وGPS والطلبات على جهاز حقيقي.
