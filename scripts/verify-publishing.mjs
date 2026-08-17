#!/usr/bin/env node
/**
 * تحقق فعلي من نظام النشر على قاعدة التطوير.
 *
 * يستخدم مفتاح Publishable حصرًا:
 *   • جلسة مستخدم إداري ⇒ تغيير حالة النشر (كما تفعل لوحة الإدارة)
 *   • بلا جلسة (anon)    ⇒ قراءة الموقع العام (كما يفعل الزائر)
 *
 * ⚠️ لا يُستخدم SUPABASE_SECRET_KEY في أي خطوة.
 *
 * التشغيل: node scripts/verify-publishing.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
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
const failures = [];
function check(name, actual, expected, note = '') {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? (pass += 1) : (fail += 1);
  if (!ok) failures.push({ name, actual, expected });
  console.log(
    `  ${ok ? '✅' : '❌'} ${name.padEnd(56)} ${String(actual).padEnd(8)}${ok ? '' : `متوقع ${expected}`} ${note}`,
  );
}

/** عميل الزائر — بلا جلسة، دور anon. */
const anon = () => createClient(URL, PUBLISHABLE, { auth: { persistSession: false } });

async function login(key) {
  const c = createClient(URL, PUBLISHABLE, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({
    email: `${key}@demo.local`,
    password: pw.get(`${key}@demo.local`),
  });
  if (error) throw new Error(`دخول ${key}: ${error.message}`);
  return c;
}

const countAnon = async (table, columns) => {
  const { data, error } = await anon().from(table).select(columns);
  if (error) return `ERR:${error.code}`;
  return data.length;
};

console.log('\n══════════════════════════════════════════════════════════════════════');
console.log('  تحقق نظام النشر — anon مقابل لوحة الإدارة (مفتاح Publishable فقط)');
console.log('══════════════════════════════════════════════════════════════════════\n');

const admin = await login('ceo'); // company_admin = كل الصلاحيات بما فيها النشر
const reception = await login('rec.ryd01'); // بلا أي صلاحية نشر

/*
  ⚠️ السكربت يبدأ بتصفير حالة النشر وينتهي باستعادتها.

  السبب: كان يفترض أن كل شيء غير منشور، وهو صحيح على قاعدة جديدة فقط. بعد
  أي تشغيل سابق يترك عناصر منشورة تفشل التوكيدات — وهو فشل في افتراض السكربت
  لا في النظام. الاعتماد على حالة سابقة يجعل الاختبار يمرّ أو يسقط حسب ترتيب
  التشغيل، وهذا أسوأ من عدم وجوده.
*/
const PUBLISHABLE_TABLES = ['organizations', 'branches', 'services', 'service_providers'];
const snapshot = new Map();
for (const table of PUBLISHABLE_TABLES) {
  const { data } = await admin.from(table).select('id, is_public');
  snapshot.set(table, data ?? []);
  const published = (data ?? []).filter((r) => r.is_public).map((r) => r.id);
  if (published.length > 0) {
    await admin.from(table).update({ is_public: false }).in('id', published);
  }
}
console.log(
  `ℹ️ حالة النشر الأصلية محفوظة (${[...snapshot.values()].flat().filter((r) => r.is_public).length} عنصر منشور) وستُستعاد في النهاية.\n`,
);

/* ---------- 1) الحالة الابتدائية ---------- */
console.log('▶ 1) الحالة الابتدائية (الافتراضي: لا شيء منشور)');
check('anon يرى منشآت', await countAnon('organizations', 'id, name_ar'), 0);
check('anon يرى فروعًا', await countAnon('branches', 'id, name_ar'), 0);
check('anon يرى خدمات', await countAnon('services', 'id, name_ar'), 0);
check('anon يرى مقدّمي خدمة', await countAnon('service_providers', 'id, full_name_ar'), 0);

/* ---------- 2) نشر المنشأة — البوابة ---------- */
console.log('\n▶ 2) بوابة المنشأة');
const { data: orgs } = await admin.from('organizations').select('id, code');
const orgId = orgs[0].id;
const { data: branches } = await admin.from('branches').select('id, code').order('code');
const b1 = branches.find((b) => b.code === 'RYD-01');
const b2 = branches.find((b) => b.code === 'JED-01');

await admin.from('branches').update({ is_public: true }).eq('id', b1.id);
check('نشر فرع بلا نشر المنشأة ⇒ anon يرى 0', await countAnon('branches', 'id, name_ar'), 0, '← البوابة تعمل');

await admin.from('organizations').update({ is_public: true }).eq('id', orgId);
check('بعد نشر المنشأة ⇒ الفرع المنشور فقط', await countAnon('branches', 'id, name_ar'), 1);

/* ---------- 3) النشر والإخفاء ---------- */
console.log('\n▶ 3) النشر والإخفاء من لوحة الإدارة');
await admin.from('branches').update({ is_public: true }).eq('id', b2.id);
check('نشر فرع ثانٍ', await countAnon('branches', 'id, name_ar'), 2);

await admin.from('branches').update({ is_public: false }).eq('id', b2.id);
check('إلغاء النشر يُخفيه فورًا', await countAnon('branches', 'id, name_ar'), 1);

const { data: svcs } = await admin.from('services').select('id, code').limit(2);
await admin.from('services').update({ is_public: true }).eq('id', svcs[0].id);
check('نشر خدمة', await countAnon('services', 'id, name_ar'), 1);

const { data: provs } = await admin.from('service_providers').select('id, code').limit(3);
await admin.from('service_providers').update({ is_public: true }).eq('id', provs[0].id);
await admin.from('service_providers').update({ is_public: true }).eq('id', provs[1].id);
check('نشر مقدّمَي خدمة', await countAnon('service_providers', 'id, full_name_ar'), 2);

/* ---------- 4) الحالة غير النشطة ---------- */
console.log('\n▶ 4) الحالة غير النشطة تُخفي المنشور');
await admin.from('services').update({ status: 'inactive' }).eq('id', svcs[0].id);
check('خدمة منشورة لكن غير نشطة', await countAnon('services', 'id, name_ar'), 0);
await admin.from('services').update({ status: 'active' }).eq('id', svcs[0].id);

/* ---------- 5) فرض صلاحية النشر ---------- */
console.log('\n▶ 5) صلاحية النشر مفروضة في المحرّك');
const before = (await admin.from('branches').select('is_public').eq('id', b1.id)).data[0].is_public;
const attempt = await reception.from('branches').update({ is_public: false }).eq('id', b1.id);
const after = (await admin.from('branches').select('is_public').eq('id', b1.id)).data[0].is_public;
check('الاستقبال (بلا صلاحية نشر) تُلغي النشر', after === before, true, 'القيمة لم تتغير');

/* ---------- 6) الأعمدة المحجوبة ---------- */
console.log('\n▶ 6) الأعمدة المحجوبة عن anon');
for (const col of ['phone', 'email', 'profile_id', 'notes']) {
  const { error } = await anon().from('service_providers').select(col).limit(1);
  check(`العمود ${col}`, Boolean(error), true, error ? 'محجوب' : '❌ مكشوف');
}
const { error: starError } = await anon().from('service_providers').select('*').limit(1);
check('select=* على مقدّمي الخدمة', Boolean(starError), true, 'مرفوض');

/* ---------- 7) الجداول الحسّاسة ---------- */
console.log('\n▶ 7) الجداول الحسّاسة محجوبة عن anon');
for (const table of ['customers', 'appointments', 'profiles', 'financial_transactions', 'audit_logs']) {
  const { data, error } = await anon().from(table).select('id').limit(1);
  check(table, Boolean(error) || (data ?? []).length === 0, true);
}

/* ---------- 8) anon لا يكتب ---------- */
console.log('\n▶ 8) anon لا يستطيع الكتابة');
const ins = await anon().from('branches').insert({ organization_id: orgId, code: 'HACK', name_ar: 'x' });
check('إدراج فرع بدور anon', Boolean(ins.error), true, 'مرفوض');
const upd = await anon().from('branches').update({ name_ar: 'مُخترَق' }).eq('id', b1.id);
const nameAfter = (await admin.from('branches').select('name_ar').eq('id', b1.id)).data[0].name_ar;
check('تعديل فرع بدور anon', nameAfter !== 'مُخترَق', true, 'الاسم لم يتغير');

/* ---------- استعادة حالة النشر الأصلية ---------- */
console.log('\n▶ استعادة حالة النشر الأصلية');
for (const table of PUBLISHABLE_TABLES) {
  const rows = snapshot.get(table) ?? [];
  for (const flag of [true, false]) {
    const ids = rows.filter((r) => r.is_public === flag).map((r) => r.id);
    if (ids.length > 0) await admin.from(table).update({ is_public: flag }).in('id', ids);
  }
}
for (const table of PUBLISHABLE_TABLES) {
  const expected = (snapshot.get(table) ?? []).filter((r) => r.is_public).length;
  const { data } = await admin.from(table).select('id').eq('is_public', true);
  check(`استعادة ${table}`, (data?.length ?? 0) === expected, true, `${data?.length ?? 0}/${expected}`);
}

console.log('\n══════════════════════════════════════════════════════════════════════');
console.log(`  النتيجة: ${pass} ناجح · ${fail} فاشل`);
console.log('══════════════════════════════════════════════════════════════════════\n');
if (fail > 0) {
  failures.forEach((f) => console.log(`  ❌ ${f.name}: فعلي=${f.actual} متوقع=${f.expected}`));
}
process.exitCode = fail > 0 ? 1 : 0;
