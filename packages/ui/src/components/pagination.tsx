'use client';

import * as React from 'react';
import { ChevronRight, ChevronLeft, ChevronsRight, ChevronsLeft } from 'lucide-react';
import { Button } from './button';
import { cn } from '../lib/cn';

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: readonly number[];
  className?: string;
}

/**
 * ترقيم من طرف الخادم.
 * ملاحظة RTL: «التالي» يتجه لليسار بصريًا — لذلك أيقونة السهم الأيسر للتالي.
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
  className,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const firstRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = Math.min(page * pageSize, total);
  const canPrev = page > 1;
  const canNext = page < totalPages;

  return (
    <nav
      className={cn('flex flex-wrap items-center justify-between gap-3 px-1 py-3 text-sm', className)}
      aria-label="ترقيم الصفحات"
    >
      <p className="text-muted-foreground">
        عرض <span className="font-medium text-foreground tabular-nums">{firstRow}</span>–
        <span className="font-medium text-foreground tabular-nums">{lastRow}</span> من{' '}
        <span className="font-medium text-foreground tabular-nums">{total}</span>
      </p>

      <div className="flex items-center gap-3">
        {onPageSizeChange ? (
          <label className="flex items-center gap-2 text-muted-foreground">
            <span>عدد الصفوف</span>
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={pageSize}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
            >
              {pageSizeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            disabled={!canPrev}
            onClick={() => onPageChange(1)}
            aria-label="الصفحة الأولى"
          >
            <ChevronsRight aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            disabled={!canPrev}
            onClick={() => onPageChange(page - 1)}
            aria-label="الصفحة السابقة"
          >
            <ChevronRight aria-hidden />
          </Button>

          <span className="px-2 tabular-nums text-muted-foreground">
            {page} / {totalPages}
          </span>

          <Button
            variant="outline"
            size="icon"
            className="size-8"
            disabled={!canNext}
            onClick={() => onPageChange(page + 1)}
            aria-label="الصفحة التالية"
          >
            <ChevronLeft aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            disabled={!canNext}
            onClick={() => onPageChange(totalPages)}
            aria-label="الصفحة الأخيرة"
          >
            <ChevronsLeft aria-hidden />
          </Button>
        </div>
      </div>
    </nav>
  );
}
