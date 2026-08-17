-- =============================================================================
--  Migration : 20260817170000_public_booking
--  Phase     : 6 — الحجز العام للعميل
--  Reference : قرارات العميل المعتمدة 2026-08-17
--
--  ⚠️ فحص المخطط قبل الكتابة أثبت أن الجداول التشغيلية **كلها موجودة وكافية**:
--     appointments · customers · appointment_statuses · branches · services ·
--     service_providers · branch_services · provider_branches ·
--     provider_services · business_hours · organizations.
--     لا جدول تشغيلي جديد هنا.
--
--  الحواجز الثلاثة الحقيقية التي يعالجها هذا الترحيل:
--
--   حاجز-1: `app.available_slots` مشروطة بـ`app.can_access_branch()` ومسحوبة
--           من anon. هي دالة **الموظف**، ولا تصلح للزائر بحال. الحل دالة
--           موازية بنفس الخوارزمية لكن ببوابة **النشر** بدل بوابة النطاق.
--
--   حاجز-2: `customers_org_phone_uidx` يفرض تفرّد الهاتف على مستوى **المنشأة**.
--           القاعدة المعتمدة هي المطابقة داخل **نفس الفرع** وإنشاء عميل جديد
--           إن لم يوجد — وهذا مستحيل مع فهرس على مستوى المنشأة: زائر رقمه
--           مسجّل في فرع آخر كان سيفشل حجزه بخطأ تفرّد.
--           الترحيل الأصلي وثّق هذا كـP-15 معلّقة وقال إنه «قابل للتغيير
--           بترحيل واحد» — واعتماد قاعدة المطابقة يحسمه لصالح مستوى الفرع.
--
--   حاجز-3: لا مخزن مشترك للـidempotency ولا للحد من المعدّل. الذاكرة لا
--           تصلح: Vercel يشغّل نسخًا متعددة، فالمفتاح المحفوظ في نسخة لا
--           تراه الأخرى ⇒ ضغطتان متتاليتان تُنتجان حجزين.
--
--  ⚠️ لا منطق مالي: لا سعر ولا دفع ولا عربون ولا فاتورة — ولا عمود واحد منها.
--  ⚠️ لا حالات حجز جديدة: الخمس المعتمدة فقط، والحجز العام يبدأ `scheduled`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) حاجز-2: تفرّد هاتف العميل على مستوى الفرع (يحسم P-15)
--
--    ⚠️ لا فقدان بيانات: الفهرس الأوسع يُستبدل بأضيق منه، وكل صف يمرّ من
--       القديم يمرّ من الجديد. العكس غير صحيح — لذلك نتحقق أولًا ونفشل بصوت
--       عالٍ بدل الاستمرار بصمت لو وُجد تعارض غير متوقع.
-- -----------------------------------------------------------------------------
do $$
declare
  v_conflicts integer;
begin
  select count(*) into v_conflicts from (
    select branch_id, phone
    from public.customers
    where deleted_at is null
    group by branch_id, phone
    having count(*) > 1
  ) t;

  if v_conflicts > 0 then
    raise exception
      'يوجد % تكرار للهاتف داخل نفس الفرع — يجب تنظيفها قبل تضييق الفهرس', v_conflicts;
  end if;
end;
$$;

drop index if exists public.customers_org_phone_uidx;

create unique index if not exists customers_branch_phone_uidx
  on public.customers (branch_id, phone) where deleted_at is null;

comment on index public.customers_branch_phone_uidx is
  'P-15 محسومة (2026-08-17): الهاتف فريد داخل الفرع لا المنشأة. '
  'قاعدة المطابقة المعتمدة في الحجز العام: نفس الهاتف داخل نفس الفرع = نفس العميل.';

-- -----------------------------------------------------------------------------
-- 2) حاجز-3: الحد من المعدّل في قاعدة البيانات — مخزن مشترك بين كل النسخ
--
--    ⚠️ لا عنوان IP خام ولا هاتف ولا بريد هنا: العمود مفتاح **مُجزّأ** يُحسب
--       في طبقة التطبيق (نفس نمط المرحلة 0). العدّادات بيانات تشغيلية تُقرأ
--       أثناء التشخيص، وتحويلها إلى مخزن بيانات شخصية غير مقبول.
-- -----------------------------------------------------------------------------
create table if not exists public.rate_limit_counters (
  bucket_key   text        primary key,
  window_start timestamptz not null default now(),
  hits         integer     not null default 0
);

