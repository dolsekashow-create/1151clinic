/**
 * اختبارات RLS — تُنفَّذ على PostgreSQL حقيقي بدور `authenticated`.
 *
 * التشغيل:  pnpm test:rls
 *
 * ما تُثبته هذه الاختبارات: أن العزل مفروض في **محرّك قاعدة البيانات**،
 * أي أنه يصمد حتى لو تجاوز المهاجم واجهة التطبيق بالكامل واستدعى PostgREST
 * مباشرة بمفتاح Publishable.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { asUser, createTestDatabase, expectDenied } from './harness.mjs';
import { IDS, seedFixtures } from './fixtures.mjs';

let db;
let client;

before(async () => {
  db = await createTestDatabase();
  client = db.client;
  await seedFixtures(client);
});

after(async () => {
  await db?.close();
  // عملية Postgres المضمّنة تُبقي حلقة أحداث Node حيّة على Windows حتى بعد
  // الإيقاف؛ بدون هذا لا ينتهي أمر الاختبار ويتعلّق في CI.
  setTimeout(() => process.exit(process.exitCode ?? 0), 250).unref();
});

/* ========================================================================== */
/*  1) عزل الفروع — المتطلب الأساسي للمشروع                                    */
/* ========================================================================== */

describe('عزل الفروع (Branch Isolation)', () => {
  it('مستخدم الفرع أ-1 يرى عملاء فرعه', async () => {
    const { rows } = await asUser(client, IDS.userA1, 'select id, branch_id from public.customers');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].branch_id, IDS.branchA1);
  });

  it('مستخدم الفرع أ-1 لا يرى عملاء الفرع أ-2 — ولا حتى بطلب صريح بالمعرّف', async () => {
    const { rows } = await asUser(client, IDS.userA1, 'select id from public.customers where id = $1', [
      IDS.customerA2,
    ]);
    assert.equal(rows.length, 0, 'تسريب بيانات عبر الفروع');
  });

  it('مستخدم الفرع أ-2 يرى عملاء فرعه فقط', async () => {
    const { rows } = await asUser(client, IDS.userA2, 'select branch_id from public.customers');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].branch_id, IDS.branchA2);
  });

  it('صاحب نطاق المنشأة يرى كل فروع منشأته', async () => {
    const { rows } = await asUser(client, IDS.userOrgAdmin, 'select id from public.customers');
    assert.equal(rows.length, 2);
  });

  it('مستخدم منشأة أخرى لا يرى أي بيانات من المنشأة أ', async () => {
    const { rows } = await asUser(client, IDS.userOrgB, 'select id from public.customers');
    assert.equal(rows.length, 1, 'يجب أن يرى عميل منشأته فقط');
    assert.equal(rows[0].id, IDS.customerB1);
  });

  it('مدير فرع أ-2 يملك صلاحية عرض الفروع لكنه يرى فرعه فقط', async () => {
    const { rows } = await asUser(client, IDS.userA2, 'select code from public.branches');
    assert.deepEqual(
      rows.map((r) => r.code),
      ['A2'],
      'الصلاحية وحدها لا تكفي — يجب أن يبقى النطاق مطبّقًا',
    );
  });

  it('صاحب نطاق المنشأة يرى كل فروع منشأته دون فروع المنشأة الأخرى', async () => {
    const { rows } = await asUser(client, IDS.userOrgAdmin, 'select code from public.branches order by code');
    assert.deepEqual(
      rows.map((r) => r.code),
      ['A1', 'A2'],
    );
  });

  /*
    ⚠️ تغيّرت القاعدة عمدًا في المرحلة 5 (ترحيل 160000).

    كان هذا الاختبار يؤكد أن مستخدمًا بلا `organizations.branches.view` لا يرى
    **أي** فرع ولا حتى فرعه. تبيّن أن ذلك يُعطّل النظام: دور الاستقبال لا يملك
    تلك الصلاحية، فكانت قائمة الفروع في نموذج الحجز تظهر فارغة ويستحيل عليه
    إنشاء أي حجز — وهو الدور الأساسي للحجز.

    القاعدة الجديدة أضيق ما يمكن: يرى المستخدم **فروعه المُسندة فقط**. صلاحية
    العرض تبقى شرطًا لتصفّح بقية فروع المنشأة.
  */
  it('مستخدم بلا صلاحية عرض الفروع يرى فرعه المُسنَد فقط', async () => {
    const { rows } = await asUser(client, IDS.userA1, 'select code from public.branches');
    assert.deepEqual(
      rows.map((r) => r.code),
      ['A1'],
      'يجب أن يرى فرعه وحده — لا أكثر ولا أقل',
    );
  });
});

/* ========================================================================== */
/*  2) الصلاحيات                                                              */
/* ========================================================================== */

