-- =============================================================================
--  Migration : 20260817110000_public_publishing
--  Phase     : 2 — نظام النشر العام (is_public) ووصول دور anon
--  Reference : خطة التحويل §F/M1 · قرارات العميل 5 و6 و8
--
--  الغرض: تمكين الموقع العام من قراءة المحتوى **المنشور صراحةً** فقط،
--         بلا استخدام SUPABASE_SECRET_KEY وبلا تجاوز RLS.
--
--  ═══ نموذج الأمان: طبقتان مستقلتان ═══
--
--    الطبقة 1 — الصفوف : سياسة RLS لدور anon تُقيّد الصفوف بـ is_public = true
--                         **وبأن المنشأة نفسها منشورة ونشطة**.
--    الطبقة 2 — الأعمدة: GRANT SELECT على أعمدة محددة فقط. حتى لو أخطأت
--                         سياسة يومًا، لا يستطيع anon قراءة عمود لم يُمنح.
--
--    الافتراضي `false` على كل الأعمدة الجديدة ⇒ **تطبيق هذا الترحيل لا يكشف
--    ولا صفًا واحدًا**. النشر قرار صريح لكل صف من لوحة الإدارة.
--
--  ═══ ما لا يُمنح لـ anon (متعمّد) ═══
--    • هواتف وبُرد مقدّمي الخدمة · profile_id · notes
--    • أي عمود تدقيق (created_by / updated_by / deleted_at)
--    • organizations.settings (قد تحمل إعدادات داخلية)
--    • أي جدول عملاء أو حجوزات أو مالي أو مخزني — صفر منحة
--
--  ⚠️ لا أسعار: جدول services لا يحتوي أعمدة سعر أصلًا (P-14 معلّقة).
--  ⚠️ لا منطق مالي ولا محاسبي في هذا الترحيل.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) أعمدة النشر — الافتراضي false (لا يُكشف شيء بالتطبيق)
-- -----------------------------------------------------------------------------
alter table public.organizations    add column if not exists is_public boolean not null default false;
alter table public.branches         add column if not exists is_public boolean not null default false;
alter table public.services         add column if not exists is_public boolean not null default false;
alter table public.service_providers add column if not exists is_public boolean not null default false;

comment on column public.organizations.is_public is
  'بوابة رئيسية: إن كانت false فلا يظهر أي محتوى تابع لهذه المنشأة على الموقع العام، '
  'مهما كانت قيمة is_public على الفروع أو الخدمات.';
comment on column public.branches.is_public is 'منشور على الموقع العام — يتطلب نشر المنشأة أيضًا.';
comment on column public.services.is_public is 'منشور على الموقع العام — يتطلب نشر المنشأة أيضًا.';
comment on column public.service_providers.is_public is 'منشور على الموقع العام — يتطلب نشر المنشأة أيضًا.';

-- فهارس جزئية: استعلامات الموقع العام تقرأ المنشور فقط، وهو غالبًا حصّة صغيرة
create index if not exists branches_public_idx
  on public.branches (organization_id) where is_public and deleted_at is null;
create index if not exists services_public_idx
  on public.services (organization_id) where is_public and deleted_at is null;
create index if not exists service_providers_public_idx
  on public.service_providers (organization_id) where is_public and deleted_at is null;

-- -----------------------------------------------------------------------------
-- 2) دالة مساعدة: هل المنشأة منشورة؟
--    SECURITY DEFINER لأن anon لا يملك قراءة organizations إلا للمنشورة،
--    والاستدعاء داخل سياسة على جدول آخر يحتاج قراءة مضمونة.
-- -----------------------------------------------------------------------------
create or replace function app.is_org_published(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organizations o
    where o.id = p_org
      and o.is_public
      and o.status = 'active'
      and o.deleted_at is null
  );
$$;

revoke all on function app.is_org_published(uuid) from public;
grant execute on function app.is_org_published(uuid) to anon, authenticated;

comment on function app.is_org_published(uuid) is
  'بوابة النشر على مستوى المنشأة. تُستدعى في كل سياسة anon.';

-- -----------------------------------------------------------------------------
-- 3) الطبقة 1 — سياسات RLS لدور anon (قراءة فقط · الصفوف المنشورة فقط)
-- -----------------------------------------------------------------------------
grant usage on schema public to anon;

