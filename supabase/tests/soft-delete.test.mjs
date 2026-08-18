/**
 * اختبارات الحذف الآمن — المرحلة 7.
 *
 * التشغيل:  pnpm test:rls
 *
 * ما تُثبته: أن الحذف يتطلب صلاحية **مستقلة** عن التعديل، وأنه يُرفض عند وجود
 * توابع نشطة، وأنه لا يعبر نطاق المنشأة — كل ذلك في محرّك قاعدة البيانات.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { asUser, createTestDatabase, expectDenied } from './harness.mjs';
import { IDS, seedFixtures } from './fixtures.mjs';

let db;
let client;

const D = {
  role: '92000000-0000-4000-8000-000000000001',
  deleter: '30000000-0000-4000-8000-000000000020',
  emptyBranch: '20000000-0000-4000-8000-000000000009',
  service: '93000000-0000-4000-8000-000000000001',
  department: '94000000-0000-4000-8000-000000000001',
};

const archive = (user, entity, id) =>
  asUser(client, user, 'select public.archive_record($1, $2)', [entity, id]);

const archiveDenied = async (user, entity, id) => {
  try {
    await archive(user, entity, id);
    return null;
  } catch (error) {
    return error.message;
  }
};

before(async () => {
  db = await createTestDatabase({ port: 54337 });
  client = db.client;
  await seedFixtures(client);

  // فرع فارغ تمامًا — الحالة الوحيدة التي يجوز فيها الحذف
  await client.query(
    `insert into public.branches (id, organization_id, code, name_ar)
     values ($1, $2, 'EMPTY', 'فرع فارغ')`,
    [D.emptyBranch, IDS.orgA],
  );

  await client.query(
    `insert into public.services (id, organization_id, branch_id, code, name_ar, default_duration_minutes)
     values ($1, $2, null, 'SVC-DEL', 'خدمة للحذف', 30)`,
    [D.service, IDS.orgA],
  );

  await client.query(
    `insert into public.departments (id, organization_id, branch_id, code, name_ar)
     values ($1, $2, $3, 'DEPT-DEL', 'قسم للحذف')`,
    [D.department, IDS.orgA, IDS.branchA1],
  );

  /*
    دور اختباري يملك صلاحيات الحذف كلها + التعديل.
    ⚠️ لا يُضاف إلى بذرة النظام: توزيع صلاحيات الحذف على الأدوار قرار عمل
       (P-16) لم يُعتمد، وإضافته ستكون اختراعًا.
  */
  await client.query(
    `insert into public.roles (id, organization_id, key, name_ar, is_system)
     values ($1, $2, 'test_deleter', 'مُصرَّح بالحذف (اختبار)', false)`,
    [D.role, IDS.orgA],
  );
  await client.query(
    `insert into public.role_permissions (role_id, permission_id)
     select $1, p.id from public.permissions p
      where p.key in (
        'organizations.branches.view','organizations.branches.update','organizations.branches.delete',
        'organizations.departments.view','organizations.departments.manage','organizations.departments.delete',
        'services.view','services.update','services.delete',
        'services.providers.view','services.providers.manage','services.providers.delete',
        'customers.view','customers.update','customers.delete',
        'appointments.view','appointments.update','appointments.delete'
      )`,
    [D.role],
  );

  await client.query('insert into auth.users (id, email) values ($1, $2)', [
    D.deleter,
    'deleter@test.local',
  ]);
  await client.query(
    `insert into public.profiles (id, organization_id, full_name_ar, status, default_branch_id)
     values ($1, $2, 'مُصرَّح بالحذف', 'active', $3)`,
    [D.deleter, IDS.orgA, IDS.branchA1],
  );
  await client.query('insert into public.user_roles (user_id, role_id, scope) values ($1, $2, $3)', [
    D.deleter,
    D.role,
    'organization',
  ]);

  /*
    ساعات عمل للفرع أ-1 على مدار الأسبوع.
    ⚠️ ضرورية لا تجميلية: محفّز التحقق في المرحلة 4 يرفض أي حجز خارج ساعات
       العمل، وبدونها يستحيل إنشاء الحجز **التابع** الذي تحتاجه اختبارات رفض
       الحذف — فيمرّ الحذف لسبب خاطئ.
  */
  for (let weekday = 0; weekday < 7; weekday += 1) {
    await client.query(
      `insert into public.business_hours (organization_id, branch_id, weekday, opens_at, closes_at)
       values ($1, $2, $3, '00:00', '23:59')`,
      [IDS.orgA, IDS.branchA1, weekday],
    );
  }
});

