-- =============================================================================
--  Migration : 20260817001000_identity_rbac
--  Phase     : 2 — الهوية والصلاحيات وعزل الفروع
--  Purpose   : التنظيم، المستخدمون، RBAC، ودوال الأمان التي تُبنى عليها كل السياسات.
--  Reference : docs/DATABASE.md §2.1 · docs/SECURITY.md §3
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) الجداول التنظيمية
-- -----------------------------------------------------------------------------

create table if not exists public.organizations (
  id              uuid primary key default gen_random_uuid(),
  code            text        not null,
  name_ar         text        not null,
  name_en         text,
  status          text        not null default 'active'
                    check (status in ('active', 'inactive')),
  -- وعاء إعدادات قابل للتوسع بلا ترحيل لكل خيار جديد
  settings        jsonb       not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  updated_by      uuid,
  deleted_at      timestamptz,
  constraint organizations_code_key unique (code)
);

comment on table public.organizations is
  'المنشأة. Q-01 معلّق: هل الشركة كيان قانوني واحد أم عدة كيانات؟ التصميم يدعم الحالتين.';

create table if not exists public.branches (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations(id) on delete restrict,
  code            text        not null,
  name_ar         text        not null,
  name_en         text,
  phone           text,
  address         text,
  city            text,
  timezone        text        not null default 'Asia/Riyadh',
  status          text        not null default 'active'
                    check (status in ('active', 'inactive')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  updated_by      uuid,
  deleted_at      timestamptz,
  constraint branches_org_code_key unique (organization_id, code)
);

create index if not exists branches_organization_id_idx on public.branches (organization_id);

create table if not exists public.departments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations(id) on delete restrict,
  -- null = قسم على مستوى المنشأة (إدارة مركزية)
  branch_id       uuid        references public.branches(id) on delete restrict,
  parent_id       uuid        references public.departments(id) on delete restrict,
  code            text        not null,
  name_ar         text        not null,
  status          text        not null default 'active'
                    check (status in ('active', 'inactive')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  updated_by      uuid,
  deleted_at      timestamptz,
  constraint departments_org_code_key unique (organization_id, code)
);

create index if not exists departments_organization_id_idx on public.departments (organization_id);
create index if not exists departments_branch_id_idx on public.departments (branch_id);

comment on column public.departments.branch_id is
  'null = قسم مركزي على مستوى المنشأة. Q-03 معلّق: هل الأقسام مركزية أم لكل فرع؟';

-- -----------------------------------------------------------------------------
-- 2) المستخدمون
--    profiles.id = auth.users.id  (علاقة 1:1)
--    ⚠️ لا يوجد أي عمود كلمة مرور هنا ولن يوجد — إدارتها في Supabase Auth حصرًا.
-- -----------------------------------------------------------------------------

create table if not exists public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  organization_id   uuid        not null references public.organizations(id) on delete restrict,
  full_name_ar      text        not null,
  full_name_en      text,
  employee_code     text,
  phone             text,
  job_title         text,
  department_id     uuid        references public.departments(id) on delete set null,
  default_branch_id uuid        references public.branches(id) on delete set null,
  status            text        not null default 'active'
                      check (status in ('active', 'inactive', 'suspended')),
  -- علامة الطبيب/مقدّم الخدمة. قائمة مقدّمي الخدمة = profiles بهذه العلامة،
  -- بدل جدول doctors منفصل يُكرّر بيانات المستخدم ويفتح باب تعارض الهوية.
  is_service_provider boolean   not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid,
  updated_by        uuid,
  deleted_at        timestamptz,
  constraint profiles_org_employee_code_key unique (organization_id, employee_code)
);

create index if not exists profiles_organization_id_idx on public.profiles (organization_id);
create index if not exists profiles_default_branch_id_idx on public.profiles (default_branch_id);
create index if not exists profiles_service_provider_idx
  on public.profiles (organization_id) where is_service_provider;

comment on table public.profiles is
  'بيانات المستخدم التنظيمية. مرتبط 1:1 بـ auth.users. لا يحتوي أي بيانات اعتماد.';
comment on column public.profiles.is_service_provider is
  'الأطباء/مقدّمو الخدمة هم مستخدمون بهذه العلامة — لا جدول doctors منفصل.';

-- -----------------------------------------------------------------------------
-- 3) RBAC
-- -----------------------------------------------------------------------------

