-- =============================================================================
--  Migration : 20260817120000_publish_guards
--  Phase     : 2 — فرض صلاحية النشر على مستوى قاعدة البيانات
--
--  المشكلة التي يحلّها:
--    سياسة UPDATE على branches تشترط organizations.branches.update فقط. أي أن
--    من يملك حق التعديل يستطيع **نشر الفرع على الإنترنت** — وهو فعل مختلف
--    تمامًا في أثره ويحتاج صلاحية أعلى.
--
--    فصل الصلاحية في الكتالوج بلا فرضها في قاعدة البيانات = واجهة فقط،
--    وأي استدعاء مباشر لـ PostgREST يتجاوزها.
--
--  الحل: محفّزات تمنع تغيير is_public إلا لمن يملك صلاحية النشر المخصّصة.
--        النمط نفسه المستخدم في app.guard_profile_sensitive_fields.
--
--  ⚠️ لا يمس أي سياسة قائمة ولا يغيّر أي صلاحية موجودة — طبقة إضافية فقط.
-- =============================================================================

/*
  ⚠️ استثناء المسارات الموثوقة:
     إذا كان auth.uid() فارغًا فالعملية ليست من مستخدم عبر PostgREST، بل من
     أحد مسارين موثوقين حصرًا:
       • المفتاح السري (service_role) — تهيئة البيانات والمهام الإدارية
       • اتصال مباشر بقاعدة البيانات (ترحيلات · psql)
     كلاهما يتجاوز RLS أصلًا، ففرض الصلاحية عليهما يمنع تهيئة البيانات بلا
     أي مكسب أمني.

     ودور anon لا يملك UPDATE على هذه الجداول إطلاقًا، فلا يمكنه بلوغ المحفّز.
*/
create or replace function app.guard_publish_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_permission text := tg_argv[0];
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.is_public is distinct from old.is_public then
    if not app.has_permission(v_permission) then
      raise exception 'تغيير حالة النشر يتطلب صلاحية %', v_permission
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function app.guard_publish_flag() from public, anon, authenticated;

comment on function app.guard_publish_flag() is
  'محفّز يمنع تغيير is_public إلا بالصلاحية المُمرَّرة كوسيط. '
  'يجعل فصل صلاحية النشر مفروضًا في المحرّك لا في الواجهة.';

-- الإدراج أيضًا: لا يجوز إنشاء صف منشور مباشرةً بلا صلاحية نشر
create or replace function app.guard_publish_on_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_permission text := tg_argv[0];
begin
  -- نفس استثناء المسارات الموثوقة الموضّح في app.guard_publish_flag
  if auth.uid() is null then
    return new;
  end if;

  if new.is_public and not app.has_permission(v_permission) then
    raise exception 'إنشاء سجل منشور يتطلب صلاحية %', v_permission
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

revoke all on function app.guard_publish_on_insert() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
--  ربط المحفّزات
-- -----------------------------------------------------------------------------
drop trigger if exists organizations_guard_publish on public.organizations;
create trigger organizations_guard_publish
  before update on public.organizations
  for each row execute function app.guard_publish_flag('organizations.organization.publish');

drop trigger if exists branches_guard_publish on public.branches;
create trigger branches_guard_publish
  before update on public.branches
  for each row execute function app.guard_publish_flag('organizations.branches.publish');

drop trigger if exists branches_guard_publish_insert on public.branches;
create trigger branches_guard_publish_insert
  before insert on public.branches
  for each row execute function app.guard_publish_on_insert('organizations.branches.publish');

drop trigger if exists services_guard_publish on public.services;
create trigger services_guard_publish
  before update on public.services
  for each row execute function app.guard_publish_flag('services.publish');

drop trigger if exists services_guard_publish_insert on public.services;
create trigger services_guard_publish_insert
  before insert on public.services
  for each row execute function app.guard_publish_on_insert('services.publish');

drop trigger if exists service_providers_guard_publish on public.service_providers;
create trigger service_providers_guard_publish
  before update on public.service_providers
  for each row execute function app.guard_publish_flag('services.providers.publish');

drop trigger if exists service_providers_guard_publish_insert on public.service_providers;
create trigger service_providers_guard_publish_insert
  before insert on public.service_providers
  for each row execute function app.guard_publish_on_insert('services.providers.publish');
