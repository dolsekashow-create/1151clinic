'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search, UserPlus, X } from 'lucide-react';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Input,
  Pagination,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeleton,
} from '@erp/ui';
import type { ApiErrorShape, Paginated } from '@erp/types';
import type { CustomerRow } from '../repository';
import { CustomerCreateDrawer } from './customer-create-drawer';

const STATUS_LABELS: Record<string, { label: string; variant: 'success' | 'neutral' | 'danger' }> = {
  active: { label: 'نشط', variant: 'success' },
  inactive: { label: 'غير نشط', variant: 'neutral' },
  blocked: { label: 'محظور', variant: 'danger' },
};

export interface CustomersTableProps {
  result: Paginated<CustomerRow> | null;
  error: ApiErrorShape | null;
  branches: ReadonlyArray<{ id: string; nameAr: string }>;
  canCreate: boolean;
  defaultBranchId: string | null;
}

/**
 * جدول العملاء.
 *
 * حالة الفلاتر تعيش في عنوان الصفحة (URL) وليس في حالة المكوّن:
 * الرابط يصبح قابلًا للمشاركة والحفظ، ويعمل زر رجوع المتصفح كما يتوقع المستخدم،
 * والترقيم والبحث ينفَّذان في الخادم لا في المتصفح.
 */
export function CustomersTable({
  result,
  error,
  branches,
  canCreate,
  defaultBranchId,
}: CustomersTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [searchTerm, setSearchTerm] = useState(searchParams.get('search') ?? '');

  useEffect(() => {
    setSearchTerm(searchParams.get('search') ?? '');
  }, [searchParams]);

  const applyParams = useCallback(
    (changes: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(changes)) {
        if (value === null || value === '') params.delete(key);
        else params.set(key, value);
      }
      // أي تغيير في الفلترة يعيد الترقيم للصفحة الأولى
      if (!('page' in changes)) params.delete('page');
      startTransition(() => {
        router.replace(`${pathname}?${params.toString()}`);
      });
    },
    [pathname, router, searchParams],
  );

  const activeStatus = searchParams.get('status') ?? '';
  const activeBranch = searchParams.get('branchId') ?? '';
  const hasFilters = Boolean(searchParams.get('search') || activeStatus || activeBranch);

  if (error) {
    return <ErrorState description={error.message} code={error.code} onRetry={() => router.refresh()} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="flex min-w-64 flex-1 items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            applyParams({ search: searchTerm.trim() || null });
          }}
        >
          <Input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="بحث بالاسم أو الهاتف أو الكود…"
            startAdornment={<Search aria-hidden />}
            aria-label="بحث في العملاء"
          />
          <Button type="submit" variant="secondary" loading={pending}>
            بحث
          </Button>
        </form>

        {branches.length > 1 ? (
          <Select
            value={activeBranch || 'all'}
            onValueChange={(value) => applyParams({ branchId: value === 'all' ? null : value })}
          >
            <SelectTrigger className="w-44" aria-label="تصفية حسب الفرع">
              <SelectValue placeholder="كل الفروع" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الفروع</SelectItem>
              {branches.map((branch) => (
                <SelectItem key={branch.id} value={branch.id}>
                  {branch.nameAr}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        <Select
          value={activeStatus || 'all'}
          onValueChange={(value) => applyParams({ status: value === 'all' ? null : value })}
        >
          <SelectTrigger className="w-36" aria-label="تصفية حسب الحالة">
            <SelectValue placeholder="كل الحالات" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الحالات</SelectItem>
            <SelectItem value="active">نشط</SelectItem>
            <SelectItem value="inactive">غير نشط</SelectItem>
            <SelectItem value="blocked">محظور</SelectItem>
          </SelectContent>
        </Select>

        {hasFilters ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => applyParams({ search: null, status: null, branchId: null })}
          >
            <X aria-hidden />
            مسح الفلاتر
          </Button>
        ) : null}

        {canCreate ? (
          <CustomerCreateDrawer branches={branches} defaultBranchId={defaultBranchId} />
        ) : null}
      </div>

      <TableContainer>
        {pending && !result ? (
          <TableSkeleton rows={6} columns={5} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الاسم</TableHead>
                <TableHead>الهاتف</TableHead>
                <TableHead>الكود</TableHead>
                <TableHead>الفرع</TableHead>
                <TableHead align="center">الحالة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(result?.items ?? []).map((customer) => {
                const status = STATUS_LABELS[customer.status] ?? {
                  label: customer.status,
                  variant: 'neutral' as const,
                };
                const branch = branches.find((item) => item.id === customer.branchId);
                return (
                  <TableRow key={customer.id}>
                    <TableCell className="font-medium">{customer.fullNameAr}</TableCell>
                    <TableCell numeric dir="ltr" className="text-end">
                      {customer.phone}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{customer.code ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{branch?.nameAr ?? '—'}</TableCell>
                    <TableCell align="center">
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {result && result.items.length === 0 ? (
          <EmptyState
            icon={<UserPlus aria-hidden />}
            title={hasFilters ? 'لا توجد نتائج مطابقة' : 'لا يوجد عملاء بعد'}
            description={
              hasFilters
                ? 'جرّب تعديل كلمات البحث أو مسح الفلاتر.'
                : 'ابدأ بإضافة أول عميل في الفرع.'
            }
          />
        ) : null}
      </TableContainer>

      {result && result.meta.total > 0 ? (
        <Pagination
          page={result.meta.page}
          pageSize={result.meta.pageSize}
          total={result.meta.total}
          onPageChange={(page) => applyParams({ page: String(page) })}
          onPageSizeChange={(pageSize) => applyParams({ pageSize: String(pageSize), page: null })}
        />
      ) : null}
    </div>
  );
}
