-- =============================================================================
--  Migration : 20260817003000_inventory
--  Phase     : 4 — أساس المخازن (بنية فقط)
--  Reference : docs/DATABASE.md §2.3
--
--  ⚠️ دورة المخزن (P-05)، طريقة التقييم (P-06)، والسماح بالرصيد السالب (P-07)
--     كلها معلّقة. لذلك:
--       • stock_movements دفتر أستاذ append-only يستوعب أي دورة تُعتمد لاحقًا.
--       • stock_levels جدول مشتق يُحدَّث من محفّز، ويمكن إعادة حسابه بالكامل.
--       • لا قيد يمنع الرصيد السالب — يُضاف عند اعتماد P-07.
-- =============================================================================

create table if not exists public.item_categories (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations(id) on delete restrict,
  branch_id       uuid        references public.branches(id) on delete restrict,
  parent_id       uuid        references public.item_categories(id) on delete restrict,
  code            text        not null,
  name_ar         text        not null,
  status          text        not null default 'active' check (status in ('active', 'inactive')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  updated_by      uuid,
  constraint item_categories_org_code_key unique (organization_id, code)
);

create table if not exists public.units (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations(id) on delete restrict,
  branch_id       uuid        references public.branches(id) on delete restrict,
  code            text        not null,
  name_ar         text        not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  updated_by      uuid,
  constraint units_org_code_key unique (organization_id, code)
);

create table if not exists public.suppliers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations(id) on delete restrict,
  branch_id       uuid        references public.branches(id) on delete restrict,
  code            text        not null,
  name_ar         text        not null,
  contact_person  text,
  phone           text,
  email           text,
  address         text,
  tax_number      text,
  status          text        not null default 'active' check (status in ('active', 'inactive')),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  updated_by      uuid,
  deleted_at      timestamptz,
  constraint suppliers_org_code_key unique (organization_id, code)
);

create index if not exists suppliers_organization_id_idx on public.suppliers (organization_id);

comment on column public.suppliers.branch_id is
  'null = مورد مركزي للمنشأة. غير null = مورد خاص بفرع.';

