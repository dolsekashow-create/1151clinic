'use client';

import { useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ScrollText, Search } from 'lucide-react';
import {
  Alert,
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
} from '@erp/ui';
import type { ApiErrorShape, Paginated } from '@erp/types';
import type { AuditRow } from '../repository';

const ALL = 'all';

/** ترجمة الوحدات — القائمة تأتي من السجل نفسه لا من ثابت في الكود. */
const MODULE_LABELS: Record<string, string> = {
  identity: 'المستخدمون والصلاحيات',
  organizations: 'التنظيم',
  services: 'الخدمات',
  customers: 'العملاء',
  appointments: 'الحجوزات',
  finance: 'المالية',
  inventory: 'المخزون',
  purchasing: 'المشتريات',
};

export function AuditView({
  result,
  error,
  modules,
  branches,
}: {
  result: Paginated<AuditRow> | null;
  error: ApiErrorShape | null;
  modules: readonly string[];
  branches: ReadonlyArray<{ id: string; nameAr: string }>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function apply(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === '' || value === ALL) next.delete(key);
      else next.set(key, value);
    }
    if (!('page' in patch)) next.delete('page');
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="space-y-4">
      <Alert variant="info" title="سجل غير قابل للتعديل">
        السجل <strong>append-only</strong>: لا يُعدَّل ولا يُحذف منه شيء، ومحفّز في قاعدة البيانات
        يمنع ذلك. لا يحتوي كلمات مرور ولا مفاتيح — التنقية تجري قبل الكتابة.
      </Alert>

      <div className="flex flex-wrap items-end gap-2">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            apply({ action: String(fd.get('action') ?? '') });
          }}
        >
          <Input
            name="action"
            defaultValue={params.get('action') ?? ''}
            placeholder="بحث بالعملية… مثال: published"
            className="w-56"
            aria-label="بحث بالعملية"
            dir="ltr"
          />
          <Button type="submit" variant="outline">
            <Search aria-hidden />
            بحث
          </Button>
        </form>

        <Select value={params.get('module') ?? ALL} onValueChange={(v) => apply({ module: v })}>
          <SelectTrigger className="w-48" aria-label="تصفية حسب الوحدة">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>كل الوحدات</SelectItem>
            {modules.map((m) => (
              <SelectItem key={m} value={m}>
                {MODULE_LABELS[m] ?? m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={params.get('branchId') ?? ALL} onValueChange={(v) => apply({ branchId: v })}>
          <SelectTrigger className="w-44" aria-label="تصفية حسب الفرع">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>كل الفروع</SelectItem>
            {branches.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.nameAr}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          من
          <Input
            type="date"
            className="w-36"
            aria-label="من تاريخ"
            defaultValue={params.get('from') ?? ''}
            onChange={(e) => apply({ from: e.target.value })}
          />
        </label>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          إلى
          <Input
            type="date"
            className="w-36"
            aria-label="إلى تاريخ"
            defaultValue={params.get('to') ?? ''}
            onChange={(e) => apply({ to: e.target.value })}
          />
        </label>

        {params.toString() ? (
          <Button variant="ghost" onClick={() => router.push(pathname)}>
            مسح المرشِّحات
          </Button>
        ) : null}
      </div>

      {error ? (
        <ErrorState description={error.message} />
      ) : !result || result.items.length === 0 ? (
        <EmptyState
          icon={<ScrollText aria-hidden />}
          title="لا توجد سجلات"
          description="غيّر المرشِّحات أو نفّذ عملية لتظهر هنا."
        />
      ) : (
        <>
          <TableContainer>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-44">التاريخ</TableHead>
                  <TableHead className="w-52">العملية</TableHead>
                  <TableHead className="w-40">الوحدة</TableHead>
                  <TableHead className="w-40">المستخدم</TableHead>
                  <TableHead className="w-32">الفرع</TableHead>
                  <TableHead>التفاصيل</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.items.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-xs text-muted-foreground">
                      <Timestamp value={row.createdAt} />
                    </TableCell>
                    <TableCell className="font-mono text-xs" dir="ltr">
                      {row.action}
                    </TableCell>
                    <TableCell>
                      <Badge variant="neutral">{MODULE_LABELS[row.module] ?? row.module}</Badge>
                    </TableCell>
                    <TableCell>{row.userName ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{row.branchName ?? '—'}</TableCell>
                    <TableCell>
                      <Details value={row.newValues} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          <Pagination
            page={result.meta.page}
            pageSize={result.meta.pageSize}
            total={result.meta.total}
            onPageChange={(page) => apply({ page: String(page) })}
            onPageSizeChange={(size) => apply({ pageSize: String(size), page: null })}
          />
        </>
      )}
    </div>
  );
}

function Timestamp({ value }: { value: string }) {
  const formatted = useMemo(
    () =>
      new Intl.DateTimeFormat('ar-SA-u-ca-gregory', {
        timeZone: 'Asia/Riyadh',
        dateStyle: 'short',
        timeStyle: 'medium',
      }).format(new Date(value)),
    [value],
  );
  return <span>{formatted}</span>;
}

/**
 * ⚠️ يعرض القيم كنص مختصر لا كـJSON خام: السجل قد يحتوي معرّفات طويلة تُغرق
 *    الجدول. التفاصيل الكاملة تبقى في قاعدة البيانات لمن يحتاجها.
 */
function Details({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object') return <span className="text-muted-foreground">—</span>;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .slice(0, 4);

  if (entries.length === 0) return <span className="text-muted-foreground">—</span>;

  return (
    <div className="flex flex-wrap gap-1">
      {entries.map(([key, v]) => (
        <span
          key={key}
          className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
          dir="ltr"
        >
          {key}: {String(v).length > 24 ? `${String(v).slice(0, 24)}…` : String(v)}
        </span>
      ))}
    </div>
  );
}