create table if not exists public.permissions (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,          -- صيغة: module.action
  module      text not null,
  action      text not null,
  name_ar     text not null,
  is_sensitive boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint permissions_key_format check (key ~ '^[a-z]+\.[a-z.]+$')
);

comment on table public.permissions is
  'مرجع عام للنظام كله. يُولَّد من packages/core/src/permissions/catalog.ts — لا يُحرَّر يدويًا.';

create table if not exists public.roles (
  id              uuid primary key default gen_random_uuid(),
  -- null = دور نظامي عام متاح لكل المنشآت
  organization_id uuid        references public.organizations(id) on delete cascade,
  key             text        not null,
  name_ar         text        not null,
  description     text,
  is_system       boolean     not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  updated_by      uuid
);

-- مفتاح فريد يتعامل مع organization_id = null بشكل صحيح
create unique index if not exists roles_org_key_uidx
  on public.roles (coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), key);

comment on table public.roles is
  'الأدوار. القائمة الحالية بذرة أولية وليست قرارًا نهائيًا — راجع P-16.';

create table if not exists public.role_permissions (
  role_id       uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (role_id, permission_id)
);

create index if not exists role_permissions_permission_id_idx
  on public.role_permissions (permission_id);

create table if not exists public.user_roles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role_id    uuid not null references public.roles(id) on delete restrict,
  -- نطاق الدور: كل المنشأة، أو الفروع المحددة في user_branches
  scope      text not null default 'branch' check (scope in ('organization', 'branch')),
  created_at timestamptz not null default now(),
  created_by uuid,
  constraint user_roles_unique unique (user_id, role_id, scope)
);

create index if not exists user_roles_user_id_idx on public.user_roles (user_id);
create index if not exists user_roles_role_id_idx on public.user_roles (role_id);

comment on column public.user_roles.scope is
  'organization = يرى كل فروع المنشأة. branch = يرى فروع user_branches فقط. '
  'Q-05 معلّق: هل يوجد مشرف منطقة يرى مجموعة فروع؟ عندها تُضاف طبقة branch_groups.';

create table if not exists public.user_branches (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  branch_id  uuid not null references public.branches(id) on delete cascade,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid,
  primary key (user_id, branch_id)
);

create index if not exists user_branches_branch_id_idx on public.user_branches (branch_id);

comment on table public.user_branches is
  'الفروع التي يصلها المستخدم. مُستعلَم في كل سياسة RLS ⇒ الفهرس على user_id (PK) حرج للأداء.';

-- =============================================================================
--  4) دوال الأمان — أساس كل سياسات RLS
--
--  ⚠️ ملاحظة معمارية حرجة:
--     هذه الدوال SECURITY DEFINER وتُنفَّذ بصلاحيات مالكها (postgres).
--     السبب ليس التساهل، بل **منع التكرار اللانهائي**: سياسة على user_roles
--     تستدعي has_permission التي تقرأ user_roles — لو خضعت القراءة لـ RLS
--     لدخلنا في recursion. تنفيذها كمالك يكسر الحلقة.
--
--  ⚠️ SET search_path = '' إلزامي على كل SECURITY DEFINER:
--     بدونه يستطيع مستخدم بصلاحية إنشاء مخطط أن يزرع دالة تُنتحل، فتُنفَّذ
--     بصلاحيات المالك ⇒ تصعيد صلاحيات كامل.
-- =============================================================================

create or replace function app.current_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid();
$$;

create or replace function app.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.organization_id
  from public.profiles p
  where p.id = auth.uid()
    and p.status = 'active'
    and p.deleted_at is null;
$$;

create or replace function app.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and p.deleted_at is null
  );
$$;

create or replace function app.has_permission(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    join public.permissions perm     on perm.id   = rp.permission_id
    join public.profiles pr          on pr.id     = ur.user_id
    where ur.user_id = auth.uid()
      and perm.key = p_key
      and pr.status = 'active'
      and pr.deleted_at is null
  );
$$;

-- هل للمستخدم دور بنطاق المنشأة كلها؟
create or replace function app.has_org_scope()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.profiles pr on pr.id = ur.user_id
    where ur.user_id = auth.uid()
      and ur.scope = 'organization'
      and pr.status = 'active'
      and pr.deleted_at is null
  );
$$;

