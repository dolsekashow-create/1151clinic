'use client';

import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { cn } from '../lib/cn';

export const Label = React.forwardRef<
  React.ComponentRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & { required?: boolean }
>(function Label({ className, required, children, ...props }, ref) {
  return (
    <LabelPrimitive.Root
      ref={ref}
      className={cn(
        'text-sm font-medium leading-none text-foreground',
        'peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
        className,
      )}
      {...props}
    >
      {children}
      {required ? (
        <span className="ms-1 text-destructive" aria-hidden>
          *
        </span>
      ) : null}
    </LabelPrimitive.Root>
  );
});

export interface FieldProps {
  label?: React.ReactNode;
  htmlFor?: string;
  required?: boolean;
  /** نص إرشادي أسفل الحقل. */
  hint?: React.ReactNode;
  /** رسالة خطأ — وجودها يجعل الحقل في حالة خطأ. */
  error?: string | null;
  className?: string;
  children: React.ReactNode;
}

/**
 * غلاف حقل موحّد: تسمية + محتوى + تلميح/خطأ.
 * يربط الرسائل بالحقل عبر aria-describedby لتجربة قارئ شاشة صحيحة.
 */
export function Field({ label, htmlFor, required, hint, error, className, children }: FieldProps) {
  const generatedId = React.useId();
  const fieldId = htmlFor ?? generatedId;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label ? (
        <Label htmlFor={fieldId} required={required}>
          {label}
        </Label>
      ) : null}

      {React.isValidElement(children)
        ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
            id: fieldId,
            'aria-invalid': error ? true : undefined,
            'aria-describedby': [hintId, errorId].filter(Boolean).join(' ') || undefined,
          })
        : children}

      {hint && !error ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs font-medium text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
