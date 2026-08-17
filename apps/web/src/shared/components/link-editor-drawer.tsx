'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Link2 } from 'lucide-react';
import {
  Alert,
  Button,
  Drawer,
  DrawerContent,
  DrawerTrigger,
  Input,
  toast,
} from '@erp/ui';
import type { ActionResult } from '@erp/types';

export interface LinkState {
  id: string;
  nameAr: string;
  linked: boolean;
}

export interface LinkEditorDrawerProps {
  /** نص الزر — يصف العلاقة لا الفعل. */
  label: string;
  title: string;
  description: string;
  /** يقرأ الحالة الكاملة عند الفتح. */
  load: (input: { id: string }) => Promise<ActionResult<readonly LinkState[]>>;
  /** يحفظ الاختيار كاملًا — استبدال لا فرق. */
  save: (ids: readonly string[]) => Promise<ActionResult<unknown>>;
  entityId: string;
  disabled?: boolean;
  /** يُعرض عندما لا يبقى أي عنصر مختار. */
  emptyWarning: string;
}

/**
 * محرّر علاقة كثير-إلى-كثير.
 *
 * ⚠️ التحميل عند الفتح لا عند عرض الصفحة: القوائم كثيرة في الجداول، وتحميل
 *    حالة كل صف مسبقًا يُنتج عشرات الاستعلامات لصفحة واحدة.
 * ⚠️ يحفظ الاختيار **كاملًا** لا الفرق: إرسال الفرق يفتح باب انحراف صامت لو
 *    تغيّرت الحالة بين القراءة والحفظ.
 * ⚠️ القائمة المعروضة محدودة أصلًا بما تراه صلاحيات المستخدم (RLS)، والحكم
 *    النهائي على ما يجوز ربطه في قاعدة البيانات لا هنا.
 */
export function LinkEditorDrawer({
  label,
  title,
  description,
  load,
  save,
  entityId,
  disabled = false,
  emptyWarning,
}: LinkEditorDrawerProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<readonly LinkState[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setFormError(null);
    load({ id: entityId })
      .then((result) => {
        if (!result.success) {
          setFormError(result.error.message);
          return;
        }
        setItems(result.data);
        setSelected(new Set(result.data.filter((i) => i.linked).map((i) => i.id)));
      })
      .finally(() => setLoading(false));
  }, [open, entityId, load]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function onSave() {
    setFormError(null);
    startTransition(async () => {
      const result = await save([...selected]);
      if (!result.success) {
        setFormError(result.error.message);
        return;
      }
      toast.success('تم حفظ الربط');
      setOpen(false);
      router.refresh();
    });
  }

  const visible = search
    ? items.filter((i) => i.nameAr.toLowerCase().includes(search.trim().toLowerCase()))
    : items;

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" disabled={disabled}>
          <Link2 className="size-3.5" aria-hidden />
          {label}
        </Button>
      </DrawerTrigger>
      <DrawerContent
        title={title}
        description={description}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              إلغاء
            </Button>
            <Button onClick={onSave} loading={pending} disabled={loading}>
              حفظ
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {formError ? (
            <Alert variant="danger" title="تعذّر الحفظ">
              {formError}
            </Alert>
          ) : null}

          {selected.size === 0 && !loading ? (
            <Alert variant="warning" title="لا شيء مختار">
              {emptyWarning}
            </Alert>
          ) : null}

          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث…"
            aria-label="بحث في القائمة"
            disabled={loading || pending}
          />

          <p className="text-xs text-muted-foreground">
            مختار: <strong>{selected.size}</strong> من {items.length}
          </p>

          <div className="max-h-96 space-y-0.5 overflow-y-auto rounded-md border border-border p-2">
            {loading ? (
              <p className="p-3 text-sm text-muted-foreground">جارٍ التحميل…</p>
            ) : visible.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">لا نتائج</p>
            ) : (
              visible.map((item) => (
                <label
                  key={item.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
                >
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--color-primary)]"
                    checked={selected.has(item.id)}
                    onChange={() => toggle(item.id)}
                    disabled={pending}
                  />
                  {item.nameAr}
                </label>
              ))
            )}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