/*
  وصول المستخدم لفرع محدد.

  p_branch = null يعني سجلًا على مستوى المنشأة ⇒ يتطلب نطاق منشأة.
  هذا متعمّد: بدونه يستطيع موظف فرع رؤية السجلات المركزية.
*/
create or replace function app.can_access_branch(p_branch uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not app.is_active_user() then false
    when app.has_org_scope()      then true
    when p_branch is null         then false
    else exists (
      select 1 from public.user_branches ub
      where ub.user_id = auth.uid()
        and ub.branch_id = p_branch
    )
  end;
$$;

-- ⚠️ الدوال تُمنح EXECUTE لـ PUBLIC افتراضيًا في PostgreSQL.
--    السحب من anon/authenticated وحدهما لا يكفي — يجب السحب من PUBLIC أولًا.
revoke all on function app.current_user_id()       from public;
revoke all on function app.current_org_id()        from public;
revoke all on function app.is_active_user()        from public;
revoke all on function app.has_permission(text)    from public;
revoke all on function app.has_org_scope()         from public;
revoke all on function app.can_access_branch(uuid) from public;

grant execute on function app.current_user_id()       to authenticated;
grant execute on function app.current_org_id()        to authenticated;
grant execute on function app.is_active_user()        to authenticated;
grant execute on function app.has_permission(text)    to authenticated;
grant execute on function app.has_org_scope()         to authenticated;
grant execute on function app.can_access_branch(uuid) to authenticated;

-- =============================================================================
--  5) مولّد السياسات القياسية
--
--  لماذا مولّد بدل كتابة ~150 سياسة يدويًا؟
--    • المراجعة الأمنية تصبح مراجعة قالب واحد + جدول وسائط، بدل 150 نصًا.
--    • يستحيل نسيان WITH CHECK على UPDATE (أخطر ثغرة في هذا النموذج:
--      بدونها ينقل المستخدم صفًا من فرعه إلى فرع آخر أو لمنشأة أخرى).
--    • أي تعديل على النموذج يسري على كل الجداول دفعة واحدة.
-- =============================================================================

create or replace function app.apply_rls(
  p_table      text,
  p_view       text,                     -- صلاحية القراءة
  p_create     text default null,        -- null ⇒ لا سياسة إدراج (ممنوع)
  p_update     text default null,        -- null ⇒ لا سياسة تعديل (ممنوع)
  p_delete     text default null,        -- null ⇒ لا سياسة حذف (ممنوع)
  p_branch     boolean default true,     -- هل الجدول يحمل عمود branch_id؟
  p_ledger     boolean default false     -- جدول دفتري: يمنع UPDATE/DELETE مطلقًا
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope  text;
begin
  -- شرط النطاق المشترك: نفس المنشأة + وصول للفرع
  v_scope := '(select app.is_active_user()) and organization_id = (select app.current_org_id())';
  if p_branch then
    v_scope := v_scope || ' and (select app.can_access_branch(branch_id))';
  end if;

  execute format('alter table public.%I enable row level security', p_table);

  -- SELECT
  execute format('drop policy if exists %I on public.%I', p_table || '_select', p_table);
  execute format(
    'create policy %I on public.%I for select to authenticated using (%s and (select app.has_permission(%L)))',
    p_table || '_select', p_table, v_scope, p_view);

  -- INSERT
  execute format('drop policy if exists %I on public.%I', p_table || '_insert', p_table);
  if p_create is not null then
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (%s and (select app.has_permission(%L)))',
      p_table || '_insert', p_table, v_scope, p_create);
  end if;

  -- UPDATE — الصف الحالي والصف الناتج كلاهما يجب أن يقع داخل نطاق المستخدم.
  -- هذا ما يمنع نقل السجل إلى فرع/منشأة أخرى.
  execute format('drop policy if exists %I on public.%I', p_table || '_update', p_table);
  if p_update is not null and not p_ledger then
    execute format(
      'create policy %I on public.%I for update to authenticated using (%s and (select app.has_permission(%L))) with check (%s and (select app.has_permission(%L)))',
      p_table || '_update', p_table, v_scope, p_update, v_scope, p_update);
  end if;

  -- DELETE
  execute format('drop policy if exists %I on public.%I', p_table || '_delete', p_table);
  if p_delete is not null and not p_ledger then
    execute format(
      'create policy %I on public.%I for delete to authenticated using (%s and (select app.has_permission(%L)))',
      p_table || '_delete', p_table, v_scope, p_delete);
  end if;

  -- صلاحيات الجدول: الأوامر غير المسموح بها لا تُمنح أصلًا (دفاع ثانٍ قبل RLS)
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

