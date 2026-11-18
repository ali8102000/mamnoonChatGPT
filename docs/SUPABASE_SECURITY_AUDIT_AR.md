# تدقيق أمان Supabase لممنون

**التاريخ:** 17 نوفمبر 2026  
**النطاق:** فحص قراءة فقط لمشروع الإنتاج `enteiolvirenbhkyskgb` (mamnoon-new، PostgreSQL 17.11).  
**تنبيه:** لم تُنفّذ أي تغييرات على قاعدة الإنتاج أو مفاتيحها أو سياسات RLS أو Storage.

## الخلاصة

- لا توجد جداول في مخطط `public` أو `storage` من دون RLS: تم فحص 60 جدولاً في `public` و10 جداول في `storage`، وجميعها مفعّل عليها RLS.
- لا توجد صلاحيات INSERT/UPDATE/DELETE ممنوحة إلى `anon` على جداول `public`، ولا توجد صلاحية SELECT لـ`anon` إلا على `regional_service_controls` المقصود أن تكون إعدادات الخدمة/الإعلانات فيه قابلة للقراءة العامة.
- توجد 13 جداول في `public` عليها RLS بلا Policies. فحص صلاحيات الجدول أكد أن `anon` و`authenticated` لا يملكان SELECT أو INSERT أو UPDATE أو DELETE عليها؛ لذلك هي مغلقة أمام واجهة المستخدم حالياً، وليست جداول مفتوحة.
- مخطط `supabase_migrations` يحتوي جدولاً واحداً RLS فيه غير مفعّل، لكن `anon` و`authenticated` لا يملكان USAGE على المخطط ولا SELECT على الجدول.
- واجهة الويب وAndroid تستخدمان Publishable Key. ملف `client.server.ts` وحده هو عميل Service Role الخادمي، ويجب أن يبقى محصوراً في server-only handlers. ملف `config/public-backend.json` يحتوي المفتاح العام `sb_publishable_...` فقط.
- Trigger إنشاء الملف الشخصي موجود ويعمل حالياً: 5 مستخدمين في Auth يقابلهم 5 صفوف في `profiles`، ولا توجد صفوف يتيمة أو حسابات بلا profile.
- توجد نقطتان تحتاجان معالجة قبل اعتبار تدقيق الأمان مكتملاً: صلاحية تنفيذ عامة لوظيفتي Trigger من نوع SECURITY DEFINER، وسلوك ابتلاع أخطاء Trigger إنشاء الملف الشخصي.

## 1) مفاتيح API

الملفات التي فُحصت:
- `src/integrations/supabase/client.ts`: يستخدم `VITE_SUPABASE_PUBLISHABLE_KEY` فقط.
- `expo-app/src/lib/supabase.ts`: يستخدم `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` فقط.
- `config/public-backend.json`: يحتوي URL المشروع ومفتاح `sb_publishable_...` العام.
- `src/integrations/supabase/client.server.ts`: يقرأ `MAMNOON_SUPABASE_SERVICE_ROLE_KEY` أو `SUPABASE_SERVICE_ROLE_KEY` لإنشاء عميل خادمي يتجاوز RLS.

لم يظهر استعمال Service Role في ملفات عميل الويب أو عميل Android التي فُحصت. هذا فحص للمصدر، وليس فحصاً جنائياً لكل ملف bundle/APK نهائي؛ لذلك يجب إعادة فحص artifacts عند اكتمال بناء APK.

## 2) RLS وPolicies

نتيجة قاعدة البيانات:
- `public`: 60/60 جدولاً RLS مفعّل.
- `storage`: 10/10 جداول RLS مفعّل.
- لا توجد جداول عامة تسمح لـ`anon` بالكتابة.
- سياسات `profiles` تحدد قراءة المستخدم لملفه، وتسمح بتحديث/إدراج صفه فقط عندما `auth.uid() = id`. توجد استثناءات مقيدة لعرض الملف عند وجود طلب مشترك أو صلاحية إشراف.
- سياسات القراءة العامة/للمستخدم المسجل في جداول الإعدادات والأسعار والخدمات والتقييمات هي للقراءة فقط، وليست سياسات كتابة.

### جداول RLS بلا Policies

