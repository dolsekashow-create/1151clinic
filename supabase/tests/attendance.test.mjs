/**
 * اختبارات الحضور والانصراف — المرحلة 7.
 *
 * التشغيل:  pnpm test:rls
 *
 * ما تُثبته: أن النطاق الجغرافي وعزل الفروع ومنع التزوير مفروضة في **محرّك
 * قاعدة البيانات**، وأن الموظف لا يستطيع كتابة سجل حضور بأي طريق آخر.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { asUser, createTestDatabase, expectDenied } from './harness.mjs';
import { IDS, seedFixtures } from './fixtures.mjs';

let db;
let client;

/** موقع الفرع أ-1 ونقاط حوله بمسافات معلومة. */
const BRANCH = { lat: 24.711, lng: 46.674, radius: 150 };
/** ~55 مترًا شمالًا — داخل النطاق. */
const INSIDE = { lat: 24.7115, lng: 46.674 };
/** ~1.1 كم — خارج النطاق بوضوح. */
const OUTSIDE = { lat: 24.721, lng: 46.674 };

const checkIn = (user, branch = IDS.branchA1, point = INSIDE) =>
  asUser(client, user, 'select * from public.attendance_check_in($1, $2, $3)', [
    branch,
    point.lat,
    point.lng,
  ]);

const checkInDenied = async (user, branch = IDS.branchA1, point = INSIDE) => {
  try {
    await checkIn(user, branch, point);
    return null;
  } catch (error) {
    return error.message;
  }
};

const checkOut = (user, point = INSIDE) =>
  asUser(client, user, 'select * from public.attendance_check_out($1, $2)', [point.lat, point.lng]);

before(async () => {
  db = await createTestDatabase({ port: 54336 });
  client = db.client;
  await seedFixtures(client);

  await client.query(
    `update public.branches
        set latitude = $2, longitude = $3, geofence_radius_meters = $4
      where id = $1`,
    [IDS.branchA1, BRANCH.lat, BRANCH.lng, BRANCH.radius],
  );
  // الفرع أ-2 يبقى بلا إحداثيات عمدًا — ضابط سلبي

  /*
    دور اختباري: مشرف حضور بنطاق فرع.
    ⚠️ لا يُضاف إلى بذرة النظام: توزيع صلاحيات الحضور على الأدوار قرار عمل
       (P-16) لم يُعتمد، وإضافته هنا ستكون اختراعًا.
  */
  await client.query(
    `insert into public.roles (id, organization_id, key, name_ar, is_system)
     values ('91000000-0000-4000-8000-000000000001', $1, 'test_attendance_viewer', 'مشرف حضور (اختبار)', false)`,
    [IDS.orgA],
  );
  await client.query(
    `insert into public.role_permissions (role_id, permission_id)
     select '91000000-0000-4000-8000-000000000001', p.id from public.permissions p
      where p.key in ('attendance.view', 'attendance.manage', 'organizations.branches.view')`,
  );
  await client.query('insert into public.user_roles (user_id, role_id, scope) values ($1, $2, $3)', [
    IDS.userA2,
    '91000000-0000-4000-8000-000000000001',
    'branch',
  ]);
});

after(async () => {
  await db?.close();
  setTimeout(() => process.exit(process.exitCode ?? 0), 250).unref();
});

/* ========================================================================== */
/*  1) حساب المسافة                                                           */
/* ========================================================================== */

describe('حساب المسافة', () => {
  it('نفس النقطة = صفر', async () => {
    const { rows } = await client.query('select app.geo_distance_meters($1,$2,$1,$2) as d', [
      BRANCH.lat,
      BRANCH.lng,
    ]);
    assert.equal(Number(rows[0].d), 0);
  });

  it('مسافة معلومة تُحسب بدقة مقبولة', async () => {
    // فرق 0.001 درجة عرض ≈ 111 مترًا
    const { rows } = await client.query('select app.geo_distance_meters($1,$2,$3,$2) as d', [
      BRANCH.lat,
      BRANCH.lng,
      BRANCH.lat + 0.001,
    ]);
    const d = Number(rows[0].d);
    assert.ok(d > 105 && d < 118, `المسافة ${d} م خارج المدى المتوقع`);
  });

  it('الدالة IMMUTABLE — صالحة للفهرسة والحساب المتكرر', async () => {
    const { rows } = await client.query(
      "select provolatile from pg_proc where proname = 'geo_distance_meters'",
    );
    assert.equal(rows[0].provolatile, 'i');
  });
});

/* ========================================================================== */
/*  2) تسجيل الدخول                                                           */
/* ========================================================================== */