comment on function app.apply_rls(text, text, text, text, text, boolean, boolean) is
  'يولّد سياسات RLS القياسية لجدول تشغيلي. القالب الأمني الوحيد في النظام — راجعه بعناية.';

-- محفّزات مشتركة: updated_at + created_by/updated_by من الجلسة (لا من العميل)
create or replace function app.set_audit_fields()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT') then
    new.created_at := now();
    new.updated_at := now();
    new.created_by := auth.uid();
    new.updated_by := auth.uid();
  elsif (tg_op = 'UPDATE') then
    new.updated_at := now();
    new.updated_by := auth.uid();
    -- ممنوع تزوير أثر الإنشاء
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;

comment on function app.set_audit_fields() is
  'يضبط حقول التتبع من الجلسة. يمنع العميل من التحكم في created_by/updated_by.';

create or replace function app.apply_audit_triggers(p_table text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  execute format('drop trigger if exists %I on public.%I', p_table || '_audit_fields', p_table);
  execute format(
    'create trigger %I before insert or update on public.%I for each row execute function app.set_audit_fields()',
    p_table || '_audit_fields', p_table);
end;
$$;

-- =============================================================================
--  6) سياسات الجداول التنظيمية و RBAC
--     مكتوبة يدويًا لأن نطاقها ليس (organization_id + branch_id) القياسي.
-- =============================================================================

-- ---- organizations : المستخدم يرى منشأته فقط -------------------------------
alter table public.organizations enable row level security;

drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations
  for select to authenticated
  using (
    (select app.is_active_user())
    and id = (select app.current_org_id())
    and (select app.has_permission('organizations.organization.view'))
  );

drop policy if exists organizations_update on public.organizations;
create policy organizations_update on public.organizations
  for update to authenticated
  using (
    (select app.is_active_user())
    and id = (select app.current_org_id())
    and (select app.has_permission('organizations.organization.update'))
  )
  with check (
    -- لا يمكن تحويل الصف إلى منشأة أخرى
    id = (select app.current_org_id())
    and (select app.has_permission('organizations.organization.update'))
  );

grant select, update on public.organizations to authenticated;
-- لا INSERT ولا DELETE للمنشآت من التطبيق: عملية إدارية موثّقة فقط.

select app.apply_audit_triggers('organizations');

-- ---- branches / departments : قياسية بنطاق فرع ------------------------------
-- الفرع نفسه: branch_id هو id، لذلك نتعامل معه كجدول بلا branch_id
-- ونضيف شرط الوصول للفرع يدويًا.
alter table public.branches enable row level security;

drop policy if exists branches_select on public.branches;
create policy branches_select on public.branches
  for select to authenticated
  using (
    (select app.is_active_user())
    and organization_id = (select app.current_org_id())
    and (select app.can_access_branch(id))
    and (select app.has_permission('organizations.branches.view'))
  );

drop policy if exists branches_insert on public.branches;
create policy branches_insert on public.branches
  for insert to authenticated
  with check (
    (select app.is_active_user())
    and organization_id = (select app.current_org_id())
    and (select app.has_org_scope())              -- إنشاء فرع = عملية على مستوى المنشأة
    and (select app.has_permission('organizations.branches.create'))
  );

drop policy if exists branches_update on public.branches;
create policy branches_update on public.branches
  for update to authenticated
  using (
    (select app.is_active_user())
    and organization_id = (select app.current_org_id())
    and (select app.can_access_branch(id))
    and (select app.has_permission('organizations.branches.update'))
  )
  with check (
    organization_id = (select app.current_org_id())
    and (select app.can_access_branch(id))
    and (select app.has_permission('organizations.branches.update'))
  );

grant select, insert, update on public.branches to authenticated;
select app.apply_audit_triggers('branches');

select app.apply_rls(
  'departments',
  'organizations.departments.view',
  'organizations.departments.manage',
  'organizations.departments.manage',
  null,
  true
);
select app.apply_audit_triggers('departments');

-- ---- profiles ---------------------------------------------------------------
-- قاعدة إضافية: المستخدم يقرأ ملفه الشخصي دائمًا حتى بلا صلاحية identity.users.view،
-- وإلا تعذّر بناء سياق الجلسة أصلًا.
alter table public.profiles enable row level security;

drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    (select app.is_active_user())
    and organization_id = (select app.current_org_id())
    and (select app.has_permission('identity.users.view'))
    and (
      (select app.has_org_scope())
      or default_branch_id is null
      or (select app.can_access_branch(default_branch_id))
    )
  );

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and organization_id = (select app.current_org_id())
    -- ⚠️ الحقول الحساسة (status, organization_id) محميّة إضافيًا بمحفّز أدناه
  );

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (
    (select app.is_active_user())
    and organization_id = (select app.current_org_id())
    and (select app.has_permission('identity.users.update'))
  )
  with check (
    organization_id = (select app.current_org_id())
    and (select app.has_permission('identity.users.update'))
  );

grant select, update on public.profiles to authenticated;
-- لا INSERT: إنشاء المستخدم يمر عبر Supabase Auth Admin API من الخادم فقط.

/*
  حارس إضافي على profiles:
  RLS يضمن النطاق، لكنه لا يمنع المستخدم من ترقية نفسه بتعديل status
  أو نقل نفسه لمنشأة أخرى ضمن سياسة "تعديل ملفي الشخصي".
  هذا المحفّز يمنع تغيير الحقول الحساسة إلا لمن يملك identity.users.update.
*/
create or replace function app.guard_profile_sensitive_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'نقل المستخدم بين المنشآت غير مسموح من التطبيق'
      using errcode = 'insufficient_privilege';
  end if;

  if (new.status is distinct from old.status
      or new.is_service_provider is distinct from old.is_service_provider)
     and not app.has_permission('identity.users.update') then
    raise exception 'تعديل حالة المستخدم يتطلب صلاحية identity.users.update'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_sensitive on public.profiles;
create trigger profiles_guard_sensitive
  before update on public.profiles
  for each row execute function app.guard_profile_sensitive_fields();

select app.apply_audit_triggers('profiles');

-- ---- permissions : مرجع عام للقراءة فقط -------------------------------------
alter table public.permissions enable row level security;

drop policy if exists permissions_select on public.permissions;
create policy permissions_select on public.permissions
  for select to authenticated
  using ((select app.is_active_user()));

grant select on public.permissions to authenticated;
-- لا كتابة إطلاقًا: الكتالوج يُدار من الكود عبر seed.

-- ---- roles ------------------------------------------------------------------
alter table public.roles enable row level security;

drop policy if exists roles_select on public.roles;
create policy roles_select on public.roles
  for select to authenticated
  using (
    (select app.is_active_user())
    and (organization_id is null or organization_id = (select app.current_org_id()))
    and (select app.has_permission('identity.roles.view'))
  );

drop policy if exists roles_insert on public.roles;
create policy roles_insert on public.roles
  for insert to authenticated
  with check (
    (select app.is_active_user())
    and organization_id = (select app.current_org_id())   -- لا يُنشأ دور نظامي من التطبيق
    and is_system = false
    and (select app.has_permission('identity.roles.manage'))
  );

drop policy if exists roles_update on public.roles;
create policy roles_update on public.roles
  for update to authenticated
  using (
    (select app.is_active_user())
    and organization_id = (select app.current_org_id())
    and is_system = false                                  -- الأدوار النظامية غير قابلة للتعديل
    and (select app.has_permission('identity.roles.manage'))
  )
  with check (
    organization_id = (select app.current_org_id())
    and is_system = false
    and (select app.has_permission('identity.roles.manage'))
  );

drop policy if exists roles_delete on public.roles;
create policy roles_delete on public.roles
  for delete to authenticated
  using (
    (select app.is_active_user())
    and organization_id = (select app.current_org_id())
    and is_system = false
    and (select app.has_permission('identity.roles.manage'))
  );

grant select, insert, update, delete on public.roles to authenticated;
select app.apply_audit_triggers('roles');

-- ---- role_permissions : النطاق يُشتق من الدور الأب --------------------------
alter table public.role_permissions enable row level security;

drop policy if exists role_permissions_select on public.role_permissions;
create policy role_permissions_select on public.role_permissions
  for select to authenticated
  using (
    (select app.is_active_user())
    and (select app.has_permission('identity.roles.view'))
    and exists (
      select 1 from public.roles r
      where r.id = role_permissions.role_id
        and (r.organization_id is null or r.organization_id = (select app.current_org_id()))
    )
  );

