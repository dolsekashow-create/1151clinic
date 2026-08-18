-- =============================================================================
--  Migration : 20260817200000_soft_delete
--  Phase     : 7 — الحذف الآمن للكيانات الإدارية
--  Reference : طلب العميل 2026-08-17
--
--  الثغرة المكتشَفة أثناء العمل:
--    كل الجداول تحمل `deleted_at`، وسياسات UPDATE القائمة تسمح لمن يملك
--    صلاحية **التعديل** بضبطه. أي أن من يصحّح اسم خدمة كان يستطيع «حذفها»
--    بلا صلاحية حذف. الحذف والتعديل فعلان مختلفان بأثرين مختلفين.
--
--  ما يفعله هذا الترحيل:
--    1. حارس يمنع تغيير `deleted_at` إلا بالصلاحية المخصّصة لكل كيان.
--    2. دالة أرشفة تفحص **التوابع** قبل الحذف وترفض بأرقام مفهومة.
--
--  ⚠️ الحذف **ناعم** لا صلب. السبب ليس تفضيلًا: كل المفاتيح الأجنبية معرّفة
--     `on delete restrict`، فالحذف الصلب يفشل أصلًا عند أول مرجع. والأهم أن
--     حجزًا مضى يشير إلى خدمة محذوفة يجب أن يظل قابلًا للقراءة — محو الخدمة
--     يُفسد سجلًا تاريخيًا لا يملك أحد حق إفساده.
--
--  ⚠️ ما **لا** يفعله عمدًا:
--     • لا حذف متتالٍ: حذف فرع لا يحذف عملاءه ولا حجوزاته.
--     • لا استعادة تلقائية ولا سلة محذوفات — الاستعادة تحتاج قرارك.
--     • لا يقرّر متى «يُسمح» بالحذف تجاريًا: يرفض عند وجود تابع نشط ويكتفي.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) حارس الحذف الناعم
--
--    نفس نمط `app.guard_publish_flag` في المرحلة 2: الصلاحية تُفحص في المحرّك
--    فلا تُتجاوَز بنداء مباشر على PostgREST.
--    الإعفاء عند auth.uid() is null = مسارات موثوقة (الترحيلات والبذرة).
-- -----------------------------------------------------------------------------
create or replace function app.guard_soft_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_permission text := tg_argv[0];
begin
  if auth.uid() is null then return new; end if;

  if new.deleted_at is distinct from old.deleted_at then
    if not app.has_permission(v_permission) then
      raise exception 'الحذف يتطلب صلاحية %', v_permission
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function app.guard_soft_delete() from public, anon, authenticated;

do $$
declare
  v record;
begin
  for v in
    select * from (values
      ('branches',          'organizations.branches.delete'),
      ('departments',       'organizations.departments.delete'),
      ('services',          'services.delete'),
      ('service_providers', 'services.providers.delete'),
      ('appointments',      'appointments.delete'),
      ('customers',         'customers.delete'),
      ('profiles',          'identity.users.delete')
    ) as t(table_name, permission)
  loop
    execute format('drop trigger if exists %I on public.%I',
                   v.table_name || '_guard_soft_delete', v.table_name);
    execute format(
      'create trigger %I before update of deleted_at on public.%I
       for each row execute function app.guard_soft_delete(%L)',
      v.table_name || '_guard_soft_delete', v.table_name, v.permission);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2) عدّ التوابع قبل الحذف
