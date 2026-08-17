/**
 * اختبارات الحجز العام — المرحلة 6.
 *
 * التشغيل:  pnpm test:rls
 *
 * ما تُثبته: أن دورة الحجز العام محكومة بالكامل في **محرّك قاعدة البيانات**،
 * وأن دور `anon` لا يملك أي طريق إلى الجداول التشغيلية، وأن كل قيمة حسّاسة
 * يرسلها المتصفح لا أثر لها.
 *
 * ⚠️ كل الاستدعاءات هنا بدور `anon` — نفس ظروف الزائر الحقيقي.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createTestDatabase, expectDenied } from './harness.mjs';
import { IDS, seedFixtures } from './fixtures.mjs';

let db;
let client;

const P = {
  service: '88000000-0000-4000-8000-000000000001', // منشورة · 30 دقيقة
  serviceHidden: '88000000-0000-4000-8000-000000000002', // غير منشورة
  serviceInactive: '88000000-0000-4000-8000-000000000003', // منشورة لكن غير نشطة
  provider: '89000000-0000-4000-8000-000000000001', // منشور · فرع A1
  providerHidden: '89000000-0000-4000-8000-000000000002', // غير منشور
  statusScheduled: null,
  statusCancelled: null,
};

const SUNDAY = '2027-03-07'; // أحد ⇒ dow = 0
const at = (hhmm) => `${SUNDAY}T${hhmm}:00+03:00`;

/** ينفّذ استعلامًا بدور `anon` — بلا أي هوية مستخدم. */
async function asAnon(sql, params = []) {
  await client.query('begin');
  try {
    await client.query('set local role anon');
    const result = await client.query(sql, params);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

async function anonDenied(sql, params = []) {
  try {
    await asAnon(sql, params);
    return null;
  } catch (error) {
    return error.message;
  }
}

const slots = async (branch, service, provider, date = SUNDAY) => {
  const { rows } = await asAnon(
    'select slot_start from public.public_available_slots($1, $2, $3, $4::date) order by slot_start',
    [branch, service, provider, date],
  );
  return rows.map((r) => new Date(r.slot_start).toISOString());
};

const book = (overrides = {}) => {
  const f = {
    branch: IDS.branchA1,
    service: P.service,
    provider: P.provider,
    slot: at('09:00'),
    name: 'زائر تجريبي',
    phone: '0500000001',
    email: null,
    notes: null,
    key: null,
    ...overrides,
  };
  return asAnon(
    'select * from public.create_public_booking($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [f.branch, f.service, f.provider, f.slot, f.name, f.phone, f.email, f.notes, f.key],
  );
};

const bookDenied = async (overrides = {}) => {
  try {
    await book(overrides);
    return null;
  } catch (error) {
    return error.message;
  }
};

before(async () => {
  db = await createTestDatabase({ port: 54335 });
  client = db.client;
  await seedFixtures(client);

  const statusId = async (key) => {
    const { rows } = await client.query(
      'select id from public.appointment_statuses where organization_id = $1 and key = $2',
      [IDS.orgA, key],
    );
    return rows[0].id;
  };
  P.statusScheduled = await statusId('scheduled');
  P.statusCancelled = await statusId('cancelled');

  // --- المنشأة والفرع منشوران ---
  await client.query('update public.organizations set is_public = true where id = $1', [IDS.orgA]);
  await client.query('update public.branches set is_public = true where id = $1', [IDS.branchA1]);
  // الفرع أ-2 يبقى غير منشور عمدًا — ضابط سلبي

  // --- الخدمات ---
  await client.query(
    `insert into public.services (id, organization_id, branch_id, code, name_ar, default_duration_minutes, is_public, status)
     values ($1, $4, null, 'PUB-30',  'خدمة عامة',        30, true,  'active'),
            ($2, $4, null, 'PUB-HID', 'خدمة غير منشورة',  30, false, 'active'),
            ($3, $4, null, 'PUB-INA', 'خدمة غير نشطة',    30, true,  'inactive')`,
    [P.service, P.serviceHidden, P.serviceInactive, IDS.orgA],
  );
  await client.query(
    `insert into public.branch_services (branch_id, service_id) values ($1, $2), ($1, $3), ($1, $4)`,
    [IDS.branchA1, P.service, P.serviceHidden, P.serviceInactive],
  );

  // --- مقدّمو الخدمة ---
  await client.query(
    `insert into public.service_providers (id, organization_id, branch_id, code, full_name_ar, specialty, phone, email, is_public)
     values ($1, $3, $4, 'PDR-1', 'د. علي العام', 'أسنان', '0550000001', 'dr@internal.test', true),
            ($2, $3, $4, 'PDR-2', 'د. خفي',       'جلدية', '0550000002', 'hidden@internal.test', false)`,
    [P.provider, P.providerHidden, IDS.orgA, IDS.branchA1],
  );
  await client.query(
    `insert into public.provider_services (provider_id, service_id) values
       ($1, $3), ($1, $4), ($1, $5), ($2, $3)`,
    [P.provider, P.providerHidden, P.service, P.serviceHidden, P.serviceInactive],
  );

  // --- ساعات العمل: الأحد 08:00–17:00 للفرع أ-1 فقط ---
  await client.query(
    `insert into public.business_hours (organization_id, branch_id, weekday, opens_at, closes_at)
     values ($1, $2, 0, '08:00', '17:00')`,
    [IDS.orgA, IDS.branchA1],
  );
});

after(async () => {
  await db?.close();
  setTimeout(() => process.exit(process.exitCode ?? 0), 250).unref();
});

/* ========================================================================== */
/*  1) عزل anon عن الجداول التشغيلية                                          */
/* ========================================================================== */

describe('anon لا يصل إلى أي جدول تشغيلي', () => {
  for (const table of ['customers', 'appointments', 'profiles', 'audit_logs', 'financial_transactions']) {
    it(`لا يقرأ ${table}`, async () => {
      const message = await anonDenied(`select * from public.${table} limit 1`);
      assert.ok(message, `anon قرأ ${table}`);
    });
  }

  it('لا يُدرج عميلًا مباشرة', async () => {
    const message = await anonDenied(
      `insert into public.customers (organization_id, branch_id, full_name_ar, phone)
       values ($1, $2, 'مقتحم', '0500009999')`,
      [IDS.orgA, IDS.branchA1],
    );
    assert.ok(message, 'anon أدرج عميلًا مباشرة');
  });

  it('لا يُدرج حجزًا مباشرة', async () => {
    const message = await anonDenied(
      `insert into public.appointments (organization_id, branch_id, customer_id, status_id, scheduled_at)
       values ($1, $2, $3, $4, now())`,
      [IDS.orgA, IDS.branchA1, IDS.customerA1, P.statusScheduled],
    );
    assert.ok(message, 'anon أدرج حجزًا مباشرة');
  });

  it('لا يُعدّل حجزًا قائمًا', async () => {
    const message = await anonDenied("update public.appointments set notes = 'مقتحم'");
    assert.ok(message);
  });

  it('لا يصل إلى جدول عدّادات الحد ولا مفاتيح عدم التكرار', async () => {
    assert.ok(await anonDenied('select * from public.rate_limit_counters'));
    assert.ok(await anonDenied('select * from public.booking_idempotency'));
  });

  it('لا يستدعي دالة الأوقات الخاصة بالموظفين', async () => {
    const message = await anonDenied(
      'select * from public.available_slots($1, $2, $3, $4::date)',
      [IDS.branchA1, P.service, P.provider, SUNDAY],
    );
    assert.ok(message, 'anon استدعى دالة الموظفين');
  });
});

/* ========================================================================== */
/*  2) الأوقات المتاحة للزائر                                                  */
/* ========================================================================== */

describe('الأوقات المتاحة العامة', () => {
  it('فرع منشور بخدمة ومقدّم منشورين ⇒ أوقات', async () => {
    const list = await slots(IDS.branchA1, P.service, P.provider);
    assert.ok(list.length > 0, 'لا أوقات رغم اكتمال الشروط');
  });

  it('الخطوة تساوي مدة الخدمة', async () => {
    const list = await slots(IDS.branchA1, P.service, P.provider);
    const gap = (new Date(list[1]) - new Date(list[0])) / 60000;
    assert.equal(gap, 30);
  });

  it('فرع غير منشور ⇒ صفر', async () => {
    const list = await slots(IDS.branchA2, P.service, P.provider);
    assert.equal(list.length, 0, 'كُشفت أوقات فرع غير منشور');
  });

  it('خدمة غير منشورة ⇒ صفر', async () => {
    const list = await slots(IDS.branchA1, P.serviceHidden, P.provider);
    assert.equal(list.length, 0);
  });

  it('خدمة غير نشطة ⇒ صفر', async () => {
    const list = await slots(IDS.branchA1, P.serviceInactive, P.provider);
    assert.equal(list.length, 0);
  });

  it('مقدّم غير منشور ⇒ صفر', async () => {
    const list = await slots(IDS.branchA1, P.service, P.providerHidden);
    assert.equal(list.length, 0);
  });

  it('مقدّم غير مربوط بالخدمة ⇒ صفر (قرار معتمد)', async () => {
    await client.query('delete from public.provider_services where provider_id = $1 and service_id = $2', [
      P.provider,
      P.service,
    ]);
    const list = await slots(IDS.branchA1, P.service, P.provider);
    assert.equal(list.length, 0, 'ظهرت أوقات لمقدّم لا يقدّم الخدمة');
    await client.query('insert into public.provider_services (provider_id, service_id) values ($1, $2)', [
      P.provider,
      P.service,
    ]);
  });

  it('يوم بلا ساعات عمل ⇒ صفر', async () => {
    const list = await slots(IDS.branchA1, P.service, P.provider, '2027-03-08'); // اثنين
    assert.equal(list.length, 0);
  });

  it('المنشأة غير منشورة تُخفي كل شيء', async () => {
    await client.query('update public.organizations set is_public = false where id = $1', [IDS.orgA]);
    const list = await slots(IDS.branchA1, P.service, P.provider);
    assert.equal(list.length, 0, 'بوابة المنشأة لا تعمل');
    await client.query('update public.organizations set is_public = true where id = $1', [IDS.orgA]);
  });

  it('الأوقات الماضية لا تُعرض', async () => {
    const list = await slots(IDS.branchA1, P.service, P.provider, '2020-03-01');
    assert.equal(list.length, 0);
  });
});

/* ========================================================================== */
/*  3) إنشاء الحجز                                                            */
/* ========================================================================== */

describe('إنشاء الحجز العام', () => {
  it('حجز صحيح ينجح ويُرجع رقمًا مرجعيًا بالصيغة المعتمدة', async () => {
    const { rows } = await book({ slot: at('09:00') });
    assert.match(rows[0].reference_no, /^APT-\d{6}$/);
    assert.equal(rows[0].reused, false);
  });

  it('الحجز يظهر للموظفين بالحالة scheduled والمدة من الخدمة', async () => {
    const { rows } = await client.query(
      `select a.duration_minutes, a.ends_at, a.scheduled_at, st.key as status
       from public.appointments a
       join public.appointment_statuses st on st.id = a.status_id
       where a.provider_id = $1 order by a.created_at desc limit 1`,
      [P.provider],
    );
    assert.equal(rows[0].status, 'scheduled', 'الحالة الابتدائية ليست scheduled');
    assert.equal(rows[0].duration_minutes, 30, 'المدة لم تُشتق من الخدمة');
    assert.equal(
      new Date(rows[0].ends_at).getTime() - new Date(rows[0].scheduled_at).getTime(),
      30 * 60000,
    );
  });

  it('العميل أُنشئ في الفرع الصحيح ببياناته فقط', async () => {
    const { rows } = await client.query(
      'select branch_id, full_name_ar, phone from public.customers where phone = $1',
      ['0500000001'],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].branch_id, IDS.branchA1);
  });

  it('نفس الهاتف في نفس الفرع يُعيد استخدام العميل ولا يُنشئ ثانيًا', async () => {
    const before = (
      await client.query('select count(*)::int as n from public.customers where phone = $1', [
        '0500000001',
      ])
    ).rows[0].n;

    await book({ slot: at('10:00'), name: 'اسم مختلف', phone: '0500000001' });

    const after = (
      await client.query('select count(*)::int as n from public.customers where phone = $1', [
        '0500000001',
      ])
    ).rows[0].n;
    assert.equal(after, before, 'أُنشئ عميل مكرر في نفس الفرع');
  });

  it('الوقت المحجوز يختفي من الأوقات المتاحة', async () => {
    const list = await slots(IDS.branchA1, P.service, P.provider);
    assert.ok(!list.includes(new Date(at('09:00')).toISOString()), 'وقت محجوز ما زال معروضًا');
  });

  it('حجز نفس الوقت مرتين مرفوض', async () => {
    const message = await bookDenied({ slot: at('09:00'), phone: '0500000002' });
    assert.match(message ?? '', /لم يعد متاحًا/);
  });

  it('التلاصق مسموح — الحد ليس أوسع من اللازم', async () => {
    const { rows } = await book({ slot: at('09:30'), phone: '0500000003' });
    assert.ok(rows[0].reference_no);
  });
});

/* ========================================================================== */
/*  4) رفض التزوير                                                            */
/* ========================================================================== */

describe('رفض القيم المزوّرة', () => {
  it('لا يمكن تمرير مدة ولا نهاية ولا حالة ولا رقم مرجعي — لا معامل لها أصلًا', async () => {
    const { rows } = await client.query(
      `select p.proname, pg_get_function_arguments(p.oid) as args
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'create_public_booking'`,
    );
    const args = rows[0].args;
    for (const forbidden of ['duration', 'ends_at', 'status', 'reference', 'organization']) {
      assert.ok(!args.includes(forbidden), `التوقيع يقبل ${forbidden} من العميل`);
    }
  });

  it('فرع مزوّر (غير منشور) مرفوض', async () => {
    const message = await bookDenied({ branch: IDS.branchA2, slot: at('11:00'), phone: '0500000004' });
    assert.ok(message, 'قُبل حجز في فرع غير منشور');
  });

  it('فرع من منشأة أخرى مرفوض', async () => {
    const message = await bookDenied({ branch: IDS.branchB1, slot: at('11:00'), phone: '0500000005' });
    assert.ok(message);
  });

  it('خدمة غير منشورة مرفوضة', async () => {
    const message = await bookDenied({ service: P.serviceHidden, slot: at('11:00'), phone: '0500000006' });
    assert.ok(message);
  });

  it('خدمة غير نشطة مرفوضة', async () => {
    const message = await bookDenied({ service: P.serviceInactive, slot: at('11:00'), phone: '0500000007' });
    assert.ok(message);
  });

  it('مقدّم غير منشور مرفوض', async () => {
    const message = await bookDenied({ provider: P.providerHidden, slot: at('11:00'), phone: '0500000008' });
    assert.ok(message);
  });

  it('مقدّم لا يقدّم الخدمة مرفوض', async () => {
    await client.query('delete from public.provider_services where provider_id = $1 and service_id = $2', [
      P.provider,
      P.service,
    ]);
    const message = await bookDenied({ slot: at('11:00'), phone: '0500000009' });
    assert.ok(message, 'قُبل حجز لمقدّم لا يقدّم الخدمة');
    await client.query('insert into public.provider_services (provider_id, service_id) values ($1, $2)', [
      P.provider,
      P.service,
    ]);
  });

  it('وقت خارج ساعات العمل مرفوض', async () => {
    const message = await bookDenied({ slot: at('06:00'), phone: '0500000010' });
    assert.match(message ?? '', /لم يعد متاحًا|خارج ساعات/);
  });

  it('وقت غير محاذٍ لمدة الخدمة مرفوض', async () => {
    const message = await bookDenied({ slot: at('09:07'), phone: '0500000011' });
    assert.ok(message, 'قُبل وقت خارج شبكة المواعيد');
  });

  it('يوم مغلق مرفوض', async () => {
    const message = await bookDenied({ slot: '2027-03-08T09:00:00+03:00', phone: '0500000012' });
    assert.ok(message);
  });

  it('اسم أو هاتف فارغ مرفوض', async () => {
    assert.ok(await bookDenied({ slot: at('12:00'), name: '   ', phone: '0500000013' }));
    assert.ok(await bookDenied({ slot: at('12:00'), phone: '  ' }));
  });
});

/* ========================================================================== */
/*  5) عدم التكرار (idempotency)                                              */
/* ========================================================================== */

describe('عدم التكرار', () => {
  const KEY = 'hash-of-client-key-0001';

  it('أول طلب بمفتاح ينشئ حجزًا', async () => {
    const { rows } = await book({ slot: at('13:00'), phone: '0500000020', key: KEY });
    assert.equal(rows[0].reused, false);
  });

  it('إعادة الإرسال بنفس المفتاح تُعيد نفس الحجز ولا تُنشئ ثانيًا', async () => {
    const before = (await client.query('select count(*)::int as n from public.appointments')).rows[0].n;
    const { rows } = await book({ slot: at('13:00'), phone: '0500000020', key: KEY });
    const after = (await client.query('select count(*)::int as n from public.appointments')).rows[0].n;

    assert.equal(rows[0].reused, true, 'لم يُعلَّم الطلب كمُعاد');
    assert.equal(after, before, 'أُنشئ حجز ثانٍ من نفس المفتاح');
  });

  it('المفتاح المُعاد يتجاوز كل الفحوص — حتى لو صار الوقت محجوزًا', async () => {
    // نفس المفتاح مع بيانات مختلفة: يجب أن يُرجع الحجز الأصلي لا أن يُعيد الفحص
    const { rows } = await book({ slot: at('14:00'), phone: '0500000021', key: KEY });
    assert.equal(rows[0].reused, true);
  });

  it('مفتاح مختلف ينشئ حجزًا جديدًا', async () => {
    const { rows } = await book({ slot: at('14:00'), phone: '0500000022', key: 'hash-different' });
    assert.equal(rows[0].reused, false);
  });
});

/* ========================================================================== */
/*  6) الإلغاء يحرّر الوقت                                                     */
/* ========================================================================== */

describe('الإلغاء يحرّر الوقت', () => {
  it('إلغاء حجز يُعيد وقته إلى المتاح ويقبل حجزًا جديدًا', async () => {
    const slot = at('15:00');
    await book({ slot, phone: '0500000030' });

    await client.query(
      `update public.appointments set status_id = $1
        where provider_id = $2 and scheduled_at = $3`,
      [P.statusCancelled, P.provider, slot],
    );

    const list = await slots(IDS.branchA1, P.service, P.provider);
    assert.ok(list.includes(new Date(slot).toISOString()), 'الوقت لم يتحرّر بعد الإلغاء');

    const { rows } = await book({ slot, phone: '0500000031' });
    assert.ok(rows[0].reference_no, 'تعذّر حجز الوقت المُفرَّج عنه');
  });
});

/* ========================================================================== */
/*  7) التزامن — الحكم النهائي لقيد قاعدة البيانات                             */
/* ========================================================================== */

describe('تدقيق الحجز العام', () => {
  it('الحجز العام يترك أثرًا في سجل التدقيق', async () => {
    const { rows: before } = await client.query(
      "select count(*)::int as n from public.audit_logs where action = 'appointment.public_booked'",
    );
    await book({ slot: at('12:00'), phone: '0500000060' });
    const { rows: after } = await client.query(
      "select count(*)::int as n from public.audit_logs where action = 'appointment.public_booked'",
    );
    assert.equal(after[0].n, before[0].n + 1, 'الحجز العام بلا سجل تدقيق');
  });

  it('السجل يميّز الزائر عن الموظف', async () => {
    const { rows } = await client.query(
      `select user_id, module, entity_type, new_values from public.audit_logs
        where action = 'appointment.public_booked' order by created_at desc limit 1`,
    );
    assert.equal(rows[0].user_id, null, 'user_id = null يعني زائر — تمييز مقصود');
    assert.equal(rows[0].module, 'appointments');
    assert.equal(rows[0].new_values.source, 'public_website');
  });

  it('⭐ السجل لا يحتوي أي بيانات شخصية', async () => {
    const { rows } = await client.query(
      `select new_values from public.audit_logs
        where action = 'appointment.public_booked' order by created_at desc limit 1`,
    );
    const serialized = JSON.stringify(rows[0].new_values);
    assert.ok(!serialized.includes('0500000060'), 'هاتف العميل مُسجَّل');
    assert.ok(!serialized.includes('زائر تجريبي'), 'اسم العميل مُسجَّل');
    for (const key of ['fullName', 'phone', 'email', 'notes', 'customerId']) {
      assert.ok(!Object.hasOwn(rows[0].new_values, key), `حقل شخصي مُسجَّل: ${key}`);
    }
  });

  it('السجل يظل غير قابل للتعديل', async () => {
    const message = await anonDenied(
      "update public.audit_logs set action = 'مزوّر' where action = 'appointment.public_booked'",
    );
    assert.ok(message);
  });
});

describe('التزامن', () => {
  it('⭐ طلبان متزامنان على نفس الوقت: واحد فقط ينجح', async () => {
    const c1 = await db.newClient();
    const c2 = await db.newClient();
    const slot = at('16:00');

    const call = (c, phone) =>
      c.query('select * from public.create_public_booking($1,$2,$3,$4,$5,$6,null,null,null)', [
        IDS.branchA1,
        P.service,
        P.provider,
        slot,
        'زائر متزامن',
        phone,
      ]);

    for (const c of [c1, c2]) {
      await c.query('begin');
      await c.query('set local role anon');
    }

    // الأولى تُدرج ولا تُثبّت؛ الثانية تتوقف على قيد الاستبعاد حتى تُحسم الأولى.
    // ⚠️ لا ننتظر الثانية قبل تثبيت الأولى وإلا تجمّد الاختبار نفسه لا النظام.
    await call(c1, '0500000040');

    let secondError = null;
    const p2 = call(c2, '0500000041').catch((e) => {
      secondError = e;
    });

    await c1.query('commit');
    await p2;
    await c2.query('rollback');

    assert.ok(secondError, 'الطلب المتزامن الثاني نجح ⇒ overbooking ممكن');

    const { rows } = await client.query(
      `select count(*)::int as n from public.appointments
        where provider_id = $1 and scheduled_at = $2 and deleted_at is null`,
      [P.provider, slot],
    );
    assert.equal(rows[0].n, 1, `عدد الحجوزات = ${rows[0].n} (يجب 1)`);

    await c1.end();
    await c2.end();
  });
});

/* ========================================================================== */
/*  8) صفحة التأكيد                                                           */
/* ========================================================================== */

describe('قراءة تأكيد الحجز', () => {
  let reference;

  before(async () => {
    const { rows } = await book({ slot: at('11:30'), phone: '0500000050', name: 'زائر التأكيد', email: 'v@test.local', notes: 'ملاحظة خاصة' });
    reference = rows[0].reference_no;
  });

  it('الرقم المرجعي يُرجع بيانات الموعد', async () => {
    const { rows } = await asAnon('select * from public.get_public_booking($1)', [reference]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].reference_no, reference);
    assert.equal(rows[0].branch_name, 'فرع أ-1');
    assert.equal(rows[0].status_key, 'scheduled');
  });

  it('⭐ لا يكشف أي بيانات شخصية للعميل', async () => {
    const { rows, fields } = await asAnon('select * from public.get_public_booking($1)', [reference]);
    const columns = fields.map((f) => f.name);
    for (const forbidden of ['customer', 'full_name', 'email', 'notes']) {
      assert.ok(
        !columns.some((c) => c.includes(forbidden) && c !== 'branch_name' && c !== 'service_name' && c !== 'provider_name'),
        `عمود مكشوف: ${forbidden}`,
      );
    }
    const serialized = JSON.stringify(rows[0]);
    assert.ok(!serialized.includes('زائر التأكيد'), 'اسم العميل مكشوف');
    assert.ok(!serialized.includes('v@test.local'), 'بريد العميل مكشوف');
    assert.ok(!serialized.includes('ملاحظة خاصة'), 'ملاحظات العميل مكشوفة');
    assert.ok(!serialized.includes('0500000050'), 'هاتف العميل مكشوف');
  });

  it('رقم غير موجود يُرجع لا شيء بلا تسريب', async () => {
    const { rows } = await asAnon('select * from public.get_public_booking($1)', ['APT-999999']);
    assert.equal(rows.length, 0);
  });

  it('حجز في منشأة غير منشورة لا يُقرأ', async () => {
    await client.query('update public.organizations set is_public = false where id = $1', [IDS.orgA]);
    const { rows } = await asAnon('select * from public.get_public_booking($1)', [reference]);
    assert.equal(rows.length, 0, 'كُشف حجز في منشأة غير منشورة');
    await client.query('update public.organizations set is_public = true where id = $1', [IDS.orgA]);
  });
});

