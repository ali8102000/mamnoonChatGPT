# ممنون (Mamnoon)

منصة عراقية لطلبات سيارات الأجرة والخدمات المنزلية، مبنية باستخدام React وTanStack Start وSupabase.

## المتطلبات

- Bun 1.4 أو أحدث
- حساب Supabase للمشروع
- مفاتيح Google Maps وFirebase عند تفعيل ميزاتهما

## التشغيل المحلي

```bash
git clone https://github.com/ali8102000/mamnoonChatGPT.git
cd mamnoonChatGPT
cp .env.example .env
bun install
bun run dev
```

املأ المتغيرات المطلوبة في `.env` من إعدادات الاستضافة وSupabase. لا ترفع ملف `.env` أو أي مفاتيح خدمة إلى GitHub.

## فحوصات الجودة

```bash
bun run lint
bun run typecheck
bun run test
bun run build
```

GitHub Actions يشغّل هذه الفحوصات تلقائياً عند الدفع إلى `main` أو فتح Pull Request.

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

يجب تطبيق ترحيل `0003_secure_super_admin_bootstrap.sql` على قاعدة Supabase قبل استخدام صفحة `/admin/bootstrap`. لا ترسل الرمز السري في المحادثات ولا تضعه في كود الواجهة.

## حالة Android

المستودع الحالي يحتوي تطبيق ويب وملفات PWA. لا يحتوي حالياً مشروع Android أصلياً أو إعداد Capacitor/Gradle، لذلك نجاح بناء الويب لا يعني أن ملف AAB جاهز للنشر.
