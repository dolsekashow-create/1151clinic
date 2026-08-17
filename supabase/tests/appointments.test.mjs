/**
 * اختبارات الحجز الداخلي — المرحلة 4.
 *
 * التشغيل:  pnpm test:rls
 *
 * ما تُثبته: أن قواعد الحجز مفروضة في **محرّك قاعدة البيانات** — التعارض،
 * ساعات العمل، تماسك الخدمة/المقدّم/الفرع، والعزل — فتصمد حتى لو استُدعي
 * PostgREST مباشرة بمفتاح Publishable متجاوزًا الواجهة بالكامل.
 *
 * ⚠️ ملف مستقل بقاعدة بيانات خاصة: هذه الاختبارات تكتب حجوزات، وخلطها
 *    باختبارات العزل يجعل ترتيب التنفيذ جزءًا من صحة النتيجة.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { asUser, createTestDatabase, expectDenied } from './harness.mjs';
import { IDS, seedFixtures } from './fixtures.mjs';

let db;
let client;

const A = {
  service: '80000000-0000-4000-8000-000000000001', // خدمة مشتركة 30 دقيقة
  serviceLong: '80000000-0000-4000-8000-000000000002', // خدمة 60 دقيقة
  serviceOther: '80000000-0000-4000-8000-000000000003', // خدمة لا يقدّمها المقدّم
  providerA1: '81000000-0000-4000-8000-000000000001', // مقدّم في الفرع A1
  providerA2: '81000000-0000-4000-8000-000000000002', // مقدّم في الفرع A2
  // ⚠️ الحالات لا تُنشأ هنا: محفّز `organizations_seed_defaults` يزرع الخمس
  //    المعتمدة عند إنشاء المنشأة. إنشاؤها في التركيبة صار تكرارًا يفشل.
  statusScheduled: null,
  statusCancelled: null,
};

/** الأحد القادم بتوقيت الرياض — يوم عمل ثابت في التركيبات. */
const SUNDAY = '2026-08-23'; // الأحد ⇒ extract(dow) = 0
/** بناء لحظة بتوقيت آسيا/الرياض (+03) بلا اعتماد على توقيت الجهاز. */
const at = (hhmm) => `${SUNDAY}T${hhmm}:00+03:00`;

before(async () => {
  db = await createTestDatabase({ port: 54333 });
  client = db.client;
  await seedFixtures(client);

  // --- حالات الحجز: الخمس المعتمدة مزروعة تلقائيًا مع إنشاء المنشأة ---
  const statusId = async (key) => {
    const { rows } = await client.query(
      'select id from public.appointment_statuses where organization_id = $1 and key = $2',
      [IDS.orgA, key],
    );
    if (!rows[0]) throw new Error(`حالة غير مزروعة: ${key}`);
    return rows[0].id;
  };
  A.statusScheduled = await statusId('scheduled');
  A.statusCancelled = await statusId('cancelled');

  // --- الخدمات ---
  await client.query(
    `insert into public.services (id, organization_id, branch_id, code, name_ar, default_duration_minutes) values
       ($1, $4, null, 'SVC-30',  'خدمة ثلاثين دقيقة', 30),
       ($2, $4, null, 'SVC-60',  'خدمة ستين دقيقة',   60),
       ($3, $4, null, 'SVC-OTH', 'خدمة أخرى',         30)`,
    [A.service, A.serviceLong, A.serviceOther, IDS.orgA],
  );
  await client.query(
    `insert into public.branch_services (branch_id, service_id) values
       ($1, $3), ($1, $4), ($1, $5), ($2, $3)`,
    [IDS.branchA1, IDS.branchA2, A.service, A.serviceLong, A.serviceOther],
  );

  // --- مقدّمو الخدمة: مربوطان بفرعين مختلفين ---
  await client.query(
    `insert into public.service_providers (id, organization_id, branch_id, code, full_name_ar) values
       ($1, $3, $4, 'DR-A1', 'طبيب فرع أ-1'),
       ($2, $3, $5, 'DR-A2', 'طبيب فرع أ-2')`,
    [A.providerA1, A.providerA2, IDS.orgA, IDS.branchA1, IDS.branchA2],
  );
  // المقدّم أ-1 يقدّم الخدمتين 30 و 60 — ولا يقدّم SVC-OTH عمدًا
  await client.query(
    `insert into public.provider_services (provider_id, service_id) values
       ($1, $2), ($1, $3), ($4, $2)`,
    [A.providerA1, A.service, A.serviceLong, A.providerA2],
  );

  // --- ساعات العمل: الأحد 08:00–17:00 لكلا الفرعين، والاثنين مغلق في A1 ---
  await client.query(
    `insert into public.business_hours (organization_id, branch_id, weekday, opens_at, closes_at) values
       ($1, $2, 0, '08:00', '17:00'),
       ($1, $3, 0, '08:00', '17:00')`,
    [IDS.orgA, IDS.branchA1, IDS.branchA2],
  );
  await client.query(
    `insert into public.business_hours (organization_id, branch_id, weekday, opens_at, closes_at, is_closed)
     values ($1, $2, 1, '00:00', '00:00', true)`,
    [IDS.orgA, IDS.branchA1],
  );

  // موظف الفرع أ-1 يحتاج صلاحيات الحجز — دور الاستقبال يحملها أصلًا
});

