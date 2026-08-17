/**
 * اختبارات لوحة الإدارة — المرحلة 5.
 *
 * التشغيل:  pnpm test:rls
 *
 * ما تُثبته: أن الأسطح الإدارية التي بُنيت في هذه المرحلة محكومة في **محرّك
 * قاعدة البيانات**: بيانات المنشأة، جداول الربط (فروع/خدمات مقدّم الخدمة،
 * وإتاحة الخدمة في الفروع)، وسجل التدقيق.
 *
 * ⚠️ لا ترحيل جديد في هذه المرحلة — كل ما هنا يختبر سياسات قائمة لم تكن
 *    مستعملة من أي واجهة قبل الآن.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { asUser, createTestDatabase, expectDenied } from './harness.mjs';
import { IDS, seedFixtures } from './fixtures.mjs';

let db;
let client;

const M = {
  service: '85000000-0000-4000-8000-000000000001',
  providerA1: '86000000-0000-4000-8000-000000000001',
};

before(async () => {
  db = await createTestDatabase({ port: 54334 });
  client = db.client;
  await seedFixtures(client);

  await client.query(
    `insert into public.services (id, organization_id, branch_id, code, name_ar, default_duration_minutes)
     values ($1, $2, null, 'SVC-ADM', 'خدمة إدارية', 30)`,
    [M.service, IDS.orgA],
  );
  await client.query(
    `insert into public.service_providers (id, organization_id, branch_id, code, full_name_ar)
     values ($1, $2, $3, 'DR-ADM', 'طبيب إداري')`,
    [M.providerA1, IDS.orgA, IDS.branchA1],
  );
});

after(async () => {
  await db?.close();
  setTimeout(() => process.exit(process.exitCode ?? 0), 250).unref();
});

/* ========================================================================== */
/*  1) بيانات المنشأة                                                          */
/* ========================================================================== */

describe('بيانات المنشأة', () => {
  it('صاحب الصلاحية يقرأ منشأته', async () => {
    const { rows } = await asUser(client, IDS.userOrgAdmin, 'select code from public.organizations');
    assert.deepEqual(rows.map((r) => r.code), ['ORG-A']);
  });

  it('لا يرى المستخدم منشأة غيره إطلاقًا', async () => {
    const { rows } = await asUser(
      client,
      IDS.userOrgB,
      'select code from public.organizations order by code',
    );
    assert.deepEqual(rows.map((r) => r.code), ['ORG-B'], 'تسريب بيانات منشأة أخرى');
  });

  it('مستخدم بلا صلاحية العرض لا يرى بيانات المنشأة', async () => {
    // دور الاستقبال لا يملك organizations.organization.view
    const { rows } = await asUser(client, IDS.userA1, 'select id from public.organizations');
    assert.equal(rows.length, 0);
  });

  it('التعديل يتطلب صلاحية — والاستقبال لا تملكها', async () => {
    const before = (
      await client.query('select name_ar from public.organizations where id = $1', [IDS.orgA])
    ).rows[0].name_ar;

    // RLS تُطابق صفر صفوف بصمت ⇒ القياس على القيمة لا على الخطأ
    await asUser(client, IDS.userA1, 'update public.organizations set name_ar = $2 where id = $1', [
      IDS.orgA,
      'مُختَرَقة',
    ]);

    const after = (
      await client.query('select name_ar from public.organizations where id = $1', [IDS.orgA])
    ).rows[0].name_ar;
    assert.equal(after, before, 'عُدّلت بيانات المنشأة بلا صلاحية');
  });

  it('صاحب الصلاحية يعدّل بنجاح', async () => {
    await asUser(
      client,
      IDS.userOrgAdmin,
      'update public.organizations set name_ar = $2 where id = $1',
      [IDS.orgA, 'شركة الاختبار أ المحدّثة'],
    );
    const { rows } = await client.query('select name_ar from public.organizations where id = $1', [
      IDS.orgA,
    ]);
    assert.equal(rows[0].name_ar, 'شركة الاختبار أ المحدّثة');
  });

  it('لا يمكن نقل المنشأة إلى معرّف آخر عبر التعديل', async () => {
    await asUser(client, IDS.userOrgAdmin, 'update public.organizations set id = $2 where id = $1', [
      IDS.orgA,
      IDS.orgB,
    ]).catch(() => {});
    const { rows } = await client.query('select count(*)::int as n from public.organizations');
    assert.equal(rows[0].n, 2, 'تغيّر عدد المنشآت');
  });

  it('لا يستطيع أحد إنشاء منشأة أو حذفها من التطبيق', async () => {
    const insertDenied = await expectDenied(
      client,
      IDS.userOrgAdmin,
      "insert into public.organizations (code, name_ar) values ('ORG-X', 'منشأة مقتحمة')",
    );
    assert.ok(insertDenied, 'أُنشئت منشأة من التطبيق');

    const deleteDenied = await expectDenied(
      client,
      IDS.userOrgAdmin,
      'delete from public.organizations where id = $1',
      [IDS.orgA],
    );
    assert.ok(deleteDenied, 'حُذفت منشأة من التطبيق');
  });
});

