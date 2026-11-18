# نقل خدمة الخرائط إلى Supabase — ممنون

## ما تم تنفيذه

- إضافة `supabase/functions/maps-proxy/index.ts` مع ملف حدود المحافظات العراقية `iraq-governorate-boundaries.json`.
- نشر الوظيفة في مشروع Supabase `enteiolvirenbhkyskgb` بالحالة `ACTIVE`، الإصدار 2، مع `verify_jwt = true`.
- نقل عمليات البحث عن الأماكن (Photon + ذاكرة Supabase)، تفاصيل الأماكن المحفوظة، العنوان العكسي، اكتشاف المحافظة، التحقق من حدودها، ومسار الطريق إلى الوظيفة.
- تحويل عميل Android `expo-app/src/lib/maps-api.ts` إلى `supabase.functions.invoke("maps-proxy")` بدلاً من الاتصال المباشر بـVercel.
- تحويل عميل الويب `src/lib/maps.functions.ts` إلى استدعاء الوظيفة نفسها، وإزالة وظيفة إعداد الخرائط القديمة غير المستخدمة.
- إزالة المفتاح القديم المضمّن في `src/lib/google-maps.ts` وإزالة كل متغيرات Lovable Maps القديمة من هذا الملف.
- تحويل `src/routes/api.mobile-maps.ts` إلى جسر توافق مؤقت فقط، يمرر الطلب إلى Supabase ولا ينفذ بحثاً أو صلاحيات أو كتابة قاعدة بيانات بنفسه، ولا يستخدم Lovable أو Service Role.
- رفض action القديم `createTaxiRequest` داخل الوظيفة الجديدة برمز 410؛ إنشاء طلبات التاكسي العادية يجب أن يبقى عبر `auto-taxi-pricing` حتى لا نتجاوز حساب الأجرة والكوبونات وفحوصات الطلب.
- تثبيت `verify_jwt = true` في `supabase/config.toml`.

## سلوك الوظيفة

| Action | السلوك |
|---|---|
| `autocomplete` | قراءة اقتراحات Supabase، ثم Photon عند الحاجة، مع فلترة النتائج بحدود المحافظة |
| `details` | قراءة المكان المحفوظ من Supabase أو جلب تفاصيل Google Places عند وجود المفتاح |
| `reverse` | Photon Reverse |
| `detectGovernorate` | تحديد المحافظة من حدود GeoJSON |
| `validateGovernorate` | تحقق دقيق داخل مضلع المحافظة |
| `route` | Google Routes عند توفر المفتاح، وإلا تقدير Haversine للعرض فقط |
| `createTaxiRequest` | مرفوض 410؛ يستخدم العميل `auto-taxi-pricing` |

**تنبيه التسعير:** مسار Haversine هنا ليس مصدراً معتمداً للأجرة النهائية. تسعير التاكسي وإنشاء الطلب يظلان في `auto-taxi-pricing` كما في الويب وAndroid.

## إعدادات لازمة قبل الاعتماد الكامل

1. إضافة `GOOGLE_MAPS_API_KEY` إلى Supabase Edge Function Secrets إذا كان مطلوباً استخدام Google Places/Routes. لا نحتاج المفتاح كي تعمل اقتراحات Photon والأماكن المحفوظة.
2. ضبط `VITE_GOOGLE_MAPS_API_KEY` لمفتاح عرض المتصفح فقط، مع تقييده بنطاقات الويب المسموحة. لا تضع مفتاحاً خادمياً داخل متغير VITE.
3. تأكيد أن مفتاح Google القديم الذي كان في GitHub قد تم تدويره من Google Cloud Console؛ حذف القيمة من الملف لا يمحوها من تاريخ Git.
4. اختبار الطلبات بحساب مستخدم حقيقي على الويب وAndroid قبل إزالة جسر Vercel القديم.
5. بعد تحديث المستخدمين للإصدارات الجديدة والتحقق من عدم وجود مستهلكين قدامى، يمكن حذف `api.mobile-maps` ومتغير `EXPO_PUBLIC_MAMNOON_API_URL` إن لم تعد مستخدمة في أي مكان آخر.

## التحقق المنفذ

- نشر Supabase أعاد: `ACTIVE`, الإصدار `2`, و`verify_jwt=true`.
- فحص هندسي محلي لحدود GeoJSON: اجتازت مراكز المحافظات الـ18 جميعها اختبار وقوعها داخل مضلعات محافظاتها، كما اجتازت حدود المحافظات الـ18 فحص القيم الرقمية الصالحة.
- فحص المصدر: لا يوجد مفتاح Google ثابت أو متغير Lovable في `src/lib/google-maps.ts` أو عميل الخرائط الجديد، وAndroid لم يعد يستدعي Vercel مباشرة.
- لم أتمكن من تنفيذ طلب authenticated end-to-end من بيئة الفحص لعدم توفر جلسة مستخدم فعلية للاختبار. لذلك لا أدعي أن الاختبار الحي للبحث/التفاصيل اكتمل.
- لم يتم تعديل جداول الإنتاج أو سياسات RLS أو أسرار الإنتاج أو بيانات المستخدمين.

## حالة CI

- على commit `cf4e84e35950acb5a9ae6f117be8c2b072e9a4eb` (وهو يتضمن تغييرات المصدر الخاصة بالخرائط قبل تحديثات التوثيق وملف CI اللاحقة): نجح GitHub Actions في خطوة Production build للويب.
- فحوص TypeScript وroute parity وscreen parity وtaxi fare parity وإعدادات الإنتاج وفحص توافق Expo نجحت في تشغيل Android CI نفسه، لكن مرحلة Expo Doctor أُلغيت، وتصدير Android تم تخطيه؛ لذلك لا نعدّ بناء Android مكتملاً.
- فحص Deno الذي نجح في ذلك التشغيل كان مخصصاً لوظائف الإدارة القديمة ولم يكن يتضمن maps-proxy. أضفت maps-proxy إلى قائمة `deno check` في workflow، لكن لم يظهر تشغيل جديد على أحدث commit بعد.
- فحوص Vercel على PR ما زالت تفشل بسبب `build-rate-limit`، وليس لدينا دليل أن هذا فشل في كود التطبيق.

