-- =============================================================================
--  Migration : 20260817007000_security_hardening
--  Phase     : 2 (مراجعة) — إصلاحات ناتجة عن مراجعة قاعدة البيانات
--  Reference : docs/DATABASE_REVIEW.md
--
--  ⚠️ هذا الترحيل يصلح ثغرة تصعيد صلاحيات **حرجة** مُثبَتة عمليًا، إضافةً إلى
--     إصلاحات سلامة بيانات وأداء. لا يحتوي أي قاعدة عمل.
-- =============================================================================

-- =============================================================================
--  [CRITICAL-01] تصعيد صلاحيات عبر دوال app الإدارية
--
--  المشكلة : PostgreSQL يمنح EXECUTE على كل دالة جديدة لـ PUBLIC افتراضيًا.
--            الترحيل الأصلي سحب هذا الامتياز من دوال القراءة الست فقط،
--            وترك app.apply_rls و app.apply_audit_triggers مكشوفتين.
--  الأثر   : أي مستخدم مُصادَق يستطيع تنفيذ:
--                select app.apply_rls('customers','customers.view',…, false, false);
--            فتُحذف سياسات الجدول وتُعاد كتابتها بلا شرط فرع ⇒ سقوط عزل الفروع
--            بالكامل، وقراءة وحذف بيانات كل الفروع. وكذلك إسقاط محفّزات التدقيق.
--  الإثبات : مستخدم فرع أ-1 رأى عملاء الفرعين ثم حذف صف فرع أ-2.
--  السبب   : الاعتماد على سحب الامتياز يدويًا لكل دالة بدل قاعدة عامة.
-- =============================================================================

-- 1) قاعدة عامة: لا EXECUTE لـ PUBLIC على أي دالة في مخطط app — حالية أو مستقبلية.
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
  loop
    execute format('revoke all on function %s from public', fn.signature);
    execute format('revoke all on function %s from anon, authenticated', fn.signature);
  end loop;
end;
$$;

-- الدوال التي تُنشأ لاحقًا في مخطط app لن تُمنح لـ PUBLIC تلقائيًا
alter default privileges in schema app revoke execute on functions from public;

-- 2) إعادة المنح الصريح لدوال القراءة الست فقط — وهي كل ما تحتاجه سياسات RLS.
grant execute on function app.current_user_id()       to authenticated;
grant execute on function app.current_org_id()        to authenticated;
grant execute on function app.is_active_user()        to authenticated;
grant execute on function app.has_permission(text)    to authenticated;
grant execute on function app.has_org_scope()         to authenticated;
grant execute on function app.can_access_branch(uuid) to authenticated;

comment on schema app is
  'دوال الأمان والمساعدة (SECURITY DEFINER). غير مكشوف عبر PostgREST. '
  'قاعدة مُلزِمة: لا EXECUTE لـ PUBLIC؛ يُمنح صراحةً لدوال القراءة فقط. '
  'أي دالة إدارية أو محفّز هنا يجب ألا يكون قابلًا للاستدعاء من العميل.';

-- =============================================================================
--  [HIGH-01] السجلات على مستوى المنشأة غير مرئية لموظفي الفروع
--
--  المشكلة : الأعمدة branch_id في جداول المراجع (الخدمات، الأصناف، الوحدات،
--            التصنيفات، الموردين، الأقسام…) قابلة للإفراغ، و NULL يعني
--            «سجل على مستوى المنشأة». لكن app.can_access_branch(null) تُرجع
--            false لغير أصحاب نطاق المنشأة.
--  الأثر   : كتالوج الخدمات والأصناف المشترك يظهر فارغًا تمامًا لموظف الفرع،
--            رغم أنه بيانات مرجعية مشتركة. النظام غير قابل للاستخدام عمليًا.
--  السبب   : قالب السياسة يعامل NULL كـ«فرع غير مصرّح» بدل «سجل مشترك».
--  الحل    : علم صريح على مستوى الجدول يسمح بالقراءة فقط للسجلات المشتركة.
--            الكتابة تبقى محكومة بنطاق الفرع ⇒ موظف الفرع لا ينشئ سجلًا مشتركًا.
-- =============================================================================

drop function if exists app.apply_rls(text, text, text, text, text, boolean, boolean);

