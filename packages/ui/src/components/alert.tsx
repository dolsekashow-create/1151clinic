import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { cn } from '../lib/cn';

const alertVariants = cva('relative flex w-full gap-3 rounded-lg border p-4 text-sm', {
  variants: {
    variant: {
      info: 'border-info/30 bg-info/5 text-foreground [&>svg]:text-info',
      success: 'border-success/30 bg-success/5 text-foreground [&>svg]:text-success',
      warning: 'border-warning/30 bg-warning/5 text-foreground [&>svg]:text-warning',
      danger: 'border-destructive/30 bg-destructive/5 text-foreground [&>svg]:text-destructive',
    },
  },
  defaultVariants: { variant: 'info' },
});

const icons = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
} as const;

export interface AlertProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'>,
    VariantProps<typeof alertVariants> {
  title?: React.ReactNode;
  hideIcon?: boolean;
}

export function Alert({ className, variant, title, hideIcon, children, ...props }: AlertProps) {
  const Icon = icons[variant ?? 'info'];
  return (
    <div role="alert" className={cn(alertVariants({ variant }), className)} {...props}>
      {hideIcon ? null : <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />}
      <div className="flex-1 space-y-1">
        {title ? <p className="font-semibold leading-none">{title}</p> : null}
        {children ? <div className="text-muted-foreground">{children}</div> : null}
      </div>
    </div>
  );
}
