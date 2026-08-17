/**
 * اختبارات إدارة المستخدمين — المرحلة 3.
 *
 * التشغيل:  pnpm test:rls
 *
 * ما تُثبته: أن التجهيز ذري، وأن كل مسارات تصعيد الصلاحيات مغلقة في **محرّك
 * قاعدة البيانات** لا في طبقة التطبيق. كل اختبار ينفّذ بدور `authenticated`،
 * أي بنفس ظروف نداء PostgREST مباشر بمفتاح Publishable.
 *
 * ⚠️ ملف مستقل عن rls.test.mjs بقاعدة بيانات خاصة به: هذه الاختبارات تكتب
 *    (تُنشئ مستخدمين، تُوقفهم) وخلطها بقاعدة اختبارات العزل يجعل ترتيب
 *    التنفيذ جزءًا من صحة النتيجة.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { asUser, createTestDatabase, expectDenied } from './harness.mjs';
import { IDS, seedFixtures } from './fixtures.mjs';

let db;
let client;

/** معرّفات خاصة بهذا الملف — لا تتقاطع مع نطاق fixtures. */
const P3 = {
  branchAdmin: '30000000-0000-4000-8000-000000000010', // مدير مستخدمين بنطاق فرع A1
  created: '30000000-0000-4000-8000-000000000011', // يُنشئه مدير المنشأة
  createdByBranch: '30000000-0000-4000-8000-000000000012', // يُنشئه مدير الفرع
  puppet: '30000000-0000-4000-8000-000000000013', // هدف محاولات التصعيد
  orphan: '30000000-0000-4000-8000-000000000014', // هدف اختبار الذرية
  testRole: '90000000-0000-4000-8000-000000000001',
};

let receptionRole;
let companyAdminRole;

before(async () => {
  // ⚠️ منفذ مختلف عن rls.test.mjs (54329) وعن مولّد الأنواع (54331):
  //    مجلد بيانات المُحرِّك مشتق من المنفذ، والتصادم يُفشل التشغيل المتوازي.
  db = await createTestDatabase({ port: 54332 });
  client = db.client;
  await seedFixtures(client);

  const roleId = async (key) => {
    const { rows } = await client.query(
      'select id from public.roles where key = $1 and organization_id is null',
      [key],
    );
    if (!rows[0]) throw new Error(`دور غير موجود: ${key}`);
    return rows[0].id;
  };
  receptionRole = await roleId('reception');
  companyAdminRole = await roleId('company_admin');

  /*
    دور اختباري محلي: مدير مستخدمين على مستوى فرع.

    ⚠️ لا يُضاف إلى بذرة النظام. صلاحيات branch_manager الحقيقية قرار عمل لم
       يُعتمد بعد (P-16)، وإضافة صلاحيات إدارة مستخدمين إليه ستكون اختراعًا
       لقاعدة عمل. الدور موجود لأجل الاختبار وحده.

    يحمل كل صلاحيات reception — شرط منح الدور أن تكون صلاحيات الدور الممنوح
    مجموعة فرعية من صلاحيات المانح — مضافًا إليها صلاحيات إدارة المستخدمين،
    وبلا أي صلاحية حساسة أخرى.
  */
  await client.query(
    `insert into public.roles (id, organization_id, key, name_ar, is_system)
     values ($1, $2, 'test_branch_user_admin', 'مدير مستخدمين فرع (اختبار)', false)`,
    [P3.testRole, IDS.orgA],
  );
  await client.query(
    `insert into public.role_permissions (role_id, permission_id)
     select $1, p.id from public.permissions p
      where p.key in (
        'customers.view','customers.create','customers.update',
        'services.view','services.providers.view',
        'appointments.view','appointments.create','appointments.update','appointments.cancel',
        'finance.shifts.open','notifications.send',
        'identity.users.view','identity.users.create','identity.users.update',
        'identity.roles.view','identity.roles.manage','identity.branches.assign',
        'organizations.branches.view'
      )`,
    [P3.testRole],
  );

  await client.query('insert into auth.users (id, email) values ($1, $2)', [
    P3.branchAdmin,
    'branchadmin@test.local',
  ]);
  await client.query(
    `insert into public.profiles (id, organization_id, full_name_ar, status, default_branch_id)
     values ($1, $2, 'مدير مستخدمي فرع أ-1', 'active', $3)`,
    [P3.branchAdmin, IDS.orgA, IDS.branchA1],
  );
  await client.query('insert into public.user_roles (user_id, role_id, scope) values ($1, $2, $3)', [
    P3.branchAdmin,
    P3.testRole,
    'branch',
  ]);
  await client.query(
    'insert into public.user_branches (user_id, branch_id, is_default) values ($1, $2, true)',
    [P3.branchAdmin, IDS.branchA1],
  );

  // حسابات المصادقة جاهزة مسبقًا: إنشاء auth.users مسؤولية Auth Admin API
  // في التطبيق، وهذه الاختبارات تغطّي الجانب التنظيمي بعده.
  for (const [id, email] of [
    [P3.created, 'created@test.local'],
    [P3.createdByBranch, 'created2@test.local'],
    [P3.puppet, 'puppet@test.local'],
    [P3.orphan, 'orphan@test.local'],
  ]) {
    await client.query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
  }
});