الجداول الـ13 هي:
`audit_logs`, `coupon_assignments`, `coupon_redemptions`, `coupon_subsidy_ledger`, `coupons`, `dispatch_zone_settings`, `driver_performance_tier_rules`, `map_place_search_cache`, `map_place_suggestions`, `push_delivery_outbox`, `service_dispatch_queue`, `taxi_dispatch_queue`, `zaincash_webhook_events`.

تحققنا من صلاحيات الأدوار مباشرة: كل هذه الجداول ترفض صلاحيات `anon` و`authenticated` الأربع (SELECT/INSERT/UPDATE/DELETE). لا نضيف Policies عامة إليها لمجرد إسكات Advisor؛ إن احتاجت واجهة المستخدم مستقبلاً وصولاً إليها، تُصمم سياسة دقيقة وفق مالك الصف والغرض.

## 3) Storage

Buckets الحالية:
- `avatars`: public؛ القراءة العامة متوقعة للصور الشخصية. الرفع/التعديل/الحذف محصور بمالك المجلد الذي يطابق `auth.uid()`.
- `regional-notices`: public؛ القراءة العامة متوقعة لإعلانات التطبيق. الرفع محصور بمسؤول مخوّل وبمجلد مرتبط بهويته.
- `provider-verification`: private؛ القراءة للمالك أو موظف مخوّل، والرفع/التعديل ضمن مجلد المالك.
- `request-attachments`: private؛ القراءة للمشاركين في الطلب، والرفع/الحذف للزبون صاحب الطلب.

رغم أن أدوار Storage تملك امتيازات SQL على `storage.objects`، فإن RLS وسياسات الكائنات تقيد العمليات حسب bucket والمالك/المشارك. لا توجد سياسة anon للرفع أو التعديل أو الحذف.

## 4) إنشاء profile عند التسجيل

يوجد Trigger:
`auth.users AFTER INSERT -> public.handle_new_user()`

ويقوم بإنشاء `profiles.id = auth.users.id`، وإضافة دور `customer` في `user_roles`. الفحص الحالي:
- Auth users: 5
- Profiles: 5
- Users without profile: 0
- Orphan profiles: 0

**ملاحظة إصلاح:** الدالة تحتوي `EXCEPTION WHEN OTHERS` ثم تعيد `NEW`، وهذا قد يخفي فشل إدراج profile ويسمح بإنشاء مستخدم Auth بلا ملف شخصي مستقبلاً. يجب تعديل السلوك بعد اختبار آمن؛ الخيار الأكثر اتساقاً هو إظهار الخطأ/إلغاء معاملة التسجيل بدلاً من إخفائه، ما لم توجد آلية تعافٍ موثقة.

## 5) Security Advisor — نقاط مفتوحة

### أولوية عالية: دالتا Trigger قابلتان للتنفيذ من anon

Advisor وجد:
- `public.refresh_driver_performance_tier_from_rating()`
- `public.refresh_driver_performance_tier_from_request()`

كلتاهما `SECURITY DEFINER RETURNS trigger`، ولهما ACL افتراضي PUBLIC؛ فالفحص أكد `anon_execute=true` و`authenticated_execute=true`. هما دالتا Trigger بلا معاملات، وليستا API مقصوداً، لكن لا حاجة لمنح EXECUTE العام عليهما.

**تم التنفيذ بعد موافقة المستخدم بتاريخ 17 نوفمبر 2026:** سُحبت EXECUTE من PUBLIC وanon وauthenticated للدالتين فقط. التحقق اللاحق أكد أن `anon_execute=false` و`authenticated_execute=false`، وأن الدالتين ما زالتا مرتبطتين بالمشغلين الأصليين: `ratings.driver_performance_tier_rating_refresh` و`service_requests.driver_performance_tier_request_refresh`. ACL أصبح `postgres=X/postgres`. لم تُحذف الدوال أو الـTriggers. لم ننفذ اختبار كتابة اصطناعي على بيانات الإنتاج؛ يلزم اختبار trigger behavior في staging أو ضمن اختبار مراقب لا يغيّر بيانات حقيقية.

### دوال SECURITY DEFINER أخرى

