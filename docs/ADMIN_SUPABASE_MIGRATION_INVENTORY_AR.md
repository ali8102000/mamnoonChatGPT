# جرد وظائف لوحة إدارة ممنون — خطة نقل الإدارة إلى Supabase

تاريخ الجرد: 17 نوفمبر 2026
الفرع: `chore/decouple-lovable-backend`
Supabase project ref: `enteiolvirenbhkyskgb`

## النتيجة التنفيذية

- `src/lib/admin.functions.ts`: عدد 60 Server Functions.
- `src/lib/subscription.functions.ts`: عدد 19 Server Functions.
- المجموع: 79 وظيفة واجهة/خادم.
- 26 من وظائف الإدارة و13 من وظائف الاشتراكات تستخدم `supabaseAdmin` (Service Role) مباشرة أو عبر استعلامات خادم، أي 39 وظيفة ما زالت تعتمد على خادم الويب ذي المفتاح السري.
- توجد أربع Edge Functions إدارية منشورة: `admin-users`, `admin-finance`, `admin-governance`, `admin-subscriptions`. وهي تغطي مجموعة من الإجراءات، لكن لا يوجد دليل حتى الآن أن كل واجهة الإدارة تستدعيها بدلاً من Server Functions.
- لا يجوز إزالة `SUPABASE_SERVICE_ROLE_KEY` من Vercel قبل نقل كل المسارات التي تعتمد عليه والتحقق من البديل.

## A. وظائف الإدارة الـ60

### 1. وظائف تستخدم Service Role مباشرة (26)
`checkSuperAdminExists`, `bootstrapSuperAdmin`, `adminSearchUsers`, `adminListUsers`, `adminGetUserDetail`, `adminUpdateProviderName`, `adminListProviders`, `adminListProviderChangeRequests`, `adminSetProviderStatus`, `adminListRequests`, `adminListTransactions`, `adminListCoupons`, `adminListReports`, `adminListFriends`, `adminListFriendRequests`, `adminListMessages`, `adminListChats`, `adminListStaffActivity`, `adminListAuditLogs`, `adminGetDashboardStats`, `adminGetLiveLocations`, `adminGetLiveRequests`, `adminGetMonitoringData`, `adminGetGovernorateUserStats`, `adminGetCustomerActivityStats`, `adminUpdateUserProfile`.

### 2. وظائف تعتمد على RPC عبر جلسة المستخدم (34)
`adminGrantRole`, `adminRevokeRole`, `adminListDepartmentStaff`, `adminPromoteStaffOneLevel`, `adminDeactivateStaff`, `adminSetStaffRank`, `getStaffRoles`, `adminBlockUser`, `adminUnblockUser`, `adminReviewProviderChangeRequest`, `adminCancelRequest`, `adminReopenRequest`, `adminAdjustWallet`, `adminSaveCoupon`, `adminCouponAudienceCount`, `adminDistributeCoupon`, `adminCouponSubsidyReport`, `adminDeleteCoupon`, `adminResolveReport`, `adminDeleteFriendship`, `adminDeleteFriendRequest`, `adminDeleteMessage`, `adminBroadcastNotification`, `adminBroadcastGovernorateNotification`, `adminGovernanceListStaff`, `adminGovernanceAssignStaff`, `adminGovernanceChangeRank`, `adminGovernanceDeactivateStaff`, `adminGovernanceGrantPricingPermissions`, `adminGovernanceGrantPermission`, `adminGovernanceCreateDelegation`, `adminGovernanceRevokePermission`, `adminGovernanceRevokeDelegation`, `adminGovernanceReviewApproval`.

ملاحظة: بعض الأسماء في المجموعة الثانية تستدعي RPCs ذات صلاحيات داخل PostgreSQL. لا يعني غياب فحص دور ظاهر في TypeScript أن الإجراء مفتوح تلقائياً؛ يجب فحص تنفيذ كل RPC وسياساته.