create or replace function app.apply_rls(
  p_table               text,
  p_view                text,                  -- صلاحية القراءة
  p_create              text default null,     -- null ⇒ لا سياسة إدراج (ممنوع)
  p_update              text default null,     -- null ⇒ لا سياسة تعديل (ممنوع)
  p_delete              text default null,     -- null ⇒ لا سياسة حذف (ممنوع)
  p_branch              boolean default true,  -- هل الجدول يحمل عمود branch_id؟
  p_ledger              boolean default false, -- جدول دفتري: يمنع UPDATE/DELETE مطلقًا
  p_org_level_readable  boolean default false  -- السجلات ذات branch_id = null مشتركة للقراءة
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_branch_read  text := '';
  v_branch_write text := '';
  v_scope_read   text;
  v_scope_write  text;
begin
  if p_branch then
    -- القراءة: يُسمح بالسجل المشترك (branch_id is null) عند تفعيل العلم
    v_branch_read := case
      when p_org_level_readable
        then ' and (branch_id is null or (select app.can_access_branch(branch_id)))'
      else ' and (select app.can_access_branch(branch_id))'
    end;
    -- الكتابة: دائمًا نطاق فرع صارم — إنشاء سجل مشترك يتطلب نطاق منشأة
    v_branch_write := ' and (select app.can_access_branch(branch_id))';
  end if;

  v_scope_read :=
    '(select app.is_active_user()) and organization_id = (select app.current_org_id())'
    || v_branch_read;
  v_scope_write :=
    '(select app.is_active_user()) and organization_id = (select app.current_org_id())'
    || v_branch_write;

  execute format('alter table public.%I enable row level security', p_table);

  execute format('drop policy if exists %I on public.%I', p_table || '_select', p_table);
  execute format(
    'create policy %I on public.%I for select to authenticated using (%s and (select app.has_permission(%L)))',
    p_table || '_select', p_table, v_scope_read, p_view);

  execute format('drop policy if exists %I on public.%I', p_table || '_insert', p_table);
  if p_create is not null then
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (%s and (select app.has_permission(%L)))',
      p_table || '_insert', p_table, v_scope_write, p_create);
  end if;

  -- UPDATE — الصف الحالي والصف الناتج كلاهما داخل نطاق الكتابة.
  -- USING يستخدم نطاق القراءة حتى يمكن تعديل سجل مشترك بصلاحية مناسبة،
  -- و WITH CHECK يستخدم نطاق الكتابة الصارم ⇒ يستحيل نقل صف لفرع آخر
  -- أو تحويل صف خاص بفرع إلى سجل مشترك.
  execute format('drop policy if exists %I on public.%I', p_table || '_update', p_table);
  if p_update is not null and not p_ledger then
    execute format(
      'create policy %I on public.%I for update to authenticated using (%s and (select app.has_permission(%L))) with check (%s and (select app.has_permission(%L)))',
      p_table || '_update', p_table, v_scope_read, p_update, v_scope_write, p_update);
  end if;

  execute format('drop policy if exists %I on public.%I', p_table || '_delete', p_table);
  if p_delete is not null and not p_ledger then
    execute format(
      'create policy %I on public.%I for delete to authenticated using (%s and (select app.has_permission(%L)))',
      p_table || '_delete', p_table, v_scope_write, p_delete);
  end if;

  execute format('grant select on public.%I to authenticated', p_table);
  if p_create is not null then
    execute format('grant insert on public.%I to authenticated', p_table);
  end if;
  if p_update is not null and not p_ledger then
    execute format('grant update on public.%I to authenticated', p_table);
  end if;
  if p_delete is not null and not p_ledger then
    execute format('grant delete on public.%I to authenticated', p_table);
  end if;
end;
$$;

revoke all on function app.apply_rls(text, text, text, text, text, boolean, boolean, boolean)
  from public, anon, authenticated;

comment on function app.apply_rls(text, text, text, text, text, boolean, boolean, boolean) is
  'يولّد سياسات RLS القياسية. القالب الأمني الوحيد في النظام — راجعه بعناية. '
  '⛔ ممنوع منحه لأي دور عميل.';