after(async () => {
  await db?.close();
  setTimeout(() => process.exit(process.exitCode ?? 0), 250).unref();
});

/* ========================================================================== */
/*  1) التجهيز الذري                                                          */
/* ========================================================================== */

describe('التجهيز الذري للمستخدم', () => {
  it('مدير المنشأة يُنشئ مستخدمًا: profile + user_roles + user_branches بنداء واحد', async () => {
    await asUser(
      client,
      IDS.userOrgAdmin,
      `select app.provision_user(
         p_user_id => $1, p_full_name_ar => 'موظف استقبال جديد',
         p_role_id => $2, p_scope => 'branch', p_branch_ids => array[$3]::uuid[],
         p_phone => '0500000099', p_job_title => 'استقبال')`,
      [P3.created, receptionRole, IDS.branchA2],
    );

    const { rows } = await client.query(
      `select organization_id, phone, status, default_branch_id, created_by
         from public.profiles where id = $1`,
      [P3.created],
    );
    assert.equal(rows.length, 1, 'لم يُنشأ الملف');
    assert.equal(rows[0].organization_id, IDS.orgA);
    assert.equal(rows[0].status, 'active');
    assert.equal(rows[0].phone, '0500000099');
    assert.equal(rows[0].default_branch_id, IDS.branchA2, 'الفرع الافتراضي يُشتق من الفرع المُسند');
    assert.equal(rows[0].created_by, IDS.userOrgAdmin, 'أثر الإنشاء يُنسب للمُنشئ لا للنظام');
  });

  it('تعيين الدور صحيح ومطابق للنطاق المطلوب', async () => {
    const { rows } = await client.query(
      'select role_id, scope from public.user_roles where user_id = $1',
      [P3.created],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].role_id, receptionRole);
    assert.equal(rows[0].scope, 'branch');
  });

  it('تعيين الفرع صحيح مع علامة الفرع الافتراضي', async () => {
    const { rows } = await client.query(
      'select branch_id, is_default from public.user_branches where user_id = $1',
      [P3.created],
    );
    assert.deepEqual(rows, [{ branch_id: IDS.branchA2, is_default: true }]);
  });

  it('المستخدم الجديد يدخل بصلاحيات دوره فقط وفرعه فقط', async () => {
    const { rows: seen } = await asUser(client, P3.created, 'select branch_id from public.customers');
    assert.deepEqual(
      seen.map((r) => r.branch_id),
      [IDS.branchA2],
      'المستخدم الجديد يجب أن يرى فرعه المُسند فقط',
    );

    // reception لا تملك finance.view ⇒ لا حركات مالية
    const { rows: finance } = await asUser(
      client,
      P3.created,
      'select id from public.financial_transactions',
    );
    assert.equal(finance.length, 0, 'ظهرت بيانات تتطلب صلاحية غير ممنوحة');

    const { rows: scope } = await asUser(client, P3.created, 'select app.has_org_scope() as v');
    assert.equal(scope[0].v, false, 'مستخدم بنطاق فرع ظهر بنطاق منشأة');
  });

  it('الذرية: فشل التحقق لا يترك ملفًا ولا دورًا معلّقًا', async () => {
    const message = await expectDenied(
      client,
      IDS.userOrgAdmin,
      `select app.provision_user(
         p_user_id => $1, p_full_name_ar => 'مستخدم فاشل',
         p_role_id => $2, p_scope => 'branch', p_branch_ids => array[$3]::uuid[])`,
      // فرع تابع للمنشأة ب ⇒ يجب أن يُرفض
      [P3.orphan, receptionRole, IDS.branchB1],
    );
    assert.ok(message, 'إسناد فرع من منشأة أخرى نجح');

    const { rows } = await client.query('select 1 from public.profiles where id = $1', [P3.orphan]);
    assert.equal(rows.length, 0, 'بقي ملف معلّق بعد الفشل ⇒ العملية ليست ذرية');
    const { rows: roles } = await client.query('select 1 from public.user_roles where user_id = $1', [
      P3.orphan,
    ]);
    assert.equal(roles.length, 0);
  });

  it('نطاق فرع بلا فروع مرفوض — لا يُنشأ مستخدم بلا وصول', async () => {
    const message = await expectDenied(
      client,
      IDS.userOrgAdmin,
      `select app.provision_user(
         p_user_id => $1, p_full_name_ar => 'بلا فرع',
         p_role_id => $2, p_scope => 'branch', p_branch_ids => array[]::uuid[])`,
      [P3.orphan, receptionRole],
    );
    assert.match(message ?? '', /فرعًا واحدًا على الأقل/);
  });

  it('مستخدم بلا صلاحية إنشاء لا يستطيع التجهيز', async () => {
    const message = await expectDenied(
      client,
      IDS.userA1,
      `select app.provision_user(
         p_user_id => $1, p_full_name_ar => 'محاولة بلا صلاحية',
         p_role_id => $2, p_scope => 'branch', p_branch_ids => array[$3]::uuid[])`,
      [P3.orphan, receptionRole, IDS.branchA1],
    );
    assert.match(message ?? '', /identity\.users\.create/);
  });
});

