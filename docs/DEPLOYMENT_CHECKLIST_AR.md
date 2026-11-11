# قائمة تجهيز تطبيق كفو قبل الإطلاق — المستودع mamnoonChatGPT

هذه القائمة تخص المستودع الحالي `ali8102000/mamnoonChatGPT` والفرع `main`. اسم التطبيق الحالي هو **كفو**، ومعرّف المستودع بقي كما هو.

## 1. ربط Supabase — تحقق من الزوج الصحيح قبل النشر

توجد قيمتان مختلفتان في ملفات المستودع:
- `supabase/config.toml` يشير إلى المشروع `hvfiwjryffjwaynkpgar`.
- `config/public-backend.json` يحتوي عنوان مشروع آخر `tojqupbkqsnouhgioygq` ومفتاحاً عاماً تابعاً لذلك العنوان.

اعتمد مشروع Supabase الذي يحتوي بيانات كفو الفعلية. المرجع المستخدم في إعداد CLI الحالي هو `hvfiwjryffjwaynkpgar`، لكن ملف `config/public-backend.json` لا يزال يحمل زوج URL/Key قديماً. لم أغيّر المفتاح أو العنوان لأن المفتاح العام الحالي لا يمكن نقله بين المشاريع. استبدل الزوج كاملاً من إعدادات المشروع الصحيح قبل أي نشر من Lovable أو بناء ويب يعتمد هذا الملف.

لا تضع كلمة مرور أو `service_role` أو أي سر في GitHub أو داخل تطبيق الهاتف.

## 2. تطبيق Android وExpo EAS

هوية التطبيق في ملفات Expo:
- اسم التطبيق: كفو.
- Expo slug: `kfw` (احتفظنا به لأنه مرتبط بمشروع EAS الحالي).
- Android package: `com.mamnoon.app` (أبقيناه لتجنب كسر هوية التثبيت الحالية).
- Deep-link scheme: `mamnoon` (أبقيناه حتى لا تتعطل روابط المصادقة الحالية).
- EAS project ID: `a6c763c4-3a5c-4725-b370-81967e3c0aab`.

ملف `expo-app/eas.json` هو إعداد البناء الفعلي. ملف `eas.json` في جذر المستودع نسخة توافقية ويجب أن يبقى معرّف EAS فيه مطابقاً.

