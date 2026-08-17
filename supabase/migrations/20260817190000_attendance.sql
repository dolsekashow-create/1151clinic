-- =============================================================================
--  Migration : 20260817190000_attendance
--  Phase     : 7 — الحضور والانصراف بالموقع الجغرافي
--  Reference : طلب العميل 2026-08-17
--
--  ⚠️ فحص المخطط قبل الكتابة: لا يوجد أي جدول حضور، ولا أعمدة إحداثيات على
--     الفروع، ولا صلاحيات حضور. كل ما هنا جديد فعلًا ولا يكرّر شيئًا.
--
--  ⚠️ ما **لا** يحتويه هذا الترحيل عمدًا (قواعد عمل لم تُعتمد):
--     • لا احتساب تأخير ولا خصم ولا إضافي ولا استراحة.
--     • لا إغلاق تلقائي لجلسة نسي صاحبها الانصراف — تبقى مفتوحة وتُعلَّم.
--     • لا حد لعدد الجلسات في اليوم (قد يخرج الموظف ويعود).
--     • لا ربط بالرواتب ولا بأي منطق مالي.
--     الجدول يسجّل **وقائع** لا أحكامًا: من دخل، متى، من أين، وكم بقي.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) موقع الفرع
--
--    ⚠️ لا قيمة افتراضية لنصف قطر النطاق: تحديده قرار إداري يخص كل مقر
--       (عيادة في برج ≠ مركز بمواقف واسعة). فرع بلا إحداثيات أو بلا نصف قطر
--       **لا يقبل تسجيل حضور** — نفس اتجاه بقية النظام: الإتاحة قرار واعٍ
--       لا نتيجة صمت.
-- -----------------------------------------------------------------------------
alter table public.branches
  add column if not exists latitude  numeric(9, 6),
  add column if not exists longitude numeric(9, 6),
  add column if not exists geofence_radius_meters integer;

alter table public.branches
  drop constraint if exists branches_geofence_valid;
alter table public.branches
  add constraint branches_geofence_valid check (
    (latitude is null and longitude is null)
    or (latitude between -90 and 90 and longitude between -180 and 180)
  );

alter table public.branches
  drop constraint if exists branches_geofence_radius_valid;
alter table public.branches
  add constraint branches_geofence_radius_valid check (
    geofence_radius_meters is null or geofence_radius_meters between 20 and 5000
  );

comment on column public.branches.geofence_radius_meters is
  'نصف قطر نطاق تسجيل الحضور بالأمتار. null = الحضور معطّل لهذا الفرع. '
  'الحد الأدنى 20م لأن دقة GPS في الهواتف نادرًا ما تقل عن ذلك.';

-- -----------------------------------------------------------------------------
-- 2) المسافة بين نقطتين — صيغة هافرساين
--
--    ⚠️ لماذا لا PostGIS: الحاجة نقطة-إلى-نقطة فقط، وإضافة امتداد جغرافي كامل
--       لأجل دالة واحدة تكلفة تشغيلية بلا مقابل. هافرساين دقيقة لمسافات
--       المئات من الأمتار بما يفوق دقة GPS نفسها.
--    ⚠️ IMMUTABLE: رياضيات بحتة بلا اعتماد على أي إعداد جلسة.
-- -----------------------------------------------------------------------------
create or replace function app.geo_distance_meters(
  p_lat1 numeric, p_lng1 numeric,
  p_lat2 numeric, p_lng2 numeric
)
returns numeric
language sql
immutable
as $$
  select round(
    (6371000 * 2 * asin(sqrt(
      power(sin(radians(p_lat2 - p_lat1) / 2), 2)
      + cos(radians(p_lat1)) * cos(radians(p_lat2))
      * power(sin(radians(p_lng2 - p_lng1) / 2), 2)
    )))::numeric,
    1
  );
$$;

comment on function app.geo_distance_meters(numeric, numeric, numeric, numeric) is
  'المسافة بالأمتار بين إحداثيتين (هافرساين). رياضيات بحتة — لا تعتمد على أي حالة.';

