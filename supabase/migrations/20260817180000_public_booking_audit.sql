-- =============================================================================
--  Migration : 20260817180000_public_booking_audit
--  Phase     : 6 (إتمام) — تدقيق الحجز العام
--
--  الثغرة المرصودة في تقرير المرحلة 6:
--    الحجز العام يُنشئ موعدًا وعميلًا ولا يترك أي أثر في `audit_logs`. سياسة
--    الإدراج تشترط `user_id = auth.uid()`، وهو `null` للزائر، فالإدراج يُرفض.
--    النتيجة أن أهم عملية يقوم بها طرف **غير مصادَق عليه** كانت الوحيدة بلا
--    سجل — وهي بالضبط ما يُسأل عنه لاحقًا («من أنشأ هذا الحجز ومتى؟»).
--
--  الحل: الكتابة من داخل `app.create_public_booking` نفسها (SECURITY DEFINER)،
--  فلا تُمسّ السياسة ولا يُفتح لدور `anon` أي طريق لكتابة سجلات بلا مستخدم.
--
--  ⚠️ ما لا يُسجَّل عمدًا: الاسم والهاتف والبريد والملاحظات. السجل يُقرأ من
--     شاشة التدقيق ومن سجلات التشخيص، وتحويله إلى مخزن بيانات شخصية مخالف
--     لتعليق الجدول نفسه. المعرّفات والرقم المرجعي تكفي للتتبع الكامل.
--  ⚠️ `user_id = null` هنا **معلومة لا نقص**: تعني «أنشأه زائر لا موظف»، وهو
--     تمييز يحتاجه المدقّق.
-- =============================================================================

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
  v_new_customer boolean := false;
begin
  -- 1) عدم التكرار أولًا: إعادة الإرسال يجب ألا تصل إلى أي فحص آخر
  if p_idempotency_hash is not null and btrim(p_idempotency_hash) <> '' then
    select bi.reference_no into v_existing
    from public.booking_idempotency bi
    where bi.key_hash = p_idempotency_hash;

    if found then
      return query select v_existing.reference_no, true;
      return;
    end if;
  end if;

  -- 2) البوابة العامة — النشر والنشاط والترابط كاملًا
  if not app.is_bookable_publicly(p_branch, p_service, p_provider) then
    raise exception 'الخدمة غير متاحة لدى مقدّم الخدمة في هذا الفرع'
      using errcode = 'invalid_parameter_value';
  end if;

  select b.organization_id into v_org from public.branches b where b.id = p_branch;

  -- 3) الوقت من الأوقات المتاحة فعلًا — يغطي ساعات العمل والتعارض والمحاذاة
  if not exists (
    select 1 from app.public_available_slots(p_branch, p_service, p_provider, (p_slot at time zone
      (select b.timezone from public.branches b where b.id = p_branch))::date) s
    where s.slot_start = p_slot
  ) then
    raise exception 'هذا الموعد لم يعد متاحًا، اختر وقتًا آخر'
      using errcode = 'invalid_parameter_value';
  end if;

  -- 4) الحد الأدنى من بيانات العميل
  if btrim(coalesce(p_full_name, '')) = '' or btrim(coalesce(p_phone, '')) = '' then
    raise exception 'الاسم ورقم الهاتف مطلوبان' using errcode = 'invalid_parameter_value';
  end if;

  -- 5) مطابقة العميل داخل نفس الفرع حصرًا (قاعدة معتمدة)
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
    v_new_customer := true;
  end if;

  -- 6) الحالة الابتدائية ثابتة: scheduled
  select s.id into v_status
  from public.appointment_statuses s
  where s.organization_id = v_org and s.key = 'scheduled';

  if v_status is null then
    raise exception 'حالة الحجز الابتدائية غير معرّفة في هذه المنشأة'
      using errcode = 'invalid_parameter_value';
  end if;

  -- 7) الإدراج — المدة والنهاية والرقم المرجعي تكتبها المحفّزات
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

  -- 8) مفتاح عدم التكرار بعد النجاح
  if p_idempotency_hash is not null and btrim(p_idempotency_hash) <> '' then
    insert into public.booking_idempotency (key_hash, appointment_id, reference_no)
    values (p_idempotency_hash, v_appointment, v_reference)
    on conflict (key_hash) do nothing;
  end if;

  /*
    9) التدقيق.
       ⚠️ بلا اسم ولا هاتف ولا بريد ولا ملاحظات — معرّفات ورقم مرجعي فقط.
       ⚠️ user_id = null يعني «زائر» لا «مجهول»: تمييز مقصود يحتاجه المدقّق.
       ⚠️ فشل التدقيق **لا يُفشل الحجز**: الموعد مثبَّت، وإلغاؤه لأن سطر سجل
          لم يُكتب خسارة صافية للعميل. يُسجَّل التحذير في سجلات الخادم.
  */
  begin
    insert into public.audit_logs (
      organization_id, branch_id, user_id, action, module, entity_type, entity_id, new_values
    ) values (
      v_org, p_branch, null, 'appointment.public_booked', 'appointments', 'appointment', v_appointment,
      jsonb_build_object(
        'referenceNo', v_reference,
        'serviceId', p_service,
        'providerId', p_provider,
        'scheduledAt', p_slot,
        'source', 'public_website',
        'newCustomer', v_new_customer
      )
    );
  exception
    when others then
      raise warning 'تعذّر تسجيل تدقيق الحجز العام %', v_reference;
  end;

  return query select v_reference, false;
end;
$$;

comment on function app.create_public_booking is
  'ينشئ حجزًا عامًا بعد إعادة فحص كل قواعد النشر والترابط والتوفّر في المحرّك، '
  'ويكتب سجل تدقيق بلا أي بيانات شخصية. '
  '⚠️ لا يقبل مدة ولا نهاية ولا حالة ولا رقمًا مرجعيًا من العميل — تُشتق كلها.';

-- إعادة المنح بعد إعادة التعريف (create or replace يُبقيها، والسحب تأكيد صريح)
revoke all on function app.create_public_booking(uuid, uuid, uuid, timestamptz, text, text, text, text, text) from public;
grant execute on function app.create_public_booking(uuid, uuid, uuid, timestamptz, text, text, text, text, text) to anon, authenticated;
