#!/usr/bin/env node
/**
 * تحقق فعلي من العزل والصلاحيات على Supabase الحقيقي.
 *
 * يسجّل الدخول بكل مستخدم تجريبي **بمفتاح Publishable** (نفس ما يستخدمه المتصفح)
 * ثم يستعلم عبر PostgREST مباشرةً — أي أنه يتجاوز واجهة التطبيق بالكامل.
 * هذا وحده يُثبت أن الحماية في محرّك قاعدة البيانات لا في الشاشة.
 *
 * التشغيل: node scripts/verify-demo.mjs
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const env = Object.fromEntries(
  readFileSync(resolve(root, 'apps/web/.env.local'), 'utf8')
    .split(/\r?\n/)
    .map((l) => {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l);
      return m ? [m[1], m[2].replace(/^["']|["']$/g, '')] : null;
    })
    .filter(Boolean),
);

const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLISHABLE = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const creds = JSON.parse(readFileSync(resolve(root, '.demo-credentials/demo-users.json'), 'utf8'));
const pw = new Map(creds.users.map((u) => [u.email, u.password]));

let pass = 0;
let fail = 0;
const results = [];

function check(name, actual, expected, note = '') {
  const ok = actual === expected;
  ok ? (pass += 1) : (fail += 1);
  results.push({ ok, name, actual, expected, note });
  console.log(`  ${ok ? '✅' : '❌'} ${name.padEnd(58)} = ${String(actual).padEnd(6)}${ok ? '' : `متوقع ${expected}`} ${note}`);
}

/** جلسة مستخدم بمفتاح Publishable — تمامًا كالمتصفح. */
async function login(key) {
  const email = `${key}@demo.local`;
  const c = createClient(URL, PUBLISHABLE, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password: pw.get(email) });
  if (error) throw new Error(`فشل دخول ${email}: ${error.message}`);
  return { client: c, userId: data.user.id };
}

/** بعض الجداول بمفتاح مركّب بلا عمود id (مثل stock_levels) ⇒ نعدّ بعمود موجود. */
const COUNT_COLUMN = { stock_levels: 'item_id', provider_branches: 'branch_id', branch_services: 'service_id' };

const count = async (c, table, filters = (q) => q) => {
  const col = COUNT_COLUMN[table] ?? 'id';
  const { count: n, error } = await filters(c.from(table).select(col, { count: 'exact', head: true }));
  if (error) return `ERR:${error.code} ${error.message}`;
  return n ?? 0;
};

/**
 * تحقق صارم من عدم قابلية التعديل: نقرأ القيمة، نحاول التعديل، نقرأ مرة أخرى.
 *
 * ⚠️ لا يكفي فحص وجود خطأ: عندما يحجب RLS الصف فإن UPDATE يطابق صفر صفوف
 *    ويعود **بلا خطأ** — وهو سلوك PostgREST الصحيح. الحكم الوحيد الموثوق
 *    هو مقارنة القيمة قبل وبعد.
 */
async function immutabilityCheck(reader, writer, table, id, patch, column) {
  const before = (await reader.from(table).select(column).eq('id', id).single()).data?.[column];
  const res = await writer.from(table).update(patch).eq('id', id);
  const after = (await reader.from(table).select(column).eq('id', id).single()).data?.[column];
  return { unchanged: String(before) === String(after), before, after, errorCode: res.error?.code ?? null };
}

console.log('\n══════════════════════════════════════════════════════════════════════');
console.log('  تحقق فعلي على Supabase — عبر PostgREST بمفتاح Publishable');
console.log('══════════════════════════════════════════════════════════════════════\n');

/* ---------- 1) تسجيل الدخول بكل الأدوار ---------- */
console.log('▶ 1) تسجيل الدخول بكل الأدوار');
const sessions = {};
for (const key of ['sysadmin', 'ceo', 'bm.ryd01', 'bm.jed01', 'rec.ryd01', 'acc.multi', 'wh.ryd01', 'emp.ryd01', 'suspended']) {
  try {
    sessions[key] = await login(key);
    check(`دخول ${key}`, 'نجح', 'نجح');
  } catch (e) {
    check(`دخول ${key}`, `فشل: ${e.message}`, 'نجح');
  }
}

/* ---------- 2) عزل الفروع ---------- */
console.log('\n▶ 2) عزل الفروع — أعداد العملاء');
check('مدير فرع العليا يرى عملاء فرعه', await count(sessions['bm.ryd01'].client, 'customers'), 24);
check('مدير فرع جدة يرى عملاء فرعه', await count(sessions['bm.jed01'].client, 'customers'), 16);
check('مدير الشركة يرى كل العملاء', await count(sessions['ceo'].client, 'customers'), 80);
check('المستخدم الموقوف', await count(sessions['suspended'].client, 'customers'), 0, 'رغم امتلاكه دور الاستقبال');
/*
  ⚠️ المحاسب لا يملك customers.view (وهو تصميم RBAC صحيح — المحاسب لا يحتاج
     قائمة العملاء). لذلك اختبار «تعدد الفروع» يستخدم موردًا يملكه فعلًا:
     الخزائن والحركات المالية.
*/
check('المحاسب لا يرى العملاء (بلا customers.view)', await count(sessions['acc.multi'].client, 'customers'), 0, 'RBAC صحيح');

