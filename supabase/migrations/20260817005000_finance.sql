-- =============================================================================
--  Migration : 20260817005000_finance
--  Phase     : 4 — أساس المالية والخزائن والورديات (بنية فقط)
--  Reference : docs/DATABASE.md §2.5
--
--  ⚠️ ما هو **غير** منفّذ هنا، عمدًا:
--       • معادلة تقفيل الوردية (P-01) — الأعمدة موجودة والحساب غير موجود.
--       • طريقة القيد ودليل الحسابات (P-02) — account_ref نصّي مرن.
--       • القيد المالي التلقائي من العمليات (P-03) — لا محفّز يُنشئ حركة مالية.
--       • سياسة العهدة (P-04).
--     المبني هنا: هيكل بيانات قادر على استيعاب أي قاعدة تُعتمد لاحقًا.
-- =============================================================================

create table if not exists public.treasuries (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations(id) on delete restrict,
  branch_id       uuid        not null references public.branches(id) on delete restrict,
  code            text        not null,
  name_ar         text        not null,
  currency        char(3)     not null default 'SAR',
  type            text        not null default 'cash'
                    check (type in ('cash', 'bank', 'other')),
  status          text        not null default 'active' check (status in ('active', 'inactive')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  updated_by      uuid,
  constraint treasuries_org_code_key unique (organization_id, code)
);

create index if not exists treasuries_branch_idx on public.treasuries (branch_id);

-- -----------------------------------------------------------------------------
-- الحركة المالية — الرأس
-- -----------------------------------------------------------------------------
create table if not exists public.financial_transactions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid        not null references public.organizations(id) on delete restrict,
  branch_id        uuid        not null references public.branches(id) on delete restrict,
  reference_no     text,
  transaction_type text        not null
                     check (transaction_type in (
                       'revenue', 'expense', 'supplier_payment',
                       'custody_handover', 'adjustment', 'transfer'
                     )),
  amount           numeric(18, 4) not null check (amount > 0),
  currency         char(3)     not null default 'SAR',
  occurred_at      timestamptz not null default now(),
  status           text        not null default 'draft'
                     check (status in ('draft', 'posted', 'void')),
  -- ربط الحركة بالعملية التشغيلية التي سبّبتها
  source_module    text,
  source_record_id uuid,
  -- منع الازدواج عند إعادة إرسال الطلب
  idempotency_key  text,
  description      text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  updated_by       uuid,
  constraint financial_transactions_org_ref_key unique (organization_id, reference_no),
  constraint financial_transactions_idempotency_key unique (organization_id, idempotency_key)
);

create index if not exists financial_transactions_branch_idx
  on public.financial_transactions (branch_id, occurred_at desc);
create index if not exists financial_transactions_source_idx
  on public.financial_transactions (source_module, source_record_id);
create index if not exists financial_transactions_status_idx
  on public.financial_transactions (organization_id, status);

comment on column public.financial_transactions.source_module is
  'الوحدة التي سبّبت الحركة (inventory, purchasing, appointments…). '
  'مع source_record_id يشكّلان جسر الربط التشغيلي↔المالي. التوليد التلقائي معطّل (P-03).';

-- -----------------------------------------------------------------------------
-- بنود القيد
-- ⚠️ account_ref نصّي حر عمدًا: بناء دليل حسابات قبل اعتماده من المحاسب
--    يُنتج بنية خاطئة يصعب تغييرها. سيصبح FK لجدول accounts عند اعتماد P-02.
-- -----------------------------------------------------------------------------
create table if not exists public.financial_entries (
  id             uuid primary key default gen_random_uuid(),
  organization_id uuid       not null references public.organizations(id) on delete restrict,
  branch_id      uuid        not null references public.branches(id) on delete restrict,
  transaction_id uuid        not null references public.financial_transactions(id) on delete cascade,
  direction      text        not null check (direction in ('debit', 'credit')),
  account_ref    text,
  amount         numeric(18, 4) not null check (amount > 0),
  currency       char(3)     not null default 'SAR',
  description    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid,
  updated_by     uuid
);

create index if not exists financial_entries_transaction_idx
  on public.financial_entries (transaction_id);

comment on table public.financial_entries is
  'بنود الحركة. لا يُفرض توازن مدين/دائن بعد — طريقة القيد = P-02 معلّقة.';

-- -----------------------------------------------------------------------------
-- حركة الخزينة
-- -----------------------------------------------------------------------------
create table if not exists public.treasury_movements (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid        not null references public.organizations(id) on delete restrict,
  branch_id        uuid        not null references public.branches(id) on delete restrict,
  treasury_id      uuid        not null references public.treasuries(id) on delete restrict,
  transaction_id   uuid        references public.financial_transactions(id) on delete restrict,
  shift_id         uuid,
  movement_type    text        not null
                     check (movement_type in (
                       'cash_in', 'cash_out', 'revenue', 'expense',
                       'supplier_payment', 'custody_handover', 'adjustment'
                     )),
  direction        smallint    not null check (direction in (1, -1)),
  amount           numeric(18, 4) not null check (amount > 0),
  currency         char(3)     not null default 'SAR',
  occurred_at      timestamptz not null default now(),
  status           text        not null default 'posted'
                     check (status in ('draft', 'posted', 'void')),
  source_module    text,
  source_record_id uuid,
  reference_no     text,
  description      text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  updated_by       uuid
);