describe('الصلاحيات (Permissions)', () => {
  it('مستخدم بصلاحية الإنشاء يستطيع إضافة عميل في فرعه', async () => {
    const { rows } = await asUser(
      client,
      IDS.userA1,
      `insert into public.customers (organization_id, branch_id, full_name_ar, phone)
       values ($1, $2, 'عميل جديد', '0590000001') returning id`,
      [IDS.orgA, IDS.branchA1],
    );
    assert.equal(rows.length, 1);
  });

  it('مستخدم بلا صلاحية الإنشاء يُمنع من إضافة عميل', async () => {
    const error = await expectDenied(
      client,
      IDS.userReadOnly,
      `insert into public.customers (organization_id, branch_id, full_name_ar, phone)
       values ($1, $2, 'محاولة غير مصرّح بها', '0590000002')`,
      [IDS.orgA, IDS.branchA1],
    );
    assert.ok(error, 'كان يجب رفض الإدراج');
  });

  it('مستخدم بلا صلاحية عرض المالية لا يرى الخزائن', async () => {
    const { rows } = await asUser(client, IDS.userReadOnly, 'select id from public.treasuries');
    assert.equal(rows.length, 0);
  });

  it('مستخدم بصلاحية عرض المالية يرى خزينة فرعه', async () => {
    const { rows } = await asUser(client, IDS.userA1, 'select code from public.treasuries');
    assert.deepEqual(
      rows.map((r) => r.code),
      ['TR-A1'],
    );
  });

  it('المستخدم المعطّل لا يرى أي شيء رغم امتلاكه الدور', async () => {
    const customers = await asUser(client, IDS.userSuspended, 'select id from public.customers');
    const branches = await asUser(client, IDS.userSuspended, 'select id from public.branches');
    assert.equal(customers.rows.length, 0);
    assert.equal(branches.rows.length, 0);
  });
});

/* ========================================================================== */
/*  3) WITH CHECK — منع تهريب السجلات بين الفروع والمنشآت                      */
/*     هذه أخطر ثغرة في نموذج متعدد المستأجرين                                  */
/* ========================================================================== */

describe('WITH CHECK — منع نقل السجلات', () => {
  it('لا يمكن إنشاء سجل في فرع خارج نطاق المستخدم', async () => {
    const error = await expectDenied(
      client,
      IDS.userA1,
      `insert into public.customers (organization_id, branch_id, full_name_ar, phone)
       values ($1, $2, 'تهريب لفرع آخر', '0590000003')`,
      [IDS.orgA, IDS.branchA2],
    );
    assert.ok(error, 'كان يجب رفض الإدراج في فرع آخر');
  });

  it('لا يمكن إنشاء سجل في منشأة أخرى', async () => {
    const error = await expectDenied(
      client,
      IDS.userA1,
      `insert into public.customers (organization_id, branch_id, full_name_ar, phone)
       values ($1, $2, 'تهريب لمنشأة أخرى', '0590000004')`,
      [IDS.orgB, IDS.branchB1],
    );
    assert.ok(error, 'كان يجب رفض الإدراج في منشأة أخرى');
  });

  it('لا يمكن نقل عميل قائم إلى فرع آخر', async () => {
    const error = await expectDenied(
      client,
      IDS.userA1,
      'update public.customers set branch_id = $1 where id = $2',
      [IDS.branchA2, IDS.customerA1],
    );
    assert.ok(error, 'WITH CHECK لم يمنع نقل السجل بين الفروع');
  });

  it('لا يمكن نقل عميل قائم إلى منشأة أخرى', async () => {
    const error = await expectDenied(
      client,
      IDS.userA1,
      'update public.customers set organization_id = $1 where id = $2',
      [IDS.orgB, IDS.customerA1],
    );
    assert.ok(error, 'WITH CHECK لم يمنع نقل السجل بين المنشآت');
  });

  it('التعديل المشروع داخل نفس الفرع ينجح', async () => {
    const { rowCount } = await asUser(
      client,
      IDS.userA1,
      "update public.customers set notes = 'ملاحظة' where id = $1",
      [IDS.customerA1],
    );
    assert.equal(rowCount, 1);
  });
});

/* ========================================================================== */
/*  4) منع تصعيد الصلاحيات الذاتي                                             */
/* ========================================================================== */