create index if not exists rate_limit_counters_window_idx
  on public.rate_limit_counters (window_start);

comment on table public.rate_limit_counters is
  'عدّادات الحد من المعدّل. المفتاح مُجزّأ دائمًا — ممنوع تخزين IP أو هاتف أو بريد.';

alter table public.rate_limit_counters enable row level security;
-- لا سياسة ⇒ لا وصول لأي دور عميل. الوصول عبر الدالة أدناه حصرًا.
revoke all on public.rate_limit_counters from anon, authenticated;

/*
  ⚠️ الذرّية هنا شرط صحة لا تحسين: `select` ثم `update` يسمح لطلبين متزامنين
     بقراءة نفس العدّاد فيتجاوزان الحد معًا. `insert … on conflict do update`
     يقفل الصف داخل العبارة الواحدة فيستحيل ذلك.
*/
create or replace function app.consume_rate_limit(
  p_bucket_key text,
  p_limit      integer,
  p_window_seconds integer
)
returns table (allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hits         integer;
  v_window_start timestamptz;
begin
  -- تنظيف انتهازي: العدّادات المنتهية لا قيمة لها، وحذفها في مهمة مستقلة
  -- يتطلب جدولة. 1% من النداءات تكفي لمنع النمو بلا حد.
  if random() < 0.01 then
    delete from public.rate_limit_counters where window_start < now() - interval '1 day';
  end if;

  insert into public.rate_limit_counters as c (bucket_key, window_start, hits)
  values (p_bucket_key, now(), 1)
  on conflict (bucket_key) do update
    set hits = case
          when c.window_start < now() - make_interval(secs => p_window_seconds) then 1
          else c.hits + 1
        end,
        window_start = case
          when c.window_start < now() - make_interval(secs => p_window_seconds) then now()
          else c.window_start
        end
  returning c.hits, c.window_start into v_hits, v_window_start;

  return query select
    v_hits <= p_limit,
    greatest(0, p_limit - v_hits),
    v_window_start + make_interval(secs => p_window_seconds);
end;
$$;

comment on function app.consume_rate_limit(text, integer, integer) is
  'عدّاد نافذة ثابتة مشترك بين كل نسخ الخادم. المفتاح مُجزّأ من طبقة التطبيق.';

revoke all on function app.consume_rate_limit(text, integer, integer) from public, anon, authenticated;

/*
  غلاف PostgREST للعدّاد — **مقصور على `service_role` وحده**.

  ⚠️ السبب أن الغلاف ضروري أصلًا: PostgREST يكشف دوال `public` فقط، ومخطط
     `app` غير مكشوف عمدًا. بلا غلاف لا يستطيع الخادم استدعاء العدّاد إطلاقًا.
  ⚠️ ولماذا `service_role` وحده: منحه لـ`anon` يعني أن الزائر يستطيع استهلاك
     عدّاد أي مفتاح — أي إسقاط الخدمة عن غيره أو تصفير حدّه هو. العدّاد يُستدعى
     من الخادم حصرًا وقبل أن يلمس الطلب أي منطق.
*/
create or replace function public.consume_rate_limit(
  p_bucket_key text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, remaining integer, reset_at timestamptz)
language sql
security invoker
set search_path = ''
as $$
  select * from app.consume_rate_limit(p_bucket_key, p_limit, p_window_seconds);
$$;

revoke all on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;
grant execute on function app.consume_rate_limit(text, integer, integer) to service_role;

-- -----------------------------------------------------------------------------
-- 3) حاجز-3: تخزين مفاتيح عدم التكرار (idempotency)
--
--    ⚠️ المفتاح مُجزّأ أيضًا: العميل يرسل مفتاحًا عشوائيًا، ونخزّن بصمته فقط.
--       تخزين المفتاح الخام يجعل من يقرأ الجدول قادرًا على انتحال إعادة الطلب.
-- -----------------------------------------------------------------------------
create table if not exists public.booking_idempotency (
  key_hash       text        primary key,
  appointment_id uuid        not null references public.appointments(id) on delete cascade,
  reference_no   text        not null,
  created_at     timestamptz not null default now()
);

