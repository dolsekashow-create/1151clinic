/**
 * بيانات تجريبية لاختبارات RLS.
 *
 * ⚠️ بيانات وهمية بالكامل — لا تُستخدم أي بيانات إنتاج في الاختبارات.
 * تُدرَج بصلاحيات المالك (تتجاوز RLS) لبناء الحالة الابتدائية،
 * ثم تُنفَّذ الاختبارات بدور authenticated.
 */

export const IDS = {
  orgA: '10000000-0000-4000-8000-000000000001',
  orgB: '10000000-0000-4000-8000-000000000002',
  branchA1: '20000000-0000-4000-8000-000000000001',
  branchA2: '20000000-0000-4000-8000-000000000002',
  branchB1: '20000000-0000-4000-8000-000000000003',

  userOrgAdmin: '30000000-0000-4000-8000-000000000001', // نطاق منشأة، كل الصلاحيات
  userA1: '30000000-0000-4000-8000-000000000002', // استقبال، فرع A1
  userA2: '30000000-0000-4000-8000-000000000003', // استقبال، فرع A2
  userReadOnly: '30000000-0000-4000-8000-000000000004', // موظف عرض فقط، فرع A1
  userSuspended: '30000000-0000-4000-8000-000000000005', // معطّل، فرع A1
  userOrgB: '30000000-0000-4000-8000-000000000006', // منشأة أخرى

  customerA1: '40000000-0000-4000-8000-000000000001',
  customerA2: '40000000-0000-4000-8000-000000000002',
  customerB1: '40000000-0000-4000-8000-000000000003',

  treasuryA1: '50000000-0000-4000-8000-000000000001',
  warehouseA1: '60000000-0000-4000-8000-000000000001',
  warehouseA2: '60000000-0000-4000-8000-000000000002',
  itemA: '70000000-0000-4000-8000-000000000001',
};