revoke all on function app.geo_distance_meters(numeric, numeric, numeric, numeric) from public;
grant execute on function app.geo_distance_meters(numeric, numeric, numeric, numeric) to authenticated;

-- -----------------------------------------------------------------------------
-- 3) جلسات الحضور
--
--    صف = جلسة واحدة: دخول ثم خروج. الجلسة المفتوحة `checked_out_at = null`.
--
--    ⚠️ الإحداثيات تُخزَّن لأنها **الدليل**: بدونها لا معنى لادّعاء أن الموظف
--       كان في المقر. المسافة المحسوبة تُخزَّن أيضًا حتى لا تتغيّر النتيجة لو
--       عُدّل موقع الفرع لاحقًا — السجل يحفظ الواقعة كما كانت لحظتها.
-- -----------------------------------------------------------------------------
create table if not exists public.attendance_sessions (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid        not null references public.organizations(id) on delete restrict,
  branch_id         uuid        not null references public.branches(id) on delete restrict,
  user_id           uuid        not null references public.profiles(id) on delete restrict,

  checked_in_at     timestamptz not null default now(),
  check_in_latitude  numeric(9, 6) not null,
  check_in_longitude numeric(9, 6) not null,
  check_in_distance_meters numeric not null,

  checked_out_at    timestamptz,
  check_out_latitude  numeric(9, 6),
  check_out_longitude numeric(9, 6),
  check_out_distance_meters numeric,

  /* تُحسب بمحفّز عند الانصراف. لا عمود مولّد: `timestamptz - timestamptz`
     يُنتج interval، والاشتقاق منه في عمود مولّد يصطدم بنفس قيد IMMUTABLE
     الذي واجهناه في `appointments.ends_at`. */
  duration_minutes  integer,

  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid,
  updated_by        uuid,

  constraint attendance_period_valid check (
    checked_out_at is null or checked_out_at > checked_in_at
  ),
  constraint attendance_checkout_complete check (
    (checked_out_at is null and check_out_latitude is null and check_out_longitude is null)
    or (checked_out_at is not null and check_out_latitude is not null and check_out_longitude is not null)
  )
);

create index if not exists attendance_user_time_idx
  on public.attendance_sessions (user_id, checked_in_at desc);
create index if not exists attendance_branch_time_idx
  on public.attendance_sessions (branch_id, checked_in_at desc);
create index if not exists attendance_org_time_idx
  on public.attendance_sessions (organization_id, checked_in_at desc);

/*
  ⚠️ جلسة مفتوحة واحدة لكل مستخدم — القيد الأهم في الجدول.
     بدونه ينتج ضغط مزدوج على «تسجيل دخول» جلستين مفتوحتين فتُحتسب الساعات
     مرتين. الفهرس الجزئي الفريد يجعل ذلك مستحيلًا حتى مع طلبين متزامنين.
*/
create unique index if not exists attendance_one_open_session_uidx
  on public.attendance_sessions (user_id) where checked_out_at is null;

comment on table public.attendance_sessions is
  'وقائع الحضور والانصراف بالموقع. ⚠️ لا تحتوي أي حكم: لا تأخير ولا خصم ولا '
  'إضافي ولا ربط بالرواتب — تلك قواعد عمل غير معتمدة.';

select app.apply_audit_triggers('attendance_sessions');

/* حساب المدة عند الانصراف — مصدر واحد للحقيقة بدل حسابها في كل استعلام. */
create or replace function app.set_attendance_duration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.checked_out_at is not null then
    new.duration_minutes := greatest(
      0,
      (extract(epoch from (new.checked_out_at - new.checked_in_at)) / 60)::integer
    );
  else
    new.duration_minutes := null;
  end if;
  return new;
end;
$$;

revoke all on function app.set_attendance_duration() from public, anon, authenticated;