describe('منع تصعيد الصلاحيات', () => {
  it('المستخدم لا يستطيع إسناد دور لنفسه', async () => {
    const { rows } = await client.query(
      "select id from public.roles where key = 'company_admin' and organization_id is null",
    );
    const error = await expectDenied(
      client,
      IDS.userOrgAdmin,
      "insert into public.user_roles (user_id, role_id, scope) values ($1, $2, 'organization')",
      [IDS.userOrgAdmin, rows[0].id],
    );
    assert.ok(error, 'المستخدم رفع صلاحيات نفسه');
  });

  it('المستخدم لا يستطيع منح نفسه وصولًا لفرع جديد', async () => {
    const error = await expectDenied(
      client,
      IDS.userA1,
      'insert into public.user_branches (user_id, branch_id) values ($1, $2)',
      [IDS.userA1, IDS.branchA2],
    );
    assert.ok(error, 'المستخدم منح نفسه فرعًا إضافيًا');
  });

  it('المستخدم لا يستطيع تفعيل حساب معطّل بلا صلاحية إدارة المستخدمين', async () => {
    const error = await expectDenied(
      client,
      IDS.userSuspended,
      "update public.profiles set status = 'active' where id = $1",
      [IDS.userSuspended],
    );
    assert.ok(error, 'المستخدم المعطّل فعّل حسابه بنفسه');
  });

  it('المستخدم لا يستطيع نقل نفسه إلى منشأة أخرى', async () => {
    const error = await expectDenied(
      client,
      IDS.userA1,
      'update public.profiles set organization_id = $1 where id = $2',
      [IDS.orgB, IDS.userA1],
    );
    assert.ok(error, 'المستخدم نقل نفسه لمنشأة أخرى');
  });

  /*
    انحدار لخلل مُكتشَف عند أول تشغيل فعلي: المستخدم لم يستطع قراءة صلاحياته
    الخاصة لأن سياسة role_permissions تشترط identity.roles.view ⇒ سياق الجلسة
    يُبنى بقائمة صلاحيات فارغة فتخفي الواجهة كل شيء.
  */
  it('المستخدم يقرأ صلاحيات دوره الخاص بلا identity.roles.view', async () => {
    const { rows } = await asUser(
      client,
      IDS.userA1,
      `select count(*)::int as n
         from public.role_permissions rp
         join public.user_roles ur on ur.role_id = rp.role_id
        where ur.user_id = $1`,
      [IDS.userA1],
    );
    assert.ok(rows[0].n > 0, 'المستخدم لا يرى صلاحياته ⇒ التطبيق سيظنّه بلا صلاحيات');
  });

  it('المستخدم لا يرى صلاحيات دور لا يحمله', async () => {
    const { rows: other } = await client.query(
      "select id from public.roles where key = 'company_admin' and organization_id is null",
    );
    const { rows } = await asUser(
      client,
      IDS.userA1,
      'select count(*)::int as n from public.role_permissions where role_id = $1',
      [other[0].id],
    );
    assert.equal(rows[0].n, 0, 'تسريب صلاحيات دور آخر');
  });

  it('المستخدم يقرأ اسم دوره الخاص فقط', async () => {
    const { rows } = await asUser(client, IDS.userA1, 'select key from public.roles order by key');
    assert.deepEqual(
      rows.map((r) => r.key).sort(),
      ['accountant', 'reception', 'warehouse_manager'],
      'يجب أن يرى أدواره الثلاثة فقط',
    );
  });

  it('المستخدم يقرأ ملفه الشخصي دائمًا', async () => {
    const { rows } = await asUser(client, IDS.userReadOnly, 'select id from public.profiles where id = $1', [
      IDS.userReadOnly,
    ]);
    assert.equal(rows.length, 1);
  });
});

/* ========================================================================== */
/*  5) الدفاتر غير القابلة للتعديل                                            */
/* ========================================================================== */

