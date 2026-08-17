#!/usr/bin/env node
/**
 * تحقق فعلي من إدارة المستخدمين على قاعدة التطوير.
 *
 * يُحاكي بالضبط ما تفعله لوحة الإدارة:
 *   • مفتاح Publishable + جلسة المدير  ⇒ كل قرارات التصريح
 *   • مفتاح Secret                      ⇒ إنشاء/حذف/حظر auth.users فقط
 *
 * ⚠️ المستخدمون الذين يُنشئهم هذا السكربت تجريبيون ويُحذفون في النهاية.
 *
 * التشغيل: node scripts/verify-users.mjs
 */
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
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
const SECRET = env.SUPABASE_SECRET_KEY;
if (!SECRET) throw new Error('SUPABASE_SECRET_KEY مطلوب لإنشاء حسابات المصادقة');

const creds = JSON.parse(readFileSync(resolve(root, '.demo-credentials/demo-users.json'), 'utf8'));
const pw = new Map(creds.users.map((u) => [u.email, u.password]));

const admin = createClient(URL, SECRET, { auth: { persistSession: false } });

let pass = 0;
let fail = 0;
const failures = [];
function check(name, ok, note = '') {
  ok ? (pass += 1) : (fail += 1);
  if (!ok) failures.push(name);
  console.log(`  ${ok ? '✅' : '❌'} ${name.padEnd(60)} ${note}`);
}

async function login(key) {
  const c = createClient(URL, PUBLISHABLE, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({
    email: `${key}@demo.local`,
    password: pw.get(`${key}@demo.local`),
  });
  if (error) throw new Error(`دخول ${key}: ${error.message}`);
  return c;
}

/** ينشئ حساب مصادقة ويعيد معرّفه — نفس ما يفعله createUser في التطبيق. */
async function createAuthUser(email) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: randomBytes(32).toString('base64url'),
    email_confirm: true,
  });
  if (error) throw new Error(`إنشاء ${email}: ${error.message}`);
  return data.user.id;
}

const created = [];
const suffix = randomBytes(3).toString('hex');
const mail = (n) => `verify.${n}.${suffix}@demo.local`;

console.log('\n══════════════════════════════════════════════════════════════════════');
console.log('  تحقق إدارة المستخدمين — التجهيز والنطاق ومنع التصعيد');
console.log('══════════════════════════════════════════════════════════════════════\n');

const ceo = await login('ceo');
const reception = await login('rec.ryd01');

const { data: branches } = await ceo.from('branches').select('id, code').order('code');
const ryd = branches.find((b) => b.code === 'RYD-01');
const jed = branches.find((b) => b.code === 'JED-01');
const { data: roles } = await ceo.from('roles').select('id, key');
const roleId = (key) => roles.find((r) => r.key === key).id;

