-- Granular permission catalog for the Mamnoon owner control center.
-- This migration only registers capabilities; it does NOT grant them to staff.
-- The existing is_super_admin() path keeps the verified owner above all catalog grants.
begin;

insert into public.admin_permission_catalog
  (permission_key, domain, label_ar, risk_level, description, active)
values
  -- Dashboard and analytics
  ('dashboard.view','overview','عرض لوحة القيادة','normal','عرض مؤشرات التشغيل والتنبيهات'),
  ('analytics.view','reports','عرض التحليلات','normal','عرض مؤشرات الاستخدام والأداء'),
  ('analytics.export','reports','تصدير التحليلات','sensitive','تصدير تقارير التحليلات المسموح بها'),

  -- Customers and identity
  ('users.read','users','عرض العملاء','normal','عرض ملفات العملاء ضمن النطاق'),
  ('users.profile.edit','users','تعديل ملفات العملاء','sensitive','تعديل حقول الملف الشخصي المسموح بها'),
  ('users.block','users','حظر العملاء','sensitive','حظر حساب عميل مع تسجيل السبب'),
  ('users.unblock','users','رفع حظر العملاء','sensitive','رفع حظر حساب عميل مع تسجيل السبب'),
  ('users.roles.read','users','عرض أدوار المستخدمين','sensitive','عرض أدوار المستخدمين وتاريخها'),
  ('users.roles.manage','users','إدارة أدوار المستخدمين','critical','تغيير أدوار التطبيق دون المساس بحساب المالك'),
  ('users.privacy.export','users','تصدير بيانات الخصوصية','critical','تنفيذ طلبات تصدير البيانات بعد التحقق'),

  -- Providers, drivers, workers and fleet
  ('providers.read','providers','عرض مقدمي الخدمة','normal','عرض ملفات السائقين والفنيين'),
  ('providers.create','providers','إضافة مقدم خدمة','sensitive','إنشاء ملف مقدم خدمة وفق إجراءات التسجيل'),
  ('providers.profile.edit','providers','تعديل ملفات مقدمي الخدمة','sensitive','تعديل البيانات التشغيلية المسموح بها'),
  ('providers.verify','providers','توثيق مقدمي الخدمة','sensitive','قبول أو رفض مستندات التوثيق مع السبب'),
  ('providers.suspend','providers','إيقاف مقدمي الخدمة','critical','إيقاف مقدم خدمة أو إعادة تفعيله مع السبب'),
  ('providers.services.manage','providers','إدارة خدمات الفنيين','sensitive','إضافة أو تعديل أو إيقاف خدمات الفني'),
  ('fleet.read','fleet','عرض الأسطول والمركبات','normal','عرض المركبات والباصات والكيّات'),
  ('fleet.manage','fleet','إدارة الأسطول والمركبات','sensitive','إضافة وتعديل وإيقاف سجلات المركبات'),
  ('fleet.categories.manage','fleet','إدارة أصناف المركبات','critical','إدارة أصناف السيارات والكيّات والباصات'),

  -- Orders and dispatch
  ('orders.read','orders','عرض الطلبات','normal','عرض الطلبات ضمن النطاق'),
  ('orders.assign','orders','تعيين الطلبات','sensitive','تعيين الطلب أو إعادة توزيعه'),
  ('orders.cancel','orders','إلغاء الطلبات','sensitive','إلغاء الطلب مع سبب موثق'),
  ('orders.reopen','orders','إعادة فتح الطلبات','sensitive','إعادة فتح طلب مؤهل مع تسجيل السبب'),
  ('orders.override','orders','التدخل بحالات الطلب','critical','تجاوز حالة الطلب وفق ضوابط التدقيق'),
  ('dispatch.manage','orders','إدارة التوزيع الآلي','critical','إدارة إعدادات التوزيع وإعادة المحاولة ضمن النطاق'),
  ('dispatch.monitor','orders','مراقبة التوزيع','normal','عرض الطوابير وأسباب تعذر التعيين'),

  -- Pricing and geography
  ('pricing.taxi.read','pricing','عرض تعرفة التاكسي','normal','قراءة تعرفة التاكسي'),
  ('pricing.taxi.edit','pricing','تعديل تعرفة التاكسي','critical','تعديل أجور الانطلاق والكيلومتر والدقيقة والحد الأدنى'),
  ('pricing.vehicles.manage','pricing','تسعير أصناف المركبات','critical','تعديل تعرفة السيارات والكيّات والباصات كل على حدة'),
  ('pricing.services.read','pricing','عرض تسعير الخدمات','normal','عرض تعرفة الخدمات المنزلية والمهنية'),
  ('pricing.services.edit','pricing','تعديل تسعير الخدمات','critical','تعديل أجور الخدمات المنزلية والمهنية'),
  ('pricing.peak.edit','pricing','إدارة الذروة والاستعجال','critical','تعديل الذروة والاستعجال وحدودهما'),
  ('pricing.commission.edit','pricing','إدارة العمولات','critical','تعديل عمولات المنصة ومقدمي الخدمة'),
  ('pricing.preview','pricing','معاينة التسعيرة','normal','محاكاة السعر قبل اعتماده'),
  ('pricing.publish','pricing','اعتماد ونشر التسعيرة','critical','نشر نسخة تسعير جديدة بعد المعاينة والموافقة'),
  ('pricing.rollback','pricing','استرجاع نسخة تسعير سابقة','critical','الرجوع إلى نسخة تسعير سابقة موثقة'),
  ('regions.read','regions','عرض المحافظات والمناطق','normal','عرض إعدادات التغطية الجغرافية'),
  ('regions.manage','regions','إدارة المحافظات','critical','تفعيل أو إيقاف التغطية والخدمات حسب المحافظة'),
  ('zones.manage','regions','إدارة مناطق الخدمة والحظر','critical','إنشاء وتعديل مناطق التغطية والمناطق المحظورة'),
  ('routes.policy.manage','regions','إدارة ضوابط المسارات','critical','إدارة قواعد قبول المسارات والمناطق المسموح بها'),

  -- Promotions
  ('promotions.read','promotions','عرض الخصومات','normal','عرض الكوبونات والحملات'),
  ('promotions.create','promotions','إنشاء الخصومات','sensitive','إنشاء كوبون أو حملة جديدة'),
  ('promotions.edit','promotions','تعديل الخصومات','sensitive','تعديل شروط الكوبونات والحملات'),
  ('promotions.publish','promotions','نشر الخصومات','critical','نشر حملة أو كوبون للعملاء'),
  ('promotions.pause','promotions','إيقاف الخصومات','sensitive','إيقاف حملة أو كوبون'),
  ('promotions.delete','promotions','حذف الخصومات','critical','إلغاء سجل حملة غير مستخدم وفق سياسة الاحتفاظ'),
  ('promotions.budget.manage','promotions','إدارة ميزانية الحملات','critical','تحديد حدود الصرف والدعم المالي للحملات'),

  -- Wallet, finance and reconciliation
  ('finance.read','finance','عرض التقارير المالية','sensitive','قراءة السجلات المالية ضمن النطاق'),
  ('finance.wallet.read','finance','عرض المحافظ','sensitive','عرض أرصدة وحركات المحافظ المصرح بها'),
  ('finance.wallet.adjust','finance','تسوية المحفظة','critical','إجراء قيد تسوية مسبب في دفتر الأستاذ'),
  ('finance.refund.read','finance','عرض طلبات الاسترداد','sensitive','عرض عمليات الاسترداد وحالاتها'),
  ('finance.refund','finance','إرجاع المدفوعات','critical','إجراء استرداد عبر مسار الدفع المعتمد'),
  ('finance.settlement.manage','finance','إدارة التسويات','critical','إعداد ومراجعة دفعات التسوية'),
  ('finance.reconcile','finance','مطابقة الحسابات','critical','مطابقة المدفوعات والمحافظ والدفاتر'),
  ('finance.export','finance','تصدير التقارير المالية','critical','تصدير البيانات المالية بعد التحقق'),

  -- Subscriptions
  ('subscriptions.read','subscriptions','عرض الاشتراكات','normal','عرض الخطط واشتراكات المستخدمين'),
  ('subscriptions.plans.manage','subscriptions','إدارة خطط الاشتراك','sensitive','إنشاء وتعديل وإيقاف الخطط'),
  ('subscriptions.grant','subscriptions','منح الاشتراكات','sensitive','منح استحقاق اشتراك وفق السياسة'),
  ('subscriptions.revoke','subscriptions','سحب الاشتراكات','critical','سحب استحقاق اشتراك مع سبب'),

  -- Support and moderation
  ('support.read','support','عرض الدعم الفني','normal','عرض تذاكر ومحادثات الدعم المصرح بها'),
  ('support.manage','support','إدارة الدعم الفني','sensitive','الرد والتصنيف والإحالة وإغلاق التذاكر'),
  ('support.refund.request','support','طلب استرداد للدعم','sensitive','رفع طلب استرداد للمراجعة دون تنفيذه'),
  ('moderation.read','moderation','عرض البلاغات','normal','عرض البلاغات والمراجعات'),
  ('moderation.manage','moderation','إدارة البلاغات والمحتوى','sensitive','مراجعة البلاغات وإخفاء المحتوى وفق السياسة'),
  ('moderation.appeal','moderation','مراجعة الاعتراضات','sensitive','مراجعة اعتراضات الحظر والإجراءات'),

  -- Communications and content
  ('notifications.read','communications','عرض الإشعارات','normal','عرض الحملات وحالات الإرسال'),
  ('notifications.create','communications','إنشاء الإشعارات','sensitive','إنشاء مسودة إشعار'),
  ('notifications.send','communications','إرسال الإشعارات','critical','إرسال إشعارات للعملاء أو مقدمي الخدمة'),
  ('notifications.target','communications','استهداف الإشعارات','sensitive','تحديد الجمهور والمحافظة والفئة المستهدفة'),
  ('content.manage','communications','إدارة محتوى التطبيق','sensitive','إدارة النصوص واللافتات والمواد الظاهرة داخل التطبيق'),

  -- Platform settings and operations
  ('settings.read','platform','عرض إعدادات المنصة','normal','قراءة الإعدادات التشغيلية غير السرية'),
  ('settings.manage','platform','إدارة إعدادات المنصة','critical','تعديل الإعدادات التشغيلية غير السرية'),
  ('features.manage','platform','إدارة ميزات التطبيق','critical','تفعيل أو تعطيل ميزات التطبيق حسب المنصة أو المحافظة'),
  ('maintenance.manage','platform','إدارة وضع الصيانة','critical','تفعيل أو إنهاء وضع الصيانة'),
  ('app_versions.manage','platform','إدارة إصدارات التطبيق','critical','تحديد الحد الأدنى للإصدار وسياسة التحديث'),
  ('integrations.read','platform','عرض حالة الربط الخارجي','sensitive','عرض حالة الخرائط والرسائل وبوابات الدفع دون كشف الأسرار'),
  ('integrations.manage','platform','إدارة الربط الخارجي','critical','تغيير إعدادات الربط غير السرية واختبارها'),

  -- Staff governance and audit
  ('staff.read','staff','عرض الموظفين','normal','عرض الموظفين ضمن نطاق الإدارة'),
  ('staff.assign','staff','إضافة الموظفين','critical','إضافة موظف بصلاحيات لا تتجاوز صلاحيات المانح'),
  ('staff.manage_created','staff','إدارة الموظفين الذين أضافهم','critical','إدارة الموظفين الذين أنشأهم المدير حصراً'),
  ('staff.rank.manage','staff','إدارة رتب الموظفين','critical','تغيير رتبة موظف ضمن التسلسل الإداري'),
  ('staff.permissions.read','staff','عرض صلاحيات الموظفين','sensitive','عرض منح وتفويضات الصلاحيات'),
  ('staff.delegate','staff','تفويض الصلاحيات','critical','تفويض صلاحيات محددة ضمن نطاق ومدة'),
  ('staff.approve','staff','مراجعة طلبات الموافقة','critical','الموافقة أو الرفض مع منع الموافقة الذاتية'),
  ('staff.deactivate','staff','تعطيل الموظفين','critical','تعطيل موظف أدنى رتبة ضمن النطاق'),
  ('audit.read','audit','قراءة سجل التدقيق','sensitive','قراءة سجل العمليات والتغييرات'),
  ('audit.export','audit','تصدير سجل التدقيق','critical','تصدير سجل التدقيق مع تسجيل عملية التصدير'),
  ('reports.export','reports','تصدير التقارير','sensitive','تصدير التقارير المسموح بها')
on conflict (permission_key) do update set
  domain=excluded.domain,
  label_ar=excluded.label_ar,
  risk_level=excluded.risk_level,
  description=excluded.description,
  active=true;

commit;