create index if not exists booking_idempotency_created_idx
  on public.booking_idempotency (created_at);

comment on table public.booking_idempotency is
  'يربط مفتاح عدم التكرار المُجزّأ بالحجز الناتج. يمنع إنشاء حجزين من ضغطتين.';

alter table public.booking_idempotency enable row level security;
revoke all on public.booking_idempotency from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4) حاجز-1: الأوقات المتاحة للزائر
--
--    نفس خوارزمية `app.available_slots` حرفيًا (الخطوة = مدة الخدمة، استبعاد
--    المشغول، داخل فترات العمل)، والفرق الوحيد هو **البوابة**:
--      دالة الموظف : app.can_access_branch(branch)
--      دالة الزائر : المنشأة والفرع والخدمة والمقدّم منشورون ونشطون ومترابطون
--
--    ⚠️ لم أُعمّم الدالة الأصلية بمعامل «وضع»: خلط بوابتَي تصريح مختلفتين في
--       دالة واحدة يجعل خطأ واحد في شرط يفتح بيانات فرع غير منشور للعالم.
--       التكرار هنا مقصود ومحدود في شرط البوابة وحده.
-- -----------------------------------------------------------------------------
create or replace function app.is_bookable_publicly(
  p_branch   uuid,
  p_service  uuid,
  p_provider uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.branches b
    join public.services s
      on s.id = p_service
     and s.organization_id = b.organization_id
     and s.status = 'active'
     and s.is_public
     and s.deleted_at is null
     and s.default_duration_minutes is not null
    join public.service_providers sp
      on sp.id = p_provider
     and sp.organization_id = b.organization_id
     and sp.status = 'active'
     and sp.is_public
     and sp.deleted_at is null
    where b.id = p_branch
      and b.status = 'active'
      and b.is_public
      and b.deleted_at is null
      and app.is_org_published(b.organization_id)
      -- الخدمة متاحة في الفرع: خاصة به، أو مشتركة ومربوطة صراحةً
      and (
        s.branch_id = b.id
        or (
          s.branch_id is null
          and exists (
            select 1 from public.branch_services bs
            where bs.branch_id = b.id and bs.service_id = s.id and bs.is_available
          )
        )
      )
      -- المقدّم يعمل في الفرع
      and (
        sp.branch_id = b.id
        or (
          sp.branch_id is null
          and exists (
            select 1 from public.provider_branches pb
            where pb.provider_id = sp.id and pb.branch_id = b.id
          )
        )
      )
      -- المقدّم يقدّم هذه الخدمة (قرار معتمد: الغياب = غير متاح)
      and exists (
        select 1 from public.provider_services ps
        where ps.provider_id = sp.id and ps.service_id = s.id and ps.is_available
      )
  );
$$;

comment on function app.is_bookable_publicly(uuid, uuid, uuid) is
  'بوابة الحجز العام: المنشأة والفرع والخدمة والمقدّم منشورون ونشطون ومترابطون.';

create or replace function app.public_available_slots(
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
  if not app.is_bookable_publicly(p_branch, p_service, p_provider) then
    return;
  end if;

  -- لا أوقات في الماضي: عرضها يُنتج حجزًا يرفضه المنطق التشغيلي لاحقًا
  if p_date < (now() at time zone 'UTC')::date - 1 then
    return;
  end if;

  select b.timezone into v_tz from public.branches b where b.id = p_branch;
  select s.default_duration_minutes into v_duration
    from public.services s where s.id = p_service;
  if v_tz is null or v_duration is null or v_duration <= 0 then return; end if;

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
      greatest(0, (extract(epoch from (p.closes_at - p.opens_at))::integer / (v_duration * 60)) - 1)
    ) as n
  )
  select c.starts_at
  from candidates c
  where c.starts_at + make_interval(mins => v_duration) <= c.period_end
    -- الأوقات الماضية لا تُعرض للحجز
    and c.starts_at > now()
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