after(async () => {
  await db?.close();
  setTimeout(() => process.exit(process.exitCode ?? 0), 250).unref();
});

/** يبني نص إدراج حجز بجلسة مستخدم. */
const insertAppointment = (fields) => ({
  sql: `insert into public.appointments
          (organization_id, branch_id, customer_id, service_id, provider_id, status_id, scheduled_at)
        values ($1, $2, $3, $4, $5, $6, $7) returning id, duration_minutes, ends_at`,
  params: [
    IDS.orgA,
    fields.branch ?? IDS.branchA1,
    fields.customer ?? IDS.customerA1,
    fields.service ?? A.service,
    fields.provider === undefined ? A.providerA1 : fields.provider,
    fields.status ?? A.statusScheduled,
    fields.at,
  ],
});

const book = async (user, fields) => {
  const { sql, params } = insertAppointment(fields);
  return asUser(client, user, sql, params);
};

const bookDenied = async (user, fields) => {
  const { sql, params } = insertAppointment(fields);
  return expectDenied(client, user, sql, params);
};

/* ========================================================================== */
/*  1) الحجز الصحيح والمدة                                                     */
/* ========================================================================== */

describe('إنشاء الحجز والمدة', () => {
  it('حجز صحيح داخل ساعات العمل ينجح', async () => {
    const { rows } = await book(IDS.userA1, { at: at('09:00') });
    assert.equal(rows.length, 1);
  });

  it('المدة تأتي من services.default_duration_minutes لا من العميل', async () => {
    const { rows } = await book(IDS.userA1, { service: A.serviceLong, at: at('10:00') });
    assert.equal(rows[0].duration_minutes, 60, 'لم تُشتق المدة من الخدمة');
  });

  it('نهاية الموعد محسوبة صحيحًا من المدة', async () => {
    const { rows } = await book(IDS.userA1, { at: at('12:00') });
    const ends = new Date(rows[0].ends_at).toISOString();
    assert.equal(ends, new Date(at('12:30')).toISOString(), 'ends_at لا يطابق البداية + المدة');
  });

  it('محاولة فرض مدة مخالفة من العميل تُتجاهَل', async () => {
    const { rows } = await asUser(
      client,
      IDS.userA1,
      `insert into public.appointments
         (organization_id, branch_id, customer_id, service_id, provider_id, status_id,
          scheduled_at, duration_minutes, ends_at)
       values ($1, $2, $3, $4, $5, $6, $7, 5, $8) returning duration_minutes, ends_at`,
      [
        IDS.orgA,
        IDS.branchA1,
        IDS.customerA1,
        A.service,
        A.providerA1,
        A.statusScheduled,
        at('13:00'),
        at('23:00'),
      ],
    );
    assert.equal(rows[0].duration_minutes, 30, 'العميل فرض مدة مخالفة للخدمة');
    assert.equal(
      new Date(rows[0].ends_at).toISOString(),
      new Date(at('13:30')).toISOString(),
      'العميل فرض ends_at مزيّفًا',
    );
  });
});