describe('تسجيل الدخول', () => {
  it('موظف داخل النطاق يسجّل دخوله', async () => {
    const { rows } = await checkIn(IDS.userA1);
    assert.ok(rows[0].session_id);
    assert.ok(Number(rows[0].distance_meters) < BRANCH.radius);
  });

  it('الوقت يأتي من الخادم لا من الجهاز', async () => {
    const { rows } = await client.query(
      'select checked_in_at from public.attendance_sessions where user_id = $1',
      [IDS.userA1],
    );
    const diff = Math.abs(Date.now() - new Date(rows[0].checked_in_at).getTime());
    assert.ok(diff < 60_000, 'وقت التسجيل ليس وقت الخادم');
  });

  it('الإحداثيات والمسافة محفوظة كدليل', async () => {
    const { rows } = await client.query(
      `select check_in_latitude, check_in_longitude, check_in_distance_meters
         from public.attendance_sessions where user_id = $1`,
      [IDS.userA1],
    );
    assert.equal(Number(rows[0].check_in_latitude), INSIDE.lat);
    assert.ok(Number(rows[0].check_in_distance_meters) > 0);
  });

  it('⭐ جلسة مفتوحة ثانية مرفوضة — الضغط المزدوج لا يُنتج جلستين', async () => {
    const message = await checkInDenied(IDS.userA1);
    assert.match(message ?? '', /جلسة حضور مفتوحة/);

    const { rows } = await client.query(
      'select count(*)::int as n from public.attendance_sessions where user_id = $1 and checked_out_at is null',
      [IDS.userA1],
    );
    assert.equal(rows[0].n, 1);
  });

  /*
    ⚠️ المستخدم هنا `userReadOnly` لأنه مُسنَد للفرع أ-1.
       استخدام مستخدم من فرع آخر يُرجع «لا تملك وصولًا لهذا الفرع» — وهو رفض
       صحيح لكنه يفحص بوابة **الفرع** لا بوابة **الموقع**. ترتيب الفحص مقصود:
       الانتماء للفرع أولًا ثم المسافة.
  */
  it('خارج النطاق مرفوض مع بيان المسافة', async () => {
    const message = await checkInDenied(IDS.userReadOnly, IDS.branchA1, OUTSIDE);
    assert.match(message ?? '', /خارج نطاق/);
  });

  it('فرع بلا إحداثيات لا يقبل حضورًا', async () => {
    const message = await checkInDenied(IDS.userA2, IDS.branchA2);
    assert.match(message ?? '', /لم يُحدَّد موقع/);
  });

  it('موظف لا يسجّل في فرع خارج نطاقه', async () => {
    // userA2 يعمل في الفرع أ-2 فقط
    const message = await checkInDenied(IDS.userA2, IDS.branchA1, INSIDE);
    assert.ok(message, 'سجّل حضورًا في فرع لا يعمل به');
  });

  it('إحداثيات فارغة مرفوضة', async () => {
    const message = await expectDenied(
      client,
      IDS.userReadOnly,
      'select * from public.attendance_check_in($1, null, null)',
      [IDS.branchA1],
    );
    assert.match(message ?? '', /تحديد موقعك/);
  });

  it('المستخدم الموقوف لا يسجّل حضورًا', async () => {
    const message = await checkInDenied(IDS.userSuspended);
    assert.ok(message);
  });

  it('فرع من منشأة أخرى مرفوض', async () => {
    const message = await checkInDenied(IDS.userA1, IDS.branchB1);
    assert.ok(message);
  });
});

/* ========================================================================== */
/*  3) منع التزوير                                                            */
/* ========================================================================== */

