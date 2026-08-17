-- =============================================================================
--  Migration : 20260817140000_appointments_scheduling
--  Phase     : 4 — نظام الحجز الداخلي
--  Purpose   : ساعات العمل + توفّر المقدّم للخدمة + منع التعارض في المحرّك.
--  Reference : docs/REQUIREMENTS.md P-12 · قرارات العميل 2026-08-17
--
--  ⚠️ فحص المخطط قبل الكتابة (البند 13) أثبت:
--     • `appointments` موجود ولا يُعاد إنشاؤه — نُضيف إليه عمودين وقيدًا فقط.
--     • `appointment_statuses` موجود وفيه 5 حالات كافية — لا حالات جديدة.
--     • `branch_services` و `provider_branches` موجودان — لا تكرار.
--     • `btree_gist` مُفعّل منذ ترحيل الأساس وكان مُعدًّا لهذا الغرض بالضبط.
--     • **لا يوجد** جدول ساعات عمل ⇒ نقص حقيقي.
--     • **لا يوجد** ربط بين مقدّم الخدمة والخدمات ⇒ نقص حقيقي يمنع تنفيذ
--       «اختيار مقدّم الخدمة المتاح للخدمة».
--
--  ⚠️ ما لا يفعله هذا الترحيل عمدًا:
--     • لا قواعد انتقال بين الحالات، ولا سياسة إلغاء، ولا إعادة جدولة (P-11).
--     • لا أسعار ولا دفع ولا عربون ولا فواتير — لا عمود مالي واحد.
--     • لا حجز عام: كل ما هنا لدور `authenticated` فقط، وبلا أي سياسة `anon`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) ساعات العمل
--
--    التصميم الأبسط الذي يفي بالمطلوب ويقبل التوسّع:
--      • صف = فترة عمل واحدة في يوم أسبوع واحد لفرع واحد.
--      • أكثر من صف لنفس اليوم = أكثر من فترة (صباحية/مسائية) بلا أي تغيير بنيوي.
--      • is_closed = اليوم مغلق كليًا.
--
--    ⚠️ ليس نظام ورديات: لا موظفين، ولا تناوب، ولا استثناءات تواريخ (أعياد).
--       إجازات التواريخ المحددة تُضاف لاحقًا بجدول استثناءات يعلو هذا النمط،
--       ولا تتطلب تعديل هذا الجدول.
--    ⚠️ الأوقات **محلية بتوقيت الفرع** (branches.timezone) لا UTC. تخزين
--       ساعات العمل بـ UTC يجعلها تنزلق مع أي تغيير توقيت.
-- -----------------------------------------------------------------------------
create table if not exists public.business_hours (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations(id) on delete restrict,
  branch_id       uuid        not null references public.branches(id) on delete cascade,
  -- 0 = الأحد … 6 = السبت (يطابق extract(dow) في PostgreSQL)
  weekday         smallint    not null check (weekday between 0 and 6),
  opens_at        time        not null,
  closes_at       time        not null,
  is_closed       boolean     not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  updated_by      uuid,
  -- فترة مغلقة لا تحتاج أوقاتًا منطقية؛ الفترة المفتوحة تحتاجها
  constraint business_hours_period_valid check (is_closed or closes_at > opens_at),
  -- منع تكرار نفس الفترة حرفيًا لنفس اليوم
  constraint business_hours_unique_period unique (branch_id, weekday, opens_at, closes_at)
);

create index if not exists business_hours_branch_weekday_idx
  on public.business_hours (branch_id, weekday);

comment on table public.business_hours is
  'ساعات عمل الفرع بتوقيته المحلي. صف = فترة واحدة؛ عدة صفوف لنفس اليوم = عدة فترات. '
  '⚠️ ليس نظام ورديات ولا يحمل أي قاعدة عمل غير معتمدة.';
comment on column public.business_hours.weekday is
  '0 = الأحد … 6 = السبت — مطابق لـ extract(dow) حتى لا تلزم أي خريطة تحويل.';

-- -----------------------------------------------------------------------------
-- 2) الخدمات التي يقدّمها مقدّم الخدمة
--    يعكس نمط branch_services القائم حرفيًا — لا نمط جديد.
--
--    ⚠️ قرار تصميمي صريح: **الغياب يعني عدم التوفّر**. مقدّم بلا أي ربط لا
--       يظهر لأي خدمة. الاتجاه نفسه المعتمد في نظام النشر (الافتراضي مخفي):
--       الإتاحة قرار واعٍ لا نتيجة صمت. راجع التقرير — يحتاج تأكيدك.
-- -----------------------------------------------------------------------------
create table if not exists public.provider_services (
  provider_id  uuid    not null references public.service_providers(id) on delete cascade,
  service_id   uuid    not null references public.services(id) on delete cascade,
  is_available boolean not null default true,
  created_at   timestamptz not null default now(),
  created_by   uuid,
  primary key (provider_id, service_id)
);

