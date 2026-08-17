'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import {
  Alert,
  Button,
  Drawer,
  DrawerContent,
  DrawerTrigger,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  toast,
} from '@erp/ui';
import { createCustomerAction } from '../actions';

export interface CustomerCreateDrawerProps {
  branches: ReadonlyArray<{ id: string; nameAr: string }>;
  defaultBranchId: string | null;
}

export function CustomerCreateDrawer({ branches, defaultBranchId }: CustomerCreateDrawerProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [branchId, setBranchId] = useState(defaultBranchId ?? branches[0]?.id ?? '');
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});

    const formData = new FormData(event.currentTarget);
    const input = {
      branchId,
      fullNameAr: String(formData.get('fullNameAr') ?? ''),
      phone: String(formData.get('phone') ?? ''),
      email: String(formData.get('email') ?? ''),
      code: String(formData.get('code') ?? ''),
      notes: String(formData.get('notes') ?? ''),
    };

    startTransition(async () => {
      const result = await createCustomerAction(input);
      if (!result.success) {
        setFormError(result.error.message);
        const details = result.error.details as { fieldErrors?: Record<string, string[]> } | undefined;
        if (details?.fieldErrors) setFieldErrors(details.fieldErrors);
        return;
      }
      toast.success('تم حفظ العميل');
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button>
          <Plus aria-hidden />
          عميل جديد
        </Button>
      </DrawerTrigger>

      <DrawerContent
        title="إضافة عميل"
        description="الحقول المعلّمة بنجمة إلزامية"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              إلغاء
            </Button>
            <Button type="submit" form="customer-create-form" loading={pending}>
              حفظ
            </Button>
          </>
        }
      >
        <form id="customer-create-form" onSubmit={onSubmit} className="space-y-4" noValidate>
          {formError ? (
            <Alert variant="danger" title="تعذّر الحفظ">
              {formError}
            </Alert>
          ) : null}

          <Field label="الفرع" required htmlFor="branchId" error={fieldErrors.branchId?.[0]}>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger id="branchId">
                <SelectValue placeholder="اختر الفرع" />
              </SelectTrigger>
              <SelectContent>
                {branches.map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.nameAr}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="الاسم" required htmlFor="fullNameAr" error={fieldErrors.fullNameAr?.[0]}>
            <Input id="fullNameAr" name="fullNameAr" required disabled={pending} />
          </Field>

          <Field
            label="رقم الهاتف"
            required
            htmlFor="phone"
            error={fieldErrors.phone?.[0]}
            hint="يُستخدم لتمييز العميل داخل المنشأة"
          >
            <Input id="phone" name="phone" dir="ltr" className="text-start" required disabled={pending} />
          </Field>

          <Field label="البريد الإلكتروني" htmlFor="email" error={fieldErrors.email?.[0]}>
            <Input id="email" name="email" type="email" dir="ltr" className="text-start" disabled={pending} />
          </Field>

          <Field label="الكود" htmlFor="code" error={fieldErrors.code?.[0]} hint="اختياري">
            <Input id="code" name="code" disabled={pending} />
          </Field>

          <Field label="ملاحظات" htmlFor="notes" error={fieldErrors.notes?.[0]}>
            <Textarea id="notes" name="notes" rows={3} disabled={pending} />
          </Field>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