describe('الدفاتر المالية والمخزنية (append-only)', () => {
  it('حركة المخزون تُحدّث الرصيد المشتق', async () => {
    await asUser(
      client,
      IDS.userA1,
      `insert into public.stock_movements
         (organization_id, branch_id, warehouse_id, item_id, movement_type, quantity, direction)
       values ($1, $2, $3, $4, 'receipt', 10, 1)`,
      [IDS.orgA, IDS.branchA1, IDS.warehouseA1, IDS.itemA],
    );

    const { rows } = await asUser(
      client,
      IDS.userA1,
      'select quantity from public.stock_levels where warehouse_id = $1 and item_id = $2',
      [IDS.warehouseA1, IDS.itemA],
    );
    assert.equal(Number(rows[0].quantity), 10);
  });

  it('لا يمكن تعديل حركة مخزون مسجّلة', async () => {
    const error = await expectDenied(
      client,
      IDS.userA1,
      'update public.stock_movements set quantity = 999 where item_id = $1',
      [IDS.itemA],
    );
    assert.ok(error, 'حركة المخزون كانت قابلة للتعديل');
  });

  it('لا يمكن حذف حركة مخزون', async () => {
    const error = await expectDenied(client, IDS.userA1, 'delete from public.stock_movements');
    assert.ok(error, 'حركة المخزون كانت قابلة للحذف');
  });

  it('لا يمكن تعديل حركة خزينة مسجّلة', async () => {
    await asUser(
      client,
      IDS.userA1,
      `insert into public.treasury_movements
         (organization_id, branch_id, treasury_id, movement_type, direction, amount)
       values ($1, $2, $3, 'cash_in', 1, 100)`,
      [IDS.orgA, IDS.branchA1, IDS.treasuryA1],
    );

    const error = await expectDenied(
      client,
      IDS.userA1,
      'update public.treasury_movements set amount = 999',
    );
    assert.ok(error, 'حركة الخزينة كانت قابلة للتعديل');
  });

  it('حتى صاحب صلاحية الاعتماد لا يستطيع تعديل حركة مالية مُرحَّلة', async () => {
    // يُنفَّذ بمستخدم يملك finance.approve فعليًا، وإلا صار الاختبار زائفًا:
    // منع RLS للصف يُنتج 0 صفوف بلا خطأ، فيبدو كأن الحماية عملت وهي لم تُختبر.
    const { rows } = await asUser(
      client,
      IDS.userOrgAdmin,
      `insert into public.financial_transactions
         (organization_id, branch_id, transaction_type, amount, status)
       values ($1, $2, 'revenue', 500, 'posted') returning id`,
      [IDS.orgA, IDS.branchA1],
    );

    // إثبات أن الصف مرئي وقابل للاستهداف بالتعديل لولا المحفّز
    const visible = await asUser(
      client,
      IDS.userOrgAdmin,
      'select id from public.financial_transactions where id = $1',
      [rows[0].id],
    );
    assert.equal(visible.rows.length, 1, 'الصف غير مرئي — الاختبار لن يثبت شيئًا');

    const error = await expectDenied(
      client,
      IDS.userOrgAdmin,
      'update public.financial_transactions set amount = 1 where id = $1',
      [rows[0].id],
    );
    assert.ok(error, 'الحركة المالية المُرحَّلة كانت قابلة للتعديل');
  });

  it('لا يمكن حذف حركة مالية بأي حال', async () => {
    const error = await expectDenied(client, IDS.userA1, 'delete from public.financial_transactions');
    assert.ok(error, 'الحركة المالية كانت قابلة للحذف');
  });

  it('سجل التدقيق غير قابل للتعديل أو الحذف', async () => {
    await client.query(
      `insert into public.audit_logs (organization_id, branch_id, user_id, action, module, entity_type)
       values ($1, $2, $3, 'test.action', 'audit', 'test')`,
      [IDS.orgA, IDS.branchA1, IDS.userA1],
    );

    const updateError = await expectDenied(
      client,
      IDS.userOrgAdmin,
      "update public.audit_logs set action = 'tampered'",
    );
    const deleteError = await expectDenied(client, IDS.userOrgAdmin, 'delete from public.audit_logs');
    assert.ok(updateError, 'سجل التدقيق كان قابلًا للتعديل');
    assert.ok(deleteError, 'سجل التدقيق كان قابلًا للحذف');
  });
});

/* ========================================================================== */
/*  6) الوصول المجهول ودوال الأمان                                            */
/* ========================================================================== */

describe('الوصول المجهول (anon)', () => {
  it('دور anon لا يصل إلى بيانات العملاء', async () => {
    await client.query('begin');
    let denied = false;
    try {
      await client.query('set local role anon');
      await client.query('select id from public.customers');
    } catch {
      denied = true;
    } finally {
      await client.query('rollback');
    }
    assert.ok(denied, 'دور anon قرأ بيانات العملاء');
  });

  it('دور anon لا يستطيع تنفيذ دوال الأمان', async () => {
    await client.query('begin');
    let denied = false;
    try {
      await client.query('set local role anon');
      await client.query("select app.has_permission('customers.view')");
    } catch {
      denied = true;
    } finally {
      await client.query('rollback');
    }
    assert.ok(denied, 'دور anon نفّذ دالة أمان');
  });
});

/* ========================================================================== */
/*  6.5) دوال مخطط app — انحدار لثغرة CRITICAL-01                             */
/*       مستخدم مُصادَق كان يستطيع استدعاء app.apply_rls وإعادة كتابة السياسات */
/* ========================================================================== */