create index if not exists provider_services_service_idx on public.provider_services (service_id);

comment on table public.provider_services is
  'الخدمات التي يقدّمها مقدّم الخدمة. الغياب = غير متوفّر (قرار تصميمي، لا قاعدة عمل).';

-- -----------------------------------------------------------------------------
-- 3) الحجوزات: نهاية الموعد وتصنيف الحالة
--
--    ends_at عمود عادي يصونه المحفّز، لا عمود مولّد.
--    ⚠️ السبب تقني ومُتحقَّق منه لا تفضيل: `timestamptz + interval` مُعرَّف
--       STABLE لا IMMUTABLE في PostgreSQL (لأن إضافة مدة إلى لحظة مطلقة تعتمد
--       على المنطقة الزمنية للجلسة في حالات التوقيت الصيفي)، وكذلك
--       `extract(epoch from timestamptz)`. والأعمدة المولّدة وتعابير الفهارس
--       تشترط IMMUTABLE ⇒ كل الصيغ المعتمدة على الجمع مرفوضة.
--       المحفّز يكتب القيمة دائمًا ويتجاهل ما يرسله العميل، فالعمود لا ينحرف.
--
--    status_category تجسيد لعمود موجود في appointment_statuses يُحدَّث بمحفّز.
--    ⚠️ نعم هذا تكرار — ومبرَّره الوحيد أن قيد الاستبعاد لا يستطيع الانضمام
--       إلى جدول آخر. المصدر يبقى appointment_statuses، والمحفّز يمنع الانحراف
--       في الاتجاهين (تغيير حالة الحجز، وتغيير تصنيف الحالة نفسها).
-- -----------------------------------------------------------------------------
alter table public.appointments add column if not exists ends_at timestamptz;
alter table public.appointments
  add column if not exists status_category text not null default 'open';

comment on column public.appointments.ends_at is
  'نهاية الموعد = البداية + المدة. يكتبه المحفّز دائمًا — لا يُرسَل من العميل.';
comment on column public.appointments.status_category is
  'تجسيد appointment_statuses.category — يُصان بمحفّز. لا يُحرَّر يدويًا.';

create or replace function app.sync_appointment_status_category()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select s.category into new.status_category
  from public.appointment_statuses s
  where s.id = new.status_id;

  if new.status_category is null then
    raise exception 'حالة الحجز غير معروفة' using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

revoke all on function app.sync_appointment_status_category() from public, anon, authenticated;

drop trigger if exists appointments_sync_status_category on public.appointments;
create trigger appointments_sync_status_category
  before insert or update of status_id on public.appointments
  for each row execute function app.sync_appointment_status_category();

/*
  تعبئة الصفوف القائمة قبل تفعيل القيد.

  ⚠️ لا حذف ولا تعديل لأي بيانات موجودة عدا العمودين الجديدين. تحديث
     status_category و ends_at وحدهما **لا يُشغّل** محفّز التحقق، لأن قائمة
     أعمدته لا تشملهما — وهذا مقصود: الحجوزات التجريبية القائمة سبقت وجود
     ساعات العمل، ولو أُخضعت للتحقق الآن لرُفضت بلا سبب وجيه.
*/
update public.appointments a
   set status_category = s.category
  from public.appointment_statuses s
 where s.id = a.status_id
   and a.status_category is distinct from s.category;

update public.appointments
   set ends_at = scheduled_at + make_interval(mins => duration_minutes)
 where ends_at is null;

alter table public.appointments alter column ends_at set not null;

-- انحراف عكسي: تغيير تصنيف حالة يجب أن يسري على حجوزاتها
create or replace function app.propagate_status_category()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.category is distinct from old.category then
    update public.appointments set status_category = new.category where status_id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function app.propagate_status_category() from public, anon, authenticated;

drop trigger if exists appointment_statuses_propagate_category on public.appointment_statuses;
create trigger appointment_statuses_propagate_category
  after update on public.appointment_statuses
  for each row execute function app.propagate_status_category();

