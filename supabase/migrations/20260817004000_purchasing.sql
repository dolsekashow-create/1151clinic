-- =============================================================================
--  Migration : 20260817004000_purchasing
--  Phase     : 4 — أساس المشتريات (بنية فقط)
--  Reference : docs/DATABASE.md §2.4
--
--  ⚠️ سلسلة الموافقات (P-08)، إلزامية الطلب قبل الأمر (P-09)، والاستلام الجزئي
--     (P-10) كلها معلّقة. لذلك:
--       • جدول approvals عام (polymorphic) يستوعب أي عدد خطوات وأي معتمِد.
--       • purchase_requests و purchase_orders غير مترابطين إلزاميًا.
--       • goods_receipt_items منفصلة عن purchase_order_items ⇒ الاستلام الجزئي
--         ممكن بنيويًا دون أن نفرض قاعدته.
--     لا انتقال حالة تلقائي، ولا قيد مالي تلقائي.
-- =============================================================================

create table if not exists public.purchase_requests (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations(id) on delete restrict,
  branch_id       uuid        not null references public.branches(id) on delete restrict,
  reference_no    text,
  department_id   uuid        references public.departments(id) on delete set null,
  requested_by    uuid        references public.profiles(id) on delete set null,
  needed_by       date,
  -- الحالات مفتوحة عمدًا: القائمة النهائية غير معتمدة
  status          text        not null default 'draft',
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  updated_by      uuid,
  constraint purchase_requests_org_ref_key unique (organization_id, reference_no)
);

create index if not exists purchase_requests_branch_idx
  on public.purchase_requests (branch_id, created_at desc);

create table if not exists public.purchase_request_items (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid           not null references public.organizations(id) on delete restrict,
  branch_id           uuid           not null references public.branches(id) on delete restrict,
  purchase_request_id uuid           not null references public.purchase_requests(id) on delete cascade,
  item_id             uuid           references public.items(id) on delete restrict,
  description         text,
  quantity            numeric(18, 4) not null check (quantity > 0),
  unit_id             uuid           references public.units(id) on delete restrict,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid,
  updated_by          uuid
);

create index if not exists purchase_request_items_parent_idx
  on public.purchase_request_items (purchase_request_id);

create table if not exists public.purchase_orders (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid        not null references public.organizations(id) on delete restrict,
  branch_id           uuid        not null references public.branches(id) on delete restrict,
  reference_no        text,
  supplier_id         uuid        not null references public.suppliers(id) on delete restrict,
  -- اختياري عمدًا: P-09 لم تُعتمد بعد
  purchase_request_id uuid        references public.purchase_requests(id) on delete set null,
  order_date          date        not null default current_date,
  expected_date       date,
  currency            char(3)     not null default 'SAR',
  -- إجمالي محسوب من البنود عبر محفّز — لا يُكتب من العميل
  total_amount        numeric(18, 4) not null default 0 check (total_amount >= 0),
  status              text        not null default 'draft',
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid,
  updated_by          uuid,
  constraint purchase_orders_org_ref_key unique (organization_id, reference_no)
);

create index if not exists purchase_orders_branch_idx
  on public.purchase_orders (branch_id, order_date desc);
create index if not exists purchase_orders_supplier_idx on public.purchase_orders (supplier_id);

comment on column public.purchase_orders.status is
  'حالة نصّية مفتوحة. قائمة الحالات وانتقالاتها = P-08 معلّقة — لا تُفرض من قاعدة البيانات بعد.';

create table if not exists public.purchase_order_items (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid           not null references public.organizations(id) on delete restrict,
  branch_id         uuid           not null references public.branches(id) on delete restrict,
  purchase_order_id uuid           not null references public.purchase_orders(id) on delete cascade,
  item_id           uuid           references public.items(id) on delete restrict,
  description       text,
  quantity          numeric(18, 4) not null check (quantity > 0),
  unit_id           uuid           references public.units(id) on delete restrict,
  unit_price        numeric(18, 4) not null default 0 check (unit_price >= 0),
  line_total        numeric(18, 4) generated always as (quantity * unit_price) stored,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid,
  updated_by        uuid
);

create index if not exists purchase_order_items_parent_idx
  on public.purchase_order_items (purchase_order_id);

-- إجمالي أمر الشراء = مجموع البنود (حساب حسابي، ليس قاعدة عمل)
create or replace function app.recalculate_purchase_order_total()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order uuid := coalesce(new.purchase_order_id, old.purchase_order_id);
begin
  update public.purchase_orders po
     set total_amount = coalesce(
           (select sum(i.line_total) from public.purchase_order_items i
             where i.purchase_order_id = v_order), 0),
         updated_at = now()
   where po.id = v_order;
  return null;