/* ========================================================================== */
/*  2) جداول الربط                                                             */
/* ========================================================================== */

describe('ربط مقدّم الخدمة بالفروع والخدمات', () => {
  it('صاحب صلاحية الإدارة يربط المقدّم بخدمة', async () => {
    await asUser(
      client,
      IDS.userOrgAdmin,
      'insert into public.provider_services (provider_id, service_id) values ($1, $2)',
      [M.providerA1, M.service],
    );
    const { rows } = await client.query(
      'select 1 from public.provider_services where provider_id = $1',
      [M.providerA1],
    );
    assert.equal(rows.length, 1);
  });

  it('مستخدم بلا صلاحية الإدارة لا يربط', async () => {
    const message = await expectDenied(
      client,
      IDS.userA1,
      'insert into public.provider_services (provider_id, service_id) values ($1, $2)',
      [M.providerA1, M.service],
    );
    assert.ok(message, 'رُبطت خدمة بلا صلاحية');
  });

  it('منشأة أخرى لا ترى روابط منشأتنا', async () => {
    const { rows } = await asUser(
      client,
      IDS.userOrgB,
      'select provider_id from public.provider_services',
    );
    assert.equal(rows.length, 0, 'تسريب روابط عبر المنشآت');
  });

  it('لا يُربط المقدّم بفرع خارج نطاق المُدير', async () => {
    // موظف الفرع أ-1 لا يصل الفرع أ-2
    const message = await expectDenied(
      client,
      IDS.userA1,
      'insert into public.provider_branches (provider_id, branch_id) values ($1, $2)',
      [M.providerA1, IDS.branchA2],
    );
    assert.ok(message, 'رُبط مقدّم بفرع خارج النطاق');
  });

  it('حذف الربط متاح لصاحب الصلاحية — والغياب يعني عدم التوفّر', async () => {
    await asUser(
      client,
      IDS.userOrgAdmin,
      'delete from public.provider_services where provider_id = $1',
      [M.providerA1],
    );
    const { rows } = await client.query(
      'select 1 from public.provider_services where provider_id = $1',
      [M.providerA1],
    );
    assert.equal(rows.length, 0, 'قرار معتمد: تفريغ القائمة يجعل المقدّم غير متاح');
  });

  it('إتاحة الخدمة في الفروع محكومة بالنطاق', async () => {
    await asUser(
      client,
      IDS.userOrgAdmin,
      'insert into public.branch_services (branch_id, service_id) values ($1, $2)',
      [IDS.branchA1, M.service],
    );
    const { rows } = await asUser(
      client,
      IDS.userA2,
      'select branch_id from public.branch_services',
    );
    assert.ok(
      rows.every((r) => r.branch_id === IDS.branchA2),
      'موظف الفرع أ-2 يرى إتاحات فرع آخر',
    );
  });
});

/* ========================================================================== */
/*  2.5) رؤية الفرع المُسنَد — انحدار لخلل المرحلة 5                            */
/* ========================================================================== */

describe('رؤية الفرع المُسنَد', () => {
  it('⭐ مستخدم بلا صلاحية عرض الفروع يرى فرعه المُسنَد', async () => {
    // userA1 دوره «استقبال» ولا يملك organizations.branches.view.
    // بدون هذه السياسة تظهر قائمة الفروع في نموذج الحجز فارغة فيستحيل الحجز.
    const { rows } = await asUser(client, IDS.userA1, 'select code from public.branches');
    assert.deepEqual(rows.map((r) => r.code), ['A1'], 'الاستقبال لا ترى فرعها ⇒ الحجز معطّل');
  });

  it('ولا يرى أي فرع آخر — السياسة لا توسّع النطاق', async () => {
    const { rows } = await asUser(client, IDS.userA1, 'select id from public.branches where id = $1', [
      IDS.branchA2,
    ]);
    assert.equal(rows.length, 0, 'تسريب فرع غير مُسنَد');
  });

  it('ولا يرى فروع منشأة أخرى', async () => {
    const { rows } = await asUser(client, IDS.userA1, 'select id from public.branches where id = $1', [
      IDS.branchB1,
    ]);
    assert.equal(rows.length, 0);
  });

  it('رؤية الفرع لا تمنح تعديله', async () => {
    const before = (
      await client.query('select name_ar from public.branches where id = $1', [IDS.branchA1])
    ).rows[0].name_ar;
    await asUser(client, IDS.userA1, 'update public.branches set name_ar = $2 where id = $1', [
      IDS.branchA1,
      'مُختَرَق',
    ]);
    const after = (
      await client.query('select name_ar from public.branches where id = $1', [IDS.branchA1])
    ).rows[0].name_ar;
    assert.equal(after, before, 'رؤية الفرع منحت تعديله');
  });

  it('صاحب نطاق المنشأة يبقى محكومًا بالصلاحية كما كان', async () => {
    const { rows } = await asUser(client, IDS.userOrgAdmin, 'select code from public.branches order by code');
    assert.deepEqual(rows.map((r) => r.code), ['A1', 'A2']);
  });
});

