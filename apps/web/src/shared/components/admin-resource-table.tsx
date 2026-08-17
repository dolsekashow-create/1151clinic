'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search, X } from 'lucide-react';
import {
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
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeleton,
} from '@erp/ui';
import type { ApiErrorShape, Paginated } from '@erp/types';

export interface AdminColumn {
  key: string;
  label: string;
  align?: 'start' | 'center' | 'end';
  width?: string;
}

export interface AdminResourceTableProps<T> {
  result: Paginated<T> | null;
  error: ApiErrorShape | null;
  columns: readonly AdminColumn[];
  renderRow: (item: T) => React.ReactNode;
  searchPlaceholder: string;
  emptyTitle: string;
  emptyDescription?: string;
  /** أزرار الإجراءات (مثل «جديد») تُمرَّر من الصفحة. */
  actions?: React.ReactNode;
  /** يُظهر مُرشِّح حالة النشر. */
  showPublishFilter?: boolean;
}

/**
 * جدول إدارة مشترك: بحث + مُرشِّحات + ترقيم من الخادم.
 *
 * حالة المُرشِّحات في عنوان الصفحة لا في حالة المكوّن ⇒ الرابط قابل للمشاركة،
 * وزر رجوع المتصفح يعمل كما يتوقع المستخدم، والترقيم يُنفَّذ في الخادم.
 *
 * ⚠️ لا يفترض أي صلاحية: الصفحة هي من تقرر ما تُمرّره من أزرار وأعمدة،
 *    والخادم هو من يفحص الصلاحية عند كل فعل.
 */
export function AdminResourceTable<T extends { id: string }>({
  result,
  error,
  columns,
  renderRow,
  searchPlaceholder,
  emptyTitle,
  emptyDescription,
  actions,
  showPublishFilter = false,
}: AdminResourceTableProps<T>) {
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
      if (!('page' in changes)) params.delete('page');
      startTransition(() => router.replace(`${pathname}?${params.toString()}`));
    },
    [pathname, router, searchParams],
  );

  const activeStatus = searchParams.get('status') ?? '';
  const activePublic = searchParams.get('isPublic') ?? '';
  const hasFilters = Boolean(searchParams.get('search') || activeStatus || activePublic);

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
            placeholder={searchPlaceholder}
            startAdornment={<Search aria-hidden />}
            aria-label="بحث"
          />
          <Button type="submit" variant="secondary" loading={pending}>
            بحث
          </Button>
        </form>

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
          </SelectContent>
        </Select>

        {showPublishFilter ? (
          <Select
            value={activePublic || 'all'}
            onValueChange={(value) => applyParams({ isPublic: value === 'all' ? null : value })}
          >
            <SelectTrigger className="w-40" aria-label="تصفية حسب النشر">
              <SelectValue placeholder="النشر: الكل" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">النشر: الكل</SelectItem>
              <SelectItem value="true">منشور</SelectItem>
              <SelectItem value="false">غير منشور</SelectItem>
            </SelectContent>
          </Select>
        ) : null}

        {hasFilters ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => applyParams({ search: null, status: null, isPublic: null })}
          >
            <X aria-hidden />
            مسح
          </Button>
        ) : null}

        {actions}
      </div>

      <TableContainer>
        {pending && !result ? (
          <TableSkeleton rows={6} columns={columns.length} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((column) => (
                  <TableHead key={column.key} align={column.align} className={column.width}>
                    {column.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>{(result?.items ?? []).map((item) => renderRow(item))}</TableBody>
          </Table>
        )}

        {result && result.items.length === 0 ? (
          <EmptyState
            title={hasFilters ? 'لا توجد نتائج مطابقة' : emptyTitle}
            description={hasFilters ? 'جرّب تعديل البحث أو مسح المُرشِّحات.' : emptyDescription}
          />
        ) : null}
      </TableContainer>

      {result && result.meta.total > 0 ? (
        <Pagination
          page={result.meta.page}
          pageSize={result.meta.pageSize}
          total={result.meta.total}
          onPageChange={(page) => applyParams({ page: String(page) })}
          onPageSizeChange={(size) => applyParams({ pageSize: String(size), page: null })}
        />
      ) : null}
    </div>
  );
}