Advisor أظهر 103 دوال SECURITY DEFINER قابلة للتنفيذ من `authenticated`. هذا التحذير لا يثبت وحده وجود تجاوز صلاحيات. فحص أولي لمحتوى الدوال وجد أن 91 منها تحتوي إشارات تحقق هوية/صلاحيات؛ وعدد من الدوال الإدارية الأخرى يستدعي `assert_staff('admin'/'super')`. تبقى مراجعة دلالية واختبارات أدوار فعلية مطلوبة، خصوصاً قبل اعتماد واجهات الإدارة.

### تحذير بنيوي

- الامتداد `pg_net` مثبت في مخطط `public`. يوصى بمراجعة نقله إلى مخطط غير مكشوف ضمن تغيير منفصل ومختبر؛ لم يتغير شيء الآن.

## 6) حدود هذا التدقيق

- فحص مباشر لبيانات تعريف قاعدة الإنتاج والسياسات والامتيازات والـTriggers وBuckets.
- فحص مصدر عميل الويب وAndroid، وليس bundle/APK النهائي.
- لم تُجرَ اختبارات تسجيل دخول/رفع/قراءة باستخدام حسابات anon ومستخدمين مختلفين لتجنب أي تعديل على بيانات الإنتاج.
- لم تُعدّل سياسات RLS أو مفاتيح أو أسرار أو Storage أو دوال أو Triggers.
- لم تُنشر Edge Functions ولم تُطبق migrations.

## المراجع الرسمية

- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase API Keys](https://supabase.com/docs/guides/getting-started/api-keys)
- [Supabase Storage Access Control](https://supabase.com/docs/guides/storage/security/access-control)
- [Supabase Database Advisors](https://supabase.com/docs/guides/observability/advisors)


## 7) نتيجة إعادة التحقق بعد المعالجة

بعد سحب الصلاحيات:
- الدالتان لم تعودا قابلتين للتنفيذ من `anon` أو `authenticated`.
- كل Trigger ما زال مرتبطاً بدالته على الجدول الصحيح.
- أعاد Security Advisor لاحقاً 101 finding لدوال SECURITY DEFINER القابلة للتنفيذ من authenticated (بدلاً من 103 في اللقطة السابقة)، ولم تعد دالتا Trigger المذكورتان ضمن تحذير التنفيذ العام.
- بقيت التحذيرات الأخرى، ومنها 13 جدولاً بلا Policies (وهي مغلقة بامتيازات SQL كما وثقنا)، وامتداد `pg_net` في `public`، وتعطيل حماية كلمات المرور المسربة. لا يعني العدد 101 أن كل هذه الدوال ثغرات؛ يلزم تدقيق صلاحيات كل دالة بحسب وظيفتها والتحقق من داخلها.


## 8) المراجعة الموسعة لدوال SECURITY DEFINER (17 نوفمبر 2026)

أُعيد فحص جميع الدوال الـ101 التي بقيت قابلة للتنفيذ من `authenticated` بعد معالجة دالتي الـTrigger:

- جميع الدوال الـ101 لديها `search_path` ثابت ومحدد في إعدادات الدالة؛ لم تظهر دالة SECURITY DEFINER بلا `search_path`.
- صلاحية `CREATE` على مخطط `public` غير ممنوحة إلى `anon` أو `authenticated` أو `PUBLIC`، ما يقلل مخاطر حقن كائنات عبر المخطط.
- مراجعة الأنماط البرمجية وجدت أن الدوال التي تغيّر بيانات وتفتقر إلى استدعاء مباشر لـ`auth.uid()` هي دوال إدارة تستخدم `assert_staff('admin')` أو `assert_staff('super')` قبل التغيير. دالة `admin_grant_subscriptions_bulk` تستدعي دالة منح اشتراك محمية بعد تحقق الإدارة.
- دوال التحقق المساعدة مثل `has_role`, `has_offer`, `is_request_customer`, `is_request_party`, و`has_chat_moderation_access` تقارن معرف المستخدم الممرر مع `auth.uid()` وترجع false عند الاختلاف.
- ثلاث دوال قراءة فقط لا تتطلب جلسة مستخدم وتُنفذ بصلاحية SECURITY DEFINER:
  - `get_worker_service_catalog()`: تعرض فهرس الخدمات دون بيانات شخصية.
  - `get_provider_reputation(p_user_id)`: تعرض متوسطات التقييم والإنجازات ومؤشرات السمعة لمزود محدد، ولا تعيد أسماء المقيمين أو تفاصيلهم.
  - `get_taxi_demand_multiplier(_lat,_lng,_category)`: تعيد معامل طلب محسوباً من أعداد تقريبية ضمن نطاق 5 كم، ولا تعيد إحداثيات السائقين أو معرفاتهم. تبقى هذه الدالة قابلة للاستعلام المتكرر بنقاط مختلفة؛ يستحسن ربطها بطلبات الرحلات أو إضافة تحديد معدل في طبقة API إذا أظهرت السجلات إساءة استخدام.
- لا يُنصح بسحب EXECUTE من 101 دالة دفعة واحدة؛ كثير منها جزء من عمليات المستخدمين ولوحة الإدارة. تحذير Advisor هنا إشارة مراجعة وليس إثبات ثغرة لكل دالة.

### امتداد pg_net

التحقق من كتالوج PostgreSQL أظهر أن `pg_net` مثبت في `public` لكنه `NOT RELOCATABLE`، وأن له 28 كائناً تابعاً. لذلك لم ننفذ `ALTER EXTENSION ... SET SCHEMA` ولم نحاول حذفه/إعادة تثبيته؛ النقل القسري قد يكسر الوظائف أو الـTriggers التي تعتمد عليه. يبقى تحذير Advisor موثقاً ويحتاج خطة ترحيل مدروسة خاصة بالإصدار/المزود.

### حماية كلمات المرور المسربة

Security Advisor ما زال يبلغ أن حماية كلمات المرور المسربة معطلة. تحققنا من خطة المؤسسة عبر بيانات المشروع ووجدناها Free؛ توثيق Supabase يذكر أن ميزة Leaked Password Protection متاحة على Pro وما فوق، لذلك لا يمكن تفعيلها على الخطة الحالية دون ترقية مدفوعة. لم نغيّر إعدادات Auth. صفحة الإعداد الرسمية: https://supabase.com/dashboard/project/enteiolvirenbhkyskgb/auth/providers?provider=Email. لا أوصي بترقية مدفوعة فقط لهذه الميزة قبل تقدير التكلفة والحاجة؛ خصوصاً أن تسجيل الدخول المعتمد على OTP بالهاتف لا يستخدم كلمات مرور المستخدمين.

### نتائج إضافية

- لا توجد صلاحية `CREATE` عامة على مخطط `public`.
- لا توجد دوال SECURITY DEFINER مكشوفة لـ`authenticated` بلا `search_path` ثابت.
- لم تُجرَ تغييرات إضافية على الإنتاج في هذه الجولة؛ كانت المراجعة للقراءة فقط.


## 9) تدقيق إدخال ملفات السائقين والفنيين — اكتشاف جديد

### ما الذي وُجد؟

سياسات RLS تمنع المستخدم من إنشاء ملف لمستخدم آخر، ومشغل `guard_provider_status` يفرض `status='pending'` و`available=false` عند التسجيل الذاتي. لكن صلاحيات INSERT تسمح للمستخدم بإرسال أعمدة إضافية يتحكم بها الخادم، والمشغل الحالي لا يصفرها عند INSERT:

- `driver_profiles`: `performance_tier`, `completed_rides`, `rating_avg`, `ratings_count`.
- `worker_profiles`: `completed_jobs`, `rating_avg`, `ratings_count`.
- كلا الجدولين: `suspended_until`.

هذه القيم يجب أن تأتي من سجلات الطلبات والتقييمات أو من الإدارة، لا من payload التسجيل. كما أن القيمة الافتراضية الحالية لـ`rating_avg` هي 5.00 حتى عند عدم وجود تقييمات.

### الإصلاح المُعد

أُضيفت migration إلى فرع العمل فقط:

`supabase/migrations/20261117190000_guard_provider_onboarding_metrics.sql`

وتقوم في INSERT الذاتي بـ:
- فرض الحالة pending والتوفر false.
- إعادة احتساب متوسط التقييم وعدد التقييمات من جدول `ratings` بدلاً من قبول قيم العميل.
- إعادة احتساب إنجازات السائق من طلبات taxi المكتملة، وإنجازات الفني من طلبات service المكتملة.
- إعادة احتساب رتبة السائق وفق قواعد `driver_performance_tier_rules`.
- إزالة suspended_until المرسل من العميل.
- الإبقاء على اختيار الفني لمستوى fani/khabir كما هو في الواجهة، مع إبقاء حماية تعديل المستوى بعد الاعتماد.

**لم تُطبّق هذه migration على الإنتاج.** يلزم مراجعة CI واختبارها في staging قبل النشر؛ ولا يوجد staging مؤكد ضمن المشروع الحالي.

### فحص البيانات الحالية

- ملفات السائقين: 3، ولا توجد فروقات بين رتب/أعداد/متوسطات السائقين والقيم المحسوبة من الطلبات والتقييمات.
- ملفات الفنيين: 2. ظهرت فروقات في عدّاد التقييمات لدى سجل فني واحد (3 تقييمات موجودة لكن العداد 0). عدد الوظائف المكتملة للفنيين يطابق الطلبات المكتملة من النوع service. كذلك ظهر اختلاف في عدّاد رحلات سائق واحد عند المقارنة بطلبات taxi فقط؛ السبب أن دالة إعادة الاحتساب القديمة كانت تجمع كل أنواع الطلبات. أُضيف إلى migration backfill مشتق من المصادر الصحيحة: taxi للسائقين وservice للفنيين، والتقييمات من جدول ratings. لم نعدّل أي بيانات إنتاجية.


## 10) تدقيق إنشاء طلبات الخدمة

### النتيجة

تطبيق الويب وAndroid ينشئان طلب الخدمة مباشرة عبر INSERT في `service_requests`. سياسة RLS تقيد `customer_id = auth.uid()` و`provider_id IS NULL`، لكنها لا تفرض الحالة الابتدائية أو الحقول الإدارية. وجدنا أن:
- العميل يستطيع إرسال `status` ضمن INSERT، بينما مشغل `prepare_taxi_request` يضبط حالة طلبات التاكسي فقط.
- طلب الخدمة لا يملك حالياً BEFORE INSERT guard يفرض الحالة `pending`.
- أعمدة مثل `accepted_at`, `completed_at`, `cancelled_by`, `admin_notes`, `commission`, و`created_at` ممنوحة للعميل ضمن INSERT.

قد يسمح هذا بإنشاء طلب خدمة بحالة نهائية أو بيانات إدارية مزيفة منذ البداية، رغم أن العميل لا يستطيع تعيين مقدم خدمة بسبب RLS.

### الإصلاح المُعد

أُضيفت migration إلى فرع العمل فقط:

`supabase/migrations/20261117193000_guard_customer_request_initial_state.sql`

وتضيف BEFORE INSERT trigger يفرض أن الطلب تابع للمستخدم الحالي، بلا مقدم خدمة، ويبدأ بحالة `pending`، ويصفر الحقول الإدارية والطوابع الزمنية التي لا يملك العميل تحديدها. يعمل هذا المشغل قبل `taxi_prepare` حتى يحتفظ طلب كيا الحمل/الركاب/الباص بسلوكه الحالي الذي يحوله إلى `searching`.

**لم تُطبّق migration على الإنتاج.** يجب التحقق من ترتيب المشغلات، CI، واختبار مسارات الطلب العادي والتاكسي الكبير قبل النشر.


## 11) تدقيق مستندات التحقق وموافقة مقدم الخدمة

### اكتشاف مهم

سياسة INSERT على `provider_verifications` كانت تتحقق فقط من أن `user_id = auth.uid()`، بينما صلاحيات INSERT تشمل `status` و`reviewed_at` و`rejection_reason`. لم يكن هناك BEFORE INSERT trigger يمنع المستخدم من إرسال `status='approved'` بنفسه.

يوجد AFTER INSERT/UPDATE trigger اسمه `sync_provider_vehicle_public_details` ينسخ بيانات المركبة من metadata إلى `provider_vehicle_public` عندما تكون حالة التحقق approved. لذلك كان من الممكن تجاوز حالة التحقق داخل هذا الجدول وإطلاق مزامنة بيانات المركبة. هذا وحده لا يمنح `user_roles` أو حالة approved في `driver_profiles/worker_profiles`، إذ تبقى تلك المسارات محمية بشكل منفصل، لكنه تجاوز حقيقي لحدود حالة التحقق ويجب إغلاقه.

### الإصلاح المُعد

أُضيفت migration إلى فرع العمل فقط:

`supabase/migrations/20261117194500_guard_provider_verification_self_approval.sql`

- أي INSERT من جلسة مستخدم يفرض `pending` ويلغي `reviewed_at` و`rejection_reason` المرسلين.
- تعديل بيانات طلب التحقق لا يسمح بتغيير الحالة إلى approved/rejected.
- يسمح بإعادة إرسال الطلب المرفوض فقط كـpending، مع تصفير بيانات المراجعة.
- لا يتأثر مسار المراجعة الخادمي الذي يستخدم service_role.

لم تُطبّق هذه migration على الإنتاج. يلزم اختبار التسجيل الجديد وإعادة الإرسال بعد الرفض وتدفق اعتماد الإدارة قبل النشر.


## 12) تدقيق التقييمات

### اكتشاف

واجهة الويب وAndroid لا تعرض نافذة التقييم إلا بعد اكتمال الطلب، لكن سياسة INSERT في قاعدة البيانات كانت تتحقق من أن الطرفين مرتبطان بالطلب فقط، دون شرط `status='completed'`. كما أن مشغل الحد الأسبوعي يمنع التقييم المتكرر فقط ولا يفرض اكتمال الطلب.

كان بالإمكان استدعاء API مباشرة وإرسال تقييم أثناء طلب مقبول أو قيد التنفيذ، مما قد يؤثر على السمعة/الترتيب قبل انتهاء الخدمة.

### الإصلاح المُعد

أُضيفت migration إلى فرع العمل فقط:

`supabase/migrations/20261117200000_require_completed_request_for_rating.sql`

تستبدل سياسة INSERT بحيث لا يُقبل التقييم إلا إذا كان المستخدم أحد طرفي الطلب، وكان الطلب نفسه بحالة completed. لم تُطبّق على الإنتاج.


## 13) Trigger إنشاء profile بعد تسجيل Auth

### النتيجة

الدالة `handle_new_user()` كانت تحاول إدراج `profiles` ثم `user_roles`، لكنها تحتوي `EXCEPTION WHEN OTHERS` وتعيد `NEW` حتى عند فشل إنشاء الملف الشخصي. هذا قد يسمح بإنشاء Auth user بلا سجل profile، ثم تظهر أخطاء لاحقة في التطبيق.

اللقطة الحالية: 5 مستخدمي Auth، و5 profiles، ولا توجد profiles يتيمة أو حسابات Auth بلا profile.

### الإصلاح المُعد

أُضيفت migration إلى فرع العمل فقط:

`supabase/migrations/20261117210000_auth_profile_trigger_fail_closed.sql`

تزيل ابتلاع الأخطاء. إذا فشل إنشاء profile أو دور customer، تفشل معاملة إنشاء Auth user نفسها بدلاً من ترك حساب ناقص. لم تُطبّق على الإنتاج؛ يجب اختبار OTP/التسجيل وتعارض رقم الهاتف في staging قبل النشر.


## 14) حماية سرعة تحديث الموقع المباشر

أظهر فحص مشغل `guard_live_location_speed` أنه كان يقارن موقع المستخدم الجديد بآخر موقع له عبر جميع الطلبات، وليس ضمن الطلب الحالي فقط. هذا قد يرفض أول تحديث موقع في رحلة جديدة إذا كانت بعيدة عن آخر رحلة سابقة، رغم أن الحركة ليست غير منطقية ضمن الرحلة الحالية.

أُضيفت migration إلى فرع العمل فقط:

`supabase/migrations/20261117213000_scope_live_location_speed_to_request.sql`

أصبحت المقارنة مع آخر نقطة للمستخدم ضمن `request_id` نفسه. لم تُطبّق على الإنتاج؛ يلزم اختبار تحديث الموقع داخل الرحلة الحالية وبدء رحلة جديدة في بيئة اختبار.