create table if not exists public.items (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations(id) on delete restrict,
  branch_id       uuid        references public.branches(id) on delete restrict,
  category_id     uuid        references public.item_categories(id) on delete restrict,
  base_unit_id    uuid        references public.units(id) on delete restrict,
  code            text        not null,
  name_ar         text        not null,
  name_en         text,
  description     text,
  -- نوع التتبع يُترك عمودًا لأن دورة المخزن معلّقة (P-05)
  tracking        text        not null default 'none'
                    check (tracking in ('none', 'batch', 'serial')),
  reorder_level   numeric(18, 4) check (reorder_level >= 0),
  status          text        not null default 'active' check (status in ('active', 'inactive')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  updated_by      uuid,
  deleted_at      timestamptz,
  constraint items_org_code_key unique (organization_id, code)
);

create index if not exists items_organization_id_idx on public.items (organization_id);
create index if not exists items_category_idx on public.items (category_id);
create index if not exists items_name_trgm_idx
  on public.items using gin (name_ar extensions.gin_trgm_ops);

create table if not exists public.warehouses (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations(id) on delete restrict,
  branch_id       uuid        not null references public.branches(id) on delete restrict,
  code            text        not null,
  name_ar         text        not null,
  is_default      boolean     not null default false,
  status          text        not null default 'active' check (status in ('active', 'inactive')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  updated_by      uuid,
  constraint warehouses_org_code_key unique (organization_id, code)
);

create index if not exists warehouses_branch_id_idx on public.warehouses (branch_id);

-- -----------------------------------------------------------------------------
-- دفتر حركات المخزون — append-only
-- -----------------------------------------------------------------------------
create table if not exists public.stock_movements (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid        not null references public.organizations(id) on delete restrict,
  branch_id        uuid        not null references public.branches(id) on delete restrict,
  warehouse_id     uuid        not null references public.warehouses(id) on delete restrict,
  item_id          uuid        not null references public.items(id) on delete restrict,
  unit_id          uuid        references public.units(id) on delete restrict,
  movement_type    text        not null
                     check (movement_type in ('receipt', 'issue', 'transfer_in', 'transfer_out', 'adjustment')),
  -- الكمية دائمًا موجبة؛ الاتجاه من direction. الإشارة السالبة مصدر أخطاء متكرر.
  quantity         numeric(18, 4) not null check (quantity > 0),
  direction        smallint    not null check (direction in (1, -1)),
  unit_cost        numeric(18, 4) check (unit_cost >= 0),
  currency         char(3),
  occurred_at      timestamptz not null default now(),
  -- ربط الحركة بالعملية التي سببتها (استلام مشتريات، تحويل، تسوية…)
  source_module    text,
  source_record_id uuid,
  -- مجموعة التحويل: حركتان (out/in) تحملان نفس المعرّف
  transfer_group_id uuid,
  reference_no     text,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  updated_by       uuid
);

create index if not exists stock_movements_warehouse_item_idx
  on public.stock_movements (warehouse_id, item_id, occurred_at desc);
create index if not exists stock_movements_branch_idx
  on public.stock_movements (branch_id, occurred_at desc);
create index if not exists stock_movements_source_idx
  on public.stock_movements (source_module, source_record_id);

comment on table public.stock_movements is
  'دفتر أستاذ للمخزون: append-only. التصحيح بحركة عكسية لا بتعديل السجل. '
  'الحركة لا تُقيّد ماليًا تلقائيًا — P-03 معلّقة.';

-- -----------------------------------------------------------------------------
-- الأرصدة — جدول مشتق
-- -----------------------------------------------------------------------------
create table if not exists public.stock_levels (
  organization_id uuid           not null references public.organizations(id) on delete restrict,
  branch_id       uuid           not null references public.branches(id) on delete restrict,
  warehouse_id    uuid           not null references public.warehouses(id) on delete cascade,
  item_id         uuid           not null references public.items(id) on delete cascade,
  quantity        numeric(18, 4) not null default 0,
  updated_at      timestamptz    not null default now(),
  primary key (warehouse_id, item_id)
);

create index if not exists stock_levels_branch_item_idx on public.stock_levels (branch_id, item_id);
create index if not exists stock_levels_org_idx on public.stock_levels (organization_id);

comment on table public.stock_levels is
  'رصيد مشتق من stock_movements. ⚠️ يُحدَّث من المحفّز فقط — لا كتابة مباشرة من التطبيق. '
  'قابل لإعادة الحساب بالكامل عبر app.recalculate_stock_levels().';

-- تحديث الرصيد من الحركة (حساب كمّي بحت — ليس قاعدة عمل)
create or replace function app.apply_stock_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.stock_levels as sl
    (organization_id, branch_id, warehouse_id, item_id, quantity, updated_at)
  values
    (new.organization_id, new.branch_id, new.warehouse_id, new.item_id,
     new.quantity * new.direction, now())
  on conflict (warehouse_id, item_id) do update
    set quantity   = sl.quantity + (new.quantity * new.direction),
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists stock_movements_apply on public.stock_movements;
create trigger stock_movements_apply
  after insert on public.stock_movements
  for each row execute function app.apply_stock_movement();

-- منع التعديل/الحذف على الدفتر
drop trigger if exists stock_movements_immutable on public.stock_movements;
create trigger stock_movements_immutable
  before update or delete on public.stock_movements
  for each row execute function app.prevent_mutation();

-- إعادة حساب كاملة — أداة تشغيلية، تُنفَّذ من الخادم بمفتاح إداري فقط
create or replace function app.recalculate_stock_levels(p_organization_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  delete from public.stock_levels where organization_id = p_organization_id;

  insert into public.stock_levels
    (organization_id, branch_id, warehouse_id, item_id, quantity, updated_at)
  select sm.organization_id, sm.branch_id, sm.warehouse_id, sm.item_id,
         sum(sm.quantity * sm.direction), now()
  from public.stock_movements sm
  where sm.organization_id = p_organization_id
  group by sm.organization_id, sm.branch_id, sm.warehouse_id, sm.item_id;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function app.recalculate_stock_levels(uuid) from public;

-- -----------------------------------------------------------------------------
-- سياسات RLS
-- -----------------------------------------------------------------------------
select app.apply_rls('item_categories', 'inventory.view', 'inventory.create', 'inventory.update', null);
select app.apply_rls('units',           'inventory.view', 'inventory.create', 'inventory.update', null);
select app.apply_rls('items',           'inventory.view', 'inventory.create', 'inventory.update', null);
select app.apply_rls('warehouses',      'inventory.view', 'inventory.warehouses.manage', 'inventory.warehouses.manage', null);
select app.apply_rls('suppliers',       'purchasing.suppliers.view', 'purchasing.suppliers.manage', 'purchasing.suppliers.manage', null);

-- الدفتر: قراءة وإدراج فقط — لا تعديل ولا حذف بأي صلاحية
select app.apply_rls('stock_movements', 'inventory.view', 'inventory.create', null, null, true, true);

select app.apply_audit_triggers('item_categories');
select app.apply_audit_triggers('units');
select app.apply_audit_triggers('items');
select app.apply_audit_triggers('warehouses');
select app.apply_audit_triggers('suppliers');
select app.apply_audit_triggers('stock_movements');

-- stock_levels : قراءة فقط للتطبيق. الكتابة من المحفّز (SECURITY DEFINER).
alter table public.stock_levels enable row level security;

drop policy if exists stock_levels_select on public.stock_levels;
create policy stock_levels_select on public.stock_levels
  for select to authenticated
  using (
    (select app.is_active_user())
    and organization_id = (select app.current_org_id())
    and (select app.can_access_branch(branch_id))
    and (select app.has_permission('inventory.view'))
  );

grant select on public.stock_levels to authenticated;