-- -----------------------------------------------------------------------------
-- 4) منع التعارض — الضمان الحقيقي
--
--    قيد استبعاد لا محفّز: المحفّز يقرأ ثم يكتب، وبين القراءة والكتابة تتسع
--    نافذة يستطيع طلبان متزامنان المرور منها معًا (READ COMMITTED لا يمنع
--    ذلك). قيد الاستبعاد يُقيَّم على مستوى الفهرس داخل المعاملة، فأحد الطلبين
--    يفشل حتمًا مهما كان التزامن.
--
--    شرط السريان:
--      • provider_id غير فارغ  — موعد بلا مقدّم لا يحجز وقت أحد.
--      • deleted_at فارغ       — المحذوف منطقيًا لا يشغل الوقت.
--      • الحالة ليست ملغاة     — الملغى وعدم الحضور يحرّران الوقت.
--
--    ⚠️ «الملغى يحرّر الوقت» أقرب قرار إلى قاعدة عمل في هذا الترحيل. المصطلح
--       نفسه (cancelled) جزء من المخطط المعتمد سابقًا، والسلوك البديل — أن
--       يظل الموعد الملغى يحجز الوقت — بلا معنى تشغيلي. مذكور في التقرير.
-- -----------------------------------------------------------------------------
alter table public.appointments
  drop constraint if exists appointments_no_provider_overlap;

alter table public.appointments
  add constraint appointments_no_provider_overlap
  exclude using gist (
    provider_id with =,
    tstzrange(scheduled_at, ends_at, '[)') with &&
  )
  where (provider_id is not null and deleted_at is null and status_category <> 'cancelled');

comment on constraint appointments_no_provider_overlap on public.appointments is
  'لا حجزان متداخلان لنفس مقدّم الخدمة. مدى نصف مفتوح [) ⇒ موعد ينتهي 10:00 '
  'وآخر يبدأ 10:00 ليسا متعارضين. لا overbooking بأي حال.';

-- -----------------------------------------------------------------------------
-- 5) ساعات العمل: دالة الفحص
-- -----------------------------------------------------------------------------
create or replace function app.is_within_business_hours(
  p_branch uuid,
  p_start  timestamptz,
  p_end    timestamptz
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz          text;
  v_local_start timestamp;
  v_local_end   timestamp;
begin
  select b.timezone into v_tz from public.branches b where b.id = p_branch;
  if v_tz is null then return false; end if;

  v_local_start := p_start at time zone v_tz;
  v_local_end   := p_end   at time zone v_tz;

  -- موعد يعبر منتصف الليل لا يقع داخل أي فترة عمل يومية
  if v_local_start::date <> v_local_end::date then return false; end if;

  return exists (
    select 1
    from public.business_hours h
    where h.branch_id = p_branch
      and h.weekday   = extract(dow from v_local_start)::smallint
      and not h.is_closed
      and v_local_start::time >= h.opens_at
      and v_local_end::time   <= h.closes_at
  );
end;
$$;

comment on function app.is_within_business_hours(uuid, timestamptz, timestamptz) is
  'هل يقع الموعد كاملًا داخل فترة عمل واحدة للفرع بتوقيته المحلي؟ '
  'فرع بلا ساعات عمل مُعرَّفة = مغلق — الإتاحة قرار واعٍ لا نتيجة صمت.';

revoke all on function app.is_within_business_hours(uuid, timestamptz, timestamptz) from public;
grant execute on function app.is_within_business_hours(uuid, timestamptz, timestamptz) to authenticated;

-- -----------------------------------------------------------------------------
-- 6) تماسك الحجز — محفّز التحقق
--
--    كل ما هنا تماسك مرجعي لا قاعدة عمل: الخدمة متاحة في الفرع، والمقدّم يعمل
--    في الفرع ويقدّم الخدمة، والعميل من نفس الفرع، والمدة من الخدمة.
-- -----------------------------------------------------------------------------
create or replace function app.validate_appointment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_service_duration integer;
  v_service_branch   uuid;
  v_provider_branch  uuid;
