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

  it('مستخدم بلا صلاحية عرض الفروع لا يرى أي فرع — حتى فرعه', async () => {
    const { rows } = await asUser(client, IDS.userA1, 'select code from public.branches');
    assert.equal(rows.length, 0);
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

  it('كل جدول عليه RLS لديه سياسة واحدة على الأقل', async () => {
    const { rows } = await client.query(`
      select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
        and not exists (select 1 from pg_policies p
                        where p.schemaname = 'public' and p.tablename = c.relname)
      order by c.relname
    `);
    assert.deepEqual(
      rows.map((r) => r.relname),
      [],
      `جداول بلا سياسات (محجوبة بالكامل بصمت): ${rows.map((r) => r.relname).join(', ')}`,
    );
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