end;
$$;

drop trigger if exists purchase_order_items_total on public.purchase_order_items;
create trigger purchase_order_items_total
  after insert or update or delete on public.purchase_order_items
  for each row execute function app.recalculate_purchase_order_total();

create table if not exists public.goods_receipts (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid        not null references public.organizations(id) on delete restrict,
  branch_id         uuid        not null references public.branches(id) on delete restrict,
  reference_no      text,
  purchase_order_id uuid        references public.purchase_orders(id) on delete restrict,
  supplier_id       uuid        references public.suppliers(id) on delete restrict,
  warehouse_id      uuid        not null references public.warehouses(id) on delete restrict,
  received_at       timestamptz not null default now(),
  received_by       uuid        references public.profiles(id) on delete set null,
  status            text        not null default 'draft',
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid,
  updated_by        uuid,
  constraint goods_receipts_org_ref_key unique (organization_id, reference_no)
);

create index if not exists goods_receipts_branch_idx
  on public.goods_receipts (branch_id, received_at desc);

create table if not exists public.goods_receipt_items (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid           not null references public.organizations(id) on delete restrict,
  branch_id        uuid           not null references public.branches(id) on delete restrict,
  goods_receipt_id uuid           not null references public.goods_receipts(id) on delete cascade,
  purchase_order_item_id uuid     references public.purchase_order_items(id) on delete set null,
  item_id          uuid           references public.items(id) on delete restrict,
  quantity         numeric(18, 4) not null check (quantity > 0),
  unit_id          uuid           references public.units(id) on delete restrict,
  unit_cost        numeric(18, 4) check (unit_cost >= 0),
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  updated_by       uuid
);

create index if not exists goods_receipt_items_parent_idx
  on public.goods_receipt_items (goods_receipt_id);

comment on table public.goods_receipt_items is
  'منفصلة عن purchase_order_items ⇒ الاستلام الجزئي ممكن بنيويًا. '
  'قاعدة قبوله ومعالجة المتبقي = P-10 معلّقة. '
  'الاستلام لا يُولّد حركة مخزون تلقائيًا — يتم صراحةً من طبقة التطبيق.';

-- -----------------------------------------------------------------------------
-- الموافقات — polymorphic، مفصولة عن مستندات المشتريات
-- -----------------------------------------------------------------------------
create table if not exists public.approvals (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations(id) on delete restrict,
  branch_id       uuid        references public.branches(id) on delete restrict,
  entity_type     text        not null,
  entity_id       uuid        not null,
  step_no         integer     not null default 1 check (step_no > 0),
  approver_id     uuid        references public.profiles(id) on delete set null,
  status          text        not null default 'pending'
                    check (status in ('pending', 'approved', 'rejected', 'skipped')),
  decided_at      timestamptz,
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  updated_by      uuid,
  constraint approvals_entity_step_key unique (entity_type, entity_id, step_no)
);

create index if not exists approvals_entity_idx on public.approvals (entity_type, entity_id);
create index if not exists approvals_approver_idx on public.approvals (approver_id, status);

comment on table public.approvals is
  'سلسلة موافقات عامة لأي مستند. مفصولة عمدًا لأن عدد الخطوات والمعتمِدين وحدود '
  'المبالغ = P-08 معلّقة؛ تغييرها لاحقًا لا يمس جداول المشتريات.';

-- -----------------------------------------------------------------------------
-- سياسات RLS
-- -----------------------------------------------------------------------------
select app.apply_rls('purchase_requests',      'purchasing.view', 'purchasing.create', 'purchasing.create', null);
select app.apply_rls('purchase_request_items', 'purchasing.view', 'purchasing.create', 'purchasing.create', 'purchasing.create');
select app.apply_rls('purchase_orders',        'purchasing.view', 'purchasing.create', 'purchasing.create', null);
select app.apply_rls('purchase_order_items',   'purchasing.view', 'purchasing.create', 'purchasing.create', 'purchasing.create');
select app.apply_rls('goods_receipts',         'purchasing.view', 'purchasing.receive', 'purchasing.receive', null);
select app.apply_rls('goods_receipt_items',    'purchasing.view', 'purchasing.receive', 'purchasing.receive', 'purchasing.receive');
select app.apply_rls('approvals',              'purchasing.view', 'purchasing.approve', 'purchasing.approve', null);

select app.apply_audit_triggers('purchase_requests');
select app.apply_audit_triggers('purchase_request_items');
select app.apply_audit_triggers('purchase_orders');
select app.apply_audit_triggers('purchase_order_items');
select app.apply_audit_triggers('goods_receipts');
select app.apply_audit_triggers('goods_receipt_items');
select app.apply_audit_triggers('approvals');