after(async () => {
  await db?.close();
  setTimeout(() => process.exit(process.exitCode ?? 0), 250).unref();
});

/* ========================================================================== */
/*  1) الحذف يتطلب صلاحية مستقلة عن التعديل                                    */
/* ========================================================================== */

describe('فصل صلاحية الحذف عن التعديل', () => {
  it('⭐ من يملك التعديل ولا يملك الحذف لا يستطيع ضبط deleted_at', async () => {
    /*
      هذه الثغرة التي أوجدها هذا الترحيل: كل الجداول تحمل `deleted_at` وسياسة
      UPDATE تسمح بضبطه لمن يملك صلاحية التعديل — أي «حذف بصلاحية تعديل».
      userA1 يملك customers.update ولا يملك customers.delete.
    */
    const message = await expectDenied(
      client,
      IDS.userA1,
      'update public.customers set deleted_at = now() where id = $1',
      [IDS.customerA1],
    );
    assert.ok(message, 'حُذف سجل بصلاحية تعديل فقط');
    assert.match(message ?? '', /صلاحية/);
  });

  it('التعديل العادي يبقى مسموحًا لمن يملك صلاحية التعديل', async () => {
    await asUser(client, IDS.userA1, 'update public.customers set full_name_ar = $2 where id = $1', [
      IDS.customerA1,
      'اسم محدّث',
    ]);
    const { rows } = await client.query('select full_name_ar from public.customers where id = $1', [
      IDS.customerA1,
    ]);
    assert.equal(rows[0].full_name_ar, 'اسم محدّث', 'الحارس منع تعديلًا مشروعًا');
  });

  it('صاحب صلاحية الحذف يستطيع ضبط deleted_at', async () => {
    await asUser(client, D.deleter, 'update public.services set deleted_at = now() where id = $1', [
      D.service,
    ]);
    const { rows } = await client.query('select deleted_at from public.services where id = $1', [
      D.service,
    ]);
    assert.ok(rows[0].deleted_at, 'لم يُحذف رغم امتلاك الصلاحية');
    await client.query('update public.services set deleted_at = null where id = $1', [D.service]);
  });
});

/* ========================================================================== */
/*  2) رفض الحذف عند وجود توابع                                                */
/* ========================================================================== */

describe('رفض الحذف عند وجود توابع', () => {
  it('فرع فيه عملاء وحجوزات لا يُحذف', async () => {
    const message = await archiveDenied(D.deleter, 'branch', IDS.branchA1);
    assert.match(message ?? '', /لا يمكن الحذف/);
    assert.match(message ?? '', /عملاء|حجوزات|موظفون/);
  });

  it('الرسالة تبيّن العدد بالاسم لا رمز قيد', async () => {
    const message = await archiveDenied(D.deleter, 'branch', IDS.branchA1);
    assert.ok(
      !/foreign key|constraint|violates/i.test(message ?? ''),
      'الرسالة تكشف تفاصيل المحرّك',
    );
    assert.match(message ?? '', /: \d+/, 'الرسالة لا تحتوي أعدادًا');
  });

  it('الفرع يبقى غير محذوف بعد الرفض', async () => {
    const { rows } = await client.query('select deleted_at from public.branches where id = $1', [
      IDS.branchA1,
    ]);
    assert.equal(rows[0].deleted_at, null);
  });

  it('عميل له حجوزات لا يُحذف', async () => {
    const { rows: statuses } = await client.query(
      "select id from public.appointment_statuses where organization_id = $1 and key = 'scheduled'",
      [IDS.orgA],
    );
    await client.query(
      `insert into public.appointments
         (organization_id, branch_id, customer_id, status_id, scheduled_at)
       values ($1, $2, $3, $4, now() + interval '1 day')`,
      [IDS.orgA, IDS.branchA1, IDS.customerA1, statuses[0].id],
    );

    const message = await archiveDenied(D.deleter, 'customer', IDS.customerA1);
    assert.match(message ?? '', /حجوزات/);
  });

  it('قسم فيه أقسام فرعية لا يُحذف', async () => {
    await client.query(
      `insert into public.departments (organization_id, branch_id, parent_id, code, name_ar)
       values ($1, $2, $3, 'DEPT-CHILD', 'قسم فرعي')`,
      [IDS.orgA, IDS.branchA1, D.department],
    );
    const message = await archiveDenied(D.deleter, 'department', D.department);
    assert.match(message ?? '', /أقسام فرعية/);
  });
});