describe('دوال مخطط app غير قابلة للاستدعاء من العميل', () => {
  it('المستخدم لا يستطيع استدعاء app.apply_rls (إعادة كتابة السياسات)', async () => {
    const error = await expectDenied(
      client,
      IDS.userOrgAdmin,
      `select app.apply_rls('customers','customers.view','customers.view','customers.view','customers.view', false, false, false)`,
    );
    assert.ok(error, 'مستخدم عادي أعاد كتابة سياسات RLS ⇒ سقوط عزل الفروع');
    assert.match(error, /permission denied|does not exist/i);
  });

  it('المستخدم لا يستطيع استدعاء app.apply_audit_triggers (إسقاط التدقيق)', async () => {
    const error = await expectDenied(
      client,
      IDS.userOrgAdmin,
      `select app.apply_audit_triggers('customers')`,
    );
    assert.ok(error, 'مستخدم عادي أسقط محفّزات التدقيق');
  });

  it('المستخدم لا يستطيع استدعاء app.recalculate_stock_levels', async () => {
    const error = await expectDenied(
      client,
      IDS.userA1,
      'select app.recalculate_stock_levels($1)',
      [IDS.orgA],
    );
    assert.ok(error, 'مستخدم عادي أعاد حساب أرصدة المخزون');
  });

  it('لا توجد أي دالة في مخطط app ممنوحة لـ PUBLIC', async () => {
    const { rows } = await client.query(`
      select p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app'
        and has_function_privilege('public', p.oid, 'execute')
      order by p.proname
    `);
    assert.deepEqual(
      rows.map((r) => `${r.proname}(${r.args})`),
      [],
      'دوال app ممنوحة لـ PUBLIC ⇒ سطح هجوم مفتوح',
    );
  });

  /*
    قائمة بيضاء صريحة: أي دالة جديدة تُمنح لدور عميل تُفشل هذا الاختبار حتى
    تُضاف هنا بقرار واعٍ. هذا ما كشف ثغرة CRITICAL-01 سابقًا.
  */
  it('دور authenticated لا يملك سوى دوال القراءة المعتمدة', async () => {
    const { rows } = await client.query(`
      select p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app'
        and has_function_privilege('authenticated', p.oid, 'execute')
      order by p.proname
    `);
    /*
      القائمة مرتّبة أبجديًا لأن التوكيد يقارن بعد `.sort()`.
      م2 = النشر · م3 = إدارة المستخدمين · م4 = الحجز الداخلي · م6 = الحجز العام.
    */
    assert.deepEqual(rows.map((r) => r.proname).sort(), [
      // م7 — الحذف الآمن. تفحص التوابع وترفض بأرقام مفهومة، والصلاحية
      // يفرضها حارس منفصل على كل جدول.
      'archive_record',
      // م7 — الحضور. تُستدعى بجلسة الموظف نفسه وتُعيد فحص النطاق الجغرافي
      // والفرع داخلها؛ لا يوجد مسار آخر لكتابة سجل حضور.
      'attendance_check_in',
      'attendance_check_out',
      'attendance_monthly_summary',
      'available_slots', // م4 — أوقات الموظفين، مشروطة بنطاق الفرع
      'can_access_branch',
      'can_grant_role', // م3 — منع منح ما لا تملك
      'can_manage_user', // م3 — نطاق إدارة المستخدمين
      'count_dependents', // م7 — عدّ التوابع قبل الحذف
      'create_public_booking', // م6
      'current_org_id',
      'current_user_id',
      'geo_distance_meters', // م7 — رياضيات بحتة بلا أي بيانات
      'get_public_booking', // م6
      'has_org_scope',
      'has_permission',
      'is_active_user',
      'is_bookable_publicly', // م6 — بوابة الحجز العام
      'is_org_published', // م2 — بوابة النشر
      'is_within_business_hours', // م4
      'provision_user', // م3 — التجهيز الذري
      'public_available_slots', // م6
      'public_bookable_providers', // م6
      'public_bookable_services', // م6
      'set_user_assignment', // م3
    ]);
  });

  /*
    ⚠️ توسّعت هذه القائمة في المرحلة 6 توسّعًا مقصودًا.

    كان `anon` يملك دالة واحدة (بوابة النشر). فتح الحجز العام يتطلب أن يستدعي
    الزائر دوال الحجز — وهي بالضبط البديل عن فتح الجداول له. كل دالة هنا
    `SECURITY DEFINER` وتُعيد فحص النشر والترابط داخلها، ولا تُرجع أي بيانات
    شخصية. أي دالة جديدة تُمنح لـ`anon` تُفشل هذا الاختبار حتى تُضاف بقرار واعٍ.
  */
  it('دور anon لا يملك سوى بوابة النشر ودوال الحجز العام', async () => {
    const { rows } = await client.query(`
      select p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app'
        and has_function_privilege('anon', p.oid, 'execute')
      order by p.proname
    `);
    assert.deepEqual(
      rows.map((r) => r.proname).sort(),
      [
        'create_public_booking',
        'get_public_booking',
        'is_bookable_publicly',
        'is_org_published',
        'public_available_slots',
        'public_bookable_providers',
        'public_bookable_services',
      ],
      'anon يجب ألا يصل إلى أي دالة أمان أخرى',
    );
  });
});

/* ========================================================================== */
/*  6.6) السجلات المشتركة على مستوى المنشأة — انحدار لـ HIGH-01               */
/* ========================================================================== */

describe('السجلات المشتركة (branch_id = null)', () => {
  it('موظف الفرع يقرأ الخدمات المشتركة على مستوى المنشأة', async () => {
    await client.query(
      `insert into public.services (organization_id, branch_id, code, name_ar)
       values ($1, null, 'SVC-SHARED', 'خدمة مشتركة')`,
      [IDS.orgA],
    );

    const { rows } = await asUser(client, IDS.userA1, 'select code from public.services');
    assert.ok(
      rows.some((r) => r.code === 'SVC-SHARED'),
      'كتالوج الخدمات المشترك غير مرئي لموظف الفرع',
    );
  });

  it('موظف الفرع لا يستطيع إنشاء سجل مشترك على مستوى المنشأة', async () => {
    const error = await expectDenied(
      client,
      IDS.userA1,
      `insert into public.services (organization_id, branch_id, code, name_ar)
       values ($1, null, 'SVC-ESCALATE', 'محاولة إنشاء سجل مشترك')`,
      [IDS.orgA],
    );
    assert.ok(error, 'موظف فرع أنشأ سجلًا على مستوى المنشأة');
  });

  it('السجل المشترك لا يعبر حدود المنشأة', async () => {
    const { rows } = await asUser(client, IDS.userOrgB, 'select code from public.services');
    assert.equal(rows.length, 0, 'سجل مشترك تسرّب إلى منشأة أخرى');
  });
});

