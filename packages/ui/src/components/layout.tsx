import * as React from 'react';
import { cn } from '../lib/cn';

/** فاصل بصري. */
export function Separator({
  className,
  orientation = 'horizontal',
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { orientation?: 'horizontal' | 'vertical' }) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn('bg-border', orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px', className)}
      {...props}
    />
  );
}

export interface PageHeaderProps {
  title: string;
  description?: string;
  /** مسار التنقّل: العنصر الأخير هو الصفحة الحالية. */
  breadcrumbs?: ReadonlyArray<{ label: string; href?: string }>;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, description, breadcrumbs, actions, className }: PageHeaderProps) {
  return (
    <header className={cn('flex flex-wrap items-start justify-between gap-4', className)}>
      <div className="space-y-1">
        {breadcrumbs?.length ? (
          <nav aria-label="مسار التنقل">
            <ol className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              {breadcrumbs.map((crumb, index) => (
                <li key={`${crumb.label}-${index}`} className="flex items-center gap-1">
                  {index > 0 ? <span aria-hidden>/</span> : null}
                  {crumb.href ? (
                    <a href={crumb.href} className="hover:text-foreground hover:underline">
                      {crumb.label}
                    </a>
                  ) : (
                    <span className="text-foreground">{crumb.label}</span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
        <h1 className="text-xl font-bold tracking-tight">{title}</h1>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
  icon?: React.ReactNode;
  /** يُظهر تنبيهًا بأن القيمة تجريبية وليست بيانات إنتاج. */
  placeholder?: boolean;
  className?: string;
}

export function StatCard({ label, value, hint, icon, placeholder, className }: StatCardProps) {
  return (
    <div
      className={cn(
        'relative flex items-start justify-between gap-3 rounded-lg border border-border bg-card p-5 shadow-sm',
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold tabular-nums">{value}</p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        {placeholder ? (
          <p className="text-[11px] font-medium text-warning">قيمة تجريبية — غير مرتبطة بقاعدة البيانات</p>
        ) : null}
      </div>
      {icon ? (
        <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary [&_svg]:size-5">
          {icon}
        </div>
      ) : null}
    </div>
  );
}
