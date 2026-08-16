'use client';

import * as React from 'react';
import { cn } from '../lib/cn';

export const inputBaseClass = cn(
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
  'text-foreground placeholder:text-muted-foreground',
  'transition-colors',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
  'disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-muted',
  'aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive',
);

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** أيقونة أو زر يظهر في بداية الحقل (يمين في RTL). */
  startAdornment?: React.ReactNode;
  endAdornment?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, type = 'text', startAdornment, endAdornment, ...props },
  ref,
) {
  if (!startAdornment && !endAdornment) {
    return <input ref={ref} type={type} className={cn(inputBaseClass, className)} {...props} />;
  }

  return (
    <div className="relative flex w-full items-center">
      {startAdornment ? (
        <span className="pointer-events-none absolute start-3 text-muted-foreground [&_svg]:size-4">
          {startAdornment}
        </span>
      ) : null}
      <input
        ref={ref}
        type={type}
        className={cn(inputBaseClass, startAdornment && 'ps-9', endAdornment && 'pe-9', className)}
        {...props}
      />
      {endAdornment ? (
        <span className="absolute end-3 text-muted-foreground [&_svg]:size-4">{endAdornment}</span>
      ) : null}
    </div>
  );
});

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, rows = 4, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(inputBaseClass, 'h-auto min-h-20 resize-y py-2', className)}
      {...props}
    />
  );
});

/**
 * منتقي التاريخ.
 *
 * القرار: نعتمد حقل التاريخ الأصلي (native) في Phase 1 — يدعم الإدخال بلوحة
 * المفاتيح والتقويم المحلي، وهو الأسرع لمُدخِلي البيانات لساعات طويلة.
 * الترقية إلى تقويم مخصص (نطاقات، أيام معطّلة) تتم في Phase 4 مع وحدة الحجوزات.
 */
export const DatePicker = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & { withTime?: boolean }
>(function DatePicker({ className, withTime = false, ...props }, ref) {
  return (
    <input
      ref={ref}
      type={withTime ? 'datetime-local' : 'date'}
      className={cn(inputBaseClass, 'font-sans tabular-nums', className)}
      {...props}
    />
  );
});
