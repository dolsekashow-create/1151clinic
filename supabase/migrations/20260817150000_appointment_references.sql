-- =============================================================================
--  Migration : 20260817150000_appointment_references
--  Phase     : 4 (إتمام) — تثبيت قواعد العمل المعتمدة
--  Reference : اعتماد العميل 2026-08-17
--
--  هذا الترحيل ينفّذ قرارات **معتمدة صراحةً** من العميل، لا اجتهادًا:
--    1. غياب provider_services  = مقدّم الخدمة غير متاح للخدمة.   ← مُنفَّذ سابقًا
--    2. فرع بلا business_hours = مغلق ولا يقبل حجزًا.             ← مُنفَّذ سابقًا
--    3. الحجز الملغى يحرّر الفترة الزمنية.                        ← مُنفَّذ سابقًا
--    4. الحالات المعتمدة: scheduled · confirmed · completed · cancelled · no_show
--    5. رقم مرجعي فريد يُولَّد تلقائيًا، بصيغة بسيطة قابلة للبحث والعرض.
--
--  ⚠️ ما يزال **غير معتمد** ولم يُنفَّذ: قواعد الانتقال بين الحالات. أي حالة
--     إلى أي حالة مسموحة، ولا يوجد منطق يمنع «مكتمل ← مجدول». اعتماد قائمة
--     الحالات ليس اعتمادًا لانتقالاتها.
--  ⚠️ لا منطق مالي: لا سعر ولا دفع ولا عربون ولا فاتورة — ولا عمود واحد منها.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) الرقم المرجعي
--
--    الصيغة: APT-000001 — بادئة ثابتة + عدّاد بست خانات.
--
--    لماذا تسلسل (sequence) لا عدّ للصفوف ولا طابع زمني:
--      • `max(reference_no) + 1` سباق صريح: طلبان متزامنان يقرآن نفس الأقصى.
--      • الطابع الزمني يُنتج رقمًا طويلًا لا يُملى على الهاتف ولا يُقرأ.
--      • التسلسل ذرّي بطبيعته ولا يُحجَز داخل المعاملة، فلا يتعارض طلبان أبدًا.
--
--    ⚠️ الفجوات متوقّعة ومقبولة: التسلسل لا يتراجع عند فشل المعاملة. الرقم
--       معرّف للعرض والبحث لا عدّاد محاسبي — والتسلسل المتصل بلا فجوات يتطلب
--       قفلًا يُسلسل كل الحجوزات ويقتل التزامن.
--
--    ⚠️ تسلسل واحد للنظام لا لكل منشأة: التفرّد مضمون في الحالتين (القيد على
--       (organization_id, reference_no))، والتسلسل الواحد أبسط ولا يحتاج
--       إنشاء كائن جديد مع كل منشأة.
-- -----------------------------------------------------------------------------
create sequence if not exists public.appointment_reference_seq as bigint start with 1;

comment on sequence public.appointment_reference_seq is
  'عدّاد الرقم المرجعي للحجوزات. الفجوات متوقّعة — الرقم معرّف عرض لا عدّاد محاسبي.';

-- الصفوف القائمة تحمل APT-0001..APT-0048 (أربع خانات) والجديدة ست خانات،
-- فلا تصادم بين الصيغتين. نبدأ التسلسل بعد أعلى رقم قائم احتياطًا.
select setval(
  'public.appointment_reference_seq',
  greatest(
    1,
    coalesce(
      (select max(nullif(regexp_replace(reference_no, '\D', '', 'g'), '')::bigint)
         from public.appointments
        where reference_no is not null),
      0
    )
  )
);

create or replace function app.set_appointment_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- لا نستبدل رقمًا موجودًا: البذرة وعمليات الترحيل تُزوّد أرقامها بنفسها.
  if new.reference_no is null or btrim(new.reference_no) = '' then
    new.reference_no := 'APT-' || lpad(
      nextval('public.appointment_reference_seq')::text, 6, '0'
    );
  end if;
  return new;
end;
$$;

comment on function app.set_appointment_reference() is
  'يولّد رقمًا مرجعيًا فريدًا عند الإنشاء إن لم يُزوَّد. لا يعدّل رقمًا قائمًا.';

revoke all on function app.set_appointment_reference() from public, anon, authenticated;

-- محفّز منفصل عن app.validate_appointment عمدًا: التوليد يخص الإنشاء فقط،
-- بينما التحقق يعمل على الإنشاء والتعديل معًا.
drop trigger if exists appointments_set_reference on public.appointments;
create trigger appointments_set_reference
  before insert on public.appointments
  for each row execute function app.set_appointment_reference();

-- ⚠️ التسلسل يُستدعى من دالة SECURITY DEFINER فقط ⇒ لا حاجة لمنحه لأي دور عميل.
--    منحه كان سيسمح باستهلاك الأرقام من الخارج بلا إنشاء حجز.
revoke all on sequence public.appointment_reference_seq from public, anon, authenticated;

-- البحث بالرقم المرجعي عملية متكررة في الاستقبال
create index if not exists appointments_reference_idx
  on public.appointments (organization_id, reference_no);

-- -----------------------------------------------------------------------------
-- 2) الحالات المعتمدة
--
--    ⚠️ كانت تُزرع في سكربت التجربة فقط، فأي منشأة جديدة كانت تبدأ بلا حالات
--       ⇒ يستحيل إنشاء حجز فيها (status_id إلزامي). بعد اعتماد القائمة صارت
--       بيانات مرجعية للنظام لا بيانات تجربة، فمكانها الترحيل.
--
--    القائمة **مغلقة** باعتماد العميل: لا تُضاف حالات أخرى.
-- -----------------------------------------------------------------------------
create or replace function app.seed_appointment_statuses(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.appointment_statuses (organization_id, key, name_ar, category, sort_order)
  values
    (p_org, 'scheduled', 'مجدول',    'open',      1),
    (p_org, 'confirmed', 'مؤكد',     'open',      2),
    (p_org, 'completed', 'مكتمل',    'done',      3),
    (p_org, 'cancelled', 'ملغى',     'cancelled', 4),
    (p_org, 'no_show',   'لم يحضر',  'cancelled', 5)
  on conflict (organization_id, key) do nothing;
end;
$$;

comment on function app.seed_appointment_statuses(uuid) is
  'الحالات الخمس المعتمدة من العميل. ⚠️ لا قواعد انتقال — تلك ما تزال غير معتمدة.';

revoke all on function app.seed_appointment_statuses(uuid) from public, anon, authenticated;

-- كل منشأة قائمة
do $$
declare
  v_org uuid;
begin
  for v_org in select id from public.organizations loop
    perform app.seed_appointment_statuses(v_org);
  end loop;
end;
$$;

-- وكل منشأة تُنشأ لاحقًا — بدل تكرار البذر يدويًا وتذكّره
create or replace function app.on_organization_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.seed_appointment_statuses(new.id);
  return new;
end;
$$;

revoke all on function app.on_organization_created() from public, anon, authenticated;

drop trigger if exists organizations_seed_defaults on public.organizations;
create trigger organizations_seed_defaults
  after insert on public.organizations
  for each row execute function app.on_organization_created();
