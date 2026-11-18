# فجوات نقل وظائف الإدارة إلى Supabase Edge Functions

## تحديث الحالة الحالية — 17 نوفمبر 2026
### نتائج تدقيق إضافية — 17 نوفمبر 2026
### مقارنة المصدر مع وظائف الإنتاج المنشورة — 17 نوفمبر 2026

تمت قراءة محتويات وظائف الإنتاج الست عبر Supabase ومقارنتها بملفات الفرع. النتيجة: `maps-proxy` مطابق تماماً، أما الوظائف الإدارية والمصادقة فهناك اختلافات مصدر/عقد يجب حلها قبل أي قطع:

| الوظيفة المنشورة | الإصدار الحي | اختلافات مهمة في الفرع |
|---|---:|---|
| `admin-users` | 7 | الفرع يضيف `update_provider_name` و`review_provider_change_request` و`provider_change_requests` و`dashboard_stats` |
| `admin-subscriptions` | 2 | الفرع يضيف/يعيد تنظيم `plans` و`settings` و`payments` و`subscriptions` و`assign_subscription` |
| `admin-finance` | 3 | الفرع يضيف `list_transactions` و`list_coupons` |
| `admin-governance` | 2 | الفرع يضيف `staff_activity` |
| `auth-proxy` | 2 | المصدر مختلف؛ الفرع يتضمن حساب صفة المدير الأعلى من RPC وتوحيد البريد الداخلي |
| `maps-proxy` | 2 | مطابق تماماً لملف الفرع عند المقارنة النصية |

هذا يعني أن معاينة الواجهة التي تستخدم هذه الإجراءات الجديدة لا يمكن اعتبارها متوافقة مع وظائف الإنتاج الحالية قبل نشر متوافق أو استخدام مشروع Supabase staging مستقل. **لم يتم نشر أي Edge Function في هذه الخطوة**، ولا يجوز افتراض أن إجراءات الفرع موجودة في الإنتاج.


- كشف فحص TypeScript السابق أن طبقة `createClientFn` كانت تعرّف builder كـ`any`، ما أفقد الأنواع في handlers وvalidators. استبدلت بتعريف generic يحافظ على نوع ناتج validator وسياق المستخدم.
- عولجت أخطاء RPC الناتجة عن اختلاف ملف أنواع قاعدة البيانات عن الدوال المنشورة، وأزيلت إشارة TypeScript قديمة إلى ملف بوابة الذكاء الاصطناعي القديم الذي أزيل من المشروع.
- تدقيق مباشر للـPostgreSQL أكد أن دوال الصلاحيات الأساسية `is_super_admin` و`has_admin_access` و`has_staff_role` و`has_subscription_admin_access` ترفض المستخدم المجهول وتربط `p_user_id` بـ`auth.uid()`.
- فُحصت صلاحيات التنفيذ على مجموعة RPC الإدارية التي يستعملها الفرع: لم تظهر صلاحية تنفيذ لدور `anon`، بينما التنفيذ متاح لـ`authenticated` مع وجود فحوص صلاحيات داخل الدوال المفحوصة.
- دوال إدارة الموظفين مثل `staff_deactivate` و`staff_set_rank` و`staff_list_department` و`staff_promote_one_level` تحتوي فحوصاً خادمية مرتبطة بالمستخدم المصادق عليه.
- فشل فحص Deno السابق قبل الوصول إلى تدقيق المصدر بسبب محاولة تثبيت اعتماديات مشروع الويب عند استعمال `--node-modules-dir=auto`. تم تغيير إعداد CI إلى `--node-modules-dir=none` حتى يستخدم Deno ذاكرته المؤقتة دون تثبيت كل اعتماديات واجهة الويب.
- تحديث CI على الالتزام `56c72e8`: فحص Deno لوظائف Supabase نجح، وفحوص الويب (TypeScript وESLint والاختبارات وبناء الإنتاج) نجحت، وفحص صور الخدمات نجح للويب وAndroid. ما زال بناء Android export والتحقق الشامل وبناء APK المستقل قيد التنفيذ؛ لا يوجد APK منشور كأثر بعد.


