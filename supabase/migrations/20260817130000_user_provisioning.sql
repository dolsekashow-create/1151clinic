-- =============================================================================
--  Migration : 20260817130000_user_provisioning
--  Phase     : 3 — إدارة المستخدمين
--  Purpose   : تجهيز المستخدمين ذريًا + إغلاق مسارات تصعيد الصلاحيات.
--  Reference : docs/SECURITY.md §3 · طلب العميل بند 5 و 7
--
--  ⚠️ لا جداول جديدة ولا أعمدة جديدة ولا صلاحيات جديدة.
--     البنية القائمة تكفي؛ الناقص هو **فرض القواعد في المحرّك**.
--
--  الفجوات التي يغلقها هذا الترحيل (مكتشفة بفحص سياسات المرحلة 2):
--
--   ثغرة-1 (حرجة) تصعيد عبر إسناد دور:
--     `user_roles_insert` كانت تسمح لأي حامل `identity.roles.manage` بإسناد
--     **أي** دور مرئي لمستخدم آخر — بما فيه `company_admin` (كل الصلاحيات).
--     مدير فرع يُنشئ حسابًا صوريًا، يمنحه company_admin بنطاق فرع، ثم يدخل به
--     ⇒ يملك صلاحيات أعلى من صلاحياته هو. القاعدة الناقصة: صلاحيات الدور
--     المُسند يجب أن تكون **مجموعة فرعية** من صلاحيات المانح.
--
--   ثغرة-2 (حرجة) تصعيد عبر بناء دور مخصّص:
--     `role_permissions_insert` كانت تسمح بإضافة **أي** صلاحية من الكتالوج
--     إلى دور مخصّص. مدير فرع يُنشئ دورًا ويحشوه بصلاحيات لا يملكها
--     ⇒ نفس النتيجة بطريق أطول. القاعدة الناقصة: لا تُضاف صلاحية لا يملكها المانح.
--
--   ثغرة-3 (عالية) تعديل مستخدم خارج النطاق:
--     `profiles_update` كانت تفحص المنشأة والصلاحية فقط، بلا أي شرط فرع.
--     مدير فرع بصلاحية `identity.users.update` كان يستطيع تعديل ملف مدير
--     الشركة نفسه (بما فيه إيقافه). القاعدة الناقصة: نطاق الفرع.
--
--   ثغرة-4 (متوسطة) لا مسار ذري لإنشاء المستخدم:
--     `profiles` بلا سياسة INSERT عمدًا، فكان المسار الوحيد هو مفتاح الخدمة
--     الذي **يتجاوز RLS بالكامل** ⇒ كل الحمايات أعلاه تصبح بلا أثر في أهم
--     عملية. الحل: دالة SECURITY DEFINER تُستدعى **بجلسة المدير** فتُعيد فحص
--     كل القواعد داخل المحرّك، وتُدرج الثلاثة في معاملة واحدة.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) هل يستطيع المستخدم الحالي منح هذا الدور؟
--    القاعدة: كل صلاحية في الدور المُسند يجب أن يملكها المانح.
--    نموذج «لا تمنح ما لا تملك» — لا حاجة لتصنيف الأدوار في مستويات، فالمقارنة
--    على مجموعة الصلاحيات نفسها ولا تحتاج صيانة عند إضافة دور أو صلاحية.
-- -----------------------------------------------------------------------------
create or replace function app.can_grant_role(p_role_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_active_user()
     and not exists (
       select 1
       from public.role_permissions rp
       join public.permissions perm on perm.id = rp.permission_id
       where rp.role_id = p_role_id
         and not app.has_permission(perm.key)
     );
$$;

comment on function app.can_grant_role(uuid) is
  'صلاحيات الدور المُسند ⊆ صلاحيات المانح. يمنع منح الغير صلاحيات أعلى من المانح.';

-- -----------------------------------------------------------------------------
-- 2) هل يستطيع المستخدم الحالي إدارة هذا المستخدم؟
--    • نطاق منشأة ⇒ نعم.
--    • هدف يملك نطاق منشأة ⇒ لا، مهما كانت صلاحيات المُدير الفرعي.
--    • غير ذلك ⇒ يجب أن تكون **كل** فروع الهدف داخل فروع المُدير.
--      اشتراط «كل» لا «بعض» متعمّد: تعديل مستخدم يعمل في فرعين يمسّ الفرعين.
-- -----------------------------------------------------------------------------
create or replace function app.can_manage_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not app.is_active_user() then false
    when app.has_org_scope() then true
    when exists (
      select 1 from public.user_roles ur
      where ur.user_id = p_user_id and ur.scope = 'organization'
    ) then false
    else exists (select 1 from public.user_branches ub where ub.user_id = p_user_id)
      and not exists (
        select 1 from public.user_branches target
        where target.user_id = p_user_id
          and not exists (
            select 1 from public.user_branches mine
            where mine.user_id = auth.uid()
              and mine.branch_id = target.branch_id
          )
      )
  end;
