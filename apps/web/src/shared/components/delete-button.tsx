'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import {
  Alert,
  Button,
  Modal,
  ModalContent,
  ModalTrigger,
  toast,
} from '@erp/ui';
import type { ActionResult } from '@erp/types';

export interface DeleteButtonProps {
  /** اسم العنصر كما يراه المستخدم — يظهر في سؤال التأكيد. */
  label: string;
  /** نوع العنصر بالعربية: «الفرع»، «الخدمة»… */
  entityLabel: string;
  onDelete: () => Promise<ActionResult<unknown>>;
  disabled?: boolean;
}

/**
 * زر حذف مع تأكيد.
 *
 * ⚠️ الحذف **ناعم**: يُخفي العنصر من القوائم ويُبقي الصف في قاعدة البيانات.
 *    السبب أن السجلات التاريخية (حجز مضى يشير إلى خدمة) يجب أن تظل قابلة
 *    للقراءة — محو الأصل يُفسد سجلًا لا يملك أحد حق إفساده.
 *
 * ⚠️ التأكيد ليس تجميلًا: الحذف غير قابل للتراجع من الواجهة (لا سلة محذوفات
 *    بعد — تحتاج قرار العميل)، فخطوة واحدة إضافية أرخص بكثير من استعادة يدوية.
 *
 * ⚠️ رسالة الرفض تأتي كما هي من قاعدة البيانات لأنها مكتوبة للمستخدم النهائي
 *    وتحوي **أعداد التوابع** («12 حجزًا، 4 عملاء») — وهي المعلومة التي يحتاجها
 *    ليقرر، لا رمز قيد أجنبي.
 */
export function DeleteButton({ label, entityLabel, onDelete, disabled }: DeleteButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await onDelete();
      if (!result.success) {
        setError(result.error.message);
        return;
      }
      toast.success(`تم حذف ${entityLabel}`);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <ModalTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs text-danger hover:bg-danger/10"
          disabled={disabled}
          title={`حذف ${entityLabel}`}
        >
          <Trash2 className="size-3.5" aria-hidden />
          حذف
        </Button>
      </ModalTrigger>

      <ModalContent
        title={`حذف ${entityLabel}`}
        description={`سيُخفى «${label}» من كل القوائم.`}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              إلغاء
            </Button>
            <Button variant="destructive" onClick={confirm} loading={pending}>
              <Trash2 aria-hidden />
              تأكيد الحذف
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {error ? (
            <Alert variant="danger" title="تعذّر الحذف">
              {error}
            </Alert>
          ) : null}

          <Alert variant="info" title="الحذف لا يمحو البيانات">
            يبقى السجل محفوظًا في قاعدة البيانات لأن سجلات سابقة قد تشير إليه، لكنه يختفي من
            الشاشات والقوائم. لا يمكن التراجع من هنا.
          </Alert>

          <p className="text-sm text-muted-foreground">
            إن كان العنصر مرتبطًا بسجلات نشطة فسيُرفض الحذف مع بيان عددها — عطّله حينها بدل حذفه.
          </p>
        </div>
      </ModalContent>
    </Modal>
  );
}