/* ========================================================================== */
/*  3) سجل التدقيق                                                             */
/* ========================================================================== */

describe('سجل التدقيق', () => {
  before(async () => {
    await client.query(
      `insert into public.audit_logs (organization_id, branch_id, user_id, action, module, entity_type)
       values
         ($1, $2, $3, 'branch.updated', 'organizations', 'branch'),
         ($1, null, $3, 'organization.updated', 'organizations', 'organization'),
         ($4, null, $5, 'branch.updated', 'organizations', 'branch')`,
      [IDS.orgA, IDS.branchA1, IDS.userOrgAdmin, IDS.orgB, IDS.userOrgB],
    );
  });

  it('صاحب صلاحية التدقيق يرى سجل منشأته فقط', async () => {
    const { rows } = await asUser(
      client,
      IDS.userOrgAdmin,
      'select organization_id from public.audit_logs',
    );
    assert.ok(rows.length >= 2);
    assert.ok(
      rows.every((r) => r.organization_id === IDS.orgA),
      'تسريب سجل تدقيق عبر المنشآت',
    );
  });

  it('مستخدم بلا صلاحية audit.view لا يرى شيئًا', async () => {
    const { rows } = await asUser(client, IDS.userA1, 'select id from public.audit_logs');
    assert.equal(rows.length, 0);
  });

  it('السجل غير قابل للتعديل ولا للحذف — حتى لمالك القاعدة', async () => {
    const updateDenied = await expectDenied(
      client,
      IDS.userOrgAdmin,
      "update public.audit_logs set action = 'مزوّر' where organization_id = $1",
      [IDS.orgA],
    );
    assert.ok(updateDenied, 'عُدّل سجل تدقيق');

    // المحفّز يمنع حتى بصلاحيات المالك، لا السياسة وحدها
    let ownerDenied = null;
    try {
      await client.query("update public.audit_logs set action = 'مزوّر'");
    } catch (error) {
      ownerDenied = error.message;
    }
    assert.ok(ownerDenied, 'المالك عدّل السجل ⇒ المحفّز غير فعّال');
  });

  it('لا يمكن كتابة سجل باسم مستخدم آخر', async () => {
    const message = await expectDenied(
      client,
      IDS.userA1,
      `insert into public.audit_logs (organization_id, user_id, action, module, entity_type)
       values ($1, $2, 'انتحال', 'identity', 'user')`,
      [IDS.orgA, IDS.userOrgAdmin],
    );
    assert.ok(message, 'كُتب سجل باسم مستخدم آخر');
  });
});

/* ========================================================================== */
/*  4) ساعات العمل من شاشة الفروع                                              */
/* ========================================================================== */

describe('ساعات العمل — صلاحيات الفروع', () => {
  it('تعديل الساعات يتطلب صلاحية تعديل الفروع', async () => {
    const message = await expectDenied(
      client,
      IDS.userA1,
      `insert into public.business_hours (organization_id, branch_id, weekday, opens_at, closes_at)
       values ($1, $2, 0, '08:00', '17:00')`,
      [IDS.orgA, IDS.branchA1],
    );
    assert.ok(message, 'عُدّلت ساعات العمل بلا صلاحية');
  });

  it('صاحب الصلاحية يضبط الساعات', async () => {
    await asUser(
      client,
      IDS.userOrgAdmin,
      `insert into public.business_hours (organization_id, branch_id, weekday, opens_at, closes_at)
       values ($1, $2, 0, '08:00', '17:00')`,
      [IDS.orgA, IDS.branchA1],
    );
    const { rows } = await client.query(
      'select weekday from public.business_hours where branch_id = $1',
      [IDS.branchA1],
    );
    assert.equal(rows.length, 1);
  });

  it('موظف الفرع أ-2 لا يرى ساعات الفرع أ-1', async () => {
    const { rows } = await asUser(
      client,
      IDS.userA2,
      'select branch_id from public.business_hours',
    );
    assert.ok(
      rows.every((r) => r.branch_id === IDS.branchA2),
      'تسريب ساعات عمل عبر الفروع',
    );
  });
});
