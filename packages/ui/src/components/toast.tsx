'use client';

import { Toaster as SonnerToaster, toast } from 'sonner';

/**
 * التنبيهات المؤقتة (Toasts).
 * يُركَّب مرة واحدة في تخطيط الجذر. الموضع أعلى اليسار لأن الاتجاه RTL
 * (الجهة المقابلة لبداية القراءة) حتى لا يحجب أزرار الإجراءات الرئيسية.
 */
export function Toaster() {
  return (
    <SonnerToaster
      dir="rtl"
      position="top-left"
      closeButton
      richColors
      toastOptions={{
        classNames: {
          toast: 'font-sans text-sm',
        },
      }}
    />
  );
}

export { toast };
