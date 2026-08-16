'use client';

import { useEffect } from 'react';
import { ErrorState } from '@erp/ui';

/**
 * حدود الخطأ العامة.
 * ⚠️ لا نعرض نص الاستثناء للمستخدم — قد يحتوي تفاصيل داخلية.
 *    يُعرض `digest` فقط لأنه معرّف آمن يربط الشاشة بالسجل على الخادم.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // مكان ربط خدمة تجميع الأخطاء لاحقًا (Phase 8)
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <ErrorState
        title="حدث خطأ غير متوقع"
        description="تم تسجيل المشكلة. يمكنك إعادة المحاولة أو العودة لاحقًا."
        code={error.digest}
        onRetry={reset}
      />
    </div>
  );
}