comment on function app.public_available_slots(uuid, uuid, uuid, date) is
  'أوقات الحجز المتاحة للزائر. نفس خوارزمية دالة الموظف ببوابة النشر بدل بوابة النطاق. '
  'لا تُرجع أوقاتًا ماضية ولا أي بيانات شخصية.';

-- -----------------------------------------------------------------------------
-- 5) إنشاء الحجز العام
--
--    ⚠️ SECURITY DEFINER يتجاوز RLS بالضرورة — ولذلك **كل** قرار تصريح يُعاد
--       فحصه هنا. لا تُصدَّق أي قيمة من المتصفح: المدة والنهاية والحالة والرقم
--       المرجعي والمنشأة كلها تُشتق في المحرّك، والمعرّفات المُرسلة تُتحقَّق
--       عبر بوابة النشر قبل أي كتابة.
--    ⚠️ لا تُرجع الدالة أبدًا ما يكشف وجود العميل من عدمه: النتيجة واحدة سواء
--       طُوبق عميل قائم أو أُنشئ جديد.
-- -----------------------------------------------------------------------------
create or replace function app.create_public_booking(
  p_branch          uuid,
  p_service         uuid,
  p_provider        uuid,
  p_slot            timestamptz,
  p_full_name       text,
  p_phone           text,
  p_email           text,
  p_notes           text,
  p_idempotency_hash text
)
returns table (reference_no text, reused boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org         uuid;
  v_status      uuid;
  v_customer    uuid;
  v_appointment uuid;
  v_reference   text;
  v_existing    record;
begin
  -- 5.1 عدم التكرار أولًا: إعادة الإرسال يجب ألا تصل إلى أي فحص آخر
  if p_idempotency_hash is not null and btrim(p_idempotency_hash) <> '' then
    select bi.reference_no into v_existing
    from public.booking_idempotency bi
    where bi.key_hash = p_idempotency_hash;

    if found then
      return query select v_existing.reference_no, true;
      return;
    end if;
  end if;

  -- 5.2 البوابة العامة — تشمل النشر والنشاط والترابط كاملًا
  if not app.is_bookable_publicly(p_branch, p_service, p_provider) then
    raise exception 'الخدمة غير متاحة لدى مقدّم الخدمة في هذا الفرع'
      using errcode = 'invalid_parameter_value';
  end if;

  select b.organization_id into v_org from public.branches b where b.id = p_branch;

  -- 5.3 الوقت يجب أن يكون **من** الأوقات المتاحة فعلًا.
  --     هذا الشرط وحده يغطي ساعات العمل والتعارض والمحاذاة على مدة الخدمة،
  --     ويضمن أن ما يقبله الحجز هو بالضبط ما تعرضه الواجهة.
  if not exists (
    select 1 from app.public_available_slots(p_branch, p_service, p_provider, (p_slot at time zone
      (select b.timezone from public.branches b where b.id = p_branch))::date) s
    where s.slot_start = p_slot
  ) then
    raise exception 'هذا الموعد لم يعد متاحًا، اختر وقتًا آخر'
      using errcode = 'invalid_parameter_value';
  end if;

  -- 5.4 بيانات العميل — الحد الأدنى
  if btrim(coalesce(p_full_name, '')) = '' or btrim(coalesce(p_phone, '')) = '' then
    raise exception 'الاسم ورقم الهاتف مطلوبان' using errcode = 'invalid_parameter_value';
  end if;

  /*
    5.5 مطابقة العميل — داخل **نفس الفرع** حصرًا (قاعدة معتمدة).
        ⚠️ البحث لا يتعدّى الفرع: البحث على مستوى المنشأة كان سيسمح لزائر
           بتخمين أن رقمًا ما مسجّل في فرع آخر. والاستجابة واحدة في الحالتين.
  */
  select c.id into v_customer
  from public.customers c
  where c.branch_id = p_branch
    and c.phone = btrim(p_phone)
    and c.deleted_at is null
  limit 1;

  if v_customer is null then
    insert into public.customers (organization_id, branch_id, full_name_ar, phone, email, status)
    values (v_org, p_branch, btrim(p_full_name), btrim(p_phone), nullif(btrim(coalesce(p_email, '')), ''), 'active')
    returning id into v_customer;
  end if;

  -- 5.6 الحالة الابتدائية ثابتة: `scheduled`. لا يرسلها العميل ولا يختارها.
  select s.id into v_status
  from public.appointment_statuses s
  where s.organization_id = v_org and s.key = 'scheduled';

  if v_status is null then
    raise exception 'حالة الحجز الابتدائية غير معرّفة في هذه المنشأة'
      using errcode = 'invalid_parameter_value';
  end if;

  /*
    5.7 الإدراج.
        ⚠️ duration_minutes و ends_at و reference_no و status_category غير
           مذكورة: محفّزات المرحلة 4 و 5 تكتبها من الخدمة والتسلسل. أي قيمة
           يرسلها العميل لا تصل إلى هنا أصلًا — لا يوجد لها معامل في التوقيع.
        ⚠️ قيد الاستبعاد هو الحكم النهائي على التعارض: الفحص في 5.3 يقلّل
           الأخطاء المعروضة، لكن السباق بين طلبين متزامنين يحسمه القيد وحده.
  */
  begin
    insert into public.appointments (
      organization_id, branch_id, customer_id, service_id, provider_id, status_id,
      scheduled_at, notes
    ) values (
      v_org, p_branch, v_customer, p_service, p_provider, v_status,
      p_slot, nullif(btrim(coalesce(p_notes, '')), '')
    )
    returning id, appointments.reference_no into v_appointment, v_reference;
  exception
    when exclusion_violation then
      raise exception 'هذا الموعد لم يعد متاحًا، اختر وقتًا آخر'
        using errcode = 'invalid_parameter_value';
  end;

  -- 5.8 تسجيل مفتاح عدم التكرار بعد النجاح
  if p_idempotency_hash is not null and btrim(p_idempotency_hash) <> '' then
    insert into public.booking_idempotency (key_hash, appointment_id, reference_no)
    values (p_idempotency_hash, v_appointment, v_reference)
    on conflict (key_hash) do nothing;
  end if;

  return query select v_reference, false;
end;
$$;

comment on function app.create_public_booking is
  'ينشئ حجزًا عامًا بعد إعادة فحص كل قواعد النشر والترابط والتوفّر في المحرّك. '
  '⚠️ لا يقبل مدة ولا نهاية ولا حالة ولا رقمًا مرجعيًا من العميل — تُشتق كلها.';

-- -----------------------------------------------------------------------------
-- 6) قراءة تأكيد الحجز
--
--    ⚠️ الرقم المرجعي متسلسل ⇒ قابل للتخمين. لذلك **لا تُرجع هذه الدالة أي
--       بيانات شخصية**: لا اسم عميل ولا هاتف ولا بريد ولا ملاحظات. ما تُرجعه
--       (فرع، خدمة، مقدّم، وقت) معلومات إشغال يمكن استنتاجها أصلًا من شاشة
--       الأوقات المتاحة، فتخمين الرقم لا يكشف شيئًا جديدًا عن أي شخص.
-- -----------------------------------------------------------------------------
create or replace function app.get_public_booking(p_reference text)
returns table (
  reference_no  text,
  scheduled_at  timestamptz,
  duration_minutes integer,
  branch_name   text,
  branch_city   text,
  branch_phone  text,
  service_name  text,
  provider_name text,
  status_key    text
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.reference_no,
         a.scheduled_at,
         a.duration_minutes,
         b.name_ar,
         b.city,
         b.phone,
         s.name_ar,
         sp.full_name_ar,
         st.key
  from public.appointments a
  join public.branches b            on b.id = a.branch_id
  join public.appointment_statuses st on st.id = a.status_id
  left join public.services s        on s.id = a.service_id
  left join public.service_providers sp on sp.id = a.provider_id
  where a.reference_no = p_reference
    and a.deleted_at is null
    -- لا يُكشف حجز في منشأة غير منشورة
    and app.is_org_published(a.organization_id)
    and b.is_public;
$$;

comment on function app.get_public_booking(text) is
  'بيانات تأكيد الحجز للزائر — بلا أي بيانات شخصية. الرقم المرجعي وحده لا يكشف عميلًا.';

-- -----------------------------------------------------------------------------
-- 7) أغلفة PostgREST لدور anon
--
--    ⚠️ مخطط `app` غير مكشوف عمدًا. نكشف ثلاثة أغلفة بلا منطق فقط.
--    ⚠️ `consume_rate_limit` **لا يُكشف**: يُستدعى من الخادم بجلسة الخدمة
--       الداخلية للتطبيق، وكشفه للزائر يسمح باستهلاك عدّادات الآخرين.
-- -----------------------------------------------------------------------------
create or replace function public.public_available_slots(
  p_branch uuid, p_service uuid, p_provider uuid, p_date date
)
returns table (slot_start timestamptz)
language sql
security invoker
set search_path = ''
as $$
  select * from app.public_available_slots(p_branch, p_service, p_provider, p_date);