$$;

comment on function app.can_manage_user(uuid) is
  'نطاق إدارة المستخدمين: كل فروع الهدف داخل فروع المُدير، ومن له نطاق منشأة محميّ.';

revoke all on function app.can_grant_role(uuid)  from public;
revoke all on function app.can_manage_user(uuid) from public;
grant execute on function app.can_grant_role(uuid)  to authenticated;
grant execute on function app.can_manage_user(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 3) ثغرة-1: حارس التصعيد على user_roles
--    محفّز لا سياسة فقط: السياسة تحمي مسار PostgREST المباشر، والمحفّز يحمي
--    أيضًا مسار الدوال SECURITY DEFINER في البند 6 — دفاع لا يُتجاوَز بمسار آخر.
--    الإعفاء عند auth.uid() is null = مسارات موثوقة (الـseed ومفتاح الخدمة).
-- -----------------------------------------------------------------------------
create or replace function app.guard_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then return new; end if;

  if not app.can_grant_role(new.role_id) then
    raise exception 'لا يمكنك منح دور يحتوي صلاحيات لا تملكها'
      using errcode = 'insufficient_privilege';
  end if;

  if new.scope = 'organization' and not app.has_org_scope() then
    raise exception 'منح نطاق المنشأة يتطلب أن تكون أنت بنطاق المنشأة'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

-- ⚠️ الحارس لا يُستدعى مباشرة أبدًا؛ المحفّز ينفّذه كجزء من عملية الجدول.
--    السحب الصريح إلزامي: `alter default privileges` في ترحيل التقوية لا يغطي
--    هذه الدوال فعليًا (أثبته اختبار القائمة البيضاء) — الاعتماد عليه وحده يترك
--    دوال جديدة قابلة للتنفيذ من anon.
revoke all on function app.guard_role_escalation() from public, anon, authenticated;

drop trigger if exists user_roles_guard_escalation on public.user_roles;
create trigger user_roles_guard_escalation
  before insert on public.user_roles
  for each row execute function app.guard_role_escalation();

-- السياسة تُعاد بنفس شروطها السابقة + شرط التصعيد والنطاق (رفض مبكر ومفهوم)
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
    and (scope = 'branch' or (select app.has_org_scope()))
    -- جديد: لا تمنح دورًا يحتوي صلاحيات لا تملكها
    and (select app.can_grant_role(user_roles.role_id))
    -- جديد: الهدف داخل نطاقك
    and (select app.can_manage_user(user_roles.user_id))
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
    -- جديد: لا تسحب دورًا من مستخدم خارج نطاقك
    and (select app.can_manage_user(user_roles.user_id))
  );

-- -----------------------------------------------------------------------------
-- 4) ثغرة-2: حارس التصعيد على role_permissions
-- -----------------------------------------------------------------------------
create or replace function app.guard_permission_escalation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  if auth.uid() is null then return new; end if;

  select perm.key into v_key
  from public.permissions perm
  where perm.id = new.permission_id;

  if not app.has_permission(v_key) then
    raise exception 'لا يمكنك إضافة صلاحية لا تملكها إلى دور: %', v_key
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

revoke all on function app.guard_permission_escalation() from public, anon, authenticated;

drop trigger if exists role_permissions_guard_escalation on public.role_permissions;
create trigger role_permissions_guard_escalation
  before insert on public.role_permissions
  for each row execute function app.guard_permission_escalation();

-- -----------------------------------------------------------------------------
-- 5) ثغرة-3: نطاق الفرع في تعديل الملفات
-- -----------------------------------------------------------------------------
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (
    (select app.is_active_user())
    and organization_id = (select app.current_org_id())
    and (select app.has_permission('identity.users.update'))
    and (select app.can_manage_user(id))
  )
  with check (
    organization_id = (select app.current_org_id())
    and (select app.has_permission('identity.users.update'))
    and (select app.can_manage_user(id))
  );

-- قراءة الملفات: مستخدم الفرع يرى من في فروعه ومن له نطاق منشأة (ليعرف رئيسه)
-- لكنه لا يعدّلهم — الفصل بين الرؤية والتعديل متعمّد.