/* ========================================================================== */
/*  6.7) تطابق نطاق الأب والابن — انحدار لـ HIGH-02                           */
/* ========================================================================== */

describe('تطابق الفرع بين المستند وبنوده', () => {
  it('لا يمكن إلحاق بند قيد بحركة مالية في فرع آخر', async () => {
    const parent = await client.query(
      `insert into public.financial_transactions
         (organization_id, branch_id, transaction_type, amount)
       values ($1, $2, 'revenue', 100) returning id`,
      [IDS.orgA, IDS.branchA2],
    );

    const error = await expectDenied(
      client,
      IDS.userA1,
      `insert into public.financial_entries
         (organization_id, branch_id, transaction_id, direction, amount)
       values ($1, $2, $3, 'debit', 100)`,
      [IDS.orgA, IDS.branchA1, parent.rows[0].id],
    );
    assert.ok(error, 'بند قيد أُلحق بحركة في فرع آخر');
  });
});

/* ========================================================================== */
/*  6.8) النشر العام ودور anon — المرحلة 2                                     */
/*       الأهم: البيانات غير المنشورة يجب ألا تظهر لـ anon إطلاقًا             */
/* ========================================================================== */

/** ينفّذ استعلامًا بدور anon تمامًا كزائر الموقع العام. */
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

describe('النشر العام (is_public) ودور anon', () => {
  it('الافتراضي: لا شيء منشور ⇒ anon يرى صفرًا', async () => {
    for (const table of ['organizations', 'branches', 'services', 'service_providers']) {
      const { rows } = await asAnon(`select count(*)::int as n from public.${table}`);
      assert.equal(rows[0].n, 0, `${table}: يجب أن يكون صفرًا قبل النشر`);
    }
  });

  it('نشر فرع بلا نشر المنشأة لا يكشفه — بوابة المنشأة', async () => {
    await client.query('update public.branches set is_public = true where code = $1', ['A1']);
    const { rows } = await asAnon('select count(*)::int as n from public.branches');
    assert.equal(rows[0].n, 0, 'الفرع ظهر رغم أن المنشأة غير منشورة');
  });

  it('بعد نشر المنشأة يظهر الفرع المنشور فقط', async () => {
    await client.query('update public.organizations set is_public = true where id = $1', [IDS.orgA]);
    const { rows } = await asAnon('select code from public.branches order by code');
    assert.deepEqual(
      rows.map((r) => r.code),
      ['A1'],
      'يجب أن يظهر A1 وحده — A2 غير منشور',
    );
  });

  it('منشأة أخرى منشورة لا تكشف بيانات المنشأة الأولى غير المنشورة', async () => {
    await client.query('update public.organizations set is_public = true where id = $1', [IDS.orgB]);
    await client.query('update public.branches set is_public = true where code = $1', ['B1']);
    const { rows } = await asAnon('select code from public.branches order by code');
    assert.deepEqual(rows.map((r) => r.code), ['A1', 'B1']);
    // A2 ما زال غير منشور
    assert.ok(!rows.some((r) => r.code === 'A2'));
  });

  it('إلغاء النشر يُخفي الفرع فورًا', async () => {
    await client.query('update public.branches set is_public = false where code = $1', ['A1']);
    const { rows } = await asAnon('select code from public.branches order by code');
    assert.deepEqual(rows.map((r) => r.code), ['B1'], 'A1 يجب أن يختفي بعد إلغاء النشر');
    await client.query('update public.branches set is_public = true where code = $1', ['A1']);
  });

  it('الفرع غير النشط لا يظهر حتى لو كان منشورًا', async () => {
    await client.query("update public.branches set status = 'inactive' where code = $1", ['A1']);
    const { rows } = await asAnon('select code from public.branches where code = $1', ['A1']);
    assert.equal(rows.length, 0);
    await client.query("update public.branches set status = 'active' where code = $1", ['A1']);
  });

  it('⭐ anon لا يستطيع قراءة الأعمدة غير الممنوحة (الطبقة الثانية)', async () => {
    // hidden columns على service_providers
    await client.query('update public.service_providers set is_public = true');
    for (const col of ['phone', 'email', 'profile_id', 'notes', 'created_by']) {
      let denied = false;
      try {
        await asAnon(`select ${col} from public.service_providers limit 1`);
      } catch {
        denied = true;
      }
      assert.ok(denied, `العمود ${col} يجب أن يكون محجوبًا عن anon`);
    }
    // العمود المسموح يعمل
    const ok = await asAnon('select full_name_ar, specialty from public.service_providers limit 1');
    assert.ok(Array.isArray(ok.rows));
  });

  it('⭐ anon لا يصل إلى أي جدول حسّاس', async () => {
    for (const table of [
      'customers',
      'appointments',
      'profiles',
      'financial_transactions',
      'treasury_movements',
      'stock_movements',
      'audit_logs',
      'user_roles',
      'user_branches',
      'permissions',
    ]) {
      let denied = false;
      try {
        const { rows } = await asAnon(`select count(*)::int as n from public.${table}`);
        // إن سُمح بالاستعلام يجب أن يكون صفرًا على الأقل
        denied = rows[0].n === 0;
      } catch {
        denied = true;
      }
      assert.ok(denied, `${table}: anon حصل على صفوف`);
    }
  });

  it('anon لا يستطيع الكتابة في أي جدول منشور', async () => {
    for (const stmt of [
      "insert into public.branches (organization_id, code, name_ar) values ('00000000-0000-4000-8000-000000000001','X','x')",
      "update public.branches set name_ar = 'مُخترَق' where code = 'A1'",
      "delete from public.branches where code = 'A1'",
    ]) {
      let denied = false;
      try {
        await asAnon(stmt);
      } catch {
        denied = true;
      }
      assert.ok(denied, `يجب رفض: ${stmt.slice(0, 40)}`);
    }
  });

  it('جدول الربط لا يكشف خدمة غير منشورة', async () => {
    // A1 منشور · نُنشئ خدمة غير منشورة مربوطة به
    const svc = await client.query(
      `insert into public.services (organization_id, code, name_ar, is_public)
       values ($1, 'SVC-HIDDEN', 'خدمة غير منشورة', false) returning id`,
      [IDS.orgA],
    );
    await client.query(
      'insert into public.branch_services (branch_id, service_id) values ((select id from public.branches where code = $1), $2)',
      ['A1', svc.rows[0].id],
    );
    const { rows } = await asAnon('select count(*)::int as n from public.branch_services');
    assert.equal(rows[0].n, 0, 'الربط كشف خدمة غير منشورة');
  });

  it('نشر الخدمة يجعل الربط مرئيًا', async () => {
    await client.query("update public.services set is_public = true where code = 'SVC-HIDDEN'");
    const { rows } = await asAnon('select count(*)::int as n from public.branch_services');
    assert.ok(rows[0].n > 0, 'الربط يجب أن يظهر بعد نشر الطرفين');
  });
});