create index if not exists treasury_movements_treasury_idx
  on public.treasury_movements (treasury_id, occurred_at desc);
create index if not exists treasury_movements_branch_idx
  on public.treasury_movements (branch_id, occurred_at desc);
create index if not exists treasury_movements_shift_idx on public.treasury_movements (shift_id);

comment on table public.treasury_movements is
  'دفتر حركة النقد: append-only. لا رصيد مخزّن — الرصيد يُحسب بالتجميع '
  'حتى لا نثبّت طريقة حساب قبل اعتمادها.';

-- -----------------------------------------------------------------------------
-- الورديات
-- -----------------------------------------------------------------------------
create table if not exists public.shifts (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid        not null references public.organizations(id) on delete restrict,
  branch_id         uuid        not null references public.branches(id) on delete restrict,
  treasury_id       uuid        references public.treasuries(id) on delete restrict,
  reference_no      text,
  opened_by         uuid        references public.profiles(id) on delete set null,
  opened_at         timestamptz not null default now(),
  closed_by         uuid        references public.profiles(id) on delete set null,
  closed_at         timestamptz,
  opening_balance   numeric(18, 4) not null default 0,
  -- ⚠️ الأعمدة الثلاثة التالية تبقى NULL حتى تُعتمد معادلة التقفيل (P-01).
  --    لا يوجد أي كود يحسبها — لا في قاعدة البيانات ولا في التطبيق.
  expected_balance  numeric(18, 4),
  closing_balance   numeric(18, 4),
  difference        numeric(18, 4),
  currency          char(3)     not null default 'SAR',
  status            text        not null default 'open'
                      check (status in ('open', 'closed', 'reconciled')),
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid,
  updated_by        uuid,
  constraint shifts_org_ref_key unique (organization_id, reference_no),
  constraint shifts_closed_consistency
    check ((status = 'open' and closed_at is null) or (status <> 'open'))
);

create index if not exists shifts_branch_status_idx on public.shifts (branch_id, status, opened_at desc);
create index if not exists shifts_opened_by_idx on public.shifts (opened_by);

-- وردية مفتوحة واحدة لكل مستخدم/خزينة في نفس الوقت (قيد سلامة تقني، لا قاعدة عمل)
create unique index if not exists shifts_one_open_per_user_treasury_uidx
  on public.shifts (opened_by, treasury_id) where status = 'open';

comment on table public.shifts is
  'الوردية. ⚠️ معادلة التقفيل (P-01) غير منفّذة: expected_balance/difference تبقى NULL '
  'حتى تعتمدها الإدارة المالية. الإغلاق يسجّل الوقت والمسؤول فقط.';

create table if not exists public.custody_handovers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations(id) on delete restrict,
  branch_id       uuid        not null references public.branches(id) on delete restrict,
  shift_id        uuid        references public.shifts(id) on delete set null,
  treasury_id     uuid        references public.treasuries(id) on delete restrict,
  from_user_id    uuid        references public.profiles(id) on delete set null,
  to_user_id      uuid        references public.profiles(id) on delete set null,
  amount          numeric(18, 4) not null check (amount > 0),
  currency        char(3)     not null default 'SAR',
  handed_at       timestamptz not null default now(),
  status          text        not null default 'pending'
                    check (status in ('pending', 'accepted', 'rejected')),
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  updated_by      uuid,
  constraint custody_handovers_distinct_parties check (from_user_id is distinct from to_user_id)
);

create index if not exists custody_handovers_branch_idx
  on public.custody_handovers (branch_id, handed_at desc);

