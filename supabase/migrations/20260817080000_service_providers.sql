-- =============================================================================
--  Migration : 20260817080000_service_providers
--  Phase     : 3 (تمكين) — فصل مقدّم الخدمة عن حساب المستخدم
--  Reference : docs/REQUIREMENTS.md RQ-02 (قرار العميل 2026-08-17)
--
--  ⚠️ لم تُطبَّق بعد. تحتاج موافقة صريحة قبل `supabase db push`.
--
--  القرار المعتمد من العميل:
--    «الطبيب / مقدّم الخدمة كيان تشغيلي مستقل، وحساب المستخدم اختياري
--     ولا يُشترط وجوده.»
--
--  المشكلة في التصميم السابق:
--    appointments.provider_id → profiles(id) → auth.users(id)
--    أي أن كل طبيب كان **ملزَمًا** بحساب مصادقة. هذا يخالف القرار مخالفة مباشرة،
--    ويُنتج حسابات وهمية لأطباء لا يستخدمون النظام — وهي حسابات قابلة لتسجيل
--    الدخول فعليًا ⇒ سطح هجوم بلا مقابل.
--
--  الحل:
--    جدول service_providers ككيان تشغيلي، مع رابط **اختياري** إلى profiles
--    لمن يحتاج تسجيل الدخول. الاتجاه مقصود: المقدّم يشير إلى الحساب، لا العكس.
--
--  لا تحتوي هذه الترحيلة أي قاعدة عمل: لا جدولة، ولا تعارض مواعيد، ولا أسعار،
--  ولا عمولات. بنية فقط.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) مقدّمو الخدمة (الأطباء والفنيون…)
-- -----------------------------------------------------------------------------
create table if not exists public.service_providers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations(id) on delete restrict,
  -- null = مقدّم على مستوى المنشأة (يعمل في عدة فروع عبر provider_branches)
  branch_id       uuid        references public.branches(id) on delete restrict,
  code            text        not null,
  full_name_ar    text        not null,
  full_name_en    text,
  specialty       text,
  phone           text,
  email           text,
  /*
    الرابط الاختياري بحساب المستخدم.

    • null  ⇒ طبيب بلا حساب — لا يسجّل الدخول ولا يُستهلك مقعد مصادقة.
    • قيمة  ⇒ نفس الشخص يملك حسابًا ويستطيع الدخول.

    unique يمنع ربط حسابين بمقدّم واحد أو مقدّمين بحساب واحد.
    on delete set null: حذف الحساب لا يحذف الطبيب ولا يمس حجوزاته.
  */
  profile_id      uuid        unique references public.profiles(id) on delete set null,
  status          text        not null default 'active'
                    check (status in ('active', 'inactive')),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  updated_by      uuid,
  deleted_at      timestamptz,
  constraint service_providers_org_code_key unique (organization_id, code),
  -- مطلوب للمفاتيح الأجنبية المركّبة المستقبلية على مستوى الفرع
  constraint service_providers_id_branch_key unique (id, branch_id)
);

create index if not exists service_providers_org_idx on public.service_providers (organization_id);
create index if not exists service_providers_branch_idx on public.service_providers (branch_id);
create index if not exists service_providers_profile_idx on public.service_providers (profile_id);
create index if not exists service_providers_name_trgm_idx
  on public.service_providers using gin (full_name_ar extensions.gin_trgm_ops);

comment on table public.service_providers is
  'مقدّمو الخدمة (أطباء/فنيون) ككيان تشغيلي مستقل. حساب المستخدم اختياري '
  'عبر profile_id — قرار العميل RQ-02. ⚠️ لا بيانات طبية ولا أسعار ولا عمولات.';
comment on column public.service_providers.profile_id is
  'null = مقدّم خدمة بلا حساب مستخدم (لا يسجّل الدخول). قيمة = مرتبط بحساب.';
comment on column public.service_providers.branch_id is
  'null = يعمل على مستوى المنشأة؛ الفروع الفعلية تُحدَّد في provider_branches.';

-- -----------------------------------------------------------------------------
-- 2) توفّر المقدّم بالفروع — يعكس نمط branch_services القائم
--    يسمح بتمثيل «طبيب يعمل في الفرعين أ وج وليس ب» بلا افتراض أي قاعدة جدولة.
-- -----------------------------------------------------------------------------
create table if not exists public.provider_branches (
  provider_id uuid    not null references public.service_providers(id) on delete cascade,
  branch_id   uuid    not null references public.branches(id) on delete cascade,
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  primary key (provider_id, branch_id)
);

create index if not exists provider_branches_branch_idx on public.provider_branches (branch_id);