-- organizations: المنشأة المنشورة نفسها
drop policy if exists organizations_public_select on public.organizations;
create policy organizations_public_select on public.organizations
  for select to anon
  using (is_public and status = 'active' and deleted_at is null);

-- branches
drop policy if exists branches_public_select on public.branches;
create policy branches_public_select on public.branches
  for select to anon
  using (
    is_public
    and status = 'active'
    and deleted_at is null
    and (select app.is_org_published(organization_id))
  );

-- services
drop policy if exists services_public_select on public.services;
create policy services_public_select on public.services
  for select to anon
  using (
    is_public
    and status = 'active'
    and deleted_at is null
    and (select app.is_org_published(organization_id))
  );

-- service_providers
drop policy if exists service_providers_public_select on public.service_providers;
create policy service_providers_public_select on public.service_providers
  for select to anon
  using (
    is_public
    and status = 'active'
    and deleted_at is null
    and (select app.is_org_published(organization_id))
  );

/*
  جداول الربط: بلا organization_id، فنطاقها يُشتق من طرفيها.

  ⚠️ نقطة تصميم مهمة: الشروط **لا تُكرَّر** هنا. الاستعلامات الفرعية تخضع
     لسياسات anon على الجدولين الأصليين (RLS متداخل)، فالوجود في الاستعلام
     الفرعي يعني بالضرورة «منشور ونشط وغير محذوف ومنشأته منشورة».

     فائدتان:
       1. مصدر واحد لقاعدة النشر — تغييرها في مكان واحد يسري على الربط تلقائيًا.
       2. لا حاجة لمنح anon أعمدة إضافية (مثل deleted_at) لتقييم الشروط،
          فتبقى قائمة الأعمدة المكشوفة في حدّها الأدنى.
*/
drop policy if exists branch_services_public_select on public.branch_services;
create policy branch_services_public_select on public.branch_services
  for select to anon
  using (
    is_available
    and exists (select 1 from public.branches b where b.id = branch_services.branch_id)
    and exists (select 1 from public.services s where s.id = branch_services.service_id)
  );

drop policy if exists provider_branches_public_select on public.provider_branches;
create policy provider_branches_public_select on public.provider_branches
  for select to anon
  using (
    exists (select 1 from public.branches b where b.id = provider_branches.branch_id)
    and exists (select 1 from public.service_providers sp where sp.id = provider_branches.provider_id)
  );

-- -----------------------------------------------------------------------------
-- 4) الطبقة 2 — منح على مستوى الأعمدة
--
--    ⚠️ حاجز مستقل عن السياسات: عمود غير مذكور هنا **لا يمكن قراءته** من anon
--       حتى لو سمحت السياسة بالصف. لذلك استعلامات الموقع العام يجب أن تُحدّد
--       الأعمدة صراحةً (select('*') يفشل — وهذا مقصود).
-- -----------------------------------------------------------------------------
grant select (id, name_ar, name_en, is_public, status)
  on public.organizations to anon;

grant select (id, organization_id, code, name_ar, name_en, phone, address, city, timezone, is_public, status)
  on public.branches to anon;

grant select (id, organization_id, branch_id, code, name_ar, name_en, description, default_duration_minutes, is_public, status)
  on public.services to anon;

-- ⚠️ بلا phone ولا email ولا profile_id ولا notes
grant select (id, organization_id, branch_id, code, full_name_ar, full_name_en, specialty, is_public, status)
  on public.service_providers to anon;

grant select (branch_id, service_id, is_available) on public.branch_services to anon;
grant select (provider_id, branch_id, is_primary)  on public.provider_branches to anon;

-- -----------------------------------------------------------------------------
-- 5) تأكيد صريح: لا شيء آخر لـ anon
--    (الافتراض الأصلي في ترحيل الأساس يمنع المنح التلقائي؛ هذا توكيد مقروء)
-- -----------------------------------------------------------------------------
revoke all on public.customers          from anon;
revoke all on public.appointments        from anon;
revoke all on public.profiles            from anon;
revoke all on public.financial_transactions from anon;
revoke all on public.treasury_movements  from anon;
revoke all on public.stock_movements     from anon;
revoke all on public.audit_logs          from anon;