## B. وظائف الاشتراكات الـ19

### تستخدم Service Role (13)
`checkSubscriptionAllowed`, `getUserSubscription`, `incrementUserRequestCount`, `adminGetPlans`, `adminSavePlan`, `adminTogglePlan`, `adminGetSettings`, `adminSaveSettings`, `adminGetPayments`, `adminGetSubscriptions`, `adminAssignSubscription`, `adminSearchSubscriptionUsers`, `adminGrantSubscription`.

### تستخدم جلسة المستخدم/RPC (6)
`adminGetStats`, `adminSetSubscriptionStatus`, `adminExtendSubscription`, `adminPauseAllSubscriptions`, `adminGrantSubscriptionsBulk`, `adminBroadcastAnnouncement`.

## C. تغطية Edge Functions المنشورة

| Edge Function | الإجراءات التي ظهرت في الكود المنشور |
|---|---|
| `admin-users` | `list`, `search`, `detail`, `providers`, `requests`, `set_provider_status`, `cancel_request`, `reopen_request`, `block`, `unblock`, `live_map`, `reports`, `monitoring`, `resolve_report`, `chats`, `messages`, `delete_message`, `friends`, `friend_requests`, `delete_friendship`, `delete_friend_request`, `broadcast_notification`, `broadcast_governorate_notification`, `customer_activity_stats`, `governorate_stats`, `update_profile` |
| `admin-finance` | `search_users`, `list`, `adjust_wallet`, `save_coupon`, `audience_count`, `distribute_coupon`, `subsidy_report`, `delete_coupon` |
| `admin-governance` | `audit_logs`, `search_users`, `get_roles`, `grant_role`, `revoke_role` |
| `admin-subscriptions` | `list`, `search_users`, `save_plan`, `toggle_plan`, `save_settings`, `grant_subscription`, `set_status`, `extend`, `pause_all`, `grant_bulk`, `broadcast` |

التغطية الظاهرة تشير إلى تداخل جيد، لكنها ليست تكافؤاً كاملاً. يلزم مطابقة كل Server Function مع action فعلي ومدخلاته ومخرجاته والتحقق من صلاحياته قبل تحويل الاستدعاء.

## D. مراجعة صلاحيات قاعدة البيانات التي تمت

### إجراءات RPC ذات فحوص داخل PostgreSQL
فحصنا تعريفات مجموعة من RPCs التي تستدعيها وظائف TypeScript دون فحص role محلي. عدة إجراءات تتحقق من `auth.uid()` ثم من `has_admin_access` أو `admin_has_permission` أو `is_super_admin` أو من تسلسل الرتب/المدير المنشئ. من أمثلتها:
- `admin_adjust_wallet`
- `admin_save_coupon`, `admin_delete_coupon`, `admin_distribute_coupon`
- `admin_coupon_audience_count`, `admin_coupon_subsidy_report`
- `admin_assign_staff`, `admin_change_staff_rank`, `admin_deactivate_staff`
- `admin_grant_staff_permission`, `admin_create_delegation`, `admin_revoke_staff_permission`, `admin_revoke_delegation`
- `admin_review_approval`
- `staff_list_department`, `staff_promote_one_level`

### حالات تحتاج متابعة خاصة
- `bootstrap_first_super_admin`: يتحقق من `auth.role() = service_role`، كما أن استدعاء TypeScript محمي ببريد مدير متوقع وسر تهيئة طويل. يجب نقل سر التهيئة إلى Supabase Function Secrets، وإعادة تصميم التهيئة دون فتح RPC للمستخدمين.
- `admin_grant_pricing_permissions`: الدالة لا تستخدم SECURITY DEFINER، وتتحقق من `auth.uid()` والمدخلات، ثم تنفذ المنح عبر `admin_grant_staff_permission` لكل صلاحية/محافظة. تعريف الدالة المستدعاة يتحقق من صلاحية المدير أو تفويضه ونطاقه. لذلك لا يظهر أنها تتجاوز فحص الصلاحية، لكن يجب اختبارها عملياً بحساب لا يملك `pricing.taxi.edit` وحساب مخوّل قبل أي تغيير في grants.
- `checkSuperAdminExists`: قراءة وجود مدير أعلى تتم حالياً بواسطة Service Role. ينبغي تحديد ما إذا كان يمكن تقديم إشارة آمنة محدودة عبر Edge Function بدلاً من كشف بيانات الأدوار.