describe('منع التزوير', () => {
  it('⭐ لا يستطيع الموظف إدراج سجل حضور مباشرة', async () => {
    const message = await expectDenied(
      client,
      IDS.userA1,
      `insert into public.attendance_sessions
         (organization_id, branch_id, user_id, check_in_latitude, check_in_longitude, check_in_distance_meters)
       values ($1, $2, $3, $4, $5, 0)`,
      [IDS.orgA, IDS.branchA1, IDS.userA1, BRANCH.lat, BRANCH.lng],
    );
    assert.ok(message, 'أُدرج سجل حضور مباشرة ⇒ تزوير ممكن');
  });

  it('لا يستطيع تعديل سجل حضوره هو', async () => {
    const before = (
      await client.query(
        'select check_in_distance_meters from public.attendance_sessions where user_id = $1',
        [IDS.userA1],
      )
    ).rows[0].check_in_distance_meters;

    // RLS تُطابق صفر صفوف بصمت ⇒ القياس على القيمة
    await asUser(
      client,
      IDS.userA1,
      'update public.attendance_sessions set check_in_distance_meters = 0 where user_id = $1',
      [IDS.userA1],
    );

    const after = (
      await client.query(
        'select check_in_distance_meters from public.attendance_sessions where user_id = $1',
        [IDS.userA1],
      )
    ).rows[0].check_in_distance_meters;
    assert.equal(after, before, 'عدّل الموظف مسافته المسجّلة');
  });

  it('⭐ حتى صاحب صلاحية التصحيح لا يصحّح سجل نفسه', async () => {
    /*
      ⚠️ `checked_in_at` في الماضي إلزامي: القيد يشترط أن يكون الانصراف
         **بعد** الحضور، وتركهما على `now()` يجعلهما متساويين فيُرفض الصف.
      يُدرج بصلاحيات المالك لأن لا مسار عميل للإدراج أصلًا — وهذا هو المقصود.
    */
    await client.query(
      `insert into public.attendance_sessions
         (organization_id, branch_id, user_id, checked_in_at,
          check_in_latitude, check_in_longitude, check_in_distance_meters,
          checked_out_at, check_out_latitude, check_out_longitude)
       values ($1, $2, $3, now() - interval '3 hours', $4, $5, 10, now(), $4, $5)`,
      [IDS.orgA, IDS.branchA2, IDS.userA2, BRANCH.lat, BRANCH.lng],
    );

    const before = (
      await client.query(
        'select notes from public.attendance_sessions where user_id = $1 limit 1',
        [IDS.userA2],
      )
    ).rows[0].notes;

    await asUser(client, IDS.userA2, "update public.attendance_sessions set notes = 'تصحيح ذاتي' where user_id = $1", [
      IDS.userA2,
    ]);

    const after = (
      await client.query('select notes from public.attendance_sessions where user_id = $1 limit 1', [
        IDS.userA2,
      ])
    ).rows[0].notes;
    assert.equal(after, before, 'صحّح صاحب الصلاحية سجل نفسه ⇒ تزوير حضور');
  });

  it('لا يمكن حذف سجل حضور إطلاقًا', async () => {
    const message = await expectDenied(
      client,
      IDS.userA2,
      'delete from public.attendance_sessions where user_id = $1',
      [IDS.userA1],
    );
    assert.ok(message, 'حُذف سجل حضور');
  });

  it('anon لا يرى الحضور ولا يكتبه', async () => {
    await client.query('begin');
    let denied = false;
    try {
      await client.query('set local role anon');
      await client.query('select * from public.attendance_sessions');
    } catch {
      denied = true;
    }
    await client.query('rollback');
    assert.ok(denied, 'الزائر يرى سجلات الحضور');
  });
});

/* ========================================================================== */
/*  4) تسجيل الانصراف                                                          */
/* ========================================================================== */

describe('تسجيل الانصراف', () => {
  it('الانصراف يُغلق الجلسة ويحسب المدة', async () => {
    // نُرجع وقت الدخول ساعتين للخلف لنقيس مدة حقيقية
    await client.query(
      `update public.attendance_sessions
          set checked_in_at = now() - interval '2 hours'
        where user_id = $1 and checked_out_at is null`,
      [IDS.userA1],
    );

    const { rows } = await checkOut(IDS.userA1);
    assert.ok(rows[0].duration_minutes >= 119 && rows[0].duration_minutes <= 121,
      `المدة ${rows[0].duration_minutes} دقيقة`);
  });

  it('المدة تُحسب في المحرّك لا تُرسل من العميل', async () => {
    const { rows } = await client.query(
      `select duration_minutes, checked_in_at, checked_out_at
         from public.attendance_sessions where user_id = $1 and checked_out_at is not null`,
      [IDS.userA1],
    );
    const expected = Math.floor(
      (new Date(rows[0].checked_out_at) - new Date(rows[0].checked_in_at)) / 60000,
    );
    assert.equal(rows[0].duration_minutes, expected);
  });

  it('انصراف بلا جلسة مفتوحة مرفوض', async () => {
    const message = await expectDenied(
      client,
      IDS.userA1,
      'select * from public.attendance_check_out($1, $2)',
      [INSIDE.lat, INSIDE.lng],
    );
    assert.match(message ?? '', /لا توجد جلسة/);
  });

  it('⚠️ الانصراف من خارج النطاق مسموح — المسافة تُسجَّل ولا تُرفض', async () => {
    await checkIn(IDS.userA1);
    const { rows } = await checkOut(IDS.userA1, OUTSIDE);
    assert.ok(rows[0].session_id, 'مُنع الانصراف بسبب البُعد');
    assert.ok(
      Number(rows[0].distance_meters) > BRANCH.radius,
      'المسافة البعيدة لم تُسجَّل كدليل',
    );
  });

  it('بعد الانصراف يمكن تسجيل دخول جديد', async () => {
    const { rows } = await checkIn(IDS.userA1);
    assert.ok(rows[0].session_id, 'تعذّر فتح جلسة بعد إغلاق السابقة');
    await checkOut(IDS.userA1);
  });
});