/* ========================================================================== */
/*  2) منع تصعيد الصلاحيات                                                    */
/* ========================================================================== */

describe('منع تصعيد الصلاحيات', () => {
  before(async () => {
    // هدف داخل فرع مدير الفرع، ليُفصل «الهدف خارج نطاقي» عن «الدور أعلى مني»
    await client.query(
      `insert into public.profiles (id, organization_id, full_name_ar, status, default_branch_id)
       values ($1, $2, 'حساب صوري', 'active', $3)`,
      [P3.puppet, IDS.orgA, IDS.branchA1],
    );
    await client.query(
      'insert into public.user_branches (user_id, branch_id, is_default) values ($1, $2, true)',
      [P3.puppet, IDS.branchA1],
    );
  });

  it('لا يُسند المستخدم دورًا لنفسه', async () => {
    const message = await expectDenied(
      client,
      P3.branchAdmin,
      'insert into public.user_roles (user_id, role_id, scope) values ($1, $2, $3)',
      [P3.branchAdmin, companyAdminRole, 'branch'],
    );
    assert.ok(message, 'التصعيد الذاتي نجح');
  });

  it('مدير فرع لا يمنح دورًا يحتوي صلاحيات لا يملكها — ولو لحساب داخل فرعه', async () => {
    const message = await expectDenied(
      client,
      P3.branchAdmin,
      'insert into public.user_roles (user_id, role_id, scope) values ($1, $2, $3)',
      [P3.puppet, companyAdminRole, 'branch'],
    );
    assert.ok(message, 'منح company_admin من مدير فرع نجح ⇒ تصعيد صلاحيات');

    const { rows } = await client.query(
      'select 1 from public.user_roles where user_id = $1 and role_id = $2',
      [P3.puppet, companyAdminRole],
    );
    assert.equal(rows.length, 0, 'الصف أُدرج فعليًا رغم رسالة الرفض');
  });

  it('نفس المنع يسري على مسار التجهيز الذري لا على PostgREST وحده', async () => {
    const message = await expectDenied(
      client,
      P3.branchAdmin,
      `select app.provision_user(
         p_user_id => $1, p_full_name_ar => 'تصعيد عبر التجهيز',
         p_role_id => $2, p_scope => 'branch', p_branch_ids => array[$3]::uuid[])`,
      [P3.orphan, companyAdminRole, IDS.branchA1],
    );
    assert.match(message ?? '', /صلاحيات لا تملكها/);
  });

  it('مدير فرع لا يمنح نطاق المنشأة', async () => {
    const message = await expectDenied(
      client,
      P3.branchAdmin,
      `select app.provision_user(
         p_user_id => $1, p_full_name_ar => 'ترقية نطاق',
         p_role_id => $2, p_scope => 'organization', p_branch_ids => array[$3]::uuid[])`,
      [P3.orphan, receptionRole, IDS.branchA1],
    );
    assert.match(message ?? '', /نطاق المنشأة/);
  });

  it('لا تُضاف صلاحية لا يملكها المُدير إلى دور مخصّص', async () => {
    // الطريق الأطول للتصعيد: أنشئ دورًا مخصّصًا ثم احشُه بصلاحيات أعلى منك
    await asUser(
      client,
      P3.branchAdmin,
      `insert into public.roles (organization_id, key, name_ar, is_system)
       values ($1, 'sneaky', 'دور ملتوٍ', false)`,
      [IDS.orgA],
    );
    const { rows: role } = await client.query("select id from public.roles where key = 'sneaky'");
    assert.equal(role.length, 1, 'إنشاء دور مخصّص للمنشأة يجب أن ينجح — البنية تسمح به');

    const { rows: perm } = await client.query(
      "select id from public.permissions where key = 'identity.users.delete'",
    );
    const message = await expectDenied(
      client,
      P3.branchAdmin,
      'insert into public.role_permissions (role_id, permission_id) values ($1, $2)',
      [role[0].id, perm[0].id],
    );
    assert.ok(message, 'إضافة صلاحية غير مملوكة نجحت ⇒ تصعيد صلاحيات بطريق أطول');
  });

  it('المُدير يضيف إلى الدور المخصّص صلاحية يملكها', async () => {
    const { rows: role } = await client.query("select id from public.roles where key = 'sneaky'");
    const { rows: perm } = await client.query(
      "select id from public.permissions where key = 'customers.view'",
    );
    await asUser(
      client,
      P3.branchAdmin,
      'insert into public.role_permissions (role_id, permission_id) values ($1, $2)',
      [role[0].id, perm[0].id],
    );
    const { rows } = await client.query(
      'select 1 from public.role_permissions where role_id = $1 and permission_id = $2',
      [role[0].id, perm[0].id],
    );
    assert.equal(rows.length, 1, 'الحارس يمنع ما يجب منعه فقط، لا كل شيء');
  });
});