### صلاحيات anon
استعلام قاعدة البيانات لم يعثر على أي RPC إدارية عادية قابلة للتنفيذ مباشرة من `anon` ضمن قائمة RPCs المفحوصة. الدوال التي ظهرت في جرد anon كانت بالأساس trigger functions؛ يجب الإبقاء على تحليل صلاحياتها منفصلاً عن RPCs التي يستدعيها العميل.

## E. مثال مطابقة يمنع النقل العشوائي

تمت مقارنة `adminGetLiveLocations` مع action `live_map` في Edge Function `admin-users`:
- Server Function الحالي يستعمل `requireLiveOps` (RPC `has_live_ops_access`) ثم يعيد مصفوفة المواقع فقط.
- Edge action الحالي يستعمل قائمة أدوار ثابتة `super_admin/admin/support/department_operations/department_monitoring/rank:general_manager`، ويعيد كائناً يحوي `locations` و`requests`.
- لذلك لا يصح استبدال استدعاء الواجهة مباشرة؛ اختلاف الصلاحيات وشكل الاستجابة قد يكسر لوحة المراقبة أو يوسّع/يضيّق الوصول.
- قبل النقل، يجب توحيد فحص الصلاحيات مع `has_live_ops_access` أو إثبات تكافؤ قائمة الأدوار، ثم توفير adapter يحافظ على شكل الاستجابة الذي تتوقعه الواجهة، واختبار الدور والنطاق.

هذا مثال عملي على سبب عدم تنفيذ نقل جماعي تلقائي حتى لو كان اسم الـ action متشابهاً.

## F. خطة النقل المقترحة — بدون كسر الواجهات

1. **المرحلة الأولى: مطابقة العقود** — لكل وظيفة: استدعاء الواجهة، action المقابل، schema المدخلات، شكل المخرجات، الرسائل، صلاحيات القسم/المحافظة، وأثرها الجانبي.
2. **المرحلة الثانية: نقل مجموعات محددة** — نبدأ بقراءات لوحة الإدارة غير الحساسة التي لها action مطابق في `admin-users` أو `admin-governance`، ثم نبدّل استدعاء الواجهة بعد اختبار المقارنة.
3. **المرحلة الثالثة: العمليات المالية والتغييرات** — تُنقل فقط بعد إثبات أن صلاحيات RPC/Edge Function تطابق صلاحيات الواجهة، مع audit log واختبار رفض المستخدم غير المخوّل.
4. **المرحلة الرابعة: الاشتراكات** — نطابق 19 وظيفة مع `admin-subscriptions`، ونفصل عمليات المستخدم الذاتية عن وظائف الإدارة.
5. **المرحلة الخامسة: إزالة Service Role من Vercel** — بعد أن يصبح عدد استدعاءات `supabaseAdmin` في Server Functions صفراً أو محصوراً في استخدام موثق لا يمكن نقله، واختبار كل تدفق.
6. **الاختبار** — مستخدم عادي، سائق/فني، دعم، مالية، مشرف، مدير، مدير أعلى، ونطاق محافظة مقابل النطاق العام.

## حدود العمل الحالي
هذا جرد وتحليل قراءة فقط. لم تُعدّل RPCs أو RLS أو Edge Functions المنشورة، ولم تُغيّر أي قيمة سرية، ولم يُحوّل أي استدعاء واجهة بعد. إبقاء التنفيذ الحالي حتى اكتمال المقارنة أكثر أماناً من نقل جماعي غير مختبر.