/* ========================================================================== */
/*  2) منع التعارض                                                            */
/* ========================================================================== */

describe('منع التعارض', () => {
  it('حجز متداخل كليًا لنفس المقدّم مرفوض', async () => {
    const message = await bookDenied(IDS.userA1, { at: at('09:00'), customer: IDS.customerA1 });
    assert.ok(message, 'تم إنشاء حجزين متطابقين لنفس المقدّم');
  });

  it('تداخل جزئي مرفوض أيضًا', async () => {
    // 09:00–09:30 محجوز؛ محاولة 09:15 تتداخل 15 دقيقة
    const message = await bookDenied(IDS.userA1, { at: at('09:15') });
    assert.ok(message, 'تداخل جزئي مرّ');
  });

  it('حجز يبتلع حجزًا قائمًا مرفوض', async () => {
    // 10:00–11:00 محجوز (الخدمة الطويلة)؛ محاولة 30 دقيقة داخله
    const message = await bookDenied(IDS.userA1, { at: at('10:30') });
    assert.ok(message, 'حجز داخل حجز قائم مرّ');
  });

  it('⭐ التلاصق مسموح: موعد ينتهي 09:30 وآخر يبدأ 09:30', async () => {
    const { rows } = await book(IDS.userA1, { at: at('09:30') });
    assert.equal(rows.length, 1, 'المدى نصف المفتوح [) يجب أن يسمح بالتلاصق');
  });

  it('مقدّم آخر في نفس الوقت مسموح — القيد على المقدّم لا على الفرع', async () => {
    const { rows } = await asUser(
      client,
      IDS.userOrgAdmin,
      `insert into public.appointments
         (organization_id, branch_id, customer_id, service_id, provider_id, status_id, scheduled_at)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [IDS.orgA, IDS.branchA2, IDS.customerA2, A.service, A.providerA2, A.statusScheduled, at('09:00')],
    );
    assert.equal(rows.length, 1);
  });

  it('⭐ طلبان متزامنان: واحد فقط ينجح', async () => {
    /*
      اختبار تزامن حقيقي: معاملتان مفتوحتان في وقت واحد على اتصالين مستقلين.
      قيد الاستبعاد يُقيَّم على مستوى الفهرس، فالثانية تنتظر ثم تفشل عند
      إتمام الأولى. محفّز يقرأ-ثم-يكتب كان سيسمح لكليهما بالمرور.
    */
    const c1 = await db.newClient();
    const c2 = await db.newClient();
    const slot = at('15:00');

    const begin = async (c) => {
      await c.query('begin');
      await c.query('set local role authenticated');
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: IDS.userA1, role: 'authenticated' }),
      ]);
    };
    const insert = (c) =>
      c.query(
        `insert into public.appointments
           (organization_id, branch_id, customer_id, service_id, provider_id, status_id, scheduled_at)
         values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [IDS.orgA, IDS.branchA1, IDS.customerA1, A.service, A.providerA1, A.statusScheduled, slot],
      );

    await begin(c1);
    await begin(c2);

    // الأولى تُدرج ولا تُثبّت بعد
    await insert(c1);

    /*
      الثانية تُدرج نفس الفترة بينما الأولى ما زالت مفتوحة.
      ⚠️ لا نُنتظرها هنا: قيد الاستبعاد يجعلها **تتوقف** حتى تُحسم الأولى.
         انتظارها قبل تثبيت الأولى يُنتج تجمّدًا في الاختبار نفسه لا في النظام.
      هذا التوقف هو بالضبط الضمان المطلوب: لا نافذة يمر منها الطلبان معًا.
    */
    let secondError = null;
    const p2 = insert(c2).catch((e) => {
      secondError = e;
    });

    await c1.query('commit'); // الحسم ⇒ الثانية تستأنف وتفشل
    await p2;
    await c2.query('rollback');

    assert.ok(secondError, 'الطلب المتزامن الثاني نجح ⇒ لا ضمان ضد السباق');
    assert.match(secondError.message, /appointments_no_provider_overlap|conflicting key/i);

    const { rows } = await client.query(
      'select count(*)::int as n from public.appointments where provider_id = $1 and scheduled_at = $2',
      [A.providerA1, slot],
    );
    assert.equal(rows[0].n, 1, `عدد الحجوزات في نفس اللحظة = ${rows[0].n} (يجب 1)`);

    await c1.end();
    await c2.end();
  });

  it('الحجز الملغى يحرّر الوقت لغيره', async () => {
    await asUser(
      client,
      IDS.userA1,
      `insert into public.appointments
         (organization_id, branch_id, customer_id, service_id, provider_id, status_id, scheduled_at)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [IDS.orgA, IDS.branchA1, IDS.customerA1, A.service, A.providerA1, A.statusCancelled, at('16:00')],
    );
    const { rows } = await book(IDS.userA1, { at: at('16:00') });
    assert.equal(rows.length, 1, 'الوقت بقي محجوزًا بحجز ملغى');
  });
});

/* ========================================================================== */
/*  3) ساعات العمل                                                            */
/* ========================================================================== */

describe('ساعات العمل', () => {
  it('حجز قبل بداية الدوام مرفوض', async () => {
    const message = await bookDenied(IDS.userA1, { at: at('07:00') });
    assert.match(message ?? '', /خارج ساعات عمل/);
  });

  it('حجز يتجاوز نهاية الدوام مرفوض', async () => {
    // 16:45 + 30 دقيقة = 17:15 > 17:00
    const message = await bookDenied(IDS.userA1, { at: at('16:45') });
    assert.match(message ?? '', /خارج ساعات عمل/);
  });

  it('حجز ينتهي تمامًا مع نهاية الدوام مقبول', async () => {
    const { rows } = await book(IDS.userA1, { at: at('16:30') });
    assert.equal(rows.length, 1, 'الحد الأعلى يجب أن يكون شاملًا');
  });

  it('حجز في يوم مغلق مرفوض', async () => {
    const monday = '2026-08-24T09:00:00+03:00'; // الاثنين — مُعلَّم مغلقًا في A1
    const message = await bookDenied(IDS.userA1, { at: monday });
    assert.match(message ?? '', /خارج ساعات عمل/);
  });

  it('حجز في يوم بلا ساعات عمل معرّفة مرفوض', async () => {
    const tuesday = '2026-08-25T09:00:00+03:00'; // الثلاثاء — لا صف أصلًا
    const message = await bookDenied(IDS.userA1, { at: tuesday });
    assert.match(message ?? '', /خارج ساعات عمل/);
  });
});

/* ========================================================================== */
/*  4) تماسك الخدمة والمقدّم والفرع                                            */
/* ========================================================================== */

describe('تماسك الخدمة والمقدّم', () => {
  it('مقدّم لا يقدّم الخدمة المطلوبة مرفوض', async () => {
    const message = await bookDenied(IDS.userA1, { service: A.serviceOther, at: at('14:00') });
    assert.match(message ?? '', /لا يقدّم هذه الخدمة/);
  });

  it('مقدّم من فرع آخر مرفوض', async () => {
    const message = await bookDenied(IDS.userOrgAdmin, {
      branch: IDS.branchA1,
      provider: A.providerA2,
      at: at('14:00'),
    });
    assert.match(message ?? '', /لا يعمل في هذا الفرع/);
  });

  it('خدمة غير متاحة في الفرع مرفوضة', async () => {
    // SVC-60 غير مربوطة بالفرع A2
    const message = await bookDenied(IDS.userOrgAdmin, {
      branch: IDS.branchA2,
      customer: IDS.customerA2,
      provider: A.providerA2,
      service: A.serviceLong,
      at: at('14:00'),
    });
    assert.ok(message, 'خدمة غير مربوطة بالفرع قُبلت');
  });

  it('عميل من فرع آخر مرفوض', async () => {
    const message = await bookDenied(IDS.userOrgAdmin, {
      branch: IDS.branchA1,
      customer: IDS.customerA2,
      at: at('14:00'),
    });
    assert.match(message ?? '', /العميل غير موجود في هذا الفرع/);
  });
});

/* ========================================================================== */
/*  5) العزل والصلاحيات                                                       */
/* ========================================================================== */

describe('العزل والصلاحيات', () => {
  it('موظف الفرع أ-1 لا يحجز في الفرع أ-2 ولو زوّر branch_id', async () => {
    const message = await bookDenied(IDS.userA1, {
      branch: IDS.branchA2,
      customer: IDS.customerA2,
      provider: A.providerA2,
      at: at('11:00'),
    });
    assert.ok(message, 'تجاوز نطاق الفرع بتغيير branch_id في الطلب');
  });

  it('موظف الفرع أ-1 لا يرى حجوزات الفرع أ-2', async () => {
    const { rows } = await asUser(
      client,
      IDS.userA1,
      'select branch_id from public.appointments',
    );
    assert.ok(rows.length > 0, 'يجب أن يرى حجوزات فرعه');
    assert.ok(
      rows.every((r) => r.branch_id === IDS.branchA1),
      'تسريب حجوزات عبر الفروع',
    );
  });

  it('صاحب نطاق المنشأة يرى حجوزات الفرعين', async () => {
    const { rows } = await asUser(
      client,
      IDS.userOrgAdmin,
      'select distinct branch_id from public.appointments',
    );
    assert.equal(rows.length, 2);
  });

  it('مستخدم بلا صلاحية appointments.create لا يحجز', async () => {
    // userReadOnly دوره «موظف» — يملك appointments.view فقط
    const message = await bookDenied(IDS.userReadOnly, { at: at('14:00') });
    assert.ok(message, 'مستخدم بلا صلاحية أنشأ حجزًا');
  });

  it('مستخدم بلا صلاحية appointments.view لا يرى شيئًا', async () => {
    const { rows } = await asUser(client, IDS.userOrgB, 'select id from public.appointments');
    assert.equal(rows.length, 0, 'منشأة أخرى ترى حجوزاتنا');
  });

  it('المستخدم الموقوف لا يحجز ولا يرى', async () => {
    const message = await bookDenied(IDS.userSuspended, { at: at('14:30') });
    assert.ok(message);
    const { rows } = await asUser(client, IDS.userSuspended, 'select id from public.appointments');
    assert.equal(rows.length, 0);
  });
});

/* ========================================================================== */
/*  6) الأوقات المتاحة                                                        */
/* ========================================================================== */

describe('الأوقات المتاحة', () => {
  it('الخطوة تساوي مدة الخدمة', async () => {
    const { rows } = await asUser(
      client,
      IDS.userA2,
      'select slot_start from app.available_slots($1, $2, $3, $4::date) order by slot_start',
      [IDS.branchA2, A.service, A.providerA2, SUNDAY],
    );
    assert.ok(rows.length >= 2, 'لا توجد أوقات متاحة أصلًا');
    const gap = (new Date(rows[1].slot_start) - new Date(rows[0].slot_start)) / 60000;
    assert.equal(gap, 30, 'الخطوة لا تساوي مدة الخدمة');
  });

  it('لا يُعرض وقت محجوز', async () => {
    // المقدّم A2 محجوز 09:00–09:30
    const { rows } = await asUser(
      client,
      IDS.userA2,
      'select slot_start from app.available_slots($1, $2, $3, $4::date)',
      [IDS.branchA2, A.service, A.providerA2, SUNDAY],
    );
    const times = rows.map((r) => new Date(r.slot_start).toISOString());
    assert.ok(!times.includes(new Date(at('09:00')).toISOString()), 'وقت محجوز ظهر كمتاح');
    assert.ok(times.includes(new Date(at('09:30')).toISOString()), 'وقت شاغر لم يظهر');
  });

  it('كل الأوقات المعروضة تقع داخل ساعات العمل', async () => {
    const { rows } = await asUser(
      client,
      IDS.userA2,
      'select slot_start from app.available_slots($1, $2, $3, $4::date) order by slot_start',
      [IDS.branchA2, A.service, A.providerA2, SUNDAY],
    );
    const first = new Date(rows[0].slot_start).toISOString();
    const last = new Date(rows[rows.length - 1].slot_start).toISOString();
    assert.equal(first, new Date(at('08:00')).toISOString(), 'أول وقت ليس بداية الدوام');
    // آخر بداية ممكنة لخدمة 30 دقيقة تنتهي 17:00 هي 16:30
    assert.equal(last, new Date(at('16:30')).toISOString(), 'آخر وقت يتجاوز نهاية الدوام');
  });

  it('يوم مغلق لا يُنتج أي وقت', async () => {
    const { rows } = await asUser(
      client,
      IDS.userA1,
      'select slot_start from app.available_slots($1, $2, $3, $4::date)',
      [IDS.branchA1, A.service, A.providerA1, '2026-08-24'],
    );
    assert.equal(rows.length, 0);
  });

  it('لا تكشف الدالة أوقات فرع خارج نطاق المستخدم', async () => {
    const { rows } = await asUser(
      client,
      IDS.userA1,
      'select slot_start from app.available_slots($1, $2, $3, $4::date)',
      [IDS.branchA2, A.service, A.providerA2, SUNDAY],
    );
    assert.equal(rows.length, 0, 'تسريب أوقات فرع آخر');
  });

  it('كل وقت معروض قابل للحجز فعلًا — لا تناقض بين الشاشة والمحرّك', async () => {
    const { rows } = await asUser(
      client,
      IDS.userA2,
      'select slot_start from app.available_slots($1, $2, $3, $4::date) order by slot_start limit 1',
      [IDS.branchA2, A.service, A.providerA2, SUNDAY],
    );
    const { rows: inserted } = await asUser(
      client,
      IDS.userOrgAdmin,
      `insert into public.appointments
         (organization_id, branch_id, customer_id, service_id, provider_id, status_id, scheduled_at)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [
        IDS.orgA,
        IDS.branchA2,
        IDS.customerA2,
        A.service,
        A.providerA2,
        A.statusScheduled,
        rows[0].slot_start,
      ],
    );
    assert.equal(inserted.length, 1, 'وقت عرضته الدالة رفضه المحرّك');
  });
});