try {
  /* ---------------- 1) إنشاء مستخدم كامل ---------------- */
  console.log('▶ 1) التجهيز الذري');
  const u1Email = mail('u1');
  const u1 = await createAuthUser(u1Email);
  created.push(u1);

  const { error: e1 } = await ceo.rpc('provision_user', {
    p_user_id: u1,
    p_full_name_ar: 'مستخدم تحقق ١',
    p_role_id: roleId('reception'),
    p_scope: 'branch',
    p_branch_ids: [ryd.id],
    p_phone: '0500000777',
    p_job_title: 'استقبال',
  });
  check('إنشاء مستخدم بنداء واحد', !e1, e1?.message ?? '');

  const { data: p1 } = await ceo.from('profiles').select('full_name_ar, phone, status, default_branch_id').eq('id', u1).single();
  check('الملف أُنشئ بالبيانات الصحيحة', p1?.full_name_ar === 'مستخدم تحقق ١' && p1?.status === 'active');
  check('الفرع الافتراضي مُشتق تلقائيًا', p1?.default_branch_id === ryd.id);

  const { data: r1 } = await ceo.from('user_roles').select('role_id, scope').eq('user_id', u1);
  check('الدور مُسند بالنطاق الصحيح', r1?.length === 1 && r1[0].scope === 'branch' && r1[0].role_id === roleId('reception'));

  const { data: b1 } = await ceo.from('user_branches').select('branch_id, is_default').eq('user_id', u1);
  check('الفرع مُسند مع علامة الافتراضي', b1?.length === 1 && b1[0].branch_id === ryd.id && b1[0].is_default === true);

  /* ---------------- 2) المستخدم الجديد يدخل بصلاحياته فقط ---------------- */
  console.log('\n▶ 2) المستخدم الجديد يدخل بالصلاحيات المحددة فقط');
  // نضبط كلمة مرور معروفة عبر Admin API — في التطبيق يفعلها المستخدم بنفسه
  const u1Password = `Verify!${randomBytes(6).toString('hex')}`;
  await admin.auth.admin.updateUserById(u1, { password: u1Password });

  const u1Client = createClient(URL, PUBLISHABLE, { auth: { persistSession: false } });
  const { error: loginError } = await u1Client.auth.signInWithPassword({ email: u1Email, password: u1Password });
  check('المستخدم الجديد يستطيع الدخول', !loginError, loginError?.message ?? '');

  const { data: seenCustomers } = await u1Client.from('customers').select('branch_id');
  const onlyOwn = (seenCustomers ?? []).every((c) => c.branch_id === ryd.id);
  check('يرى عملاء فرعه فقط', onlyOwn && (seenCustomers?.length ?? 0) > 0, `${seenCustomers?.length ?? 0} عميل`);

  const { data: seenFinance } = await u1Client.from('financial_transactions').select('id');
  check('لا يرى الحركات المالية (صلاحية غير ممنوحة)', (seenFinance?.length ?? 0) === 0);

  const { data: seenUsers } = await u1Client.from('profiles').select('id');
  check('لا يرى قائمة المستخدمين', (seenUsers?.length ?? 0) <= 1, 'ملفه الشخصي فقط');

  /* ---------------- 3) منع التصعيد الذاتي ---------------- */
  console.log('\n▶ 3) منع التصعيد الذاتي');
  const { error: selfRole } = await u1Client
    .from('user_roles')
    .insert({ user_id: u1, role_id: roleId('company_admin'), scope: 'organization' });
  check('لا يُسند المستخدم دورًا لنفسه', Boolean(selfRole), selfRole ? 'مرفوض' : '❌ نجح!');

  const { error: selfBranch } = await u1Client
    .from('user_branches')
    .insert({ user_id: u1, branch_id: jed.id });
  check('لا يمنح نفسه فرعًا جديدًا', Boolean(selfBranch), selfBranch ? 'مرفوض' : '❌ نجح!');

  const { error: selfAssign } = await u1Client.rpc('set_user_assignment', {
    p_user_id: u1,
    p_role_id: roleId('company_admin'),
    p_scope: 'organization',
    p_branch_ids: [ryd.id],
  });
  check('لا يغيّر دوره بنفسه عبر التجهيز', Boolean(selfAssign), selfAssign ? 'مرفوض' : '❌ نجح!');

  const { data: rolesAfter } = await ceo.from('user_roles').select('role_id').eq('user_id', u1);
  check('دور المستخدم لم يتغير فعليًا', rolesAfter?.length === 1 && rolesAfter[0].role_id === roleId('reception'));

  /* ---------------- 4) منع منح ما لا تملك ---------------- */
  console.log('\n▶ 4) منع منح صلاحيات أعلى من المانح');
  const u2 = await createAuthUser(mail('u2'));
  created.push(u2);
  const { error: escalate } = await reception.rpc('provision_user', {
    p_user_id: u2,
    p_full_name_ar: 'محاولة تصعيد',
    p_role_id: roleId('company_admin'),
    p_scope: 'branch',
    p_branch_ids: [ryd.id],
  });
  check('الاستقبال لا تُنشئ مستخدمًا (بلا صلاحية إنشاء)', Boolean(escalate), escalate ? 'مرفوض' : '❌ نجح!');

  const { data: orphan } = await ceo.from('profiles').select('id').eq('id', u2);
  check('لا ملف معلّق بعد الرفض', (orphan?.length ?? 0) === 0);

  /* ---------------- 5) الذرية ---------------- */
  console.log('\n▶ 5) الذرية عند الفشل');
  const u3 = await createAuthUser(mail('u3'));
  created.push(u3);
  const { error: noBranch } = await ceo.rpc('provision_user', {
    p_user_id: u3,
    p_full_name_ar: 'بلا فرع',
    p_role_id: roleId('reception'),
    p_scope: 'branch',
    p_branch_ids: [],
  });
  check('نطاق فرع بلا فروع مرفوض', Boolean(noBranch), noBranch?.message?.slice(0, 40) ?? '');
  const { data: u3Profile } = await ceo.from('profiles').select('id').eq('id', u3);
  check('لا ملف ولا دور بعد الفشل', (u3Profile?.length ?? 0) === 0);

  /* ---------------- 6) تغيير الدور والفروع ---------------- */
  console.log('\n▶ 6) تعديل الدور والفروع');
  const { error: reassign } = await ceo.rpc('set_user_assignment', {
    p_user_id: u1,
    p_role_id: roleId('branch_manager'),
    p_scope: 'branch',
    p_branch_ids: [ryd.id, jed.id],
  });
  check('مدير المنشأة يستبدل الدور والفروع', !reassign, reassign?.message ?? '');

  const { data: r2 } = await ceo.from('user_roles').select('role_id').eq('user_id', u1);
  check('الدور استُبدل ولم يتراكم', r2?.length === 1 && r2[0].role_id === roleId('branch_manager'));
  const { data: b2 } = await ceo.from('user_branches').select('branch_id, is_default').eq('user_id', u1);
  check('الفروع صارت اثنين بفرع افتراضي واحد', b2?.length === 2 && b2.filter((b) => b.is_default).length === 1);

  /* ---------------- 7) الإيقاف يمنع الدخول ---------------- */
  console.log('\n▶ 7) الإيقاف يمنع الدخول');
  const { error: suspendError } = await ceo.from('profiles').update({ status: 'suspended' }).eq('id', u1);
  check('مدير المنشأة يوقف المستخدم', !suspendError, suspendError?.message ?? '');

  // طبقة 1: الصلاحيات تُلغى في المحرّك للجلسة القائمة
  const { data: afterSuspend } = await u1Client.from('customers').select('id');
  check('الجلسة القائمة لم تبقَ ترى بيانات', (afterSuspend?.length ?? 0) === 0);

  // طبقة 2: حظر GoTrue يمنع تسجيل دخول جديد
  await admin.auth.admin.updateUserById(u1, { ban_duration: '876000h' });
  const banned = createClient(URL, PUBLISHABLE, { auth: { persistSession: false } });
  const { error: bannedLogin } = await banned.auth.signInWithPassword({ email: u1Email, password: u1Password });
  check('تسجيل دخول جديد مرفوض بعد الحظر', Boolean(bannedLogin), bannedLogin ? 'مرفوض' : '❌ نجح!');

  // إعادة التفعيل
  await admin.auth.admin.updateUserById(u1, { ban_duration: 'none' });
  await ceo.from('profiles').update({ status: 'active' }).eq('id', u1);
  const revived = createClient(URL, PUBLISHABLE, { auth: { persistSession: false } });
  const { error: revivedLogin } = await revived.auth.signInWithPassword({ email: u1Email, password: u1Password });
  check('إعادة التفعيل تُعيد الدخول', !revivedLogin, revivedLogin?.message ?? '');

  /* ---------------- 8) منع مستخدم فرع من الخروج عن نطاقه ---------------- */
  console.log('\n▶ 8) نطاق الفرع في إدارة المستخدمين');
  // u1 أصبح مدير فرع في RYD و JED لكنه بلا صلاحيات إدارة مستخدمين
  const u1Session = createClient(URL, PUBLISHABLE, { auth: { persistSession: false } });
  await u1Session.auth.signInWithPassword({ email: u1Email, password: u1Password });

  const nameBefore = (await ceo.from('profiles').select('full_name_ar').eq('id', u1).single()).data.full_name_ar;
  await u1Session.from('profiles').update({ full_name_ar: 'مُختَرَق' }).neq('id', u1);
  const { data: ceoProfile } = await ceo.from('profiles').select('full_name_ar').eq('id', (await ceo.auth.getUser()).data.user.id).single();
  check('مدير فرع بلا صلاحية لا يعدّل غيره', ceoProfile.full_name_ar !== 'مُختَرَق', 'لم يتغير');
  check('اسم المستخدم نفسه لم يُمسّ', nameBefore === 'مستخدم تحقق ١');

  /* ---------------- 9) لا تُظهر اللوحة كلمات مرور ---------------- */
  console.log('\n▶ 9) لا كلمات مرور في مسار القراءة');
  const { data: profileCols, error: pwError } = await ceo.from('profiles').select('*').eq('id', u1).single();
  const hasSecret = Object.keys(profileCols ?? {}).some((k) => /password|secret|token/i.test(k));
  check('جدول الملفات بلا أي عمود كلمة مرور', !hasSecret && !pwError);
} finally {
  console.log('\n▶ تنظيف المستخدمين التجريبيين');
  for (const id of created) {
    const { error } = await admin.auth.admin.deleteUser(id);
    console.log(`  ${error ? '⚠️' : '🗑'} ${id}${error ? ` — ${error.message}` : ''}`);
  }
}

console.log('\n══════════════════════════════════════════════════════════════════════');
console.log(`  النتيجة: ${pass} ناجح · ${fail} فاشل`);
console.log('══════════════════════════════════════════════════════════════════════\n');
if (fail > 0) failures.forEach((f) => console.log(`  ❌ ${f}`));
process.exitCode = fail > 0 ? 1 : 0;