/* ========================================================================== */
/*  6.9) فرض صلاحية النشر — المرحلة 2                                          */
/* ========================================================================== */

describe('صلاحية النشر مفروضة في المحرّك', () => {
  /*
    ⚠️ اختبار غير زائف: نبني دورًا يملك branches.update **بلا** branches.publish.
       بدون ذلك يحجب RLS الصف فيُنتج 0 صفوف بلا خطأ، فيبدو المحفّز عاملًا
       وهو لم يُختبر أصلًا — نفس فخّ الحركة المالية المُرحَّلة سابقًا.
  */
  it('مالك صلاحية التعديل بلا صلاحية النشر لا يستطيع نشر فرع', async () => {
    await client.query(`
      insert into public.roles (id, organization_id, key, name_ar, is_system)
      values ('99999999-9999-4999-8999-999999999999', $1, 'test_branch_editor', 'محرّر فروع (اختبار)', false)
      on conflict do nothing
    `, [IDS.orgA]);
    await client.query(`
      insert into public.role_permissions (role_id, permission_id)
      select '99999999-9999-4999-8999-999999999999', p.id
      from public.permissions p
      where p.key in ('organizations.branches.view', 'organizations.branches.update')
      on conflict do nothing
    `);
    await client.query(`
      insert into public.user_roles (user_id, role_id, scope)
      values ($1, '99999999-9999-4999-8999-999999999999', 'branch')
      on conflict do nothing
    `, [IDS.userA1]);

    // إثبات أن الصف مرئي وقابل للتعديل لهذا المستخدم (وإلا كان الاختبار زائفًا)
    const rename = await asUser(
      client,
      IDS.userA1,
      "update public.branches set name_ar = 'فرع أ-1 (مُعدَّل)' where code = 'A1'",
    );
    assert.equal(rename.rowCount, 1, 'المستخدم يملك التعديل فعلًا — الاختبار ذو معنى');

    // نفس المستخدم يحاول تغيير حالة النشر
    const error = await expectDenied(
      client,
      IDS.userA1,
      "update public.branches set is_public = not is_public where code = 'A1'",
    );
    assert.ok(error, 'نُشر فرع بلا صلاحية نشر');
    assert.match(error, /organizations\.branches\.publish/);
  });

  it('مالك صلاحية النشر ينشر بنجاح', async () => {
    const before = await client.query("select is_public from public.branches where code = 'A2'");
    await asUser(client, IDS.userOrgAdmin, "update public.branches set is_public = true where code = 'A2'");
    const after = await client.query("select is_public from public.branches where code = 'A2'");
    assert.equal(before.rows[0].is_public, false);
    assert.equal(after.rows[0].is_public, true, 'company_admin يملك كل الصلاحيات فيجب أن ينجح');
  });
});

/* ========================================================================== */
/*  7) اختبارات شاملة على المخطط — تمنع نسيان جدول جديد بلا حماية              */
/* ========================================================================== */

