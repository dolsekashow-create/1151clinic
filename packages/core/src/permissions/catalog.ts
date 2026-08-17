import type { ModuleKey } from '@erp/types';

/**
 * كتالوج الصلاحيات — المصدر الوحيد للحقيقة.
 *
 * • الصيغة: `module.action`
 * • إضافة صلاحية = سطر واحد هنا + إعادة تشغيل الـ seed. لا تغيير في منطق العمل.
 * • هذه القائمة **مبدئية** ولم تُعتمد نهائيًا من العميل (راجع P-16 في REQUIREMENTS.md).
 */
export interface PermissionDefinition {
  readonly key: string;
  readonly module: ModuleKey;
  readonly action: string;
  readonly nameAr: string;
  /** صلاحيات حساسة تتطلب تدقيقًا إضافيًا عند المنح. */
  readonly sensitive?: boolean;
}

function define(
  module: ModuleKey,
  entries: ReadonlyArray<readonly [action: string, nameAr: string, sensitive?: boolean]>,
): PermissionDefinition[] {
  return entries.map(([action, nameAr, sensitive]) => ({
    key: `${module}.${action}`,
    module,
    action,
    nameAr,
    ...(sensitive ? { sensitive: true } : {}),
  }));
}

export const PERMISSIONS: readonly PermissionDefinition[] = [
  ...define('identity', [
    ['users.view', 'عرض المستخدمين'],
    ['users.create', 'إضافة مستخدم'],
    ['users.update', 'تعديل مستخدم'],
    ['users.delete', 'حذف مستخدم', true],
    ['roles.view', 'عرض الأدوار'],
    ['roles.manage', 'إدارة الأدوار والصلاحيات', true],
    ['branches.assign', 'إسناد الفروع للمستخدمين', true],
  ]),

  ...define('organizations', [
    ['organization.view', 'عرض بيانات المنشأة'],
    ['organization.update', 'تعديل بيانات المنشأة', true],
    ['branches.view', 'عرض الفروع'],
    ['branches.create', 'إضافة فرع'],
    ['branches.update', 'تعديل فرع'],
    // النشر منفصل عن التعديل عمدًا: تعديل فرع داخليًا ≠ إظهاره للعالم
    ['branches.publish', 'نشر/إخفاء فرع على الموقع العام', true],
    ['organization.publish', 'نشر/إخفاء المنشأة على الموقع العام', true],
    ['departments.view', 'عرض الأقسام'],
    ['departments.manage', 'إدارة الأقسام'],
  ]),

  ...define('customers', [
    ['view', 'عرض العملاء'],
    ['create', 'إضافة عميل'],
    ['update', 'تعديل عميل'],
    ['delete', 'حذف عميل', true],
  ]),

  ...define('services', [
    ['view', 'عرض الخدمات'],
    ['create', 'إضافة خدمة'],
    ['update', 'تعديل خدمة'],
    ['publish', 'نشر/إخفاء خدمة على الموقع العام', true],
    // مقدّمو الخدمة (الأطباء) كيان تشغيلي مستقل عن حسابات المستخدمين — RQ-02
    ['providers.view', 'عرض مقدّمي الخدمة'],
    ['providers.manage', 'إدارة مقدّمي الخدمة'],
    ['providers.publish', 'نشر/إخفاء مقدّم خدمة على الموقع العام', true],
  ]),

  ...define('appointments', [
    ['view', 'عرض الحجوزات'],
    ['create', 'إنشاء حجز'],
    ['update', 'تعديل حجز'],
    ['cancel', 'إلغاء حجز'],
  ]),

  ...define('inventory', [
    ['view', 'عرض المخزون'],
    ['create', 'إضافة صنف'],
    ['update', 'تعديل صنف'],
    ['transfer', 'تحويل مخزني'],
    ['adjust', 'تسوية مخزنية', true],
    ['warehouses.manage', 'إدارة المخازن'],
  ]),

  ...define('purchasing', [
    ['view', 'عرض المشتريات'],
    ['create', 'إنشاء طلب/أمر شراء'],
    ['approve', 'اعتماد المشتريات', true],
    ['receive', 'استلام المشتريات'],
    ['suppliers.view', 'عرض الموردين'],
    ['suppliers.manage', 'إدارة الموردين'],
  ]),

  ...define('finance', [
    ['view', 'عرض الحركات المالية'],
    ['create', 'تسجيل حركة مالية'],
    ['approve', 'اعتماد حركة مالية', true],
    ['treasury.view', 'عرض الخزائن'],
    ['treasury.manage', 'إدارة الخزائن', true],
    ['shifts.open', 'فتح وردية'],
    ['shifts.close', 'تقفيل وردية', true],
    ['shifts.view.all', 'عرض ورديات كل المستخدمين'],
    ['custody.handover', 'تسليم العهدة', true],
  ]),

  ...define('notifications', [
    ['view', 'عرض الإشعارات'],
    ['send', 'إرسال إشعار'],
    ['templates.manage', 'إدارة قوالب الرسائل'],
  ]),

  ...define('reports', [
    ['view', 'عرض التقارير'],
    ['export', 'تصدير التقارير', true],
  ]),

  ...define('audit', [['view', 'عرض سجل التدقيق', true]]),

  ...define('settings', [
    ['view', 'عرض الإعدادات'],
    ['update', 'تعديل الإعدادات', true],
  ]),
] as const;