comment on table public.provider_branches is
  'الفروع التي يعمل بها مقدّم الخدمة. ⚠️ لا تفرض أي جدولة أو تعارض مواعيد (P-12 معلّقة).';

-- -----------------------------------------------------------------------------
-- 3) تحويل مرجع الحجز من profiles إلى service_providers
--
--    ⚠️ عملية بنيوية على جدول appointments. آمنة الآن تحديدًا لأن الجدول
--       **فارغ** على بيئة التطوير (تُحقَّق قبل الدفع). لو احتوى صفوفًا لاحقًا
--       لاستلزم ترحيل بيانات في خطوة منفصلة قبل تبديل المفتاح.
--
--    ملاحظة: لا نستخدم مفتاحًا مركّبًا (provider_id, branch_id) هنا عمدًا —
--    لأن المقدّم قد يكون على مستوى المنشأة ويخدم عدة فروع، وفرض التطابق
--    كان سيمنع ذلك.
-- -----------------------------------------------------------------------------
alter table public.appointments
  drop constraint if exists appointments_provider_id_fkey;

alter table public.appointments
  add constraint appointments_provider_id_fkey
  foreign key (provider_id) references public.service_providers(id) on delete set null;

comment on column public.appointments.provider_id is
  'مقدّم الخدمة من service_providers — لا يشترط وجود حساب مستخدم (RQ-02).';

-- -----------------------------------------------------------------------------
-- 4) إزالة مصدر الحقيقة المزدوج على profiles
--
--    بعد إنشاء service_providers.profile_id صار العمود profiles.is_service_provider
--    مصدرًا ثانيًا لنفس المعلومة — وتفرّع المصدرين هو بالضبط نوع الخطأ الذي
--    يُنتج بيانات متناقضة بصمت.
--
--    ⚠️ DROP COLUMN — لا فقدان بيانات: الجدول فارغ على بيئة التطوير.
--       إن رفضت هذا الجزء يمكن حذفه وستبقى بقية الترحيلة صالحة.
--
--    يجب إعادة تعريف الدالة الحارسة **قبل** حذف العمود لأنها تشير إليه.
-- -----------------------------------------------------------------------------
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

  if new.status is distinct from old.status
     and not app.has_permission('identity.users.update') then
    raise exception 'تعديل حالة المستخدم يتطلب صلاحية identity.users.update'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

revoke all on function app.guard_profile_sensitive_fields() from public, anon, authenticated;

drop index if exists public.profiles_service_provider_idx;
alter table public.profiles drop column if exists is_service_provider;

-- -----------------------------------------------------------------------------
-- 5) سياسات RLS
--    service_providers: بيانات مرجعية قابلة للمشاركة على مستوى المنشأة
--    ⇒ p_org_level_readable = true (نفس معالجة الخدمات والأصناف).
-- -----------------------------------------------------------------------------
select app.apply_rls(
  'service_providers',
  'services.providers.view',
  'services.providers.manage',
  'services.providers.manage',
  null,
  true,   -- يحمل branch_id
  false,  -- ليس دفترًا
  true    -- السجلات المشتركة (branch_id = null) مقروءة داخل المنشأة
);
select app.apply_audit_triggers('service_providers');

-- provider_branches: بلا organization_id — النطاق يُشتق من الفرع
alter table public.provider_branches enable row level security;

drop policy if exists provider_branches_select on public.provider_branches;
create policy provider_branches_select on public.provider_branches
  for select to authenticated
  using (
    (select app.is_active_user())
    and (select app.can_access_branch(branch_id))
    and (select app.has_permission('services.providers.view'))
  );

drop policy if exists provider_branches_insert on public.provider_branches;
create policy provider_branches_insert on public.provider_branches
  for insert to authenticated
  with check (
    (select app.is_active_user())
    and (select app.can_access_branch(branch_id))
    and (select app.has_permission('services.providers.manage'))
  );

drop policy if exists provider_branches_update on public.provider_branches;
create policy provider_branches_update on public.provider_branches
  for update to authenticated
  using (
    (select app.is_active_user())
    and (select app.can_access_branch(branch_id))
    and (select app.has_permission('services.providers.manage'))
  )
  with check (
    (select app.can_access_branch(branch_id))
    and (select app.has_permission('services.providers.manage'))
  );

drop policy if exists provider_branches_delete on public.provider_branches;
create policy provider_branches_delete on public.provider_branches
  for delete to authenticated
  using (
    (select app.is_active_user())
    and (select app.can_access_branch(branch_id))
    and (select app.has_permission('services.providers.manage'))
  );

grant select, insert, update, delete on public.provider_branches to authenticated;
