-- =============================================================================
--  Migration : 20260817002000_core_entities
--  Phase     : 3 — العملاء، الخدمات، الحجوزات (بنية فقط)
--  Reference : docs/DATABASE.md §2.2
--
--  ⚠️ لا Workflow هنا. حالات الحجز جدول مرجعي وليست enum لأن القائمة النهائية
--     غير معتمدة (P-11)، وتغيير enum يتطلب ترحيلًا بينما الجدول المرجعي لا.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- العملاء
-- ⚠️ لا بيانات طبية ولا حساسة — لم تُطلب، وإضافتها بلا طلب مخاطرة قانونية.
-- -----------------------------------------------------------------------------
create table if not exists public.customers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations(id) on delete restrict,
  branch_id       uuid        not null references public.branches(id) on delete restrict,
  code            text,
  full_name_ar    text        not null,
  full_name_en    text,
  phone           text        not null,
  email           text,
  gender          text        check (gender in ('male', 'female')),
  birth_date      date,
  status          text        not null default 'active'
                    check (status in ('active', 'inactive', 'blocked')),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  updated_by      uuid,
  deleted_at      timestamptz
);

-- P-15 معلّق: هل الهاتف فريد على مستوى المنشأة أم الفرع؟
-- الاختيار الحالي: فريد على مستوى المنشأة (الأوسع)، قابل للتغيير بترحيل واحد.
create unique index if not exists customers_org_phone_uidx
  on public.customers (organization_id, phone) where deleted_at is null;
create unique index if not exists customers_org_code_uidx
  on public.customers (organization_id, code) where code is not null and deleted_at is null;
create index if not exists customers_branch_id_idx on public.customers (branch_id);
create index if not exists customers_org_status_idx on public.customers (organization_id, status);
-- بحث جزئي بالاسم العربي والهاتف
create index if not exists customers_name_trgm_idx
  on public.customers using gin (full_name_ar extensions.gin_trgm_ops);
create index if not exists customers_phone_trgm_idx
  on public.customers using gin (phone extensions.gin_trgm_ops);

comment on table public.customers is
  'العملاء. ممنوع إضافة أي بيانات طبية أو حساسة لم يطلبها العميل صراحةً (C-27).';

-- -----------------------------------------------------------------------------
-- الخدمات
-- ⚠️ لا أعمدة سعر هنا. التسعير/الخصومات/الباقات/العمولات = P-14 معلّقة،
--    وستُضاف في جدول service_pricing منفصل حتى لا يتغير هذا الجدول لاحقًا.
-- -----------------------------------------------------------------------------
create table if not exists public.services (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid        not null references public.organizations(id) on delete restrict,
  branch_id        uuid        references public.branches(id) on delete restrict,
  code             text        not null,
  name_ar          text        not null,
  name_en          text,
  description      text,
  default_duration_minutes integer check (default_duration_minutes > 0),
  status           text        not null default 'active'
                     check (status in ('active', 'inactive')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  updated_by       uuid,
  deleted_at       timestamptz,
  constraint services_org_code_key unique (organization_id, code)
);

create index if not exists services_organization_id_idx on public.services (organization_id);

comment on column public.services.branch_id is
  'null = خدمة على مستوى المنشأة متاحة عبر branch_services. غير null = خدمة خاصة بفرع.';
comment on table public.services is
  'الخدمات. السعر غير مُصمَّم هنا عمدًا — P-14 معلّقة.';

create table if not exists public.branch_services (
  branch_id    uuid    not null references public.branches(id) on delete cascade,
  service_id   uuid    not null references public.services(id) on delete cascade,
  is_available boolean not null default true,
  created_at   timestamptz not null default now(),
  created_by   uuid,
  primary key (branch_id, service_id)
);

create index if not exists branch_services_service_id_idx on public.branch_services (service_id);

-- -----------------------------------------------------------------------------
-- حالات الحجز — جدول مرجعي (P-11 معلّقة)
-- -----------------------------------------------------------------------------
create table if not exists public.appointment_statuses (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations(id) on delete cascade,
  key             text        not null,
  name_ar         text        not null,
  -- تصنيف عام يسمح للتقارير بالعمل قبل اعتماد الحالات التفصيلية
  category        text        not null default 'open'
                    check (category in ('open', 'done', 'cancelled')),
  sort_order      integer     not null default 0,
  is_active       boolean     not null default true,
  created_at      timestamptz not null default now(),
  constraint appointment_statuses_org_key_key unique (organization_id, key)
);

comment on table public.appointment_statuses is
  'حالات الحجز. جدول مرجعي وليس enum لأن القائمة النهائية معلّقة (P-11). '
  'قواعد الانتقال بين الحالات غير منفّذة ولن تُخترع.';

-- -----------------------------------------------------------------------------
-- الحجوزات
-- ⚠️ لا قيد منع تعارض (P-12 معلّقة). عند اعتمادها يُضاف exclusion constraint
--    باستخدام btree_gist المُفعّل في ترحيل الأساس.
-- -----------------------------------------------------------------------------
create table if not exists public.appointments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid        not null references public.organizations(id) on delete restrict,
  branch_id        uuid        not null references public.branches(id) on delete restrict,
  reference_no     text,
  customer_id      uuid        not null references public.customers(id) on delete restrict,
  service_id       uuid        references public.services(id) on delete restrict,
  -- مقدّم الخدمة = مستخدم بعلامة is_service_provider
  provider_id      uuid        references public.profiles(id) on delete set null,
  status_id        uuid        not null references public.appointment_statuses(id) on delete restrict,
  scheduled_at     timestamptz not null,
  duration_minutes integer     not null default 30 check (duration_minutes > 0),
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  updated_by       uuid,
  deleted_at       timestamptz,
  constraint appointments_org_reference_key unique (organization_id, reference_no)
);