drop trigger if exists attendance_set_duration on public.attendance_sessions;
create trigger attendance_set_duration
  before insert or update of checked_out_at, checked_in_at on public.attendance_sessions
  for each row execute function app.set_attendance_duration();

-- -----------------------------------------------------------------------------
-- 4) سياسات RLS
--
--    ⚠️ قاعدة أساسية: **كل مستخدم يقرأ سجل حضوره دائمًا** بلا أي صلاحية —
--       نفس نمط `profiles_select_self`. سجل حضورك الشخصي ليس بيانات غيرك،
--       ومنعك من رؤيته يجعل الشاشة عديمة الفائدة لصاحبها.
--    ⚠️ رؤية سجل الآخرين تتطلب `attendance.view` **و** يبقى نطاق الفرع مطبّقًا.
--    ⚠️ لا سياسة INSERT/UPDATE لدور العميل إطلاقًا: التسجيل يمر عبر دالتَي
--       الدخول والخروج حصرًا، وإلا زوّر الموظف إحداثياته أو وقته مباشرةً.
-- -----------------------------------------------------------------------------
alter table public.attendance_sessions enable row level security;

drop policy if exists attendance_select_own on public.attendance_sessions;
create policy attendance_select_own on public.attendance_sessions
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists attendance_select on public.attendance_sessions;
create policy attendance_select on public.attendance_sessions
  for select to authenticated
  using (
    (select app.is_active_user())
    and organization_id = (select app.current_org_id())
    and (select app.has_permission('attendance.view'))
    and (select app.can_access_branch(branch_id))
  );

/* التصحيح الإداري — لواقعة أُدخلت خطأً (نسي الانصراف مثلًا). */
drop policy if exists attendance_update on public.attendance_sessions;
create policy attendance_update on public.attendance_sessions
  for update to authenticated
  using (
    (select app.is_active_user())
    and organization_id = (select app.current_org_id())
    and (select app.has_permission('attendance.manage'))
    and (select app.can_access_branch(branch_id))
    -- ⚠️ لا يصحّح أحد سجل نفسه: تصحيح الذات = تزوير الحضور
    and user_id <> (select auth.uid())
  )
  with check (
    organization_id = (select app.current_org_id())
    and (select app.has_permission('attendance.manage'))
    and (select app.can_access_branch(branch_id))
    and user_id <> (select auth.uid())
  );

grant select, update on public.attendance_sessions to authenticated;
-- لا INSERT ولا DELETE: الإدراج عبر الدوال، والحذف ممنوع (سجل وقائع).
revoke all on public.attendance_sessions from anon;