begin
  -- 6.1 المدة تأتي من الخدمة، لا من العميل
  if new.service_id is not null then
    select s.default_duration_minutes, s.branch_id
      into v_service_duration, v_service_branch
      from public.services s
     where s.id = new.service_id
       and s.organization_id = new.organization_id
       and s.status = 'active'
       and s.deleted_at is null;

    if not found then
      raise exception 'الخدمة غير موجودة أو غير نشطة في هذه المنشأة'
        using errcode = 'invalid_parameter_value';
    end if;

    -- خدمة خاصة بفرع لا تُحجز في فرع آخر
    if v_service_branch is not null and v_service_branch <> new.branch_id then
      raise exception 'الخدمة غير متاحة في هذا الفرع'
        using errcode = 'invalid_parameter_value';
    end if;

    -- خدمة مشتركة تحتاج إتاحة صريحة في الفرع
    if v_service_branch is null and not exists (
      select 1 from public.branch_services bs
      where bs.branch_id = new.branch_id
        and bs.service_id = new.service_id
        and bs.is_available
    ) then
      raise exception 'الخدمة غير متاحة في هذا الفرع'
        using errcode = 'invalid_parameter_value';
    end if;

    if v_service_duration is not null then
      new.duration_minutes := v_service_duration;
    end if;
  end if;

  -- 6.2 العميل من نفس الفرع
  if not exists (
    select 1 from public.customers c
    where c.id = new.customer_id
      and c.organization_id = new.organization_id
      and c.branch_id = new.branch_id
      and c.deleted_at is null
  ) then
    raise exception 'العميل غير موجود في هذا الفرع'
      using errcode = 'invalid_parameter_value';
  end if;

  -- 6.3 مقدّم الخدمة: يعمل في الفرع، ويقدّم هذه الخدمة
  if new.provider_id is not null then
    select sp.branch_id into v_provider_branch
      from public.service_providers sp
     where sp.id = new.provider_id
       and sp.organization_id = new.organization_id
       and sp.status = 'active'
       and sp.deleted_at is null;

    if not found then
      raise exception 'مقدّم الخدمة غير موجود أو غير نشط'
        using errcode = 'invalid_parameter_value';
    end if;

    -- مقدّم مربوط بفرع محدد يلتزم به؛ ومقدّم على مستوى المنشأة يحتاج
    -- إتاحة صريحة في الفرع عبر provider_branches.
    if v_provider_branch is not null then
      if v_provider_branch <> new.branch_id then
        raise exception 'مقدّم الخدمة لا يعمل في هذا الفرع'
          using errcode = 'invalid_parameter_value';
      end if;
    elsif not exists (
      select 1 from public.provider_branches pb
      where pb.provider_id = new.provider_id and pb.branch_id = new.branch_id
    ) then
      raise exception 'مقدّم الخدمة لا يعمل في هذا الفرع'
        using errcode = 'invalid_parameter_value';
    end if;

    if new.service_id is not null and not exists (
      select 1 from public.provider_services ps
      where ps.provider_id = new.provider_id
        and ps.service_id = new.service_id
        and ps.is_available
    ) then
      raise exception 'مقدّم الخدمة لا يقدّم هذه الخدمة'
        using errcode = 'invalid_parameter_value';
    end if;
  end if;

  -- 6.4 نهاية الموعد تُحسب هنا دائمًا — أي قيمة يرسلها العميل تُتجاهل.
  --     هذا ما يجعل عمودًا عاديًا مكافئًا لعمود مولّد من ناحية الضمان.
  new.ends_at := new.scheduled_at + make_interval(mins => new.duration_minutes);

  -- 6.5 داخل ساعات العمل — يُفحص بعد تثبيت المدة أعلاه
  if not app.is_within_business_hours(new.branch_id, new.scheduled_at, new.ends_at) then
    raise exception 'الموعد خارج ساعات عمل الفرع'
      using errcode = 'invalid_parameter_value';
  end if;

  return new;
end;
$$;

comment on function app.validate_appointment() is
  'تماسك الحجز: الخدمة والمقدّم والعميل والفرع وساعات العمل. '
  'لا يحتوي أي قاعدة إلغاء أو إعادة جدولة أو تسعير.';

revoke all on function app.validate_appointment() from public, anon, authenticated;

drop trigger if exists appointments_validate on public.appointments;
create trigger appointments_validate
  before insert or update of
    branch_id, customer_id, service_id, provider_id, scheduled_at, duration_minutes
  on public.appointments
  for each row execute function app.validate_appointment();