- تحولت وظائف الإدارة الـ60 والاشتراكات الـ19 من `createServerFn` إلى طبقة عميل متوافقة مع عقد الاستدعاء القديم، وتستخدم جلسة Supabase الحالية.
- فحص المصدر الحالي يؤكد عدم وجود `supabaseAdmin` أو `createServerFn` في الملفين.
- أضيفت وظيفة `import-assist` إلى Supabase، وأضيف Workflow للتحقق من TypeScript والاختبارات وبناء الويب وفحص وظائف Edge.
- لا يعني هذا اكتمال نقل كل خادم Vercel: توجد مسارات API أخرى وجسر خرائط مؤقت، وما زال علينا جرد كل endpoints وعمليات الخادم خارج هذين الملفين.
- فحوص Vercel على آخر التغييرات ظاهرة بحالة فشل بسبب `build-rate-limit`، ولم يظهر بعد نجاح Workflow الكامل؛ لذلك لا يوجد اعتماد إنتاجي حتى الآن.
- لا تزال مطابقة عقود جميع وظائف الإدارة، وتغطية الصلاحيات حسب الدور والمحافظة، واختبارات الرفض/النجاح مطلوبة قبل الدمج.


تاريخ التدقيق: 17 نوفمبر 2026
الفرع: `feature/admin-control-center-unified-analytics`

## الجرد المؤكد من المصدر
- `src/lib/admin.functions.ts`: 60 وظيفة TanStack Server Function.
- `src/lib/subscription.functions.ts`: 19 وظيفة TanStack Server Function.
- 79 وظيفة إجمالاً.
- بعد الموجة الأولى، لم تعد أي من وظائف الإدارة الـ60 أو الاشتراكات الـ19 تستخدم `supabaseAdmin` / Service Role مباشرة في خادم Vercel؛ إجمالي 79 وظيفة أصبحت تستعمل عميل المستخدم أو Supabase Edge Functions.
- الوظائف المنشورة ذات الصلة: `admin-users`, `admin-finance`, `admin-governance`, `admin-subscriptions`.

## تغطية Edge Function الحالية
- `admin-users`: 25 action تقريباً تشمل المستخدمين والمزودين والطلبات والبلاغات والمراقبة والمحادثات والأصدقاء والإشعارات.
- `admin-finance`: أضيفت action مستقلة `list_transactions` بصلاحية `finance.read` و`list_coupons` بصلاحية `promotions.read`، بالإضافة إلى عمليات المحفظة والكوبونات والتوزيع والتقارير.
- `admin-governance`: 5 actions تشمل سجلات التدقيق والبحث والأدوار الأساسية.
- `admin-subscriptions`: 11 actions تشمل الباقات والإعدادات والاشتراكات والمدفوعات والإعلانات.

تداخل أسماء الوظائف لا يثبت تطابق السلوك. يجب مقارنة وسيطات الإدخال، شكل الاستجابة، الأخطاء، الصلاحيات، نطاق المحافظة، والتفويض قبل تحويل كل مستهلك.

## فجوات مرشحة تحتاج مساراً مستقلاً
من الأسماء المصدرة في المصدر، لا يظهر مقابل مباشر واضح في actions الحالية لبعض الوظائف، ومنها:
- تهيئة أول مدير أعلى والتحقق من وجوده: `checkSuperAdminExists`, `bootstrapSuperAdmin`.
- شؤون الموظفين: `adminListDepartmentStaff`, `adminPromoteStaffOneLevel`, `adminDeactivateStaff`, `adminSetStaffRank`.
- سجل نشاط الموظفين ولوحة الإحصاءات: `adminListStaffActivity`, `adminGetDashboardStats`.
- حوكمة الصلاحيات والتفويض: `adminGovernanceAssignStaff`, `adminGovernanceChangeRank`, `adminGovernanceDeactivateStaff`, `adminGovernanceGrantPricingPermissions`, `adminGovernanceGrantPermission`, `adminGovernanceCreateDelegation`, `adminGovernanceRevokePermission`, `adminGovernanceRevokeDelegation`, `adminGovernanceReviewApproval`.

قد تكون بعض هذه العمليات موجودة كجزء من RPC أو action باسم مختلف؛ لذلك القائمة مرشحة وليست حكماً بغياب الوظيفة من النظام.