$$;

create or replace function public.create_public_booking(
  p_branch uuid, p_service uuid, p_provider uuid, p_slot timestamptz,
  p_full_name text, p_phone text, p_email text, p_notes text, p_idempotency_hash text
)
returns table (reference_no text, reused boolean)
language sql
security invoker
set search_path = ''
as $$
  select * from app.create_public_booking(
    p_branch, p_service, p_provider, p_slot,
    p_full_name, p_phone, p_email, p_notes, p_idempotency_hash
  );
$$;

create or replace function public.get_public_booking(p_reference text)
returns table (
  reference_no text, scheduled_at timestamptz, duration_minutes integer,
  branch_name text, branch_city text, branch_phone text,
  service_name text, provider_name text, status_key text
)
language sql
security invoker
set search_path = ''
as $$
  select * from app.get_public_booking(p_reference);
$$;

revoke all on function public.public_available_slots(uuid, uuid, uuid, date) from public;
revoke all on function public.create_public_booking(uuid, uuid, uuid, timestamptz, text, text, text, text, text) from public;
revoke all on function public.get_public_booking(text) from public;

grant execute on function public.public_available_slots(uuid, uuid, uuid, date) to anon, authenticated;
grant execute on function public.create_public_booking(uuid, uuid, uuid, timestamptz, text, text, text, text, text) to anon, authenticated;
grant execute on function public.get_public_booking(text) to anon, authenticated;