create index if not exists appointments_branch_scheduled_idx
  on public.appointments (branch_id, scheduled_at desc);
create index if not exists appointments_customer_idx on public.appointments (customer_id);
create index if not exists appointments_provider_idx on public.appointments (provider_id, scheduled_at);
create index if not exists appointments_status_idx on public.appointments (status_id);

comment on table public.appointments is
  'الحجوزات — بنية فقط. الإلغاء/إعادة الجدولة/التأكيد/التذكير: P-11..P-13 معلّقة.';

-- -----------------------------------------------------------------------------
-- سياسات RLS
-- -----------------------------------------------------------------------------
select app.apply_rls('customers', 'customers.view', 'customers.create', 'customers.update', 'customers.delete');
select app.apply_audit_triggers('customers');

select app.apply_rls('services', 'services.view', 'services.create', 'services.update', null, false);
select app.apply_audit_triggers('services');

select app.apply_rls(
  'appointments',
  'appointments.view',
  'appointments.create',
  'appointments.update',
  null
);
select app.apply_audit_triggers('appointments');

-- branch_services : بلا organization_id — النطاق من الفرع
alter table public.branch_services enable row level security;

drop policy if exists branch_services_select on public.branch_services;
create policy branch_services_select on public.branch_services
  for select to authenticated
  using (
    (select app.is_active_user())
    and (select app.can_access_branch(branch_id))
    and (select app.has_permission('services.view'))
  );

drop policy if exists branch_services_insert on public.branch_services;
create policy branch_services_insert on public.branch_services
  for insert to authenticated
  with check (
    (select app.is_active_user())
    and (select app.can_access_branch(branch_id))
    and (select app.has_permission('services.update'))
  );

drop policy if exists branch_services_update on public.branch_services;
create policy branch_services_update on public.branch_services
  for update to authenticated
  using (
    (select app.is_active_user())
    and (select app.can_access_branch(branch_id))
    and (select app.has_permission('services.update'))
  )
  with check (
    (select app.can_access_branch(branch_id))
    and (select app.has_permission('services.update'))
  );

drop policy if exists branch_services_delete on public.branch_services;
create policy branch_services_delete on public.branch_services
  for delete to authenticated
  using (
    (select app.is_active_user())
    and (select app.can_access_branch(branch_id))
    and (select app.has_permission('services.update'))
  );

grant select, insert, update, delete on public.branch_services to authenticated;

-- appointment_statuses : مرجع على مستوى المنشأة
alter table public.appointment_statuses enable row level security;

drop policy if exists appointment_statuses_select on public.appointment_statuses;
create policy appointment_statuses_select on public.appointment_statuses
  for select to authenticated
  using (
    (select app.is_active_user())
    and organization_id = (select app.current_org_id())
    and (select app.has_permission('appointments.view'))
  );

drop policy if exists appointment_statuses_write on public.appointment_statuses;
create policy appointment_statuses_write on public.appointment_statuses
  for all to authenticated
  using (
    (select app.is_active_user())
    and organization_id = (select app.current_org_id())
    and (select app.has_permission('settings.update'))
  )
  with check (
    organization_id = (select app.current_org_id())
    and (select app.has_permission('settings.update'))
  );

grant select, insert, update, delete on public.appointment_statuses to authenticated;