تحتاج بيئة EAS المسماة `production` إلى:
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`

يجب أن يكون رابط Supabase ومفتاح النشر من المشروع نفسه الذي تم تأكيده. قيّد مفتاح Google Maps باسم الحزمة `com.mamnoon.app` وبصمة شهادة التوقيع الفعلية.

### إعداد GitHub لبناء AAB

من المستودع افتح `Settings → Secrets and variables → Actions` وأضف Secret باسم `EXPO_TOKEN` وقيمته رمز Expo.

الـ workflow يثبت EAS project ID الحالي ويتحقق من مطابقته مع `expo-app/app.json`، ثم يفحص TypeScript وExpo Doctor ويصدر Android bundle ويبني AAB موقّعاً. اسم artifact الصحيح هو `kafo-production-aab` ومدته 14 يوماً.

## 3. إعداد الويب والخادم

تُضبط المتغيرات في بيئة استضافة الويب والخادم:
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — للخادم فقط
- `GOOGLE_MAPS_API_KEY`
- `LOVABLE_API_KEY`
- `APP_URL` و`ALLOWED_REDIRECT_ORIGINS`

لا تضع `SUPABASE_SERVICE_ROLE_KEY` في المتصفح أو تطبيق الهاتف أو أي متغير يبدأ بـ `EXPO_PUBLIC_`.

## 4. وظائف Supabase — مصادرها غير محفوظة هنا

المستودع لا يحتوي حالياً على `supabase/functions/`. الوثائق والإعدادات تشير إلى وظائف مثل `auth-proxy` و`create-taxi-request` و`subscription-cron`. لا يمكن مراجعة شيفرتها أو إعادة نشرها من هذا المستودع. يجب تصدير المصادر الفعلية من مشروع Supabase الصحيح وإضافتها إلى GitHub قبل اعتبار هذه الفجوة مغلقة. لا تنشئ بدائل تخمينية لهذه الوظائف.

## 5. قاعدة البيانات والترحيلات

ملفات SQL الحالية:
- `0000_mamnoon_tables.sql`
- `0001_mamnoon_functions.sql`
- `0002_timed_taxi_dispatch.sql`
- `0003_secure_super_admin_bootstrap.sql`
- `0004_bound_provider_map_discovery.sql`
- `0005_provider_presence_for_mobile.sql`
- `0006_secure_taxi_dispatch_retry.sql`
- `0007_sync_verified_auth_contacts.sql`
- `0008_secure_friend_workflows.sql`
- `0009_secure_phone_search_and_verified_email_sync.sql`
- `0010_exact_taxi_km_pricing.sql`
- `0011_normalize_phone_login.sql`

تمت إضافة migration 0008 إلى سجل Drizzle المحلي، ثم أضيف migration 0009 لإصلاح مطابقة أرقام العراق في البحث عن الأصدقاء ومزامنة البريد المؤكد فقط، وmigration 0010 لإزالة الحد الأدنى والتقريب القديم من أجرة التكسي وتثبيت 400 دينار لكل كيلومتر قيادة مؤكد، وmigration 0011 لتوحيد مطابقة أرقام الهاتف عند تسجيل الدخول بصيغ 07 و+964. هذا لا يثبت أن أياً منهما طُبق على قاعدة الإنتاج. كذلك snapshots من `0004` إلى `0007` غير موجودة حالياً؛ لذلك لا تشغّل `drizzle-kit generate` قبل استعادة snapshots الصحيحة أو اعتماد مسار SQL migrations موثق.

قبل تطبيق أي ترحيل على الإنتاج:
1. تأكد من مشروع Supabase الصحيح.
2. خذ نسخة احتياطية قابلة للاستعادة.
3. قارن سجل `__drizzle_migrations` في قاعدة البيانات بالملفات المحلية.
4. تحقق هل migration 0008 مطبق بالفعل أم لا.
5. اختبر على قاعدة اختبار أولاً.
6. طبّق فقط الترحيلات غير المطبقة بعد مراجعة النتائج.

أمر المشروع هو `bun run db:migrate`. لم يتم تشغيله على الإنتاج.

## 6. الاختبار قبل الإطلاق

اختبر بحسابات منفصلة للزبون والسائق والفني:
- إنشاء الحساب وتأكيد البريد وتسجيل الدخول واستعادة كلمة المرور.
- اختيار الدور وتوثيق السائق أو الفني.
- منع استقبال الطلبات قبل الموافقة الإدارية.
- صلاحيات GPS عند القبول والرفض وفقدان الشبكة.
- اكتشاف مقدمي الخدمة ضمن النطاق دون كشف إحداثياتهم الدقيقة.
- إنشاء طلب تاكسي وقبوله مرة واحدة وحساب السعر من الخادم.
- بدء الرحلة وإنهاؤها وإلغاء الطلب.
- طلب خدمة منزلية وتوجيهه للفني المناسب.
- المحادثة والإشعارات والتقييم والاشتراكات.

نجاح CI أو البناء لا يعوض اختبار المسارات على هاتف حقيقي وقاعدة الإنتاج.

## 7. نقاط تحتاج وصولاً إلى خدمات الإنتاج

- استبدال زوج Supabase URL/Key القديم في `config/public-backend.json` بالمعلومات التي تصدر من لوحة المشروع الصحيح.
- تصدير مصادر وظائف Supabase الثلاث وإضافتها إلى المستودع.
- مقارنة سجل الترحيلات الفعلي قبل تطبيق 0008.
- اختبار SMTP وتأكيد الحساب واستعادة كلمة المرور، وGPS والخرائط والإشعارات والطلبات على جهاز حقيقي.

لا تشارك أي token أو مفتاح خدمة في المحادثة أو داخل ملفات Git.
