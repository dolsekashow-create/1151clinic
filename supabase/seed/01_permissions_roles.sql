-- =============================================================================
--  ⚠️  ملف مُولّد آليًا — لا تُعدّله يدويًا.
--  المصدر : packages/core/src/permissions/catalog.ts
--  التوليد: pnpm db:seed:generate
--
--  يحتوي بيانات مرجعية فقط: الصلاحيات والأدوار الأولية.
--  ⛔ ممنوع وضع أي بيانات عملاء أو مالية أو أسرار هنا.
-- =============================================================================

-- 1) الصلاحيات
insert into public.permissions (key, module, action, name_ar, is_sensitive) values
  ('identity.users.view', 'identity', 'users.view', 'عرض المستخدمين', false),
  ('identity.users.create', 'identity', 'users.create', 'إضافة مستخدم', false),
  ('identity.users.update', 'identity', 'users.update', 'تعديل مستخدم', false),
  ('identity.users.delete', 'identity', 'users.delete', 'حذف مستخدم', true),
  ('identity.roles.view', 'identity', 'roles.view', 'عرض الأدوار', false),
  ('identity.roles.manage', 'identity', 'roles.manage', 'إدارة الأدوار والصلاحيات', true),
  ('identity.branches.assign', 'identity', 'branches.assign', 'إسناد الفروع للمستخدمين', true),
  ('organizations.organization.view', 'organizations', 'organization.view', 'عرض بيانات المنشأة', false),
  ('organizations.organization.update', 'organizations', 'organization.update', 'تعديل بيانات المنشأة', true),
  ('organizations.branches.view', 'organizations', 'branches.view', 'عرض الفروع', false),
  ('organizations.branches.create', 'organizations', 'branches.create', 'إضافة فرع', false),
  ('organizations.branches.update', 'organizations', 'branches.update', 'تعديل فرع', false),
  ('organizations.branches.publish', 'organizations', 'branches.publish', 'نشر/إخفاء فرع على الموقع العام', true),
  ('organizations.organization.publish', 'organizations', 'organization.publish', 'نشر/إخفاء المنشأة على الموقع العام', true),
  ('organizations.departments.view', 'organizations', 'departments.view', 'عرض الأقسام', false),
  ('organizations.departments.manage', 'organizations', 'departments.manage', 'إدارة الأقسام', false),
  ('customers.view', 'customers', 'view', 'عرض العملاء', false),
  ('customers.create', 'customers', 'create', 'إضافة عميل', false),
  ('customers.update', 'customers', 'update', 'تعديل عميل', false),
  ('customers.delete', 'customers', 'delete', 'حذف عميل', true),
  ('services.view', 'services', 'view', 'عرض الخدمات', false),
  ('services.create', 'services', 'create', 'إضافة خدمة', false),
  ('services.update', 'services', 'update', 'تعديل خدمة', false),
  ('services.publish', 'services', 'publish', 'نشر/إخفاء خدمة على الموقع العام', true),
  ('services.providers.view', 'services', 'providers.view', 'عرض مقدّمي الخدمة', false),
  ('services.providers.manage', 'services', 'providers.manage', 'إدارة مقدّمي الخدمة', false),
  ('services.providers.publish', 'services', 'providers.publish', 'نشر/إخفاء مقدّم خدمة على الموقع العام', true),
  ('appointments.view', 'appointments', 'view', 'عرض الحجوزات', false),
  ('appointments.create', 'appointments', 'create', 'إنشاء حجز', false),
  ('appointments.update', 'appointments', 'update', 'تعديل حجز', false),
  ('appointments.cancel', 'appointments', 'cancel', 'إلغاء حجز', false),
  ('inventory.view', 'inventory', 'view', 'عرض المخزون', false),
  ('inventory.create', 'inventory', 'create', 'إضافة صنف', false),
  ('inventory.update', 'inventory', 'update', 'تعديل صنف', false),
  ('inventory.transfer', 'inventory', 'transfer', 'تحويل مخزني', false),
  ('inventory.adjust', 'inventory', 'adjust', 'تسوية مخزنية', true),
  ('inventory.warehouses.manage', 'inventory', 'warehouses.manage', 'إدارة المخازن', false),
  ('purchasing.view', 'purchasing', 'view', 'عرض المشتريات', false),
  ('purchasing.create', 'purchasing', 'create', 'إنشاء طلب/أمر شراء', false),
  ('purchasing.approve', 'purchasing', 'approve', 'اعتماد المشتريات', true),
  ('purchasing.receive', 'purchasing', 'receive', 'استلام المشتريات', false),
  ('purchasing.suppliers.view', 'purchasing', 'suppliers.view', 'عرض الموردين', false),
  ('purchasing.suppliers.manage', 'purchasing', 'suppliers.manage', 'إدارة الموردين', false),
  ('finance.view', 'finance', 'view', 'عرض الحركات المالية', false),
  ('finance.create', 'finance', 'create', 'تسجيل حركة مالية', false),
  ('finance.approve', 'finance', 'approve', 'اعتماد حركة مالية', true),
  ('finance.treasury.view', 'finance', 'treasury.view', 'عرض الخزائن', false),
  ('finance.treasury.manage', 'finance', 'treasury.manage', 'إدارة الخزائن', true),
  ('finance.shifts.open', 'finance', 'shifts.open', 'فتح وردية', false),
  ('finance.shifts.close', 'finance', 'shifts.close', 'تقفيل وردية', true),
  ('finance.shifts.view.all', 'finance', 'shifts.view.all', 'عرض ورديات كل المستخدمين', false),
  ('finance.custody.handover', 'finance', 'custody.handover', 'تسليم العهدة', true),
  ('notifications.view', 'notifications', 'view', 'عرض الإشعارات', false),
  ('notifications.send', 'notifications', 'send', 'إرسال إشعار', false),
  ('notifications.templates.manage', 'notifications', 'templates.manage', 'إدارة قوالب الرسائل', false),
  ('reports.view', 'reports', 'view', 'عرض التقارير', false),
  ('reports.export', 'reports', 'export', 'تصدير التقارير', true),
  ('audit.view', 'audit', 'view', 'عرض سجل التدقيق', true),
  ('settings.view', 'settings', 'view', 'عرض الإعدادات', false),
  ('settings.update', 'settings', 'update', 'تعديل الإعدادات', true)
