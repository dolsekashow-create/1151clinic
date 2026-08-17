import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PERMISSIONS } from '@erp/core';
import {
  Alert,
  Badge,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@erp/ui';
import { requireAuth } from '@/modules/auth/session';

export const metadata: Metadata = { title: 'كتالوج الصلاحيات' };
export const dynamic = 'force-dynamic';

const MODULE_LABELS: Record<string, string> = {
  identity: 'الهوية',
  organizations: 'التنظيم',
  customers: 'العملاء',
  services: 'الخدمات',
  appointments: 'الحجوزات',
  inventory: 'المخازن',
  purchasing: 'المشتريات',
  finance: 'المالية',
  notifications: 'الإشعارات',
  reports: 'التقارير',
  audit: 'التدقيق',
  settings: 'الإعدادات',
};

export default async function PermissionsPage() {
  const ctx = await requireAuth();
  if (!ctx.permissions.includes('identity.roles.view')) notFound();

  const grouped = new Map<string, typeof PERMISSIONS>();
  for (const permission of PERMISSIONS) {
    const list = grouped.get(permission.module) ?? [];
    grouped.set(permission.module, [...list, permission] as typeof PERMISSIONS);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="كتالوج الصلاحيات"
        description={`${PERMISSIONS.length} صلاحية موزّعة على ${grouped.size} وحدة`}
        breadcrumbs={[
          { label: 'الرئيسية', href: '/app' },
          { label: 'المستخدمون والصلاحيات' },
          { label: 'كتالوج الصلاحيات' },
        ]}
      />

      <Alert variant="info" title="مصدر الحقيقة واحد">
        هذا الكتالوج مُعرَّف في الكود ويُولَّد منه seed قاعدة البيانات، حتى لا يتفرّع مصدران
        للصلاحيات. القائمة مبدئية وقابلة للتوسع — إضافة صلاحية = سطر واحد، بلا تغيير في منطق العمل.
      </Alert>

      <div className="space-y-6">
        {[...grouped.entries()].map(([module, permissions]) => (
          <section key={module} className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground">
              {MODULE_LABELS[module] ?? module}
            </h2>
            <TableContainer>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-72">المفتاح</TableHead>
                    <TableHead>الوصف</TableHead>
                    <TableHead align="center" className="w-28">
                      الحساسية
                    </TableHead>
                    <TableHead align="center" className="w-24">
                      لديك؟
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {permissions.map((permission) => (
                    <TableRow key={permission.key}>
                      <TableCell className="font-mono text-xs" dir="ltr">
                        {permission.key}
                      </TableCell>
                      <TableCell>{permission.nameAr}</TableCell>
                      <TableCell align="center">
                        {permission.sensitive ? (
                          <Badge variant="warning">حساسة</Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell align="center">
                        {ctx.permissions.includes(permission.key) ? (
                          <Badge variant="success">نعم</Badge>
                        ) : (
                          <span className="text-muted-foreground">لا</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </section>
        ))}
      </div>
    </div>
  );
}