/* ========================================================================== */
/*  3) الحذف الناجح                                                            */
/* ========================================================================== */

describe('الحذف الناجح', () => {
  it('فرع فارغ يُحذف بنجاح', async () => {
    await archive(D.deleter, 'branch', D.emptyBranch);
    const { rows } = await client.query('select deleted_at from public.branches where id = $1', [
      D.emptyBranch,
    ]);
    assert.ok(rows[0].deleted_at, 'لم يُحذف فرع فارغ');
  });

  it('⭐ الحذف ناعم — الصف باقٍ في الجدول', async () => {
    const { rows } = await client.query('select id, code from public.branches where id = $1', [
      D.emptyBranch,
    ]);
    assert.equal(rows.length, 1, 'الصف مُحي فعليًا ⇒ فقدان بيانات');
    assert.equal(rows[0].code, 'EMPTY');
  });

  it('المحذوف يختفي من قوائم المستخدمين', async () => {
    const { rows } = await asUser(
      client,
      D.deleter,
      'select code from public.branches where deleted_at is null order by code',
    );
    assert.ok(!rows.some((r) => r.code === 'EMPTY'), 'المحذوف ما زال يظهر');
  });

  it('خدمة بلا حجوزات تُحذف', async () => {
    await archive(D.deleter, 'service', D.service);
    const { rows } = await client.query('select deleted_at from public.services where id = $1', [
      D.service,
    ]);
    assert.ok(rows[0].deleted_at);
  });

  it('الحذف مرتين لا يُغيّر شيئًا ويُبلّغ بوضوح', async () => {
    const message = await archiveDenied(D.deleter, 'service', D.service);
    assert.match(message ?? '', /محذوف بالفعل|غير موجود/);
  });
});

/* ========================================================================== */
/*  4) النطاق والعزل                                                           */
/* ========================================================================== */

describe('نطاق الحذف', () => {
  it('لا يُحذف سجل من منشأة أخرى', async () => {
    const message = await archiveDenied(D.deleter, 'customer', IDS.customerB1);
    assert.ok(message, 'حُذف سجل من منشأة أخرى');

    const { rows } = await client.query('select deleted_at from public.customers where id = $1', [
      IDS.customerB1,
    ]);
    assert.equal(rows[0].deleted_at, null);
  });

  it('مستخدم بلا صلاحية حذف لا يستطيع الأرشفة', async () => {
    const message = await archiveDenied(IDS.userA1, 'customer', IDS.customerA2);
    assert.ok(message, 'أرشف مستخدم بلا صلاحية');
  });

  it('⭐ كيان غير معروف مرفوض — لا حقن عبر اسم الجدول', async () => {
    const message = await archiveDenied(
      D.deleter,
      'branches; drop table public.customers',
      IDS.branchA1,
    );
    assert.match(message ?? '', /كيان غير معروف/);

    const { rows } = await client.query(
      "select 1 from information_schema.tables where table_name = 'customers'",
    );
    assert.equal(rows.length, 1, 'جدول العملاء اختفى ⇒ حقن SQL');
  });

  it('anon لا يستطيع الأرشفة', async () => {
    await client.query('begin');
    let denied = false;
    try {
      await client.query('set local role anon');
      await client.query('select public.archive_record($1, $2)', ['customer', IDS.customerA1]);
    } catch {
      denied = true;
    }
    await client.query('rollback');
    assert.ok(denied, 'الزائر يستطيع حذف بيانات');
  });
});
