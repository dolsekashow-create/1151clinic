'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '../lib/cn';

export const Modal = DialogPrimitive.Root;
export const ModalTrigger = DialogPrimitive.Trigger;
export const ModalClose = DialogPrimitive.Close;

const Overlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(function Overlay({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      className={cn('fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-[2px]', className)}
      {...props}
    />
  );
});

export interface ModalContentProps
  extends Omit<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>, 'title'> {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** عنوان إلزامي لإتاحة الوصول — يمكن إخفاؤه بصريًا عبر hideTitle. */
  title: React.ReactNode;
  description?: React.ReactNode;
  hideTitle?: boolean;
  footer?: React.ReactNode;
}

const sizeClass = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
} as const;

export const ModalContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  ModalContentProps
>(function ModalContent(
  { className, size = 'md', title, description, hideTitle, footer, children, ...props },
  ref,
) {
  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          // توسيط أفقي عبر mx-auto بدل translate — يعمل في RTL و LTR بلا انعكاس
          'fixed inset-x-4 top-1/2 z-50 mx-auto flex max-h-[90vh] -translate-y-1/2 flex-col',
          'rounded-lg border border-border bg-card text-card-foreground shadow-xl focus:outline-none',
          sizeClass[size],
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border p-5">
          <div className="space-y-1">
            <DialogPrimitive.Title className={cn('text-base font-semibold', hideTitle && 'sr-only')}>
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="text-sm text-muted-foreground">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          <DialogPrimitive.Close
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="إغلاق"
          >
            <X className="size-4" aria-hidden />
          </DialogPrimitive.Close>
        </div>

        <div className="flex-1 overflow-y-auto p-5">{children}</div>

        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-border p-4">{footer}</div>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});