/* ========================================================================== */
/*  3) نطاق الفرع في إدارة المستخدمين                                          */
/* ========================================================================== */

describe('نطاق الفرع في إدارة المستخدمين', () => {
  it('مدير فرع لا يُنشئ مستخدمًا في فرع خارج نطاقه', async () => {
    const message = await expectDenied(
      client,
      P3.branchAdmin,
      `select app.provision_user(
         p_user_id => $1, p_full_name_ar => 'موظف فرع آخر',
         p_role_id => $2, p_scope => 'branch', p_branch_ids => array[$3]::uuid[])`,
      [P3.createdByBranch, receptionRole, IDS.branchA2],
    );
    assert.match(message ?? '', /وصولًا للفرع/);

    const { rows } = await client.query('select 1 from public.profiles where id = $1', [
      P3.createdByBranch,
    ]);
    assert.equal(rows.length, 0);
  });

  it('مدير فرع يُنشئ مستخدمًا داخل نطاقه بنجاح', async () => {
    await asUser(
      client,
      P3.branchAdmin,
      `select app.provision_user(
         p_user_id => $1, p_full_name_ar => 'موظف فرعي جديد',
         p_role_id => $2, p_scope => 'branch', p_branch_ids => array[$3]::uuid[])`,
      [P3.createdByBranch, receptionRole, IDS.branchA1],
    );
    const { rows } = await client.query(
      'select default_branch_id from public.profiles where id = $1',
      [P3.createdByBranch],
    );
    assert.equal(rows[0].default_branch_id, IDS.branchA1);
  });

  it('مدير فرع لا يعدّل ملف مستخدم في فرع آخر', async () => {
    const nameBefore = (
      await client.query('select full_name_ar from public.profiles where id = $1', [IDS.userA2])
    ).rows[0].full_name_ar;

    // ⚠️ RLS لا ترمي خطأً — تُطابق صفر صفوف بصمت. القياس الصحيح هو القيمة
    //    قبل وبعد، لا نجاح الأمر. اختبار يفحص الخطأ وحده يكون اختبارًا فارغًا.
    await asUser(client, P3.branchAdmin, 'update public.profiles set full_name_ar = $2 where id = $1', [
      IDS.userA2,
      'مُختَرَق',
    ]);

    const nameAfter = (
      await client.query('select full_name_ar from public.profiles where id = $1', [IDS.userA2])
    ).rows[0].full_name_ar;
    assert.equal(nameAfter, nameBefore, 'عُدّل ملف مستخدم في فرع آخر');
  });

  it('مدير فرع لا يوقف صاحب نطاق المنشأة', async () => {
    await asUser(client, P3.branchAdmin, 'update public.profiles set status = $2 where id = $1', [
      IDS.userOrgAdmin,
      'suspended',
    ]);
    const { rows } = await client.query('select status from public.profiles where id = $1', [
      IDS.userOrgAdmin,
    ]);
    assert.equal(rows[0].status, 'active', 'مدير فرع أوقف مدير المنشأة ⇒ استيلاء على النظام');
  });

  it('مدير فرع يعدّل مستخدمًا داخل فرعه', async () => {
    await asUser(client, P3.branchAdmin, 'update public.profiles set job_title = $2 where id = $1', [
      P3.createdByBranch,
      'استقبال أول',
    ]);
    const { rows } = await client.query('select job_title from public.profiles where id = $1', [
      P3.createdByBranch,
    ]);
    assert.equal(rows[0].job_title, 'استقبال أول', 'الحارس يمنع ما يجب منعه فقط');
  });

  it('لا يغيّر المستخدم دوره أو فروعه بنفسه', async () => {
    const message = await expectDenied(
      client,
      P3.branchAdmin,
      'select app.set_user_assignment($1, $2, $3, array[$4]::uuid[])',
      [P3.branchAdmin, receptionRole, 'branch', IDS.branchA1],
    );
    assert.match(message ?? '', /بنفسك/);
  });

  it('مدير المنشأة يستبدل دور مستخدم وفروعه ذريًا', async () => {
    await asUser(client, IDS.userOrgAdmin, 'select app.set_user_assignment($1, $2, $3, $4::uuid[])', [
      P3.created,
      receptionRole,
      'branch',
      [IDS.branchA1, IDS.branchA2],
    ]);
    const { rows } = await client.query(
      'select branch_id, is_default from public.user_branches where user_id = $1 order by branch_id',
      [P3.created],
    );
    assert.equal(rows.length, 2, 'لم تُستبدل الفروع');
    assert.equal(rows.filter((r) => r.is_default).length, 1, 'يجب فرع افتراضي واحد بالضبط');

    const { rows: roles } = await client.query(
      'select count(*)::int as n from public.user_roles where user_id = $1',
      [P3.created],
    );
    assert.equal(roles[0].n, 1, 'الاستبدال يجب ألا يترك أدوارًا قديمة');
  });

  it('بعد إسناد فرعين يصبح المستخدم خارج نطاق مدير فرع واحد', async () => {
    // القاعدة: كل فروع الهدف داخل فروع المُدير. الهدف الآن في A1 و A2،
    // ومدير الفرع في A1 وحده ⇒ لم يبقَ قادرًا على إدارته.
    const { rows } = await asUser(
      client,
      P3.branchAdmin,
      'select app.can_manage_user($1) as v',
      [P3.created],
    );
    assert.equal(rows[0].v, false);
  });
});

