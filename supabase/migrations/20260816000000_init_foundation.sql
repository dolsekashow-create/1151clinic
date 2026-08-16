-- =============================================================================
--  Migration : 20260816000000_init_foundation
--  Phase     : 1 — Foundation
--  Purpose   : المخططات والامتدادات ودوال البنية المشتركة فقط.
--              ⚠️ لا جداول أعمال هنا — تبدأ في المرحلة 2 (الهوية والصلاحيات).
--  Reference : docs/DATABASE.md §1
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) الامتدادات
-- -----------------------------------------------------------------------------
create schema if not exists extensions;

-- gen_random_uuid()  (متوفرة أصلًا في PG13+ عبر pgcrypto)
create extension if not exists "pgcrypto" with schema extensions;
-- بحث نصي أفضل للأسماء العربية (بحث جزئي على الاسم/الهاتف)
create extension if not exists "pg_trgm" with schema extensions;
-- قيود منع التعارض (ستُستخدم لمنع تعارض المواعيد عند اعتماد القاعدة P-12)
create extension if not exists "btree_gist" with schema extensions;

-- -----------------------------------------------------------------------------
-- 2) المخططات
--    public      : جداول التطبيق (مكشوفة عبر PostgREST)
--    app         : دوال الأمان والمساعدة — غير مكشوفة للعميل
--    audit       : سجلات التدقيق
--    integration : جداول الاستيراد/المزامنة مع النظام القديم
-- -----------------------------------------------------------------------------
create schema if not exists app;
create schema if not exists audit;
create schema if not exists integration;

comment on schema app is 'دوال الأمان والمساعدة (SECURITY DEFINER). غير مكشوف عبر PostgREST.';
comment on schema audit is 'سجلات التدقيق — append-only.';
comment on schema integration is 'طبقة التكامل مع النظام القديم. فارغة حتى تحديد النظام (Q-17).';

-- منع أي وصول مباشر من أدوار العميل إلى المخططات غير العامة.
-- الوصول يتم فقط عبر دوال SECURITY DEFINER تُستدعى من سياسات RLS.
revoke all on schema app from anon, authenticated;
revoke all on schema audit from anon, authenticated;
revoke all on schema integration from anon, authenticated;

grant usage on schema app to anon, authenticated;  -- لازم لتنفيذ الدوال داخل السياسات

-- -----------------------------------------------------------------------------
-- 3) دوال البنية المشتركة
-- -----------------------------------------------------------------------------

-- تحديث updated_at تلقائيًا. يُربط بكل جدول يحمل العمود.
create or replace function app.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function app.set_updated_at() is
  'Trigger: يضبط updated_at عند كل تحديث. يُستخدم مع BEFORE UPDATE FOR EACH ROW.';

-- منع التعديل/الحذف على جداول القيد المزدوج (المالية والمخزون).
-- تُربط كـ BEFORE UPDATE OR DELETE، وتُستخدم بدءًا من المرحلة 4.
create or replace function app.prevent_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'هذا السجل غير قابل للتعديل أو الحذف. صحّح الأثر بحركة عكسية.'
    using errcode = 'restrict_violation';
end;
$$;

comment on function app.prevent_mutation() is
  'Trigger: يمنع UPDATE/DELETE على الجداول الدفترية (append-only).';

-- -----------------------------------------------------------------------------
-- 4) الافتراضيات الأمنية للجداول القادمة
--    ملاحظة: كل جدول يُنشأ لاحقًا في public يجب أن يبدأ بـ:
--       alter table <t> enable row level security;
--       alter table <t> force  row level security;
--    ولا يُترك أي جدول بلا سياسة. راجع docs/SECURITY.md §3.
-- -----------------------------------------------------------------------------

-- منع منح صلاحيات تلقائية على أي جدول جديد في public لأدوار العميل.
-- الصلاحيات تُمنح صراحةً لكل جدول عند إنشائه.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