create table if not exists public.expense_categories (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations(id) on delete restrict,
  branch_id       uuid        references public.branches(id) on delete restrict,
  code            text        not null,
  name_ar         text        not null,
  status          text        not null default 'active' check (status in ('active', 'inactive')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  updated_by      uuid,
  constraint expense_categories_org_code_key unique (organization_id, code)
);

create table if not exists public.expenses (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations(id) on delete restrict,
  branch_id       uuid        not null references public.branches(id) on delete restrict,
  category_id     uuid        references public.expense_categories(id) on delete restrict,
  transaction_id  uuid        references public.financial_transactions(id) on delete restrict,
  treasury_id     uuid        references public.treasuries(id) on delete restrict,
  reference_no    text,
  amount          numeric(18, 4) not null check (amount > 0),
  currency        char(3)     not null default 'SAR',
  occurred_at     timestamptz not null default now(),
  description     text,
  status          text        not null default 'draft'
                    check (status in ('draft', 'posted', 'void')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  updated_by      uuid
);

create index if not exists expenses_branch_idx on public.expenses (branch_id, occurred_at desc);

create table if not exists public.supplier_payments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations(id) on delete restrict,
  branch_id       uuid        not null references public.branches(id) on delete restrict,
  supplier_id     uuid        not null references public.suppliers(id) on delete restrict,
  transaction_id  uuid        references public.financial_transactions(id) on delete restrict,
  treasury_id     uuid        references public.treasuries(id) on delete restrict,
  purchase_order_id uuid      references public.purchase_orders(id) on delete set null,
  reference_no    text,
  amount          numeric(18, 4) not null check (amount > 0),
  currency        char(3)     not null default 'SAR',
  paid_at         timestamptz not null default now(),
  method          text        not null default 'cash'
                    check (method in ('cash', 'bank_transfer', 'card', 'cheque', 'other')),
  status          text        not null default 'draft'
                    check (status in ('draft', 'posted', 'void')),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  updated_by      uuid
);

create index if not exists supplier_payments_supplier_idx
  on public.supplier_payments (supplier_id, paid_at desc);
create index if not exists supplier_payments_branch_idx
  on public.supplier_payments (branch_id, paid_at desc);

-- ربط حركة الخزينة بالوردية بعد إنشاء shifts
alter table public.treasury_movements
  drop constraint if exists treasury_movements_shift_id_fkey;
alter table public.treasury_movements
  add constraint treasury_movements_shift_id_fkey
  foreign key (shift_id) references public.shifts(id) on delete restrict;

-- -----------------------------------------------------------------------------
-- عدم قابلية التعديل على الدفاتر المالية
-- التصحيح يكون بحركة عكسية — لا بتعديل أو حذف.
-- -----------------------------------------------------------------------------
drop trigger if exists treasury_movements_immutable on public.treasury_movements;
create trigger treasury_movements_immutable
  before update or delete on public.treasury_movements
  for each row execute function app.prevent_mutation();

-- الحركة المالية: يُسمح بالانتقال draft → posted/void فقط، ولا حذف إطلاقًا.
create or replace function app.guard_financial_transaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'حذف الحركات المالية غير مسموح. استخدم إلغاءً (void) أو حركة عكسية.'
      using errcode = 'restrict_violation';
  end if;

  if old.status in ('posted', 'void') then
    -- بعد الترحيل: لا شيء قابل للتعديل سوى الإلغاء
    if new.status = 'void' and old.status = 'posted' then
      if new.amount is distinct from old.amount
         or new.currency is distinct from old.currency
         or new.branch_id is distinct from old.branch_id
         or new.organization_id is distinct from old.organization_id then
        raise exception 'لا يجوز تعديل بيانات حركة مالية مُرحَّلة'
          using errcode = 'restrict_violation';
      end if;
      return new;
    end if;
    raise exception 'الحركة المالية المُرحَّلة غير قابلة للتعديل'
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists financial_transactions_guard on public.financial_transactions;
create trigger financial_transactions_guard
  before update or delete on public.financial_transactions
  for each row execute function app.guard_financial_transaction();

-- -----------------------------------------------------------------------------
-- سياسات RLS
-- -----------------------------------------------------------------------------
select app.apply_rls('treasuries', 'finance.treasury.view', 'finance.treasury.manage', 'finance.treasury.manage', null);

-- الحركة المالية: إنشاء وتعديل (draft فقط، والمحفّز يفرض الباقي)، لا حذف
select app.apply_rls('financial_transactions', 'finance.view', 'finance.create', 'finance.approve', null);
select app.apply_rls('financial_entries',      'finance.view', 'finance.create', 'finance.approve', null);

-- دفتر الخزينة: قراءة وإدراج فقط
select app.apply_rls('treasury_movements', 'finance.treasury.view', 'finance.create', null, null, true, true);

select app.apply_rls('shifts',             'finance.view', 'finance.shifts.open', 'finance.shifts.close', null);
select app.apply_rls('custody_handovers',  'finance.view', 'finance.custody.handover', 'finance.custody.handover', null);
select app.apply_rls('expense_categories', 'finance.view', 'finance.treasury.manage', 'finance.treasury.manage', null);
select app.apply_rls('expenses',           'finance.view', 'finance.create', 'finance.approve', null);
select app.apply_rls('supplier_payments',  'finance.view', 'finance.create', 'finance.approve', null);

select app.apply_audit_triggers('treasuries');
select app.apply_audit_triggers('financial_transactions');
select app.apply_audit_triggers('financial_entries');
select app.apply_audit_triggers('treasury_movements');
select app.apply_audit_triggers('shifts');
select app.apply_audit_triggers('custody_handovers');
select app.apply_audit_triggers('expense_categories');
select app.apply_audit_triggers('expenses');
select app.apply_audit_triggers('supplier_payments');