--
--    ⚠️ `p_entity` محصورة في CASE على قيم ثابتة — لا `execute format` بمدخل
--       المستخدم. تمرير اسم جدول من العميل إلى SQL ديناميكي حقن صريح.
--    ⚠️ يعدّ **النشط فقط**: تابع محذوف مسبقًا لا يمنع حذف أصله.
-- -----------------------------------------------------------------------------
create or replace function app.count_dependents(p_entity text, p_id uuid)
returns table (label text, total bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  case p_entity
    when 'branch' then
      return query
        select 'موظفون مُسنَدون', count(*) from public.user_branches where branch_id = p_id
        union all
        select 'عملاء', count(*) from public.customers
          where branch_id = p_id and deleted_at is null
        union all
        select 'حجوزات', count(*) from public.appointments
          where branch_id = p_id and deleted_at is null
        union all
        select 'أقسام', count(*) from public.departments
          where branch_id = p_id and deleted_at is null
        union all
        select 'مقدّمو خدمة', count(*) from public.service_providers
          where branch_id = p_id and deleted_at is null
        union all
        select 'خدمات خاصة بالفرع', count(*) from public.services
          where branch_id = p_id and deleted_at is null;

    when 'department' then
      return query
        select 'موظفون في القسم', count(*) from public.profiles
          where department_id = p_id and deleted_at is null
        union all
        select 'أقسام فرعية', count(*) from public.departments
          where parent_id = p_id and deleted_at is null;

    when 'service' then
      return query
        select 'حجوزات', count(*) from public.appointments
          where service_id = p_id and deleted_at is null;

    when 'provider' then
      return query
        select 'حجوزات', count(*) from public.appointments
          where provider_id = p_id and deleted_at is null;

    when 'customer' then
      return query
        select 'حجوزات', count(*) from public.appointments
          where customer_id = p_id and deleted_at is null;

    when 'user' then
      return query
        select 'جلسات حضور', count(*) from public.attendance_sessions where user_id = p_id
        union all
        select 'أدوار مُسنَدة', count(*) from public.user_roles where user_id = p_id;

    when 'appointment' then
      -- الحجز ورقة نهائية: لا شيء يشير إليه
      return;

    else
      raise exception 'كيان غير معروف: %', p_entity using errcode = 'invalid_parameter_value';
  end case;
end;
$$;

comment on function app.count_dependents(text, uuid) is
  'يعدّ التوابع النشطة لكيان قبل حذفه. يعدّ النشط فقط — المحذوف سابقًا لا يمنع.';

revoke all on function app.count_dependents(text, uuid) from public;
grant execute on function app.count_dependents(text, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 3) الأرشفة (الحذف الناعم)
--
--    ⚠️ ترفض عند وجود أي تابع نشط وتُبيّن العدد بالاسم. الرسالة موجّهة
--       للمستخدم: «لا يمكن الحذف — 12 حجزًا، 4 عملاء» أوضح ألف مرة من
--       «انتهاك مفتاح أجنبي».
--    ⚠️ الصلاحية يفحصها الحارس في البند 1 عند الكتابة — لا نكرّر الفحص هنا
--       حتى يبقى مصدر القرار واحدًا.
-- -----------------------------------------------------------------------------
create or replace function app.archive_record(p_entity text, p_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_blockers text;
  v_updated  integer;
begin
  select string_agg(d.label || ': ' || d.total, '، ')
    into v_blockers
  from app.count_dependents(p_entity, p_id) d
  where d.total > 0;

  if v_blockers is not null then
    raise exception 'لا يمكن الحذف — يوجد مرتبط به (%). عطّله بدل حذفه.', v_blockers
      using errcode = 'invalid_parameter_value';
  end if;

  /*
    ⚠️ SECURITY INVOKER لا DEFINER: التحديث يجب أن يمر بسياسات RLS بجلسة
       المستخدم، وإلا صار بإمكان أي مستخدم أرشفة سجل خارج نطاق فرعه.
  */
  case p_entity
    when 'branch' then
      update public.branches set deleted_at = now() where id = p_id and deleted_at is null;
    when 'department' then
      update public.departments set deleted_at = now() where id = p_id and deleted_at is null;
    when 'service' then
      update public.services set deleted_at = now() where id = p_id and deleted_at is null;
    when 'provider' then
      update public.service_providers set deleted_at = now() where id = p_id and deleted_at is null;
    when 'customer' then
      update public.customers set deleted_at = now() where id = p_id and deleted_at is null;
    when 'appointment' then
      update public.appointments set deleted_at = now() where id = p_id and deleted_at is null;
    when 'user' then
      update public.profiles set deleted_at = now() where id = p_id and deleted_at is null;
    else
      raise exception 'كيان غير معروف: %', p_entity using errcode = 'invalid_parameter_value';
  end case;

  get diagnostics v_updated = row_count;

  -- RLS تُطابق صفر صفوف بصمت عند رفض النطاق ⇒ نحوّله إلى خطأ صريح
  if v_updated = 0 then
    raise exception 'العنصر غير موجود أو خارج نطاقك أو محذوف بالفعل'
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

comment on function app.archive_record(text, uuid) is
  'حذف ناعم بعد التأكد من خلوّ الكيان من التوابع النشطة. '
  'SECURITY INVOKER عمدًا: النطاق تفرضه RLS بجلسة المستخدم.';

revoke all on function app.archive_record(text, uuid) from public;
grant execute on function app.archive_record(text, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 4) سياسة تعديل الحجوزات — كانت ناقصة للأرشفة
--
--    `apply_rls('appointments', …)` مرّرت صلاحية التعديل، وهي كافية لضبط
--    `deleted_at` بعد أن صار الحارس يشترط صلاحية الحذف المستقلة.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- 5) أغلفة PostgREST
-- -----------------------------------------------------------------------------
create or replace function public.archive_record(p_entity text, p_id uuid)
returns void
language sql security invoker set search_path = ''
as $$ select app.archive_record(p_entity, p_id); $$;

create or replace function public.count_dependents(p_entity text, p_id uuid)
returns table (label text, total bigint)
language sql security invoker set search_path = ''
as $$ select * from app.count_dependents(p_entity, p_id); $$;

revoke all on function public.archive_record(text, uuid) from public, anon;
revoke all on function public.count_dependents(text, uuid) from public, anon;
grant execute on function public.archive_record(text, uuid) to authenticated;
grant execute on function public.count_dependents(text, uuid) to authenticated;