## سياسة الترحيل
1. لا تحذف أو توقف أي Server Function قبل نقل كل مستهلكاتها والتحقق من contract parity.
2. يجب إبقاء فحوص الصلاحيات داخل RPC/Edge Function على أساس JWT المستخدم، لا الاكتفاء بإخفاء الواجهة.
3. عمليات البحث/القراءة التي لا تحتاج Service Role تُنقل إلى JWT المستخدم مع RLS أو RPC آمن.
4. العمليات التي تتطلب Service Role تبقى داخل Edge Function موثوقة، بعد فحص الدور والنطاق والتفويض، مع منع أي تمرير مباشر لمفتاح الخدمة.
5. `bootstrapSuperAdmin` يحتاج مساراً مغلقاً بمفتاح تهيئة محفوظ في Supabase Function Secrets، ويجب ألا يكون RPC عاماً.
6. لكل action اختبارات للنجاح والرفض حسب الدور والنطاق، واختبارات لشكل الاستجابة والأخطاء.
7. تاريخياً كانت هناك 39 وظيفة تعتمد على Service Role؛ أزيل هذا الاعتماد من ملفي الإدارة والاشتراكات في الفرع الحالي، لكن لا تُحذف متغيرات Vercel قبل جرد كل المستهلكين خارج هذين الملفين.

## الحالة
الجرد والنقل الأولي مكتملان على مستوى المصدر لهذين الملفين، لكن التكافؤ الوظيفي لم يُثبت باختبارات شاملة بعد. لا تُعتبر الوظائف الأربع أو الـ79 دليلاً على اكتمال المنصة كلها.


## تنفيذ الموجة الأولى — 17 نوفمبر 2026

تم نقل منطق القراءة الحساسة لهذه الوظائف إلى Supabase Edge Functions، وأصبحت Server Functions على Vercel مجرد وسيط مصادق يمرر JWT المستخدم:
- `adminListUsers` → `admin-users:list`
- `adminSearchUsers` → `admin-users:search`
- `adminGetUserDetail` → `admin-users:detail`
- `adminListTransactions` → `admin-finance:list_transactions`
- `adminListCoupons` → `admin-finance:list_coupons`

تم كذلك مواءمة صلاحيات Edge actions الخاصة بالمستخدمين والمزودين والمواقع والبلاغات والمحادثات والأصدقاء مع RPCs الموجودة في قاعدة البيانات:
- `has_user_moderation_access`
- `has_provider_ops_access`
- `has_live_ops_access`
- `has_chat_moderation_access` مع استثناء موظف خدمة العملاء من محادثات المستخدمين الخاصة
- `has_friend_admin_access`

لم تُنشر تغييرات Edge Function إلى الإنتاج بعد؛ التغييرات في الفرع وتنتظر نجاح CI ومراجعة contract parity. الجرد الحالي من المصدر: 79/79 من وظائف الإدارة والاشتراكات لا تستخدم Service Role في خادم Vercel. نُقلت 12 وظيفة اشتراكات إدارية/مستخدم إلى Supabase، ثم نُقلت `incrementUserRequestCount` إلى Edge Function مستقلة. كما نُقلت `incrementUserRequestCount` في الموجة التالية، لذلك لا توجد أي وظيفة اشتراكات متبقية تستخدم Service Role من Vercel.


## موجة نقل اشتراكات المستخدم

- `checkSubscriptionAllowed` أصبح يستدعي `check_request_allowed` عبر عميل Supabase المرتبط بجلسة المستخدم.
- `getUserSubscription` أصبح يستدعي `get_user_subscription` عبر عميل المستخدم.
- فُحصت تعريفات RPCs في قاعدة البيانات: كلاهما `SECURITY DEFINER` ويمنح EXECUTE لـ `authenticated`، ويتحققان من تطابق `auth.uid()` مع `_user_id` (إلا صلاحيات الإدارة).
- `incrementUserRequestCount` لم يُنقل بعد: RPC الحالي `increment_request_count` يمنح EXECUTE لـ `service_role` فقط ولا يحتوي تحققاً من هوية المستدعي. لا نفتح صلاحية الدالة الحالية مباشرة؛ المطلوب RPC آمن بلا user_id أو يتحقق من `auth.uid()` قبل التحديث.


## موجة نقل الاشتراكات الإدارية

أُضيفت actions مستقلة في `admin-subscriptions` للقراءة:
- `plans`, `settings`, `payments`, `subscriptions`.

واستُخدمت actions الموجودة للكتابة والبحث:
- `save_plan`, `toggle_plan`, `save_settings`, `search_users`, `grant_subscription`.