drop policy if exists role_permissions_insert on public.role_permissions;
create policy role_permissions_insert on public.role_permissions
  for insert to authenticated
  with check (
    (select app.is_active_user())
    and (select app.has_permission('identity.roles.manage'))
    and exists (
      select 1 from public.roles r
      where r.id = role_permissions.role_id
        and r.organization_id = (select app.current_org_id())
        and r.is_system = false
    )
  );

drop policy if exists role_permissions_delete on public.role_permissions;
create policy role_permissions_delete on public.role_permissions
  for delete to authenticated
  using (
    (select app.is_active_user())
    and (select app.has_permission('identity.roles.manage'))
    and exists (
      select 1 from public.roles r
      where r.id = role_permissions.role_id
        and r.organization_id = (select app.current_org_id())
        and r.is_system = false
    )
  );

grant select, insert, delete on public.role_permissions to authenticated;

-- ---- user_roles -------------------------------------------------------------
alter table public.user_roles enable row level security;

drop policy if exists user_roles_select_self on public.user_roles;
create policy user_roles_select_self on public.user_roles
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists user_roles_select on public.user_roles;
create policy user_roles_select on public.user_roles
  for select to authenticated
  using (
    (select app.is_active_user())
    and (select app.has_permission('identity.users.view'))
    and exists (
      select 1 from public.profiles p
      where p.id = user_roles.user_id
        and p.organization_id = (select app.current_org_id())
    )
  );

drop policy if exists user_roles_insert on public.user_roles;
create policy user_roles_insert on public.user_roles
  for insert to authenticated
  with check (
    (select app.is_active_user())
    and (select app.has_permission('identity.roles.manage'))
    -- منع تصعيد الصلاحيات الذاتي: لا تُسند دورًا لنفسك
    and user_id <> (select auth.uid())
    and exists (
      select 1 from public.profiles p
      where p.id = user_roles.user_id
        and p.organization_id = (select app.current_org_id())
    )
    -- منح نطاق المنشأة يتطلب أن يكون المانح نفسه بنطاق منشأة
    and (scope = 'branch' or (select app.has_org_scope()))
  );

drop policy if exists user_roles_delete on public.user_roles;
create policy user_roles_delete on public.user_roles
  for delete to authenticated
  using (
    (select app.is_active_user())
    and (select app.has_permission('identity.roles.manage'))
    and user_id <> (select auth.uid())
    and exists (
      select 1 from public.profiles p
      where p.id = user_roles.user_id
        and p.organization_id = (select app.current_org_id())
    )
  );

grant select, insert, delete on public.user_roles to authenticated;

-- ---- user_branches ----------------------------------------------------------
alter table public.user_branches enable row level security;

drop policy if exists user_branches_select_self on public.user_branches;
create policy user_branches_select_self on public.user_branches
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists user_branches_select on public.user_branches;
create policy user_branches_select on public.user_branches
  for select to authenticated
  using (
    (select app.is_active_user())
    and (select app.has_permission('identity.users.view'))
    and exists (
      select 1 from public.profiles p
      where p.id = user_branches.user_id
        and p.organization_id = (select app.current_org_id())
    )
  );

drop policy if exists user_branches_insert on public.user_branches;
create policy user_branches_insert on public.user_branches
  for insert to authenticated
  with check (
    (select app.is_active_user())
    and (select app.has_permission('identity.branches.assign'))
    -- لا يمنح المستخدم لنفسه وصولًا لفرع جديد
    and user_id <> (select auth.uid())
    -- ولا يمنح وصولًا لفرع خارج نطاقه هو
    and (select app.can_access_branch(branch_id))
    and exists (
      select 1 from public.profiles p
      where p.id = user_branches.user_id
        and p.organization_id = (select app.current_org_id())
    )
  );

drop policy if exists user_branches_delete on public.user_branches;
create policy user_branches_delete on public.user_branches
  for delete to authenticated
  using (
    (select app.is_active_user())
    and (select app.has_permission('identity.branches.assign'))
    and user_id <> (select auth.uid())
    and (select app.can_access_branch(branch_id))
    and exists (
      select 1 from public.profiles p
      where p.id = user_branches.user_id
        and p.organization_id = (select app.current_org_id())
    )
  );

grant select, insert, delete on public.user_branches to authenticated;
