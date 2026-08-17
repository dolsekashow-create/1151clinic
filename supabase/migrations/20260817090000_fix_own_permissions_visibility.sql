-- =============================================================================
--  Migration : 20260817090000_fix_own_permissions_visibility
--  Phase     : 2 (إصلاح) — المستخدم يقرأ صلاحياته الخاصة
--  السبب     : خلل تنفيذي مُكتشَف عند أول تشغيل فعلي للنظام بمستخدمين حقيقيين.
--
--  المشكلة (بيضة ودجاجة):
--    سياسة role_permissions_select تشترط صلاحية identity.roles.view.
--    لكن التطبيق يبني سياق الجلسة بقراءة role_permissions ليعرف ما يملكه
--    المستخدم. النتيجة: كل مستخدم لا يملك identity.roles.view يحصل على
--    permissions = [] فتظن الواجهة أنه بلا أي صلاحية.
--
--  الإثبات العملي:
--    sysadmin  (يملك identity.roles.view) → 56 صلاحية مرئية ✅
--    bm.ryd01  (لا يملكها)                → 0  صلاحية مرئية ❌
--    ولوحة المعلومات عرضت «لا تملك صلاحية العرض» لمدير فرع يملكها فعلًا.
--
--  ⚠️ حماية البيانات لم تكن مخترقة: app.has_permission دالة SECURITY DEFINER
--     تتجاوز RLS، فسياسات الجداول ظلّت تُنفّذ بشكل صحيح (أثبتته 41 اختبارًا
--     على الجداول التشغيلية). الخلل كان في **رؤية التطبيق لصلاحياته**، وهو
--     ما يجعل الواجهة تخفي كل شيء ويجعل requirePermission يرفض كل شيء.
--
--  الحل:
--    سياسة إضافية تسمح للمستخدم بقراءة روابط صلاحيات **الأدوار التي يحملها هو**.
--    لا تكشف صلاحيات أدوار أخرى، ولا تمس أي جدول بيانات، ولا تغيّر أي صلاحية
--    قائمة — سياسة SELECT إضافية فقط (السياسات المتعددة تُدمج بـ OR).
--
--  ملاحظة أمنية: لا تسريب فعلي — المستخدم يعرف صلاحياته أصلًا من قدراته،
--  وهذه السياسة تجعل ما يعرفه ضمنًا قابلًا للقراءة صريحًا.
-- =============================================================================

drop policy if exists role_permissions_select_own on public.role_permissions;

create policy role_permissions_select_own on public.role_permissions
  for select to authenticated
  using (
    (select app.is_active_user())
    and exists (
      select 1
      from public.user_roles ur
      where ur.role_id = role_permissions.role_id
        and ur.user_id = (select auth.uid())
    )
  );

comment on policy role_permissions_select_own on public.role_permissions is
  'يسمح للمستخدم بقراءة صلاحيات الأدوار التي يحملها هو — لازم لبناء سياق الجلسة. '
  'بدونها يحصل كل مستخدم لا يملك identity.roles.view على قائمة صلاحيات فارغة.';

-- -----------------------------------------------------------------------------
--  نفس المشكلة على جدول roles: المستخدم لا يستطيع قراءة اسم دوره الخاص.
--  لازمة لعرض «دورك: مدير فرع» في الواجهة بلا منحه إدارة الأدوار.
-- -----------------------------------------------------------------------------
drop policy if exists roles_select_own on public.roles;

create policy roles_select_own on public.roles
  for select to authenticated
  using (
    (select app.is_active_user())
    and exists (
      select 1
      from public.user_roles ur
      where ur.role_id = roles.id
        and ur.user_id = (select auth.uid())
    )
  );

comment on policy roles_select_own on public.roles is
  'يسمح للمستخدم بقراءة تعريف الأدوار التي يحملها هو فقط.';