/** مفاتيح الصلاحيات كنوع للتحقق عند الاستدعاء. */
export type PermissionKey = (typeof PERMISSIONS)[number]['key'];

const PERMISSION_KEYS = new Set(PERMISSIONS.map((p) => p.key));

export function isKnownPermission(key: string): boolean {
  return PERMISSION_KEYS.has(key);
}

export function permissionsByModule(module: ModuleKey): readonly PermissionDefinition[] {
  return PERMISSIONS.filter((p) => p.module === module);
}

/**
 * الأدوار الأولية — **بذرة قابلة للتعديل من الواجهة، وليست قاعدة عمل نهائية.**
 * راجع P-16 و Q-06 في REQUIREMENTS.md.
 */
export interface RoleSeed {
  readonly key: string;
  readonly nameAr: string;
  readonly isSystem: boolean;
  /** `'*'` = كل الصلاحيات. */
  readonly permissions: readonly string[] | '*';
}

export const INITIAL_ROLES: readonly RoleSeed[] = [
  { key: 'super_admin', nameAr: 'مدير النظام', isSystem: true, permissions: '*' },
  { key: 'company_admin', nameAr: 'مدير الشركة', isSystem: true, permissions: '*' },
  {
    key: 'branch_manager',
    nameAr: 'مدير فرع',
    isSystem: false,
    permissions: [
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
      'reports.view',
    ],
  },
  {
    key: 'reception',
    nameAr: 'استقبال',
    isSystem: false,
    permissions: [
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
      'notifications.send',
    ],
  },
  {
    key: 'accountant',
    nameAr: 'محاسب',
    isSystem: false,
    permissions: [
      'finance.view',
      'finance.create',
      'finance.treasury.view',
      'finance.shifts.view.all',
      'purchasing.view',
      'purchasing.suppliers.view',
      'reports.view',
      'reports.export',
    ],
  },
  {
    key: 'warehouse_manager',
    nameAr: 'مدير مخزن',
    isSystem: false,
    permissions: [
      'inventory.view',
      'inventory.create',
      'inventory.update',
      'inventory.transfer',
      'inventory.warehouses.manage',
      'purchasing.view',
      'purchasing.receive',
      'reports.view',
    ],
  },
  {
    key: 'purchasing',
    nameAr: 'مشتريات',
    isSystem: false,
    permissions: [
      'purchasing.view',
      'purchasing.create',
      'purchasing.suppliers.view',
      'purchasing.suppliers.manage',
      'inventory.view',
      'reports.view',
    ],
  },
  {
    key: 'employee',
    nameAr: 'موظف',
    isSystem: false,
    permissions: ['customers.view', 'services.view', 'services.providers.view', 'appointments.view'],
  },
] as const;