-- -----------------------------------------------------------------------------
-- 5) تسجيل الدخول
--
--    ⚠️ الوقت `now()` من المحرّك لا من الجهاز: ساعة الهاتف قابلة للتغيير،
--       ووقت الخادم هو الوحيد الذي لا يملك الموظف تغييره.
--    ⚠️ الإحداثيات وحدها تأتي من الجهاز — ولا مفرّ. الحماية أن المسافة تُحسب
--       وتُخزَّن في المحرّك، فلا يستطيع العميل ادّعاء أنه كان قريبًا.
-- -----------------------------------------------------------------------------
create or replace function app.attendance_check_in(
  p_branch    uuid,
  p_latitude  numeric,
  p_longitude numeric
)
returns table (session_id uuid, distance_meters numeric, checked_in_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org      uuid := app.current_org_id();
  v_branch   record;
  v_distance numeric;
  v_id       uuid;
  v_time     timestamptz;
begin
  if auth.uid() is null or v_org is null then
    raise exception 'يجب تسجيل الدخول للنظام أولًا' using errcode = 'insufficient_privilege';
  end if;

  if p_latitude is null or p_longitude is null then
    raise exception 'تعذّر تحديد موقعك — فعّل خدمة الموقع وحاول مرة أخرى'
      using errcode = 'invalid_parameter_value';
  end if;

  select b.id, b.name_ar, b.latitude, b.longitude, b.geofence_radius_meters
    into v_branch
  from public.branches b
  where b.id = p_branch
    and b.organization_id = v_org
    and b.status = 'active'
    and b.deleted_at is null;

  if not found then
    raise exception 'الفرع غير موجود أو غير نشط' using errcode = 'invalid_parameter_value';
  end if;

  -- الموظف يسجّل في فرعه فقط
  if not app.can_access_branch(p_branch) then
    raise exception 'لا تملك وصولًا لهذا الفرع' using errcode = 'insufficient_privilege';
  end if;

  if v_branch.latitude is null or v_branch.geofence_radius_meters is null then
    raise exception 'لم يُحدَّد موقع هذا الفرع بعد — راجع الإدارة'
      using errcode = 'invalid_parameter_value';
  end if;

  v_distance := app.geo_distance_meters(
    v_branch.latitude, v_branch.longitude, p_latitude, p_longitude
  );

  if v_distance > v_branch.geofence_radius_meters then
    raise exception 'أنت خارج نطاق %  (تبعد % م والمسموح % م)',
      v_branch.name_ar, v_distance::integer, v_branch.geofence_radius_meters
      using errcode = 'invalid_parameter_value';
  end if;

  begin
    insert into public.attendance_sessions (
      organization_id, branch_id, user_id,
      check_in_latitude, check_in_longitude, check_in_distance_meters
    ) values (
      v_org, p_branch, auth.uid(), p_latitude, p_longitude, v_distance
    )
    returning id, attendance_sessions.checked_in_at into v_id, v_time;
  exception
    when unique_violation then
      raise exception 'لديك جلسة حضور مفتوحة بالفعل — سجّل انصرافك أولًا'
        using errcode = 'invalid_parameter_value';
  end;

  return query select v_id, v_distance, v_time;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6) تسجيل الانصراف
--
--    ⚠️ الانصراف **لا يشترط النطاق**: من سجّل حضوره ثم غادر لعذر لا يُحبَس
--       بلا انصراف. الموقع يُسجَّل والمسافة تُحسب، ويقرّر المدقّق ما يعنيه ذلك —
--       تحويل بُعد المسافة إلى رفض قاعدة عمل غير معتمدة.
-- -----------------------------------------------------------------------------
create or replace function app.attendance_check_out(
  p_latitude  numeric,
  p_longitude numeric
)
returns table (session_id uuid, duration_minutes integer, distance_meters numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session  record;
  v_branch   record;
  v_distance numeric;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول للنظام أولًا' using errcode = 'insufficient_privilege';
  end if;
  if p_latitude is null or p_longitude is null then
    raise exception 'تعذّر تحديد موقعك — فعّل خدمة الموقع وحاول مرة أخرى'
      using errcode = 'invalid_parameter_value';
  end if;

  select s.id, s.branch_id into v_session
  from public.attendance_sessions s
  where s.user_id = auth.uid() and s.checked_out_at is null
  limit 1;

  if not found then
    raise exception 'لا توجد جلسة حضور مفتوحة' using errcode = 'invalid_parameter_value';
  end if;

  select b.latitude, b.longitude into v_branch
  from public.branches b where b.id = v_session.branch_id;

  v_distance := case
    when v_branch.latitude is null then null
    else app.geo_distance_meters(v_branch.latitude, v_branch.longitude, p_latitude, p_longitude)
  end;

  update public.attendance_sessions
     set checked_out_at = now(),
         check_out_latitude = p_latitude,
         check_out_longitude = p_longitude,
         check_out_distance_meters = v_distance
   where id = v_session.id;

  return query
    select s.id, s.duration_minutes, s.check_out_distance_meters
    from public.attendance_sessions s where s.id = v_session.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7) الملخّص الشهري