export async function seedFixtures(client) {
  const q = (sql, params) => client.query(sql, params);

  // --- المنشآت والفروع ---
  await q(
    `insert into public.organizations (id, code, name_ar) values
       ($1, 'ORG-A', 'شركة الاختبار أ'),
       ($2, 'ORG-B', 'شركة الاختبار ب')`,
    [IDS.orgA, IDS.orgB],
  );

  await q(
    `insert into public.branches (id, organization_id, code, name_ar) values
       ($1, $4, 'A1', 'فرع أ-1'),
       ($2, $4, 'A2', 'فرع أ-2'),
       ($3, $5, 'B1', 'فرع ب-1')`,
    [IDS.branchA1, IDS.branchA2, IDS.branchB1, IDS.orgA, IDS.orgB],
  );

  // --- المستخدمون ---
  const users = [
    [IDS.userOrgAdmin, 'admin@test.local'],
    [IDS.userA1, 'a1@test.local'],
    [IDS.userA2, 'a2@test.local'],
    [IDS.userReadOnly, 'readonly@test.local'],
    [IDS.userSuspended, 'suspended@test.local'],
    [IDS.userOrgB, 'orgb@test.local'],
  ];
  for (const [id, email] of users) {
    await q('insert into auth.users (id, email) values ($1, $2)', [id, email]);
  }

  await q(
    `insert into public.profiles (id, organization_id, full_name_ar, status, default_branch_id) values
       ($1, $7, 'مدير المنشأة',  'active',    $9),
       ($2, $7, 'موظف فرع أ-1',  'active',    $9),
       ($3, $7, 'موظف فرع أ-2',  'active',    $10),
       ($4, $7, 'موظف عرض فقط',  'active',    $9),
       ($5, $7, 'موظف معطّل',    'suspended', $9),
       ($6, $8, 'مدير منشأة ب',  'active',    $11)`,
    [
      IDS.userOrgAdmin,
      IDS.userA1,
      IDS.userA2,
      IDS.userReadOnly,
      IDS.userSuspended,
      IDS.userOrgB,
      IDS.orgA,
      IDS.orgB,
      IDS.branchA1,
      IDS.branchA2,
      IDS.branchB1,
    ],
  );

  // --- الأدوار ---
  const roleId = async (key) => {
    const { rows } = await q('select id from public.roles where key = $1 and organization_id is null', [
      key,
    ]);
    if (!rows[0]) throw new Error(`دور غير موجود في البذرة: ${key}`);
    return rows[0].id;
  };

  const companyAdmin = await roleId('company_admin');
  const reception = await roleId('reception');
  const employee = await roleId('employee');
  const accountant = await roleId('accountant');
  const warehouseManager = await roleId('warehouse_manager');
  const branchManager = await roleId('branch_manager');

  await q(
    `insert into public.user_roles (user_id, role_id, scope) values
       ($1, $6, 'organization'),
       ($2, $7, 'branch'),
       ($3, $7, 'branch'),
       ($4, $8, 'branch'),
       ($5, $7, 'branch')`,
    [
      IDS.userOrgAdmin,
      IDS.userA1,
      IDS.userA2,
      IDS.userReadOnly,
      IDS.userSuspended,
      companyAdmin,
      reception,
      employee,
    ],
  );

  // موظفو الفروع يحتاجون صلاحيات مالية/مخزنية لبعض الاختبارات
  await q('insert into public.user_roles (user_id, role_id, scope) values ($1, $2, $3)', [
    IDS.userA1,
    accountant,
    'branch',
  ]);
  await q('insert into public.user_roles (user_id, role_id, scope) values ($1, $2, $3)', [
    IDS.userA1,
    warehouseManager,
    'branch',
  ]);
  await q('insert into public.user_roles (user_id, role_id, scope) values ($1, $2, $3)', [
    IDS.userOrgB,
    companyAdmin,
    'organization',
  ]);
  // مدير فرع أ-2: يملك organizations.branches.view لكن نطاقه فرع واحد فقط.
  // يُستخدم لإثبات أن الصلاحية وحدها لا تكفي — النطاق يظل مطبّقًا.
  await q('insert into public.user_roles (user_id, role_id, scope) values ($1, $2, $3)', [
    IDS.userA2,
    branchManager,
    'branch',
  ]);

  // --- ربط المستخدمين بالفروع ---
  await q(
    `insert into public.user_branches (user_id, branch_id, is_default) values
       ($1, $5, true),
       ($2, $6, true),
       ($3, $5, true),
       ($4, $5, true)`,
    [IDS.userA1, IDS.userA2, IDS.userReadOnly, IDS.userSuspended, IDS.branchA1, IDS.branchA2],
  );

  // --- بيانات تشغيلية ---
  await q(
    `insert into public.customers (id, organization_id, branch_id, full_name_ar, phone) values
       ($1, $4, $6, 'عميل فرع أ-1', '0500000001'),
       ($2, $4, $7, 'عميل فرع أ-2', '0500000002'),
       ($3, $5, $8, 'عميل منشأة ب', '0500000003')`,
    [
      IDS.customerA1,
      IDS.customerA2,
      IDS.customerB1,
      IDS.orgA,
      IDS.orgB,
      IDS.branchA1,
      IDS.branchA2,
      IDS.branchB1,
    ],
  );

  await q(
    `insert into public.treasuries (id, organization_id, branch_id, code, name_ar) values
       ($1, $2, $3, 'TR-A1', 'خزينة فرع أ-1')`,
    [IDS.treasuryA1, IDS.orgA, IDS.branchA1],
  );

  await q(
    `insert into public.warehouses (id, organization_id, branch_id, code, name_ar) values
       ($1, $3, $4, 'WH-A1', 'مخزن فرع أ-1'),
       ($2, $3, $5, 'WH-A2', 'مخزن فرع أ-2')`,
    [IDS.warehouseA1, IDS.warehouseA2, IDS.orgA, IDS.branchA1, IDS.branchA2],
  );

  await q(
    `insert into public.items (id, organization_id, branch_id, code, name_ar) values
       ($1, $2, $3, 'ITM-1', 'صنف تجريبي')`,
    [IDS.itemA, IDS.orgA, IDS.branchA1],
  );
}