-- -----------------------------------------------------------------------------
-- 6) ثغرة-4: التجهيز الذري
--
--    ⚠️ تُستدعى **بجلسة المدير** (المفتاح العام + JWT المستخدم) لا بمفتاح
--       الخدمة. السبب أن auth.uid() هو أساس كل الفحوص أدناه؛ استدعاؤها
--       بمفتاح الخدمة يُفقدها معناها الأمني بالكامل.
--
--    ⚠️ لا تُنشئ حساب المصادقة: إنشاء auth.users يمر عبر Auth Admin API
--       من الخادم. هذه الدالة تستقبل المعرّف الناتج وتبني الجانب التنظيمي.
-- -----------------------------------------------------------------------------
create or replace function app.provision_user(
  p_user_id             uuid,
  p_full_name_ar        text,
  p_role_id             uuid,
  p_scope               text,
  p_branch_ids          uuid[],
  p_phone               text default null,
  p_job_title           text default null,
  p_employee_code       text default null,
  p_default_branch_id   uuid default null,
  /*
    ربط اختياري بمقدّم خدمة قائم (طبيب).

    ⚠️ لا يوجد عمود `profiles.is_service_provider` — حُذف في الترحيل 080000
       لأنه كان مصدر حقيقة ثانيًا بجانب `service_providers.profile_id`.
       العلاقة اتجاهها واحد: المقدّم يشير إلى الحساب.

    null = مستخدم إداري عادي. قيمة = «أنشئ حساب دخول لهذا الطبيب» بقرار
    صريح من المدير — وهو ما يمنع إنشاء حسابات مصادقة لأطباء لا يستخدمون النظام.
  */
  p_provider_id         uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org      uuid := app.current_org_id();
  v_branch   uuid;
  v_default  uuid := p_default_branch_id;
  v_provider_branch uuid;
begin
  -- 6.1 المصادقة والصلاحية — لا نعتمد على فحص طبقة التطبيق وحده
  if auth.uid() is null then
    raise exception 'التجهيز يتطلب جلسة مستخدم' using errcode = 'insufficient_privilege';
  end if;
  if v_org is null then
    raise exception 'المستخدم الحالي غير نشط' using errcode = 'insufficient_privilege';
  end if;
  if not app.has_permission('identity.users.create') then
    raise exception 'إنشاء مستخدم يتطلب صلاحية identity.users.create'
      using errcode = 'insufficient_privilege';
  end if;

  -- 6.2 النطاق
  if p_scope not in ('organization', 'branch') then
    raise exception 'نطاق غير معروف: %', p_scope using errcode = 'invalid_parameter_value';
  end if;
  if p_scope = 'organization' and not app.has_org_scope() then
    raise exception 'منح نطاق المنشأة يتطلب أن تكون أنت بنطاق المنشأة'
      using errcode = 'insufficient_privilege';
  end if;

  -- 6.3 الدور: مرئي لهذه المنشأة، وصلاحياته ⊆ صلاحيات المانح
  if not exists (
    select 1 from public.roles r
    where r.id = p_role_id
      and (r.organization_id is null or r.organization_id = v_org)
  ) then
    raise exception 'الدور غير موجود في هذه المنشأة' using errcode = 'invalid_parameter_value';
  end if;
  if not app.can_grant_role(p_role_id) then
    raise exception 'لا يمكنك منح دور يحتوي صلاحيات لا تملكها'
      using errcode = 'insufficient_privilege';
  end if;

  -- 6.4 الفروع: نطاق فرع يلزمه فرع واحد على الأقل، وكل فرع داخل نطاق المانح
  if p_scope = 'branch' and coalesce(array_length(p_branch_ids, 1), 0) = 0 then
    raise exception 'مستخدم بنطاق فرع يحتاج فرعًا واحدًا على الأقل'
      using errcode = 'invalid_parameter_value';
  end if;

  foreach v_branch in array coalesce(p_branch_ids, array[]::uuid[]) loop
    if not exists (
      select 1 from public.branches b
      where b.id = v_branch and b.organization_id = v_org and b.deleted_at is null
    ) then
      raise exception 'الفرع غير موجود في هذه المنشأة' using errcode = 'invalid_parameter_value';
    end if;
    if not app.can_access_branch(v_branch) then
      raise exception 'لا تملك وصولًا للفرع المطلوب إسناده'
        using errcode = 'insufficient_privilege';
    end if;
  end loop;

  -- الفرع الافتراضي يجب أن يكون من الفروع المُسندة
  if v_default is not null and not (v_default = any (coalesce(p_branch_ids, array[]::uuid[]))) then
    raise exception 'الفرع الافتراضي يجب أن يكون من الفروع المُسندة'
      using errcode = 'invalid_parameter_value';
  end if;
  if v_default is null and coalesce(array_length(p_branch_ids, 1), 0) > 0 then
    v_default := p_branch_ids[1];
  end if;

  -- 6.5 مقدّم الخدمة المطلوب ربطه: داخل المنشأة، داخل النطاق، وغير مرتبط سابقًا
  if p_provider_id is not null then
    select sp.branch_id into v_provider_branch
    from public.service_providers sp
    where sp.id = p_provider_id
      and sp.organization_id = v_org
      and sp.deleted_at is null
      and sp.profile_id is null;

    if not found then
      raise exception 'مقدّم الخدمة غير موجود أو مرتبط بحساب بالفعل'
        using errcode = 'invalid_parameter_value';
    end if;
    if not app.has_permission('services.providers.manage') then
      raise exception 'ربط حساب بمقدّم خدمة يتطلب صلاحية services.providers.manage'
        using errcode = 'insufficient_privilege';
    end if;
    -- مقدّم على مستوى المنشأة (branch_id null) يتطلب نطاق منشأة
    if not app.can_access_branch(v_provider_branch) then
      raise exception 'مقدّم الخدمة خارج نطاقك' using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- 6.6 الإدراج الذري: أي استثناء أعلاه أو أدناه يُرجِع المعاملة كلها
  insert into public.profiles (
    id, organization_id, full_name_ar, phone, job_title, employee_code,
    default_branch_id, status
  ) values (
    p_user_id, v_org, p_full_name_ar, nullif(p_phone, ''), nullif(p_job_title, ''),
    nullif(p_employee_code, ''), v_default, 'active'
  );

  insert into public.user_roles (user_id, role_id, scope)
  values (p_user_id, p_role_id, p_scope);

  foreach v_branch in array coalesce(p_branch_ids, array[]::uuid[]) loop
    insert into public.user_branches (user_id, branch_id, is_default)
    values (p_user_id, v_branch, v_branch = v_default);
  end loop;

  if p_provider_id is not null then
    update public.service_providers
       set profile_id = p_user_id
     where id = p_provider_id;
  end if;

  return p_user_id;
end;
$$;

comment on function app.provision_user is
  'يبني الجانب التنظيمي لمستخدم جديد (profile + user_roles + user_branches) في '
  'معاملة واحدة، ويُعيد فحص كل قواعد النطاق والتصعيد داخل المحرّك. '
  '⚠️ تُستدعى بجلسة المدير لا بمفتاح الخدمة.';

-- -----------------------------------------------------------------------------
-- 7) تعديل الدور والفروع — نفس الفحوص، استبدال ذري
-- -----------------------------------------------------------------------------
create or replace function app.set_user_assignment(
  p_user_id    uuid,
  p_role_id    uuid,
  p_scope      text,
  p_branch_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org     uuid := app.current_org_id();
  v_branch  uuid;
  v_default uuid;
begin
  if auth.uid() is null then
    raise exception 'العملية تتطلب جلسة مستخدم' using errcode = 'insufficient_privilege';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'لا يمكنك تغيير دورك أو فروعك بنفسك'
      using errcode = 'insufficient_privilege';
  end if;
  if not app.has_permission('identity.roles.manage') then
    raise exception 'تغيير الدور يتطلب صلاحية identity.roles.manage'
      using errcode = 'insufficient_privilege';
  end if;
  if not app.has_permission('identity.branches.assign') then
    raise exception 'تغيير الفروع يتطلب صلاحية identity.branches.assign'
      using errcode = 'insufficient_privilege';
  end if;

  -- الهدف داخل المنشأة وداخل نطاق المُدير **قبل** التغيير
  if not exists (
    select 1 from public.profiles p
    where p.id = p_user_id and p.organization_id = v_org
  ) then
    raise exception 'المستخدم غير موجود في هذه المنشأة' using errcode = 'invalid_parameter_value';
  end if;
  if not app.can_manage_user(p_user_id) then
    raise exception 'المستخدم خارج نطاق إدارتك' using errcode = 'insufficient_privilege';
  end if;

  if p_scope not in ('organization', 'branch') then
    raise exception 'نطاق غير معروف: %', p_scope using errcode = 'invalid_parameter_value';
  end if;
  if p_scope = 'organization' and not app.has_org_scope() then
    raise exception 'منح نطاق المنشأة يتطلب أن تكون أنت بنطاق المنشأة'
      using errcode = 'insufficient_privilege';
  end if;
  if not app.can_grant_role(p_role_id) then
    raise exception 'لا يمكنك منح دور يحتوي صلاحيات لا تملكها'
      using errcode = 'insufficient_privilege';
  end if;
  if not exists (
    select 1 from public.roles r
    where r.id = p_role_id and (r.organization_id is null or r.organization_id = v_org)
  ) then
    raise exception 'الدور غير موجود في هذه المنشأة' using errcode = 'invalid_parameter_value';
  end if;
  if p_scope = 'branch' and coalesce(array_length(p_branch_ids, 1), 0) = 0 then
    raise exception 'مستخدم بنطاق فرع يحتاج فرعًا واحدًا على الأقل'
      using errcode = 'invalid_parameter_value';
  end if;

  foreach v_branch in array coalesce(p_branch_ids, array[]::uuid[]) loop
    if not app.can_access_branch(v_branch) then
      raise exception 'لا تملك وصولًا للفرع المطلوب إسناده'
        using errcode = 'insufficient_privilege';
    end if;
    if not exists (
      select 1 from public.branches b
      where b.id = v_branch and b.organization_id = v_org and b.deleted_at is null
    ) then
      raise exception 'الفرع غير موجود في هذه المنشأة' using errcode = 'invalid_parameter_value';
    end if;
  end loop;

  v_default := (coalesce(p_branch_ids, array[]::uuid[]))[1];

  -- الاستبدال داخل معاملة واحدة: لا تنشأ لحظة يكون فيها المستخدم بلا دور
  delete from public.user_roles where user_id = p_user_id;
  insert into public.user_roles (user_id, role_id, scope) values (p_user_id, p_role_id, p_scope);

  delete from public.user_branches where user_id = p_user_id;
  foreach v_branch in array coalesce(p_branch_ids, array[]::uuid[]) loop
    insert into public.user_branches (user_id, branch_id, is_default)
    values (p_user_id, v_branch, v_branch = v_default);
  end loop;

  update public.profiles set default_branch_id = v_default where id = p_user_id;
end;
$$;

comment on function app.set_user_assignment is
  'يستبدل دور المستخدم وفروعه ذريًا بنفس فحوص التصعيد والنطاق. لا يعمل على الذات.';

revoke all on function app.provision_user(uuid, text, uuid, text, uuid[], text, text, text, uuid, uuid) from public;
revoke all on function app.set_user_assignment(uuid, uuid, text, uuid[]) from public;
grant execute on function app.provision_user(uuid, text, uuid, text, uuid[], text, text, text, uuid, uuid) to authenticated;
grant execute on function app.set_user_assignment(uuid, uuid, text, uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
-- 8) أغلفة PostgREST
--
--    PostgREST يكشف دوال المخططات المكشوفة فقط، و`app` ليس منها — وهذا مقصود:
--    كشف المخطط كله يجعل `apply_rls` و`has_permission` قابلة للنداء من العميل.
--    لذلك نكشف غلافين صريحين فقط، بلا منطق، ينقلان النداء إلى `app`.
--
--    ⚠️ SECURITY INVOKER: الغلاف لا يمنح شيئًا؛ الدالة الداخلية هي DEFINER
--       وهي التي تُعيد فحص كل القواعد باستخدام auth.uid() للمستدعي الأصلي.
-- -----------------------------------------------------------------------------
create or replace function public.provision_user(
  p_user_id           uuid,
  p_full_name_ar      text,
  p_role_id           uuid,
  p_scope             text,
  p_branch_ids        uuid[],
  p_phone             text default null,
  p_job_title         text default null,
  p_employee_code     text default null,
  p_default_branch_id uuid default null,
  p_provider_id       uuid default null
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select app.provision_user(
    p_user_id, p_full_name_ar, p_role_id, p_scope, p_branch_ids,
    p_phone, p_job_title, p_employee_code, p_default_branch_id, p_provider_id
  );
$$;

create or replace function public.set_user_assignment(
  p_user_id    uuid,
  p_role_id    uuid,
  p_scope      text,
  p_branch_ids uuid[]
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select app.set_user_assignment(p_user_id, p_role_id, p_scope, p_branch_ids);
$$;

revoke all on function public.provision_user(uuid, text, uuid, text, uuid[], text, text, text, uuid, uuid)
  from public, anon;
revoke all on function public.set_user_assignment(uuid, uuid, text, uuid[]) from public, anon;

grant execute on function public.provision_user(uuid, text, uuid, text, uuid[], text, text, text, uuid, uuid)
  to authenticated;
grant execute on function public.set_user_assignment(uuid, uuid, text, uuid[]) to authenticated;

comment on function public.provision_user is
  'غلاف PostgREST لـ app.provision_user. بلا منطق — كل الفحوص في الدالة الداخلية.';
comment on function public.set_user_assignment is
  'غلاف PostgREST لـ app.set_user_assignment. بلا منطق.';