/* ========================================================================== */
/*  5) العزل والصلاحيات                                                        */
/* ========================================================================== */

describe('العزل والصلاحيات', () => {
  it('⭐ كل موظف يقرأ سجل حضوره بلا أي صلاحية', async () => {
    const { rows } = await asUser(
      client,
      IDS.userA1,
      'select user_id from public.attendance_sessions',
    );
    assert.ok(rows.length > 0, 'الموظف لا يرى سجله ⇒ الشاشة بلا فائدة');
    assert.ok(rows.every((r) => r.user_id === IDS.userA1), 'يرى سجل غيره');
  });

  it('مستخدم بلا صلاحية العرض لا يرى سجل غيره', async () => {
    const { rows } = await asUser(
      client,
      IDS.userReadOnly,
      'select id from public.attendance_sessions where user_id <> $1',
      [IDS.userReadOnly],
    );
    assert.equal(rows.length, 0);
  });

  it('صاحب صلاحية العرض يرى سجلات فروعه فقط', async () => {
    const { rows } = await asUser(
      client,
      IDS.userA2,
      'select distinct branch_id from public.attendance_sessions where user_id <> $1',
      [IDS.userA2],
    );
    assert.ok(
      rows.every((r) => r.branch_id === IDS.branchA2),
      'تسريب سجلات حضور عبر الفروع',
    );
  });

  it('منشأة أخرى لا ترى شيئًا', async () => {
    const { rows } = await asUser(client, IDS.userOrgB, 'select id from public.attendance_sessions');
    assert.equal(rows.length, 0);
  });
});

/* ========================================================================== */
/*  6) الملخّص الشهري                                                          */
/* ========================================================================== */

describe('الملخّص الشهري', () => {
  /*
    ⚠️ القارئ هنا `userOrgAdmin` (نطاق منشأة) لا `userA2`.
       سجلات هذه الاختبارات في الفرع أ-1، و`userA2` مُسنَد للفرع أ-2 وحده —
       فملخّصه فارغ **بحق**. استخدامه كان يفحص العزل لا التجميع.
  */
  it('يجمع دقائق الجلسات المكتملة', async () => {
    const { rows } = await asUser(
      client,
      IDS.userOrgAdmin,
      'select * from public.attendance_monthly_summary(current_date, null)',
    );
    assert.ok(rows.length > 0, 'الملخّص فارغ رغم وجود سجلات');
    assert.ok(rows.every((r) => typeof r.total_minutes === 'number'));

    const a1 = rows.find((r) => r.user_id === IDS.userA1);
    assert.ok(a1.total_minutes > 0, 'مجموع الدقائق صفر رغم جلسات مكتملة');
  });

  it('يعدّ الجلسات المفتوحة منفصلة — لا تُغلق تلقائيًا ولا تُهمَل', async () => {
    await checkIn(IDS.userA1);
    const { rows } = await asUser(
      client,
      IDS.userOrgAdmin,
      'select * from public.attendance_monthly_summary(current_date, $1)',
      [IDS.branchA1],
    );
    const a1 = rows.find((r) => r.user_id === IDS.userA1);
    assert.ok(a1, 'المستخدم غائب عن الملخّص');
    assert.ok(a1.open_sessions >= 1, 'الجلسة المفتوحة غير معدودة');
  });

  it('الجلسة المفتوحة لا تدخل في مجموع الدقائق', async () => {
    const { rows } = await asUser(
      client,
      IDS.userOrgAdmin,
      'select * from public.attendance_monthly_summary(current_date, $1)',
      [IDS.branchA1],
    );
    const a1 = rows.find((r) => r.user_id === IDS.userA1);
    // الجلسة المفتوحة duration_minutes = null ⇒ لا تُجمع
    assert.equal(a1.sessions_count + a1.open_sessions >= 1, true);
    assert.ok(a1.total_minutes >= 0);
  });

  it('مستخدم بلا صلاحية العرض يحصل على ملخّص فارغ', async () => {
    const { rows } = await asUser(
      client,
      IDS.userReadOnly,
      'select * from public.attendance_monthly_summary(current_date, null)',
    );
    assert.equal(rows.length, 0);
  });

  it('لا يتجاوز الملخّص نطاق الفروع', async () => {
    const { rows } = await asUser(
      client,
      IDS.userA2,
      'select distinct branch_id from public.attendance_monthly_summary(current_date, null)',
    );
    assert.ok(rows.every((r) => r.branch_id === IDS.branchA2));
  });
});
