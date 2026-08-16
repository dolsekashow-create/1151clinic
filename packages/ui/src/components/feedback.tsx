'use client';

import * as React from 'react';
import { AlertCircle, Inbox, Loader2, RefreshCw } from 'lucide-react';
import { Button } from './button';
import { cn } from '../lib/cn';

/* ------------------------------- التحميل ---------------------------------- */

export function Spinner({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <Loader2
      className={cn('size-5 animate-spin text-muted-foreground', className)}
      role="status"
      aria-label="جارٍ التحميل"
      {...props}
    />
  );
}

export function LoadingState({ label = 'جارٍ التحميل…', className }: { label?: string; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 py-12', className)}>
      <Spinner className="size-6" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} aria-hidden {...props} />;
}

/** هيكل تحميل لجدول — يمنع «قفزة» التخطيط أثناء الجلب. */
export function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-2 p-4" aria-hidden>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex gap-3">
          {Array.from({ length: columns }).map((_, colIndex) => (
            <Skeleton key={colIndex} className="h-8 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------ حالة فارغة -------------------------------- */

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 px-6 py-14 text-center', className)}>
      <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-6">
        {icon ?? <Inbox aria-hidden />}
      </div>
      <div className="space-y-1">
        <p className="font-semibold">{title}</p>
        {description ? (
          <p className="mx-auto max-w-md text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

/* ------------------------------- حالة خطأ --------------------------------- */

export interface ErrorStateProps {
  title?: string;
  description?: string;
  /** كود الخطأ من غلاف الاستجابة — يساعد الدعم الفني. */
  code?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({
  title = 'تعذّر تحميل البيانات',
  description = 'حدث خطأ أثناء جلب البيانات. يمكنك المحاولة مرة أخرى.',
  code,
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn('flex flex-col items-center justify-center gap-3 px-6 py-14 text-center', className)}
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive [&_svg]:size-6">
        <AlertCircle aria-hidden />
      </div>
      <div className="space-y-1">
        <p className="font-semibold">{title}</p>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">{description}</p>
        {code ? <p className="font-mono text-xs text-muted-foreground">{code}</p> : null}
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw aria-hidden />
          إعادة المحاولة
        </Button>
      ) : null}
    </div>
  );
}
