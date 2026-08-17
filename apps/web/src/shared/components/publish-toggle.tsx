'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import { Button, toast } from '@erp/ui';
import type { ActionResult } from '@erp/types';

export interface PublishToggleProps {
  id: string;
  isPublic: boolean;
  /** الفعل المسؤول عن التغيير — يفحص الصلاحية في الخادم. */
  action: (input: { id: string; isPublic: boolean }) => Promise<ActionResult<{ isPublic: boolean }>>;
  /** يُعطَّل عندما لا يملك المستخدم صلاحية النشر (إخفاء واجهة فقط). */
  canPublish: boolean;
  labelOn?: string;
  labelOff?: string;
}

/**
 * مفتاح النشر على الموقع العام.
 *
 * ⚠️ `canPublish` تحسين تجربة فقط. الحماية الحقيقية طبقتان في الخادم:
 *    فحص الصلاحية في `defineAction`، ومحفّز في قاعدة البيانات يرفض تغيير
 *    `is_public` بلا الصلاحية المخصّصة — فلا يُتجاوز باستدعاء مباشر لـ PostgREST.
 */
export function PublishToggle({
  id,
  isPublic,
  action,
  canPublish,
  labelOn = 'منشور',
  labelOff = 'غير منشور',
}: PublishToggleProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [current, setCurrent] = useState(isPublic);

  function toggle() {
    const next = !current;
    startTransition(async () => {
      const result = await action({ id, isPublic: next });
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      setCurrent(next);
      toast.success(next ? 'تم النشر على الموقع العام' : 'تم الإخفاء من الموقع العام');
      router.refresh();
    });
  }

  if (!canPublish) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
        title="تحتاج صلاحية النشر لتغيير هذه الحالة"
      >
        {current ? <Eye className="size-3.5" aria-hidden /> : <EyeOff className="size-3.5" aria-hidden />}
        {current ? labelOn : labelOff}
      </span>
    );
  }

  return (
    <Button
      variant={current ? 'secondary' : 'ghost'}
      size="sm"
      loading={pending}
      onClick={toggle}
      aria-pressed={current}
      title={current ? 'إخفاء من الموقع العام' : 'نشر على الموقع العام'}
      className="h-7 gap-1.5 px-2 text-xs"
    >
      {!pending ? (
        current ? (
          <Eye className="size-3.5" aria-hidden />
        ) : (
          <EyeOff className="size-3.5" aria-hidden />
        )
      ) : null}
      {current ? labelOn : labelOff}
    </Button>
  );
}