/* ========================================================================== */
/*  4) الإيقاف                                                                */
/* ========================================================================== */

describe('إيقاف المستخدم', () => {
  /*
    ⚠️ الإيقاف يُنفَّذ بجلسة مدير لا بصلاحيات المالك.
       `app.guard_profile_sensitive_fields` يشترط `identity.users.update`،
       وهي تُقاس بـ auth.uid()؛ تنفيذ التحديث كمالك (auth.uid() = null) يرفعه
       الحارس. هذا هو المسار الحقيقي الذي يستخدمه التطبيق أيضًا.
  */
  it('الإيقاف يُلغي كل صلاحيات المستخدم في المحرّك فورًا', async () => {
    await asUser(client, IDS.userOrgAdmin, "update public.profiles set status = 'suspended' where id = $1", [
      P3.created,
    ]);
    const { rows: check } = await client.query('select status from public.profiles where id = $1', [
      P3.created,
    ]);
    assert.equal(check[0].status, 'suspended', 'لم يُطبَّق الإيقاف فعلًا');

    const { rows: active } = await asUser(client, P3.created, 'select app.is_active_user() as v');
    assert.equal(active[0].v, false);

    const { rows: perm } = await asUser(
      client,
      P3.created,
      "select app.has_permission('customers.view') as v",
    );
    assert.equal(perm[0].v, false, 'مستخدم موقوف ما زال يملك صلاحية');

    const { rows: data } = await asUser(client, P3.created, 'select id from public.customers');
    assert.equal(data.length, 0, 'مستخدم موقوف ما زال يرى بيانات');
  });

  it('الموقوف يقرأ ملفه الشخصي فقط — ليعرف التطبيق سبب الرفض', async () => {
    const { rows } = await asUser(client, P3.created, 'select status from public.profiles');
    assert.deepEqual(rows, [{ status: 'suspended' }]);
  });

  it('الموقوف لا يستطيع الكتابة في أي جدول تشغيلي', async () => {
    const before = (await client.query('select count(*)::int as n from public.customers')).rows[0].n;
    await asUser(
      client,
      P3.created,
      `insert into public.customers (organization_id, branch_id, full_name_ar, phone)
       values ($1, $2, 'عميل من موقوف', '0500000123')`,
      [IDS.orgA, IDS.branchA2],
    ).catch(() => {});
    const after = (await client.query('select count(*)::int as n from public.customers')).rows[0].n;
    assert.equal(after, before, 'مستخدم موقوف أدرج صفًا');
  });

  it('إعادة التفعيل تُعيد الصلاحيات كما كانت', async () => {
    await asUser(client, IDS.userOrgAdmin, "update public.profiles set status = 'active' where id = $1", [
      P3.created,
    ]);
    const { rows } = await asUser(
      client,
      P3.created,
      "select app.has_permission('customers.view') as v",
    );
    assert.equal(rows[0].v, true);
  });
});