وأُضيفت action `assign_subscription` لنقل التعيين اليدوي مع الحفاظ على دورة الفوترة وعدد الأيام وتسجيل دفعة الاشتراك عند وجود سعر. جميع هذه actions محمية بفحص `has_subscription_admin_access` على مستوى الوظيفة، وتطلب `has_admin_access` للعمليات الإدارية.

**المتبقي في مجموعة الاشتراكات:** `incrementUserRequestCount` فقط. لا نمنح صلاحية authenticated على RPC الحالي لأنه يقبل user_id ولا يتحقق من `auth.uid()`; المطلوب إنشاء RPC آمن للمستخدم الحالي قبل النقل.


## نقل آخر وظيفة اشتراكات إلى Supabase

أُنشئت `increment-request-count`:
- `verify_jwt=true` في `supabase/config.toml`.
- تتحقق الوظيفة من JWT عبر `auth.getUser(token)`.
- لا تقبل `user_id` من العميل؛ تستخرج المستخدم الهدف حصراً من `auth.user.id` الموثق.
- تستخدم Service Role داخلياً لاستدعاء RPC القديم الذي لا يمنح صلاحية authenticated، دون كشف المفتاح أو السماح للمستخدم باختيار حساب آخر.
- أصبح `incrementUserRequestCount` يستدعي الوظيفة عبر عميل Supabase المرتبط بجلسة المستخدم.

بهذا أصبحت وظائف الاشتراكات الـ19 جميعها خارج Service Role في Vercel. لا تزال الوظائف المالية/الإدارية الـ21 المتبقية تحتاج نقلًا ومراجعة صلاحيات.


## إكمال نقل Service Role من ملفات الإدارة والاشتراكات

أضيفت آخر actions المطلوبة:
- `admin-users:update_provider_name`
- `admin-users:provider_change_requests`
- `admin-users:dashboard_stats`
- `admin-governance:staff_activity`
- `bootstrap-admin:check/bootstrap`

وتم تحويل آخر Server Function wrappers إلى استدعاءات Supabase Edge Functions. فحص المصدر بعد التحديث:
- `src/lib/admin.functions.ts`: 60 وظيفة، صفر استخدامات `supabaseAdmin` داخل الوظائف.
- `src/lib/subscription.functions.ts`: 19 وظيفة، صفر استخدامات `supabaseAdmin` داخل الوظائف.
- الإجمالي: 79 وظيفة، صفر اعتماد مباشر على Service Role داخل خادم Vercel.

**حدود هذا الإنجاز:** هذا يزيل Service Role من طبقة Vercel في هذين الملفين، لكنه لا يعني أن TanStack Server Functions أزيلت بعد؛ ما زالت بعض الواجهات تستدعي wrappers على Vercel، وهذه تحتاج تحويل تدريجي إلى استدعاء Supabase مباشرة قبل اعتبار Vercel مستضيف واجهة فقط.

**التهيئة:** قاعدة البيانات تحتوي حالياً على مدير أعلى واحد. وظيفة bootstrap الجديدة تتطلب أسرار Supabase Function Secrets باسم `MAMNOON_BOOTSTRAP_ADMIN_EMAIL` و`MAMNOON_BOOTSTRAP_SECRET` إذا احتجنا إعادة تهيئة المدير الأعلى؛ لم يتم تعديل أي أسرار في هذا العمل.


## فجوة صلاحية تحتاج حسم قبل النشر — 17 نوفمبر 2026

ظهر اختلاف بين فحص الصلاحية في Edge Function وقيد قاعدة البيانات للإجراء `review_provider_change_request`:
- Edge Function يطلب `providers.verify`، ما قد يسمح لموظف محدود النطاق بالوصول إلى مسار الإجراء.
- RPC `admin_review_provider_change_request(uuid,text,text)` في قاعدة البيانات يستدعي `assert_staff('admin')`، ويقبل عملياً أدوار `admin` و`super_admin` فقط.
- النتيجة: قد ينجح فحص Edge ثم يرفض RPC الطلب؛ هذا خلل توافق صلاحيات وليس سبباً لتوسيع صلاحية RPC.

**الإجراء المطلوب:** إما جعل Edge Function يطلب نفس مستوى الإدارة الذي يفرضه RPC، أو تصميم RPC جديد بصلاحية دقيقة ونطاق محافظة واضح مع تدقيق واختبارات. لا نخفف قيد قاعدة البيانات ولا ننشر الوظيفة قبل حسم القرار واختبار الأدوار المسموحة والمرفوضة.