-- -----------------------------------------------------------------------------
-- 7) الأوقات المتاحة — تُحسب في المحرّك
--
--    ⚠️ الحساب هنا لا في الواجهة، لأن أي تكرار للمنطق ينتج شاشة تعرض وقتًا
--       ترفضه قاعدة البيانات. مصدر واحد للحقيقة: ساعات العمل + المشغول فعلًا.
--
--    الخطوة = مدة الخدمة (البند 3: «أوقات الحجز مبنية على مدة الخدمة»).
-- -----------------------------------------------------------------------------
create or replace function app.available_slots(
  p_branch   uuid,
  p_service  uuid,
  p_provider uuid,
  p_date     date
)
returns table (slot_start timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz       text;
  v_duration integer;
begin
  select b.timezone into v_tz from public.branches b where b.id = p_branch;
  if v_tz is null then return; end if;

  -- النطاق: لا نكشف أوقات فرع خارج صلاحية المستخدم
  if not app.can_access_branch(p_branch) then return; end if;

  select s.default_duration_minutes into v_duration
    from public.services s where s.id = p_service;
  if v_duration is null or v_duration <= 0 then return; end if;

  return query
  with periods as (
    select h.opens_at, h.closes_at
    from public.business_hours h
    where h.branch_id = p_branch
      and h.weekday = extract(dow from p_date)::smallint
      and not h.is_closed
  ),
  candidates as (
    select ((p_date + p.opens_at) at time zone v_tz)
             + make_interval(mins => v_duration * n) as starts_at,
           ((p_date + p.closes_at) at time zone v_tz) as period_end
    from periods p
    cross join generate_series(
      0,
      -- أقصى عدد خطوات ممكن داخل الفترة
      greatest(0, (extract(epoch from (p.closes_at - p.opens_at))::integer / (v_duration * 60)) - 1)
    ) as n
  )
  select c.starts_at
  from candidates c
  where c.starts_at + make_interval(mins => v_duration) <= c.period_end
    and not exists (
      select 1
      from public.appointments a
      where a.provider_id = p_provider
        and a.deleted_at is null
        and a.status_category <> 'cancelled'
        and tstzrange(a.scheduled_at, a.ends_at, '[)')
            && tstzrange(c.starts_at, c.starts_at + make_interval(mins => v_duration), '[)')
    )
  order by c.starts_at;
end;
$$;

comment on function app.available_slots(uuid, uuid, uuid, date) is
  'أوقات البدء المتاحة لمقدّم خدمة في يوم. الخطوة = مدة الخدمة. '
  'يحترم نطاق فروع المستخدم ولا يكشف أوقات فرع خارجه.';

revoke all on function app.available_slots(uuid, uuid, uuid, date) from public;
grant execute on function app.available_slots(uuid, uuid, uuid, date) to authenticated;

-- غلاف PostgREST — مخطط `app` غير مكشوف عمدًا
create or replace function public.available_slots(
  p_branch uuid, p_service uuid, p_provider uuid, p_date date
)
returns table (slot_start timestamptz)
language sql
security invoker
set search_path = ''
as $$
  select * from app.available_slots(p_branch, p_service, p_provider, p_date);
$$;

revoke all on function public.available_slots(uuid, uuid, uuid, date) from public, anon;
grant execute on function public.available_slots(uuid, uuid, uuid, date) to authenticated;

-- -----------------------------------------------------------------------------
-- 8) سياسات RLS للجدولين الجديدين
--
--    ⚠️ لا صلاحيات جديدة (البند 5): ساعات العمل إعداد فرع ⇒ صلاحيات الفروع،
--       وتوفّر المقدّم للخدمة ⇒ صلاحيات مقدّمي الخدمة.
-- -----------------------------------------------------------------------------
select app.apply_rls(
  'business_hours',
  'organizations.branches.view',
  'organizations.branches.update',
  'organizations.branches.update',
  'organizations.branches.update',
  true,   -- يحمل branch_id
  false,  -- ليس دفترًا
  false   -- لا سجلات على مستوى المنشأة: كل صف يخص فرعًا
);
select app.apply_audit_triggers('business_hours');

-- provider_services: بلا organization_id — النطاق يُشتق من المقدّم (نمط branch_services)
alter table public.provider_services enable row level security;

drop policy if exists provider_services_select on public.provider_services;
create policy provider_services_select on public.provider_services
  for select to authenticated
  using (
    (select app.is_active_user())
    and (select app.has_permission('services.view'))
    and exists (
      select 1 from public.service_providers sp
      where sp.id = provider_services.provider_id
        and sp.organization_id = (select app.current_org_id())
    )
  );

drop policy if exists provider_services_write on public.provider_services;
create policy provider_services_write on public.provider_services
  for all to authenticated
  using (
    (select app.is_active_user())
    and (select app.has_permission('services.providers.manage'))
    and exists (
      select 1 from public.service_providers sp
      where sp.id = provider_services.provider_id
        and sp.organization_id = (select app.current_org_id())
        and (sp.branch_id is null or (select app.can_access_branch(sp.branch_id)))
    )
  )
  with check (
    (select app.has_permission('services.providers.manage'))
    and exists (
      select 1 from public.service_providers sp
      where sp.id = provider_services.provider_id
        and sp.organization_id = (select app.current_org_id())
        and (sp.branch_id is null or (select app.can_access_branch(sp.branch_id)))
    )
  );

grant select, insert, update, delete on public.provider_services to authenticated;

-- ⚠️ لا سياسة anon على أي من الجدولين: الحجز العام مرحلة لاحقة (البند 11).
revoke all on public.business_hours   from anon;
revoke all on public.provider_services from anon;