/* ========================================================================== */
/*  7) توفّر المقدّم للخدمة والفرع                                             */
/* ========================================================================== */

/* ========================================================================== */
/*  8) قرارات العمل المعتمدة 2026-08-17                                        */
/* ========================================================================== */

describe('الحالات المعتمدة والرقم المرجعي', () => {
  it('كل منشأة تُنشأ بالحالات الخمس المعتمدة تلقائيًا', async () => {
    const { rows } = await client.query(
      `select key, category from public.appointment_statuses
        where organization_id = $1 order by sort_order`,
      [IDS.orgA],
    );
    assert.deepEqual(
      rows.map((r) => r.key),
      ['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'],
    );
    assert.deepEqual(
      rows.map((r) => r.category),
      ['open', 'open', 'done', 'cancelled', 'cancelled'],
    );
  });

  it('منشأة جديدة تحصل على الحالات بلا بذر يدوي', async () => {
    await client.query(
      `insert into public.organizations (id, code, name_ar)
       values ('10000000-0000-4000-8000-000000000009', 'ORG-NEW', 'منشأة جديدة')`,
    );
    const { rows } = await client.query(
      'select count(*)::int as n from public.appointment_statuses where organization_id = $1',
      ['10000000-0000-4000-8000-000000000009'],
    );
    assert.equal(rows[0].n, 5, 'منشأة بلا حالات = يستحيل الحجز فيها');
  });

  it('الرقم المرجعي يُولَّد تلقائيًا وبصيغة قابلة للقراءة', async () => {
    const { rows } = await asUser(
      client,
      IDS.userA1,
      `insert into public.appointments
         (organization_id, branch_id, customer_id, service_id, provider_id, status_id, scheduled_at)
       values ($1, $2, $3, $4, $5, $6, $7) returning reference_no`,
      [IDS.orgA, IDS.branchA1, IDS.customerA1, A.service, A.providerA1, A.statusScheduled, at('11:00')],
    );
    assert.match(rows[0].reference_no, /^APT-\d{6}$/, `صيغة غير متوقعة: ${rows[0].reference_no}`);
  });

  it('الأرقام المرجعية فريدة ولا تتكرر', async () => {
    const { rows } = await asUser(
      client,
      IDS.userA1,
      `insert into public.appointments
         (organization_id, branch_id, customer_id, service_id, provider_id, status_id, scheduled_at)
       values ($1, $2, $3, $4, $5, $6, $7) returning reference_no`,
      [IDS.orgA, IDS.branchA1, IDS.customerA1, A.service, A.providerA1, A.statusScheduled, at('11:30')],
    );

    const { rows: all } = await client.query(
      'select reference_no from public.appointments where reference_no is not null',
    );
    const unique = new Set(all.map((r) => r.reference_no));
    assert.equal(unique.size, all.length, 'يوجد رقم مرجعي مكرر');
    assert.ok(rows[0].reference_no, 'لم يُولَّد رقم');
  });

  it('الرقم المُزوَّد صراحةً لا يُستبدَل — البذرة تحتفظ بأرقامها', async () => {
    const { rows } = await asUser(
      client,
      IDS.userA1,
      `insert into public.appointments
         (organization_id, branch_id, customer_id, service_id, provider_id, status_id,
          scheduled_at, reference_no)
       values ($1, $2, $3, $4, $5, $6, $7, 'CUSTOM-1') returning reference_no`,
      [IDS.orgA, IDS.branchA1, IDS.customerA1, A.service, A.providerA1, A.statusScheduled, at('12:30')],
    );
    assert.equal(rows[0].reference_no, 'CUSTOM-1');
  });

  it('الرقم قابل للبحث الجزئي', async () => {
    const { rows } = await asUser(
      client,
      IDS.userA1,
      "select id from public.appointments where reference_no ilike 'APT-%'",
    );
    assert.ok(rows.length >= 2, 'البحث بالبادئة لا يُرجع النتائج');
  });

  it('التسلسل غير قابل للاستهلاك من دور العميل', async () => {
    const message = await expectDenied(
      client,
      IDS.userA1,
      "select nextval('public.appointment_reference_seq')",
    );
    assert.ok(message, 'العميل يستطيع استهلاك أرقام بلا إنشاء حجز');
  });
});

