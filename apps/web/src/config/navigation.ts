import type { ModuleKey } from '@erp/types';

/**
 * خريطة لوحة التحكم — مصدر واحد للتنقل والعناوين ومسارات التنقّل (breadcrumbs).
 *
 * كل عنصر مرتبط بـ:
 *  • `permission` → يُخفى العنصر إن لم يملكها المستخدم.
 *      ⚠️ إخفاء واجهة فقط. الحماية الفعلية في RLS والخادم؛ فتح الرابط يدويًا
 *        لا يمنح أي وصول للبيانات.
 *  • `phase`      → المرحلة التي تُنفَّذ فيها الشاشة.
 *  • `implemented`→ هل الشاشة مبنية فعلًا؟ الشاشات غير المبنية تعرض صفحة
 *      «قيد الإعداد» صريحة بدل واجهة وهمية توحي بوجود وظيفة.
 */
export interface NavItem {
  readonly key: string;
  readonly label: string;
  readonly href: string;
  readonly module: ModuleKey;
  readonly permission: string | null;
  readonly phase: 1 | 2 | 3 | 4 | 5 | 6;
  readonly implemented: boolean;
  readonly icon: NavIconKey;
  readonly description?: string;
}

export interface NavSection {
  readonly key: string;
  readonly label: string;
  readonly items: readonly NavItem[];
}

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
        href: '/app',
        module: 'organizations',
        permission: null,
        phase: 1,
        implemented: true,
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
        href: '/app/organization',
        module: 'organizations',
        permission: 'organizations.organization.view',
        phase: 3,
        implemented: true,
        icon: 'building',
        description: 'بيانات المنشأة والإعدادات العامة',
      },
      {
        key: 'branches',
        label: 'الفروع',
        href: '/app/branches',
        module: 'organizations',
        permission: 'organizations.branches.view',
        phase: 3,
        implemented: true,
        icon: 'store',
        description: 'إدارة الفروع وبياناتها',
      },
      {
        key: 'departments',
        label: 'الأقسام والإدارات',
        href: '/app/departments',
        module: 'organizations',
        permission: 'organizations.departments.view',
        phase: 3,
        implemented: true,
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
        href: '/app/users',
        module: 'identity',
        permission: 'identity.users.view',
        phase: 3,
        implemented: true,
        icon: 'users',
        description: 'المستخدمون وأدوارهم وفروعهم',
      },
      {
        key: 'roles',
        label: 'الأدوار والصلاحيات',
        href: '/app/roles',
        module: 'identity',
        permission: 'identity.roles.view',
        phase: 3,
        implemented: true,
        icon: 'shield',
      },
      {
        key: 'permissions',
        label: 'كتالوج الصلاحيات',
        href: '/app/permissions',
        module: 'identity',
        permission: 'identity.roles.view',
        phase: 2,
        implemented: true,
        icon: 'key',
        description: 'مرجع الصلاحيات المتاحة في النظام',
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
        href: '/app/customers',
        module: 'customers',
        permission: 'customers.view',
        phase: 3,
        implemented: true,
        icon: 'contact',
        description: 'سجل العملاء',
      },
      {
        key: 'appointments',
        label: 'الحجوزات',
        href: '/app/appointments',
        module: 'appointments',
        permission: 'appointments.view',
        phase: 4,
        implemented: true,
        icon: 'calendar',
      },
      {
        key: 'providers',
        label: 'الأطباء ومقدّمو الخدمة',
        href: '/app/providers',
        module: 'services',
        permission: 'services.providers.view',
        phase: 3,
        implemented: true,
        icon: 'stethoscope',
      },
      {
        key: 'services',
        label: 'الخدمات',
        href: '/app/services',
        module: 'services',
        permission: 'services.view',
        phase: 3,
        implemented: true,
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
        href: '/app/inventory',
        module: 'inventory',
        permission: 'inventory.view',
        phase: 4,
        implemented: false,
        icon: 'package',
      },
      {
        key: 'warehouses',
        label: 'المخازن',
        href: '/app/warehouses',
        module: 'inventory',
        permission: 'inventory.warehouses.manage',
        phase: 4,
        implemented: false,
        icon: 'warehouse',
      },
      {
        key: 'purchasing',
        label: 'المشتريات',
        href: '/app/purchasing',
        module: 'purchasing',
        permission: 'purchasing.view',
        phase: 4,
        implemented: false,
        icon: 'shoppingCart',
      },
      {
        key: 'suppliers',
        label: 'الموردون',
        href: '/app/suppliers',
        module: 'purchasing',
        permission: 'purchasing.suppliers.view',
        phase: 4,
        implemented: false,
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
        href: '/app/transactions',
        module: 'finance',
        permission: 'finance.view',
        phase: 4,
        implemented: false,
        icon: 'receipt',
      },
      {
        key: 'treasury',
        label: 'الخزائن',
        href: '/app/treasury',
        module: 'finance',
        permission: 'finance.treasury.view',
        phase: 4,
        implemented: false,
        icon: 'vault',
      },
      {
        key: 'shifts',
        label: 'الورديات',
        href: '/app/shifts',
        module: 'finance',
        permission: 'finance.shifts.open',
        phase: 4,
        implemented: false,
        icon: 'clock',
      },
      {
        key: 'expenses',
        label: 'المصروفات والإيرادات',
        href: '/app/expenses',
        module: 'finance',
        permission: 'finance.view',
        phase: 4,
        implemented: false,
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
        href: '/app/notifications',
        module: 'notifications',
        permission: 'notifications.view',
        phase: 5,
        implemented: false,
        icon: 'bell',
      },
      {
        key: 'reports',
        label: 'التقارير',
        href: '/app/reports',
        module: 'reports',
        permission: 'reports.view',
        phase: 6,
        implemented: false,
        icon: 'barChart',
      },
      {
        key: 'audit',
        label: 'سجل التدقيق',
        href: '/app/audit',
        module: 'audit',
        permission: 'audit.view',
        phase: 6,
        implemented: true,
        icon: 'history',
      },
      {
        key: 'settings',
        label: 'الإعدادات',
        href: '/app/settings',
        module: 'settings',
        permission: 'settings.view',
        phase: 3,
        implemented: false,
        icon: 'settings',
      },
    ],
  },
] as const;

const ITEMS_BY_HREF = new Map(
  NAVIGATION.flatMap((section) => section.items).map((item) => [item.href, item]),
);

export function findNavItem(href: string): NavItem | undefined {
  return ITEMS_BY_HREF.get(href);
}

export function findSectionOf(href: string): NavSection | undefined {
  return NAVIGATION.find((section) => section.items.some((item) => item.href === href));
}

/** يُرشّح القائمة حسب صلاحيات المستخدم — لتحسين التجربة لا للحماية. */
export function visibleNavigation(permissions: readonly string[]): NavSection[] {
  return NAVIGATION.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) => item.permission === null || permissions.includes(item.permission),
    ),
  })).filter((section) => section.items.length > 0);
}
