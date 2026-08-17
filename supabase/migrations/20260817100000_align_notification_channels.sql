-- =============================================================================
--  Migration : 20260817100000_align_notification_channels
--  Phase     : 5 (إصلاح) — توحيد قنوات الإشعارات بين القوالب والإشعارات
--  السبب     : تعارض مُكتشَف أثناء بذر بيئة التجربة.
--
--  المشكلة:
--    notifications.channel          يسمح بـ ('sms','email','push','whatsapp','in_app')
--    notification_templates.channel يسمح بـ ('sms','email','push','whatsapp')
--
--    ⇒ الإشعار داخل النظام (in_app) **لا يستطيع امتلاك قالب** إطلاقًا، رغم أن
--      عمود template_key موجود عليه. أي أن قناة كاملة بلا قدرة على القولبة.
--
--  الإثبات: فشل بذر قالب `shift_closed_notice` بقناة in_app:
--    new row for relation "notification_templates" violates check constraint
--
--  السبب الجذري: القيدان كُتبا في ترحيلين مختلفين بقائمتين مختلفتين، بلا
--  مصدر واحد يضبط القائمة. سهو لا قرار.
--
--  الحل: توحيد قائمة القوالب مع قائمة الإشعارات (إضافة in_app).
--    الاتجاه مقصود: القوالب تتبع الإشعارات لا العكس — لأن حذف in_app من
--    الإشعارات كان سيُلغي قناة مستخدمة فعلًا (14 إشعارًا في بيئة التجربة).
--
--  ⚠️ عملية توسيع لا تقييد: كل القيم المسموحة سابقًا تبقى مسموحة، فلا صف
--     قائم يمكن أن يخالف القيد الجديد ⇒ صفر خطر على البيانات.
--
--  لا قاعدة عمل هنا: متى تُرسل الرسائل وما نصّها يبقى P-17 معلّقًا.
-- =============================================================================

alter table public.notification_templates
  drop constraint if exists notification_templates_channel_check;

alter table public.notification_templates
  add constraint notification_templates_channel_check
  check (channel in ('sms', 'email', 'push', 'whatsapp', 'in_app'));

comment on column public.notification_templates.channel is
  'قناة القالب. القائمة مطابقة لـ notifications.channel عمدًا — أي قناة قابلة '
  'للإرسال يجب أن تكون قابلة للقولبة. لا تُعدَّل إحداهما بلا الأخرى.';