describe('توفّر مقدّم الخدمة', () => {
  it('المقدّم لا يظهر لخدمة لا يقدّمها', async () => {
    const { rows } = await asUser(
      client,
      IDS.userA1,
      `select sp.id from public.service_providers sp
        join public.provider_services ps on ps.provider_id = sp.id and ps.is_available
       where ps.service_id = $1`,
      [A.serviceOther],
    );
    assert.equal(rows.length, 0, 'ظهر مقدّم لخدمة غير مربوطة به');
  });

  it('المقدّم يظهر للخدمة المربوطة به في فرعه', async () => {
    const { rows } = await asUser(
      client,
      IDS.userA1,
      `select sp.id from public.service_providers sp
        join public.provider_services ps on ps.provider_id = sp.id and ps.is_available
       where ps.service_id = $1 and sp.branch_id = $2`,
      [A.service, IDS.branchA1],
    );
    assert.deepEqual(rows.map((r) => r.id), [A.providerA1]);
  });

  it('مقدّم الفرع الآخر لا يظهر لموظف الفرع أ-1', async () => {
    const { rows } = await asUser(
      client,
      IDS.userA1,
      'select id from public.service_providers where id = $1',
      [A.providerA2],
    );
    assert.equal(rows.length, 0, 'تسريب مقدّم خدمة عبر الفروع');
  });
});