grant execute on function app.public_available_slots(uuid, uuid, uuid, date) to anon, authenticated;
grant execute on function app.create_public_booking(uuid, uuid, uuid, timestamptz, text, text, text, text, text) to anon, authenticated;
grant execute on function app.get_public_booking(text) to anon, authenticated;
grant execute on function app.is_bookable_publicly(uuid, uuid, uuid) to anon, authenticated;

-- ⚠️ تأكيد صريح: الجداول الحسّاسة تبقى مغلقة تمامًا أمام anon. الحجز العام
--    يمر عبر الدوال أعلاه حصرًا ولا يفتح أي جدول.
revoke all on public.customers    from anon;
revoke all on public.appointments from anon;
revoke all on public.profiles     from anon;

-- -----------------------------------------------------------------------------
-- 8) خيارات نموذج الحجز — الخدمات ومقدّمو الخدمة
--
--    ⚠️ لماذا دالة لا استعلام مباشر: جداول الربط `provider_services` و
--       `provider_branches` **محجوبة عن anon** عمدًا (لا سياسة anon عليها).
--       بناء القائمة في التطبيق كان يتطلب فتحها للزائر — أي كشف من يعمل مع من
--       في كل الفروع، بما فيها غير المنشورة. الدالة تُرجع النتيجة النهائية
--       وحدها بلا فتح أي جدول.
--
--    ⚠️ الأعمدة المُعادة هي ما يظهر للزائر فقط: لا هاتف طبيب ولا بريده ولا
--       معرّف حسابه ولا ملاحظاته.
-- -----------------------------------------------------------------------------
create or replace function app.public_bookable_services(p_branch uuid)
returns table (id uuid, name_ar text, duration_minutes integer)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.name_ar, s.default_duration_minutes
  from public.services s
  join public.branches b on b.id = p_branch
  where s.organization_id = b.organization_id
    and s.status = 'active'
    and s.is_public
    and s.deleted_at is null
    and s.default_duration_minutes is not null
    and b.status = 'active'
    and b.is_public
    and b.deleted_at is null
    and app.is_org_published(b.organization_id)
    and (
      s.branch_id = b.id
      or (
        s.branch_id is null
        and exists (
          select 1 from public.branch_services bs
          where bs.branch_id = b.id and bs.service_id = s.id and bs.is_available
        )
      )
    )
  order by s.name_ar;