console.log('\n▶ 3) عزل الفروع — أعداد الفروع');
check('مدير فرع العليا يرى فرعًا واحدًا', await count(sessions['bm.ryd01'].client, 'branches'), 1, 'يملك branches.view');
check('مدير الشركة يرى الفروع الـ15', await count(sessions['ceo'].client, 'branches'), 15);
check('موظفة الاستقبال لا ترى أي فرع', await count(sessions['rec.ryd01'].client, 'branches'), 0, 'بلا branches.view');

/* ---------- 4) الوصول المباشر لبيانات فرع آخر ---------- */
console.log('\n▶ 4) محاولة الوصول المباشر لبيانات فرع آخر (تجاوز الواجهة)');
const { data: jedCustomers } = await sessions['ceo'].client
  .from('customers')
  .select('id, branch_id')
  .limit(200);
const { data: jedBranch } = await sessions['ceo'].client.from('branches').select('id, code');
const jedId = jedBranch.find((b) => b.code === 'JED-01').id;
const ryd03Id = jedBranch.find((b) => b.code === 'RYD-03').id;
const aJedCustomer = jedCustomers.find((c) => c.branch_id === jedId);

check(
  'مدير العليا يطلب عميل جدة بالمعرّف صراحةً',
  await count(sessions['bm.ryd01'].client, 'customers', (q) => q.eq('id', aJedCustomer.id)),
  0,
  '← الحماية في المحرّك',
);
check(
  'مدير العليا يطلب كل عملاء فرع جدة',
  await count(sessions['bm.ryd01'].client, 'customers', (q) => q.eq('branch_id', jedId)),
  0,
);
check('أي مستخدم ← بيانات RYD-03', await count(sessions['ceo'].client, 'customers', (q) => q.eq('branch_id', ryd03Id)), 0, 'الضابط السلبي');

/* ---------- 5) الصلاحيات ---------- */
console.log('\n▶ 5) الصلاحيات');
check('الاستقبال لا ترى الخزائن', await count(sessions['rec.ryd01'].client, 'treasuries'), 0, 'بلا finance.treasury.view');
check('المحاسب يرى خزينتَي فرعيه فقط', await count(sessions['acc.multi'].client, 'treasuries'), 2, '⭐ تعدد الفروع: 2 من 5');
check('أمين المخزن لا يرى الحركات المالية', await count(sessions['wh.ryd01'].client, 'financial_transactions'), 0);

const whLevels = await count(sessions['wh.ryd01'].client, 'stock_levels');
const ceoLevels = await count(sessions['ceo'].client, 'stock_levels');
check('أمين المخزن يرى أرصدة فرعه فقط', whLevels > 0 && whLevels < ceoLevels, true, `${whLevels} من ${ceoLevels}`);

const insEmp = await sessions['emp.ryd01'].client.from('customers').insert({
  organization_id: (await sessions['emp.ryd01'].client.from('customers').select('organization_id').limit(1)).data?.[0]?.organization_id,
  branch_id: null,
  full_name_ar: 'محاولة غير مصرّح بها',
  phone: '0500000000',
});
check('موظف بلا customers.create ينشئ عميلًا', insEmp.error ? 'مرفوض' : 'نجح ❌', 'مرفوض');

/* ---------- 6) مقدّمو الخدمة بلا حسابات (RQ-02) ---------- */
console.log('\n▶ 6) مقدّمو الخدمة — قرار RQ-02');
const { data: provs } = await sessions['ceo'].client.from('service_providers').select('code, full_name_ar, profile_id, branch_id');
check('عدد مقدّمي الخدمة', provs.length, 7);
check('مقدّمو خدمة بلا حساب مستخدم', provs.filter((p) => p.profile_id === null).length, 6, '⭐ جوهر RQ-02');
check('مقدّم خدمة مرتبط بحساب', provs.filter((p) => p.profile_id !== null).length, 1, 'DR-007');
const { data: dr006 } = await sessions['ceo'].client.from('service_providers').select('id').eq('code', 'DR-006').single();
const { count: dr006n } = await sessions['ceo'].client
  .from('provider_branches')
  .select('branch_id', { count: 'exact', head: true })
  .eq('provider_id', dr006.id);
check('DR-006 يعمل في 3 فروع', dr006n, 3);
/*
  موظفة الاستقبال في RYD-01 ترى: 3 مقدّمين في فرعها + 1 على مستوى المنشأة
  (DR-006 بـ branch_id = null) = 4. ولا ترى مقدّمي RYD-02 و JED-01 و DMM-01.
  هذا يُثبت أمرين معًا: عزل الفروع، **وإصلاح HIGH-01** (السجل المشترك مقروء).
*/
const recProvs = await count(sessions['rec.ryd01'].client, 'service_providers');
check('الاستقبال ترى مقدّمي فرعها + المشترك', recProvs, 4, '3 فرعية + 1 مشترك (HIGH-01)');
const { count: sharedVisible } = await sessions['rec.ryd01'].client
  .from('service_providers')
  .select('id', { count: 'exact', head: true })
  .is('branch_id', null);