--
--    ⚠️ الحساب في المحرّك لا في المتصفح: الشهر يُحسب بتوقيت الفرع، وجمع
--       الدقائق في TypeScript عبر آلاف الصفوف يُنتج فروقًا في حدود الشهر.
--    ⚠️ يجمع **الجلسات المكتملة فقط**. الجلسات المفتوحة تُعدّ منفصلة ليراها
--       المدقّق ويتصرّف — لا تُغلق تلقائيًا ولا تُهمَل بصمت.
-- -----------------------------------------------------------------------------
create or replace function app.attendance_monthly_summary(
  p_month   date,
  p_branch  uuid default null
)
returns table (
  user_id         uuid,
  full_name_ar    text,
  branch_id       uuid,
  sessions_count  integer,
  total_minutes   integer,
  open_sessions   integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.user_id,
         p.full_name_ar,
         s.branch_id,
         count(*) filter (where s.checked_out_at is not null)::integer,
         coalesce(sum(s.duration_minutes) filter (where s.checked_out_at is not null), 0)::integer,
         count(*) filter (where s.checked_out_at is null)::integer
  from public.attendance_sessions s
  join public.profiles p on p.id = s.user_id
  join public.branches b on b.id = s.branch_id
  where s.organization_id = app.current_org_id()
    and app.has_permission('attendance.view')
    and app.can_access_branch(s.branch_id)
    and (p_branch is null or s.branch_id = p_branch)
    and (s.checked_in_at at time zone b.timezone)::date
        >= date_trunc('month', p_month)::date
    and (s.checked_in_at at time zone b.timezone)::date
        < (date_trunc('month', p_month) + interval '1 month')::date
  group by s.user_id, p.full_name_ar, s.branch_id
  order by p.full_name_ar;
$$;

comment on function app.attendance_monthly_summary(date, uuid) is
  'إجمالي ساعات الشهر لكل موظف بتوقيت فرعه. يحترم صلاحية العرض ونطاق الفروع. '
  'لا يحتوي أي احتساب تأخير أو خصم — قواعد غير معتمدة.';

revoke all on function app.attendance_check_in(uuid, numeric, numeric) from public;
revoke all on function app.attendance_check_out(numeric, numeric) from public;
revoke all on function app.attendance_monthly_summary(date, uuid) from public;
grant execute on function app.attendance_check_in(uuid, numeric, numeric) to authenticated;
grant execute on function app.attendance_check_out(numeric, numeric) to authenticated;
grant execute on function app.attendance_monthly_summary(date, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 8) أغلفة PostgREST
-- -----------------------------------------------------------------------------
create or replace function public.attendance_check_in(
  p_branch uuid, p_latitude numeric, p_longitude numeric
)
returns table (session_id uuid, distance_meters numeric, checked_in_at timestamptz)
language sql security invoker set search_path = ''
as $$ select * from app.attendance_check_in(p_branch, p_latitude, p_longitude); $$;

create or replace function public.attendance_check_out(p_latitude numeric, p_longitude numeric)
returns table (session_id uuid, duration_minutes integer, distance_meters numeric)
language sql security invoker set search_path = ''
as $$ select * from app.attendance_check_out(p_latitude, p_longitude); $$;

create or replace function public.attendance_monthly_summary(p_month date, p_branch uuid default null)
returns table (
  user_id uuid, full_name_ar text, branch_id uuid,
  sessions_count integer, total_minutes integer, open_sessions integer
)
language sql security invoker set search_path = ''
as $$ select * from app.attendance_monthly_summary(p_month, p_branch); $$;

revoke all on function public.attendance_check_in(uuid, numeric, numeric) from public, anon;
revoke all on function public.attendance_check_out(numeric, numeric) from public, anon;
revoke all on function public.attendance_monthly_summary(date, uuid) from public, anon;
grant execute on function public.attendance_check_in(uuid, numeric, numeric) to authenticated;
grant execute on function public.attendance_check_out(numeric, numeric) to authenticated;
grant execute on function public.attendance_monthly_summary(date, uuid) to authenticated;

-- ⚠️ الحضور بيانات موظفين — لا شأن للزائر بها إطلاقًا.
revoke all on public.attendance_sessions from anon;