$$;

create or replace function app.public_bookable_providers(p_branch uuid, p_service uuid)
returns table (id uuid, full_name_ar text, specialty text)
language sql
stable
security definer
set search_path = ''
as $$
  select sp.id, sp.full_name_ar, sp.specialty
  from public.service_providers sp
  where app.is_bookable_publicly(p_branch, p_service, sp.id)
  order by sp.full_name_ar;
$$;

comment on function app.public_bookable_services(uuid) is
  'الخدمات القابلة للحجز في فرع منشور. لا تفتح جداول الربط للزائر.';
comment on function app.public_bookable_providers(uuid, uuid) is
  'مقدّمو الخدمة القابلون للحجز لخدمة في فرع. بلا هاتف ولا بريد ولا معرّف حساب.';

create or replace function public.public_bookable_services(p_branch uuid)
returns table (id uuid, name_ar text, duration_minutes integer)
language sql security invoker set search_path = ''
as $$ select * from app.public_bookable_services(p_branch); $$;

create or replace function public.public_bookable_providers(p_branch uuid, p_service uuid)
returns table (id uuid, full_name_ar text, specialty text)
language sql security invoker set search_path = ''
as $$ select * from app.public_bookable_providers(p_branch, p_service); $$;

revoke all on function public.public_bookable_services(uuid) from public;
revoke all on function public.public_bookable_providers(uuid, uuid) from public;
grant execute on function public.public_bookable_services(uuid) to anon, authenticated;
grant execute on function public.public_bookable_providers(uuid, uuid) to anon, authenticated;
grant execute on function app.public_bookable_services(uuid) to anon, authenticated;
grant execute on function app.public_bookable_providers(uuid, uuid) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 9) سحب المنحة الضمنية لـ PUBLIC
--
--    ⚠️ اكتشفه اختبار القائمة البيضاء، ولولاه لمرّ بصمت.
--       PostgreSQL يمنح EXECUTE لـ PUBLIC افتراضيًا على كل دالة جديدة، و
--       `grant … to anon` **لا يُلغي** تلك المنحة. النتيجة أن كل دور في
--       قاعدة البيانات — بما فيها أدوار مستقبلية غير مقصودة — كان يستطيع
--       استدعاء دوال الحجز. السحب الصريح هو المُلزِم، لا المنح الانتقائي.
-- -----------------------------------------------------------------------------
revoke all on function app.is_bookable_publicly(uuid, uuid, uuid) from public;
revoke all on function app.public_available_slots(uuid, uuid, uuid, date) from public;
revoke all on function app.create_public_booking(uuid, uuid, uuid, timestamptz, text, text, text, text, text) from public;
revoke all on function app.get_public_booking(text) from public;
revoke all on function app.public_bookable_services(uuid) from public;
revoke all on function app.public_bookable_providers(uuid, uuid) from public;

grant execute on function app.is_bookable_publicly(uuid, uuid, uuid) to anon, authenticated;
grant execute on function app.public_available_slots(uuid, uuid, uuid, date) to anon, authenticated;
grant execute on function app.create_public_booking(uuid, uuid, uuid, timestamptz, text, text, text, text, text) to anon, authenticated;
grant execute on function app.get_public_booking(text) to anon, authenticated;
grant execute on function app.public_bookable_services(uuid) to anon, authenticated;
grant execute on function app.public_bookable_providers(uuid, uuid) to anon, authenticated;