check('السجل المشترك (branch_id=null) مرئي للاستقبال', sharedVisible, 1, '⭐ إصلاح HIGH-01');

/* ---------- 7) الحركات المالية ---------- */
console.log('\n▶ 7) العمليات المالية');
const acc = sessions['acc.multi'].client;
const ceoC = sessions['ceo'].client;

// المتوقع يُحسب من قاعدة البيانات لا من تخمين
const { data: accBranches } = await acc.from('treasuries').select('branch_id');
const accBranchIds = accBranches.map((r) => r.branch_id);
const { count: expectedTx } = await ceoC
  .from('financial_transactions')
  .select('id', { count: 'exact', head: true })
  .in('branch_id', accBranchIds);
const accTx = await count(acc, 'financial_transactions');
check('المحاسب يرى حركات فرعيه فقط', accTx, expectedTx, `محسوب من البعيد · الإجمالي 34`);

const { data: posted } = await ceoC.from('financial_transactions').select('id').eq('status', 'posted').limit(1);
const txId = posted[0].id;

// (أ) مستخدم بلا finance.approve ⇒ RLS يحجب الصف صامتًا (0 صفوف · بلا خطأ)
const r1 = await immutabilityCheck(ceoC, acc, 'financial_transactions', txId, { amount: '1.00' }, 'amount');
check('حركة مُرحَّلة: محاسب بلا finance.approve', r1.unchanged, true, 'RLS حجب الصف — المبلغ لم يتغير');

// (ب) مستخدم **يملك** finance.approve ⇒ المحفّز يرفض صراحةً
const r2 = await immutabilityCheck(ceoC, ceoC, 'financial_transactions', txId, { amount: '2.00' }, 'amount');
check('حركة مُرحَّلة: صاحب finance.approve', r2.unchanged, true, `المحفّز رفض (${r2.errorCode})`);

const delTx = await acc.from('financial_transactions').delete().eq('id', txId);
check('حذف حركة مالية', delTx.error ? 'مرفوض' : 'نجح ❌', 'مرفوض');

const { data: mv } = await acc.from('treasury_movements').select('id').limit(1);
const r3 = await immutabilityCheck(acc, acc, 'treasury_movements', mv[0].id, { amount: '1.00' }, 'amount');
check('دفتر الخزينة غير قابل للتعديل', r3.unchanged, true);

const { data: sm } = await sessions['wh.ryd01'].client.from('stock_movements').select('id').limit(1);
const r4 = await immutabilityCheck(
  sessions['wh.ryd01'].client,
  sessions['wh.ryd01'].client,
  'stock_movements',
  sm[0].id,
  { quantity: '1' },
  'quantity',
);
check('دفتر المخزون غير قابل للتعديل', r4.unchanged, true);

check('الورديات المفتوحة لدى المحاسب', await count(acc, 'shifts', (q) => q.eq('status', 'open')), 1);
check('حالات draft و posted موجودتان', (await count(ceoC, 'financial_transactions', (q) => q.eq('status', 'draft'))) > 0, true);

/* ---------- 8) نقل السجلات بين الفروع ---------- */
console.log('\n▶ 8) منع نقل السجلات (WITH CHECK)');
const { data: myCustomer } = await sessions['bm.ryd01'].client.from('customers').select('id').limit(1).single();
const moveBranch = await sessions['bm.ryd01'].client.from('customers').update({ branch_id: jedId }).eq('id', myCustomer.id);
check('نقل عميل إلى فرع آخر', moveBranch.error || moveBranch.count === 0 ? 'مرفوض' : 'نجح ❌', 'مرفوض');

/* ---------- 9) الأرصدة المشتقة ---------- */
console.log('\n▶ 9) الأرصدة المشتقة من المحفّز');
const { data: levels } = await sessions['wh.ryd01'].client.from('stock_levels').select('quantity');
const totalQty = levels.reduce((a, r) => a + Number(r.quantity), 0);
check('أرصدة محسوبة بالمحفّز (لا إدراج يدوي)', levels.length > 0 && totalQty !== 0, true, `إجمالي ${totalQty}`);

console.log('\n══════════════════════════════════════════════════════════════════════');
console.log(`  النتيجة: ${pass} ناجح · ${fail} فاشل`);
console.log('══════════════════════════════════════════════════════════════════════\n');
if (fail > 0) {
  console.log('  الفاشلة:');
  results.filter((r) => !r.ok).forEach((r) => console.log(`    ❌ ${r.name}: فعلي=${r.actual} متوقع=${r.expected}`));
}
process.exitCode = fail > 0 ? 1 : 0;
