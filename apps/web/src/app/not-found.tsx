import Link from 'next/link';
import { Button, EmptyState } from '@erp/ui';

export default function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <EmptyState
        title="الصفحة غير موجودة"
        description="الرابط الذي فتحته غير صحيح أو أن الصفحة لم تُنفَّذ بعد."
        action={
          <Button asChild variant="outline">
            <Link href="/dashboard">العودة إلى لوحة المعلومات</Link>
          </Button>
        }
      />
    </div>
  );
}