on conflict (key) do update set
  module = excluded.module,
  action = excluded.action,
  name_ar = excluded.name_ar,
  is_sensitive = excluded.is_sensitive;

-- 2) الأدوار النظامية الأولية (organization_id = null ⇒ متاحة لكل المنشآت)
--    ⚠️ بذرة قابلة للتعديل من الواجهة — ليست قرارًا نهائيًا (P-16).
insert into public.roles (organization_id, key, name_ar, is_system) values
  (null, 'super_admin', 'مدير النظام', true),
  (null, 'company_admin', 'مدير الشركة', true),
  (null, 'branch_manager', 'مدير فرع', false),
  (null, 'reception', 'استقبال', false),
  (null, 'accountant', 'محاسب', false),
  (null, 'warehouse_manager', 'مدير مخزن', false),
  (null, 'purchasing', 'مشتريات', false),
  (null, 'employee', 'موظف', false)
on conflict (coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), key) do update set name_ar = excluded.name_ar, is_system = excluded.is_system;

-- 3) ربط الأدوار بالصلاحيات
delete from public.role_permissions rp
  using public.roles r
 where rp.role_id = r.id and r.organization_id is null;

-- مدير النظام (super_admin)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
 where r.key = 'super_admin' and r.organization_id is null
on conflict do nothing;

-- مدير الشركة (company_admin)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
 where r.key = 'company_admin' and r.organization_id is null
on conflict do nothing;

-- مدير فرع (branch_manager)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in (
  'identity.users.view',
  'organizations.branches.view',
  'organizations.departments.view',
  'customers.view',
  'customers.create',
  'customers.update',
  'services.view',
  'services.providers.view',
  'appointments.view',
  'appointments.create',
  'appointments.update',
  'appointments.cancel',
  'inventory.view',
  'purchasing.view',
  'finance.view',
  'finance.shifts.view.all',
  'reports.view'
) where r.key = 'branch_manager' and r.organization_id is null
on conflict do nothing;

-- استقبال (reception)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in (
  'customers.view',
  'customers.create',
  'customers.update',
  'services.view',
  'services.providers.view',
  'appointments.view',
  'appointments.create',
  'appointments.update',
  'appointments.cancel',
  'finance.shifts.open',
  'notifications.send'
) where r.key = 'reception' and r.organization_id is null
on conflict do nothing;

-- محاسب (accountant)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in (
  'finance.view',
  'finance.create',
  'finance.treasury.view',
  'finance.shifts.view.all',
  'purchasing.view',
  'purchasing.suppliers.view',
  'reports.view',
  'reports.export'
) where r.key = 'accountant' and r.organization_id is null
on conflict do nothing;

-- مدير مخزن (warehouse_manager)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in (
  'inventory.view',
  'inventory.create',
  'inventory.update',
  'inventory.transfer',
  'inventory.warehouses.manage',
  'purchasing.view',
  'purchasing.receive',
  'reports.view'
) where r.key = 'warehouse_manager' and r.organization_id is null
on conflict do nothing;

-- مشتريات (purchasing)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in (
  'purchasing.view',
  'purchasing.create',
  'purchasing.suppliers.view',
  'purchasing.suppliers.manage',
  'inventory.view',
  'reports.view'
) where r.key = 'purchasing' and r.organization_id is null
on conflict do nothing;

-- موظف (employee)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in (
  'customers.view',
  'services.view',
  'services.providers.view',
  'appointments.view'
) where r.key = 'employee' and r.organization_id is null
on conflict do nothing;

