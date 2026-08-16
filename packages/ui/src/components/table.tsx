import * as React from 'react';
import { cn } from '../lib/cn';

/**
 * جداول البيانات — مصمّمة لعرض كثيف يُقرأ لساعات:
 * • رأس ثابت عند التمرير (sticky)
 * • أرقام بخط جدولي (tabular-nums) لمحاذاة الأعمدة المالية
 * • تمرير أفقي داخل حاوية مستقلة حتى لا تنزلق الصفحة كلها
 */
export function TableContainer({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('relative w-full overflow-x-auto rounded-lg border border-border bg-card', className)}
      {...props}
    />
  );
}

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn('w-full caption-bottom border-collapse text-sm', className)} {...props} />;
}

export function TableHeader({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('sticky top-0 z-10 bg-muted/60 backdrop-blur', className)} {...props} />;
}

export function TableBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}

export function TableFooter({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tfoot
      className={cn('border-t border-border bg-muted/40 font-medium tabular-nums', className)}
      {...props}
    />
  );
}

export function TableRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        'border-b border-border transition-colors hover:bg-muted/40 data-[state=selected]:bg-primary/5',
        className,
      )}
      {...props}
    />
  );
}

/** نستبدل `align` الأصلي (HTML قديم وفيزيائي) بقيم منطقية تعمل في RTL. */
export interface TableHeadProps extends Omit<React.ThHTMLAttributes<HTMLTableCellElement>, 'align'> {
  align?: 'start' | 'center' | 'end';
}

export function TableHead({ className, align = 'start', ...props }: TableHeadProps) {
  return (
    <th
      scope="col"
      className={cn(
        'h-11 whitespace-nowrap px-4 text-xs font-semibold text-muted-foreground',
        align === 'start' && 'text-start',
        align === 'center' && 'text-center',
        align === 'end' && 'text-end',
        className,
      )}
      {...props}
    />
  );
}

export interface TableCellProps extends Omit<React.TdHTMLAttributes<HTMLTableCellElement>, 'align'> {
  align?: 'start' | 'center' | 'end';
  /** للأرقام والمبالغ: خط جدولي ومحاذاة للنهاية. */
  numeric?: boolean;
}

export function TableCell({ className, align, numeric, ...props }: TableCellProps) {
  const effectiveAlign = align ?? (numeric ? 'end' : 'start');
  return (
    <td
      className={cn(
        'px-4 py-3 align-middle',
        numeric && 'tabular-nums',
        effectiveAlign === 'start' && 'text-start',
        effectiveAlign === 'center' && 'text-center',
        effectiveAlign === 'end' && 'text-end',
        className,
      )}
      {...props}
    />
  );
}

export function TableCaption({ className, ...props }: React.HTMLAttributes<HTMLTableCaptionElement>) {
  return <caption className={cn('mt-3 text-xs text-muted-foreground', className)} {...props} />;
}