/* ========================================================================== */
/*  9) الحد من المعدّل في قاعدة البيانات                                        */
/* ========================================================================== */

describe('الحد من المعدّل المشترك', () => {
  it('يسمح حتى الحد ثم يمنع', async () => {
    const key = 'test-bucket-a';
    const results = [];
    for (let i = 0; i < 4; i += 1) {
      const { rows } = await client.query('select * from app.consume_rate_limit($1, 3, 60)', [key]);
      results.push(rows[0].allowed);
    }
    assert.deepEqual(results, [true, true, true, false], 'الحد لا يُطبَّق بدقة');
  });

  it('يُرجع المتبقي ووقت إعادة الضبط', async () => {
    const { rows } = await client.query('select * from app.consume_rate_limit($1, 10, 60)', [
      'test-bucket-b',
    ]);
    assert.equal(rows[0].remaining, 9);
    assert.ok(new Date(rows[0].reset_at) > new Date());
  });

  it('مفاتيح مختلفة عدّادات مستقلة', async () => {
    await client.query('select * from app.consume_rate_limit($1, 1, 60)', ['test-bucket-c']);
    const { rows } = await client.query('select * from app.consume_rate_limit($1, 1, 60)', [
      'test-bucket-d',
    ]);
    assert.equal(rows[0].allowed, true, 'العدّادات مشتركة بين مفاتيح مختلفة');
  });

  it('anon لا يستطيع استهلاك عدّادات غيره', async () => {
    const message = await anonDenied("select * from app.consume_rate_limit('x', 1, 60)");
    assert.ok(message, 'anon يستطيع استهلاك العدّادات');
  });
});