-- إعادة توليد سياسات جداول المراجع مع السماح بقراءة السجلات المشتركة
select app.apply_rls('departments', 'organizations.departments.view', 'organizations.departments.manage', 'organizations.departments.manage', null, true, false, true);
select app.apply_rls('services', 'services.view', 'services.create', 'services.update', null, true, false, true);
select app.apply_rls('item_categories', 'inventory.view', 'inventory.create', 'inventory.update', null, true, false, true);
select app.apply_rls('units', 'inventory.view', 'inventory.create', 'inventory.update', null, true, false, true);
select app.apply_rls('items', 'inventory.view', 'inventory.create', 'inventory.update', null, true, false, true);
select app.apply_rls('suppliers', 'purchasing.suppliers.view', 'purchasing.suppliers.manage', 'purchasing.suppliers.manage', null, true, false, true);
select app.apply_rls('expense_categories', 'finance.view', 'finance.treasury.manage', 'finance.treasury.manage', null, true, false, true);
select app.apply_rls('notification_templates', 'notifications.view', 'notifications.templates.manage', 'notifications.templates.manage', 'notifications.templates.manage', true, false, true);
select app.apply_rls('files', 'reports.view', 'reports.view', null, null, true, false, true);
select app.apply_rls('approvals', 'purchasing.view', 'purchasing.approve', 'purchasing.approve', null, true, false, true);

-- =============================================================================
--  [HIGH-02] لا ضمان بأن السجل الابن يتبع نفس فرع أبيه
--
--  المشكلة : بند القيد يحمل branch_id خاصًا به، ومفتاحه الأجنبي يشير إلى
--            معرّف الأب فقط. سياسة الإدراج تفحص فرع **البند** لا فرع الأب.
--  الأثر   : مستخدم فرع أ يستطيع إلحاق بند بمستند في فرع ب (لا يقرأه لكنه
--            يفسد مجاميعه). خطر سلامة بيانات مالية.
--  الحل    : مفتاح أجنبي مركّب (id, branch_id) ⇒ المحرّك نفسه يرفض عدم التطابق.
-- =============================================================================

alter table public.financial_transactions
  add constraint financial_transactions_id_branch_key unique (id, branch_id);
alter table public.purchase_orders
  add constraint purchase_orders_id_branch_key unique (id, branch_id);
alter table public.purchase_requests
  add constraint purchase_requests_id_branch_key unique (id, branch_id);
alter table public.goods_receipts
  add constraint goods_receipts_id_branch_key unique (id, branch_id);
alter table public.warehouses
  add constraint warehouses_id_branch_key unique (id, branch_id);

alter table public.financial_entries
  drop constraint financial_entries_transaction_id_fkey,
  add constraint financial_entries_transaction_branch_fkey
    foreign key (transaction_id, branch_id)
    references public.financial_transactions(id, branch_id) on delete cascade;

alter table public.purchase_order_items
  drop constraint purchase_order_items_purchase_order_id_fkey,
  add constraint purchase_order_items_order_branch_fkey
    foreign key (purchase_order_id, branch_id)
    references public.purchase_orders(id, branch_id) on delete cascade;

alter table public.purchase_request_items
  drop constraint purchase_request_items_purchase_request_id_fkey,
  add constraint purchase_request_items_request_branch_fkey
    foreign key (purchase_request_id, branch_id)
    references public.purchase_requests(id, branch_id) on delete cascade;

alter table public.goods_receipt_items
  drop constraint goods_receipt_items_goods_receipt_id_fkey,
  add constraint goods_receipt_items_receipt_branch_fkey
    foreign key (goods_receipt_id, branch_id)
    references public.goods_receipts(id, branch_id) on delete cascade;

alter table public.stock_levels
  drop constraint stock_levels_warehouse_id_fkey,
  add constraint stock_levels_warehouse_branch_fkey
    foreign key (warehouse_id, branch_id)
    references public.warehouses(id, branch_id) on delete cascade;

-- =============================================================================
--  [MEDIUM-01] مخطط integration بلا RLS
--
--  غير مكشوف عبر PostgREST ولا يملك أي دور عميل صلاحية usage عليه، لكن تفعيل
--  RLS بلا سياسات يجعل الرفض صريحًا على مستوى المحرّك بدل الاعتماد على الإعداد.
-- =============================================================================

alter table integration.import_batches  enable row level security;
alter table integration.entity_mappings enable row level security;
alter table integration.sync_logs       enable row level security;

-- =============================================================================
--  [MEDIUM-02] مفاتيح أجنبية بلا فهارس
--
--  67 مفتاحًا أجنبيًا بلا فهرس يبدأ بأعمدته. غير كلها يستحق فهرسًا؛ نضيف فقط
--  ما له مبرر واضح:
--    (أ) أعمدة تُستخدم في كل تقييم لسياسة RLS  → أثر على كل استعلام
--    (ب) مفاتيح الأب في جداول البنود           → الجلب دائمًا عبر الأب
--    (ج) مفاتيح يستلزم حذف الأب مسحها          → تجنّب فحص جدول كامل عند الحذف
--  ما لم يُفهرس: جداول مرجعية صغيرة (units, categories) وأعمدة تُستعلَم نادرًا.
-- =============================================================================

