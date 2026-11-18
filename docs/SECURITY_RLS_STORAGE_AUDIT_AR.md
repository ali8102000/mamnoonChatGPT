# تدقيق أمان Supabase — RLS والمفاتيح والتخزين وملف المستخدم

**تاريخ الفحص:** 17 نوفمبر 2026  
**المشروع:** `enteiolvirenbhkyskgb`  
**الفرع:** `chore/decouple-lovable-backend`  
**نوع الفحص:** قراءة مباشرة من قاعدة الإنتاج ولوحة إعدادات المشروع وقراءة ملفات المستودع. لم تُنفذ أي تغييرات على قاعدة الإنتاج أو المفاتيح أو السياسات.

## النتيجة المختصرة

لا توجد جداول في `public` متروكة بلا RLS: **60 من 60 جدولاً عليها RLS**. لم يظهر منح مباشر لصلاحيات جداول `public` إلى `anon` إلا جدول واحد للقراءة العامة المقصودة هو `regional_service_controls`، وله سياسة SELECT عامة فقط. لكن توجد نقاط تحتاج معالجة قبل إعلان الأمان النهائي: دالتان SECURITY DEFINER قابلتان للاستدعاء من anon، و103 دوال SECURITY DEFINER قابلة للاستدعاء من authenticated وتحتاج مراجعة حسب وظيفتها، وميزة حماية كلمات المرور المسرّبة معطلة، كما أن trigger إنشاء الملف الشخصي يخفي أخطاء الإدراج.

## 1) RLS وسياسات الجداول

- عدد جداول `public`: 60.
- RLS مفعّل: 60/60.
- RLS معطّل: صفر.
- 13 جدولاً عليها RLS لكن بلا Policies. هذه الجداول لا تملك منحاً مباشراً لـanon أو authenticated في فحص `information_schema.role_table_grants`، ولذلك تبقى غير متاحة لهذين الدورين عبر منح الجدول المباشرة. أمثلتها: `audit_logs`, `coupons`, `coupon_redemptions`, `push_delivery_outbox`, `service_dispatch_queue`, `taxi_dispatch_queue`, `zaincash_webhook_events`. يجب إبقاء هذه الجداول خادمية/خاصة ما لم تُصمم سياسة وصول محددة لها.
- يوجد منح anon واحد فقط على جدول `regional_service_controls`، وهو SELECT فقط، مع سياسة `TO anon, authenticated USING (true)`. يجب التأكد أن محتوى هذا الجدول مخصص للنشر العام؛ لا تضع به أسراراً أو بيانات مستخدمين.
- سياسات `profiles` تتضمن قراءة الملف الشخصي لصاحبه، وللطرف المقابل عند وجود طلب مرتبط، ولفريق الدعم المخوّل. التعديل مقيد بـ`auth.uid() = id`.
- سياسات الرسائل والمحادثات والمواقع الحية والطلبات تربط الوصول بالمشارك/المالك أو بصلاحية تشغيلية محددة.
- بعض جداول الإعدادات العامة (مثل الأسعار والخدمات ونماذج المركبات) تسمح بقراءة `true` للمستخدم المسجل فقط؛ هذا مقصود للبيانات المرجعية ولا يمنح كتابة.
- **استثناء يحتاج قرار خصوصية:** جدول `ratings` لديه سياسة SELECT بـ`USING (true)` لكل مستخدم مسجل. الجدول يحتوي `rater_id`, `ratee_id`, `request_id`, `comment` ودرجات التقييم؛ لذلك يستطيع أي مستخدم مسجل قراءة جميع التقييمات والتعليقات ومعرّفات أطرافها. إذا كان المقصود عرض متوسط/عدد التقييمات فقط، فالأفضل استخدام View محدود الأعمدة مع `security_invoker=true` أو سياسة تقصر قراءة التفاصيل على أطراف الطلب وفريق مخوّل.
- جدول `regional_service_controls` متاح للقراءة من `anon` و`authenticated`، ويحتوي أيضاً `rejection_message` إلى جانب نصوص الإشعارات والإعدادات. راجع أن كل هذه الحقول مقصودة للعرض العام، وإلا افصل الحقول الداخلية في جدول خاص أو View محدود.

## 2) مفاتيح API

- ملف واجهة Supabase `src/integrations/supabase/client.ts` يقرأ `VITE_SUPABASE_URL` و`VITE_SUPABASE_PUBLISHABLE_KEY` فقط.
- `config/public-backend.json` يحتوي رابط المشروع ومفتاحاً يبدأ بـ`sb_publishable_`، ولا يحتوي حقلاً باسم service-role أو secret.
- مفتاح الخدمة موجود في `src/integrations/supabase/client.server.ts` ويُقرأ من متغيرات خادمية `MAMNOON_SUPABASE_SERVICE_ROLE_KEY` أو `SUPABASE_SERVICE_ROLE_KEY`. هذا مكان خادمي مقصود، ويجب ألا يستورده أي ملف عميل أو يمرر قيمته إلى `VITE_` أو `EXPO_PUBLIC_`.
- هذا الفحص قرأ إعدادات المصدر، ولم يفك تشفير أسرار Vercel/EAS ولم يثبت بعد بفحص ملفات build النهائية أن المفتاح السري غائب عن كل حزمة منشورة. يلزم فحص artifacts قبل إعلان سلامة الحزمة النهائية.

## 3) Storage Buckets

وجدت أربعة Buckets:

| Bucket | Public | الحد الأقصى | أنواع الملفات |
|---|---:|---:|---|
| `avatars` | نعم | 5 MiB | JPEG/PNG/WebP |
| `regional-notices` | نعم | 5 MiB | JPEG/PNG/WebP |
| `provider-verification` | لا | 10 MiB | JPEG/PNG/WebP |
| `request-attachments` | لا | 8 MiB | JPEG/PNG/WebP |

- الصور الرمزية وصور الإعلانات المناطقية قابلة للقراءة العامة، وسياسات الكتابة والحذف/التعديل تقيد المستخدم بمجلده.
- ملفات التحقق خاصة؛ الرفع والتحديث لمجلد صاحب الحساب، والقراءة لصاحب الملف أو فريق مخوّل.
- مرفقات الطلبات خاصة؛ الرفع لصاحب الطلب، والقراءة للمشاركين المصرح لهم، والحذف لصاحب الطلب وفق مسار الملف ومعرّف الطلب.
- لم تظهر سياسة رفع عامة لـanon.

## 4) Trigger إنشاء profiles

- Trigger موجود فعلياً: `auth.users AFTER INSERT` باسم `on_auth_user_created`.
- يستدعي `public.handle_new_user()`، وينشئ صفاً في `public.profiles` بنفس `NEW.id`، ثم يضيف دور `customer` في `user_roles`.
- مفتاح `profiles.id` مرتبط بـ`auth.users.id ON DELETE CASCADE`.
- الفحص العددي الحالي: كل حسابات Auth الموجودة وقت الفحص لها صف مقابل في profiles.
- **ملاحظة مهمة:** الدالة تحتوي `EXCEPTION WHEN OTHERS` وتعيد `NEW` حتى لو فشل إدراج الملف الشخصي. هذا يخفي الفشل وقد يسمح بإنشاء حساب Auth بلا profile في حالة خطأ مستقبلي. يجب تعديلها إلى معالجة دقيقة أو إعادة رفع الخطأ، واختبارها في بيئة staging قبل نشر التعديل.

## 5) تحذيرات وظائف SECURITY DEFINER

- Advisor أظهر دالتين قابلتين للتنفيذ من `anon`:
  - `public.refresh_driver_performance_tier_from_rating()`
  - `public.refresh_driver_performance_tier_from_request()`
- الدالتان مرتبطتان بمشغلات تلقائية، لكن صلاحية EXECUTE العامة ليست مطلوبة عادةً لاستدعائهما من Trigger. يجب مراجعة تعريفهما ثم سحب EXECUTE من `PUBLIC`, `anon`, و`authenticated` مع التأكد أن المشغلات تستمر بالعمل.
- Advisor أظهر 103 دوال SECURITY DEFINER قابلة للتنفيذ من `authenticated`. هذا لا يعني تلقائياً أن كل واحدة ثغرة؛ يلزم تدقيق جسم كل دالة، والتحقق من `auth.uid()` والصلاحية ونطاق المحافظة ومنع تمرير user_id مزوّر.
- Advisor أظهر أيضاً أن حماية كلمات المرور المسرّبة معطلة؛ يوصى بتفعيلها من إعدادات Auth بعد التحقق من أثرها على تجربة التسجيل.

## 6) Views

- `driver_public_stats` و`worker_public_stats` مضبوطتان على `security_invoker=true`.
- لا توجد صلاحية SELECT لـanon على هذين الـView؛ authenticated فقط.
- هذا يمنع الـViews من تجاوز RLS على الجداول المصدرية.

## 7) Lovable وFirebase

- اعتماديات `@lovable.dev/*` أزيلت من `package.json` وملف القفل بحسب تدقيق فصل Lovable السابق.
- مجلد `.lovable/` وملفات metadata ما زالت موجودة في المستودع؛ لم تُحذف حتى لا نفقد سجل الترحيل/المعلومات المرجعية قبل التأكد من عدم حاجة المشروع إليها.
- Firebase ما زال مستخدماً في `src/lib/firebase.ts` لإشعارات الويب FCM والتحليلات وقياس الأداء. لا يُحذف قبل استبدال تسجيل رموز FCM والتسليم والقياس واختبارها؛ حذف المكتبة الآن قد يعطل الإشعارات.

## إجراءات مطلوبة قبل الإغلاق الأمني

1. مراجعة الدالتين trigger SECURITY DEFINER وسحب EXECUTE العام عنهما بعد التحقق من استمرار عمل المشغلات.
2. إصلاح `handle_new_user()` حتى لا يخفي فشل إنشاء profile، مع اختبار signup جديد في staging.
3. مراجعة 103 دوال SECURITY DEFINER واحدةً واحدةً وتصنيفها: عامة مقصودة، authenticated محكومة داخلياً، أو يجب حجبها.
4. تفعيل Leaked Password Protection.
5. فحص ملفات build النهائية للويب وAndroid للتأكد من عدم تضمين service-role/secret keys، وفحص imports التي تصل إلى `client.server.ts`.
6. عدم إنشاء Policies عامة للجداول الـ13 التي بلا Policies لمجرد إزالة تحذير Advisor؛ لا تُفتح جداول الطوابير والسجلات والمدفوعات دون حاجة وصلاحية محددة.

**لا تغييرات إنتاجية نُفذت خلال هذا التدقيق.** يجب تطبيق تغييرات SQL عبر migrations مراجعة واختبارها على staging أولاً، بسبب اختلاف سجل migrations الحي عن ملفات المستودع الذي سبق توثيقه.
