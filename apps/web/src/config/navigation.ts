import type { ModuleKey } from '@erp/types';

/**
 * خريطة لوحة التحكم.
 *
 * كل عنصر مرتبط بـ:
 *  • `permission` → سيُستخدم لإخفاء/إظهار العنصر بدءًا من Phase 2
 *    (إخفاء واجهة فقط — الحماية الفعلية في RLS والخادم).
 *  • `phase`      → المرحلة التي تُنفَّذ فيها الشاشة.
 *  • `href`       → يُضاف فقط عند وجود صفحة فعلية. العناصر بلا رابط معطّلة عمدًا
 *                   بدل أن تقود إلى صفحات فارغة.
 */
export interface NavItem {
  readonly key: string;
  readonly label: string;
  readonly module: ModuleKey;
  readonly permission: string | null;
  readonly phase: 1 | 2 | 3 | 4 | 5 | 6;
  readonly href?: string;
  readonly icon: NavIconKey;
}

export interface NavSection {
  readonly key: string;
  readonly label: string;
  readonly items: readonly NavItem[];
}

/** أسماء أيقونات lucide المستخدمة — تُربط في مكوّن الشريط الجانبي. */
export type NavIconKey =
  | 'gauge'
  | 'building'
  | 'store'
  | 'network'
  | 'users'
  | 'shield'
  | 'key'
  | 'contact'
  | 'calendar'
  | 'stethoscope'
  | 'sparkles'
  | 'package'
  | 'warehouse'
  | 'shoppingCart'
  | 'truck'
  | 'wallet'
  | 'vault'
  | 'clock'
  | 'receipt'
  | 'bell'
  | 'barChart'
  | 'history'
  | 'settings';

export const NAVIGATION: readonly NavSection[] = [
  {
    key: 'overview',
    label: 'نظرة عامة',
    items: [
      {
        key: 'dashboard',
        label: 'لوحة المعلومات',
        module: 'organizations',
        permission: null,
        phase: 1,
        href: '/dashboard',
        icon: 'gauge',
      },
    ],
  },
  {
    key: 'organization',
    label: 'التنظيم',
    items: [
      {
        key: 'organization',
        label: 'بيانات المنشأة',
        module: 'organizations',
        permission: 'organizations.organization.view',
        phase: 3,
        icon: 'building',
      },
      {
        key: 'branches',
        label: 'الفروع',
        module: 'organizations',
        permission: 'organizations.branches.view',
        phase: 3,
        icon: 'store',
      },
      {
        key: 'departments',
        label: 'الأقسام والإدارات',
        module: 'organizations',
        permission: 'organizations.departments.view',
        phase: 3,
        icon: 'network',
      },
    ],
  },
  {
    key: 'identity',
    label: 'المستخدمون والصلاحيات',
    items: [
      {
        key: 'users',
        label: 'المستخدمون',
        module: 'identity',
        permission: 'identity.users.view',
        phase: 2,
        icon: 'users',
      },
      {
        key: 'roles',
        label: 'الأدوار',
        module: 'identity',
        permission: 'identity.roles.view',
        phase: 2,
        icon: 'shield',
      },
      {
        key: 'permissions',
        label: 'الصلاحيات',
        module: 'identity',
        permission: 'identity.roles.manage',
        phase: 2,
        icon: 'key',
      },
    ],
  },
  {
    key: 'operations',
    label: 'العمليات',
    items: [
      {
        key: 'customers',
        label: 'العملاء',
        module: 'customers',
        permission: 'customers.view',
        phase: 3,
        icon: 'contact',
      },
      {
        key: 'appointments',
        label: 'الحجوزات',
        module: 'appointments',
        permission: 'appointments.view',
        phase: 4,
        icon: 'calendar',
      },
      {
        key: 'staff',
        label: 'الأطباء والموظفون',
        module: 'identity',
        permission: 'identity.users.view',
        phase: 3,
        icon: 'stethoscope',
      },
      {
        key: 'services',
        label: 'الخدمات',
        module: 'services',
        permission: 'services.view',
        phase: 3,
        icon: 'sparkles',
      },
    ],
  },
  {
    key: 'supply',
    label: 'المخازن والمشتريات',
    items: [
      {
        key: 'inventory',
        label: 'المخزون',
        module: 'inventory',
        permission: 'inventory.view',
        phase: 4,
        icon: 'package',
      },
      {
        key: 'warehouses',
        label: 'المخازن',
        module: 'inventory',
        permission: 'inventory.warehouses.manage',
        phase: 4,
        icon: 'warehouse',
      },
      {
        key: 'purchasing',
        label: 'المشتريات',
        module: 'purchasing',
        permission: 'purchasing.view',
        phase: 4,
        icon: 'shoppingCart',
      },
      {
        key: 'suppliers',
        label: 'الموردون',
        module: 'purchasing',
        permission: 'purchasing.suppliers.view',
        phase: 4,
        icon: 'truck',
      },
    ],
  },
  {
    key: 'finance',
    label: 'المالية',
    items: [
      {
        key: 'transactions',
        label: 'الحركات المالية',
        module: 'finance',
        permission: 'finance.view',
        phase: 4,
        icon: 'receipt',
      },
      {
        key: 'treasury',
        label: 'الخزائن',
        module: 'finance',
        permission: 'finance.treasury.view',
        phase: 4,
        icon: 'vault',
      },
      {
        key: 'shifts',
        label: 'الورديات',
        module: 'finance',
        permission: 'finance.shifts.open',
        phase: 4,
        icon: 'clock',
      },
      {
        key: 'expenses',
        label: 'المصروفات والإيرادات',
        module: 'finance',
        permission: 'finance.view',
        phase: 4,
        icon: 'wallet',
      },
    ],
  },
  {
    key: 'system',
    label: 'النظام',
    items: [
      {
        key: 'notifications',
        label: 'الإشعارات',
        module: 'notifications',
        permission: 'notifications.view',
        phase: 5,
        icon: 'bell',
      },
      {
        key: 'reports',
        label: 'التقارير',
        module: 'reports',
        permission: 'reports.view',
        phase: 6,
        icon: 'barChart',
      },
      {
        key: 'audit',
        label: 'سجل التدقيق',
        module: 'audit',
        permission: 'audit.view',
        phase: 6,
        icon: 'history',
      },
      {
        key: 'settings',
        label: 'الإعدادات',
        module: 'settings',
        permission: 'settings.view',
        phase: 3,
        icon: 'settings',
      },
    ],
  },
] as const;