-- (أ) organization_id على الجداول التي لم تُفهرس بعد — يُقيَّم في كل سياسة
create index if not exists approvals_org_idx               on public.approvals (organization_id);
create index if not exists custody_handovers_org_idx       on public.custody_handovers (organization_id);
create index if not exists expenses_org_idx                on public.expenses (organization_id);
create index if not exists financial_entries_org_branch_idx on public.financial_entries (organization_id, branch_id);
create index if not exists goods_receipt_items_org_idx     on public.goods_receipt_items (organization_id);
create index if not exists notification_logs_org_idx       on public.notification_logs (organization_id);
create index if not exists purchase_order_items_org_idx    on public.purchase_order_items (organization_id);
create index if not exists purchase_request_items_org_idx  on public.purchase_request_items (organization_id);
create index if not exists stock_movements_org_idx         on public.stock_movements (organization_id);
create index if not exists supplier_payments_org_idx       on public.supplier_payments (organization_id);
create index if not exists treasury_movements_org_idx      on public.treasury_movements (organization_id);

-- (ب) مفاتيح الأب في جداول البنود والمراجع المتكررة
create index if not exists goods_receipts_purchase_order_idx on public.goods_receipts (purchase_order_id);
create index if not exists goods_receipts_supplier_idx       on public.goods_receipts (supplier_id);
create index if not exists goods_receipts_warehouse_idx      on public.goods_receipts (warehouse_id);
create index if not exists purchase_orders_request_idx       on public.purchase_orders (purchase_request_id);
create index if not exists goods_receipt_items_item_idx      on public.goods_receipt_items (item_id);
create index if not exists purchase_order_items_item_idx     on public.purchase_order_items (item_id);
create index if not exists purchase_request_items_item_idx   on public.purchase_request_items (item_id);
create index if not exists stock_movements_item_idx          on public.stock_movements (item_id);
create index if not exists stock_levels_item_idx             on public.stock_levels (item_id);
create index if not exists appointments_service_idx          on public.appointments (service_id);

-- (ج) روابط مالية يُستعلَم عنها من الطرفين
create index if not exists expenses_transaction_idx          on public.expenses (transaction_id);
create index if not exists expenses_treasury_idx             on public.expenses (treasury_id);
create index if not exists supplier_payments_transaction_idx on public.supplier_payments (transaction_id);
create index if not exists supplier_payments_treasury_idx    on public.supplier_payments (treasury_id);
create index if not exists supplier_payments_order_idx       on public.supplier_payments (purchase_order_id);
create index if not exists treasury_movements_transaction_idx on public.treasury_movements (transaction_id);
create index if not exists custody_handovers_treasury_idx    on public.custody_handovers (treasury_id);
create index if not exists custody_handovers_shift_idx       on public.custody_handovers (shift_id);
create index if not exists shifts_treasury_idx               on public.shifts (treasury_id);

-- روابط المستخدمين: مطلوبة عند تعطيل/حذف مستخدم وفي تقارير المسؤولية
create index if not exists custody_handovers_from_user_idx on public.custody_handovers (from_user_id);
create index if not exists custody_handovers_to_user_idx   on public.custody_handovers (to_user_id);
create index if not exists purchase_requests_requested_by_idx on public.purchase_requests (requested_by);
create index if not exists goods_receipts_received_by_idx   on public.goods_receipts (received_by);
create index if not exists shifts_closed_by_idx             on public.shifts (closed_by);
create index if not exists profiles_department_idx          on public.profiles (department_id);
create index if not exists roles_organization_idx           on public.roles (organization_id);
create index if not exists notifications_customer_idx       on public.notifications (recipient_customer_id);

-- =============================================================================
--  [LOW-01] فهرس مكرر
--
--  treasury_movements_shift_idx و custody_handovers_shift_idx يغطيان shift_id.
--  فهرس (branch_id, occurred_at) على treasury_movements يغطي branch_id أيضًا،
--  لذا لا نضيف فهرسًا مستقلًا له. تُوثَّق هنا لتجنّب إضافتها لاحقًا بالخطأ.
-- =============================================================================