describe('تغطية المخطط', () => {
  it('كل جداول public عليها RLS مُفعّلة', async () => {
    const { rows } = await client.query(`
      select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
      order by c.relname
    `);
    assert.deepEqual(
      rows.map((r) => r.relname),
      [],
      `جداول بلا RLS: ${rows.map((r) => r.relname).join(', ')}`,
    );
  });

  /*
    غرض هذا الاختبار: منع تفعيل RLS ثم نسيان السياسات — وهي حالة تحجب الجدول
    بالكامل **بصمت** فتظهر كأنها بيانات مفقودة لا كخطأ صلاحيات.

    ⚠️ الحجب الكامل **المقصود** حالة مشروعة ومختلفة: جداول لا يلمسها أي دور
       عميل إطلاقًا، ويصلها الخادم عبر دوال `SECURITY DEFINER` وحدها. لذلك
       تُدرَج هنا صراحةً بقرار واعٍ بدل تعطيل الاختبار.
  */
  const DENY_ALL_BY_DESIGN = [
    // م6 — عدّادات الحد من المعدّل: فتحها للعميل يعني استهلاك عدّادات الآخرين
    'rate_limit_counters',
    // م6 — مفاتيح عدم التكرار: قراءتها تسمح بانتحال إعادة إرسال طلب أي زائر
    'booking_idempotency',
  ];

  it('كل جدول عليه RLS لديه سياسة — إلا المحجوب عمدًا', async () => {
    const { rows } = await client.query(
      `select c.relname
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
         and not exists (select 1 from pg_policies p
                         where p.schemaname = 'public' and p.tablename = c.relname)
         and c.relname <> all($1)
       order by c.relname`,
      [DENY_ALL_BY_DESIGN],
    );
    assert.deepEqual(
      rows.map((r) => r.relname),
      [],
      `جداول بلا سياسات (محجوبة بالكامل بصمت): ${rows.map((r) => r.relname).join(', ')}`,
    );
  });

  it('الجداول المحجوبة عمدًا محجوبة فعلًا عن كل دور عميل', async () => {
    for (const table of DENY_ALL_BY_DESIGN) {
      const { rows } = await client.query(
        `select
           has_table_privilege('anon', $1, 'select') as anon_select,
           has_table_privilege('authenticated', $1, 'select') as auth_select,
           has_table_privilege('anon', $1, 'insert') as anon_insert,
           has_table_privilege('authenticated', $1, 'insert') as auth_insert`,
        [`public.${table}`],
      );
      assert.deepEqual(
        rows[0],
        { anon_select: false, auth_select: false, anon_insert: false, auth_insert: false },
        `${table} مكشوف لدور عميل`,
      );
    }
  });

  it('كل سياسة UPDATE لديها WITH CHECK', async () => {
    const { rows } = await client.query(`
      select tablename, policyname
      from pg_policies
      where schemaname = 'public' and cmd in ('UPDATE', 'ALL') and with_check is null
      order by tablename
    `);
    assert.deepEqual(
      rows.map((r) => `${r.tablename}.${r.policyname}`),
      [],
      'سياسات تعديل بلا WITH CHECK ⇒ يمكن نقل السجلات بين الفروع',
    );
  });

  it('كل جدول يحمل organization_id تحمل سياسة SELECT شرط المنشأة', async () => {
    const { rows } = await client.query(`
      select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'organization_id' and a.attnum > 0
      where n.nspname = 'public' and c.relkind = 'r'
        and not exists (
          select 1 from pg_policies p
          where p.schemaname = 'public' and p.tablename = c.relname
            and p.cmd in ('SELECT', 'ALL')
            and p.qual like '%current_org_id%'
        )
      order by c.relname
    `);
    assert.deepEqual(
      rows.map((r) => r.relname),
      [],
      `جداول بنطاق منشأة بلا فلترة منشأة: ${rows.map((r) => r.relname).join(', ')}`,
    );
  });

  it('كل دوال SECURITY DEFINER في مخطط app تضبط search_path', async () => {
    const { rows } = await client.query(`
      select p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app' and p.prosecdef
        and (p.proconfig is null or not (p.proconfig::text like '%search_path%'))
      order by p.proname
    `);
    assert.deepEqual(
      rows.map((r) => r.proname),
      [],
      `دوال SECURITY DEFINER بلا search_path ⇒ ثغرة تصعيد صلاحيات: ${rows
        .map((r) => r.proname)
        .join(', ')}`,
    );
  });

  it('كل الجداول المالية والمخزنية محميّة من التعديل والحذف', async () => {
    const ledgers = ['stock_movements', 'treasury_movements', 'audit_logs'];
    const { rows } = await client.query(
      `select tablename, cmd from pg_policies
        where schemaname = 'public' and tablename = any($1) and cmd in ('UPDATE', 'DELETE', 'ALL')`,
      [ledgers],
    );
    assert.deepEqual(rows, [], 'يوجد سياسة تعديل/حذف على جدول دفتري');
  });
});
