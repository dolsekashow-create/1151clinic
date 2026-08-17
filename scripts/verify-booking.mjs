#!/usr/bin/env node
/**
 * تحقق فعلي من الحجز العام على قاعدة التطوير.
 *
 * ⚠️ الزائر يُحاكى بمفتاح Publishable **بلا أي جلسة** — أي دور `anon` تمامًا.
 *    لا يُستخدم SUPABASE_SECRET_KEY في أي خطوة من مسار الزائر؛ يُستخدم فقط
 *    للتهيئة والتنظيف وقراءة النتائج بصفتنا «الإدارة».
 *
 * التشغيل: pnpm demo:verify:booking
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
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

const admin = createClient(URL, SECRET, { auth: { persistSession: false } });
/** الزائر — بلا جلسة، دور anon. */
const visitor = () => createClient(URL, PUBLISHABLE, { auth: { persistSession: false } });

let pass = 0;
let fail = 0;
const failures = [];
function check(name, ok, note = '') {
  ok ? (pass += 1) : (fail += 1);
  if (!ok) failures.push(name);
  console.log(`  ${ok ? '✅' : '❌'} ${name.padEnd(56)} ${note}`);
}

console.log('\n══════════════════════════════════════════════════════════════════════');
console.log('  تحقق الحجز العام — دور anon على قاعدة التطوير');
console.log('══════════════════════════════════════════════════════════════════════\n');

/* ---------------- التهيئة: ننشر ما يلزم ونحفظ الحالة ---------------- */
const { data: org } = await admin.from('organizations').select('id, is_public').single();
const { data: branches } = await admin.from('branches').select('id, code, is_public').order('code');
const ryd = branches.find((b) => b.code === 'RYD-01');
const jed = branches.find((b) => b.code === 'JED-01');

const { data: services } = await admin
  .from('services')
  .select('id, code, is_public, status, default_duration_minutes')
  .eq('status', 'active');
const { data: providers } = await admin
  .from('service_providers')
  .select('id, code, branch_id, is_public')
  .eq('status', 'active');
const { data: links } = await admin.from('provider_services').select('provider_id, service_id');
const { data: branchLinks } = await admin
  .from('branch_services')
  .select('service_id')
  .eq('branch_id', ryd.id);

const rydServiceIds = new Set(branchLinks.map((b) => b.service_id));
const candidate = links.find(
  (l) =>
    rydServiceIds.has(l.service_id) &&
    providers.some((p) => p.id === l.provider_id && p.branch_id === ryd.id),
);
if (!candidate) throw new Error('لا يوجد مقدّم خدمة مربوط بخدمة متاحة في فرع الرياض');

const service = services.find((s) => s.id === candidate.service_id);
const provider = providers.find((p) => p.id === candidate.provider_id);

const snapshot = {
  org: org.is_public,
  branch: ryd.is_public,
  service: service.is_public,
  provider: provider.is_public,
};
const createdRefs = [];

await admin.from('organizations').update({ is_public: true }).eq('id', org.id);
await admin.from('branches').update({ is_public: true }).eq('id', ryd.id);
await admin.from('services').update({ is_public: true }).eq('id', service.id);
await admin.from('service_providers').update({ is_public: true }).eq('id', provider.id);

const targetDate = (() => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 75);
  while (d.getUTCDay() === 5) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
})();

const slots = async (b = ryd.id, s = service.id, p = provider.id, date = targetDate) => {
  const { data, error } = await visitor().rpc('public_available_slots', {
    p_branch: b,
    p_service: s,
    p_provider: p,
    p_date: date,
  });
  return error ? [] : (data ?? []).map((r) => r.slot_start);
};

const book = async (over = {}) => {
  const f = {
    branch: ryd.id,
    service: service.id,
    provider: provider.id,
    slot: null,
    name: 'زائر تحقق',
    phone: `05${String(Math.floor(Math.random() * 90000000) + 10000000)}`,
    email: null,
    notes: null,
    key: null,
    ...over,
  };
  return visitor().rpc('create_public_booking', {
    p_branch: f.branch,
    p_service: f.service,
    p_provider: f.provider,
    p_slot: f.slot,
    p_full_name: f.name,
    p_phone: f.phone,
    p_email: f.email,
    p_notes: f.notes,
    p_idempotency_hash: f.key,
  });
};

try {
  /* ---------------- 1) عزل anon ---------------- */
  console.log('▶ 1) anon لا يصل إلى الجداول التشغيلية');
  for (const table of ['customers', 'appointments', 'profiles', 'audit_logs']) {
    const { data, error } = await visitor().from(table).select('id').limit(1);
    check(`قراءة ${table}`, Boolean(error) || (data ?? []).length === 0, error ? 'مرفوض' : 'فارغ');
  }
  const ins = await visitor()
    .from('customers')
    .insert({ organization_id: org.id, branch_id: ryd.id, full_name_ar: 'مقتحم', phone: '0500000000' });
  check('إدراج عميل مباشرة', Boolean(ins.error), 'مرفوض');

  const insA = await visitor()
    .from('appointments')
    .insert({ organization_id: org.id, branch_id: ryd.id, scheduled_at: new Date().toISOString() });
  check('إدراج حجز مباشرة', Boolean(insA.error), 'مرفوض');

  const staffSlots = await visitor().rpc('available_slots', {
    p_branch: ryd.id,
    p_service: service.id,
    p_provider: provider.id,
    p_date: targetDate,
  });
  check('دالة أوقات الموظفين', Boolean(staffSlots.error), 'مرفوضة على anon');

  const rl = await visitor().rpc('consume_rate_limit', { p_bucket_key: 'x', p_limit: 1, p_window_seconds: 60 });
  check('عدّاد الحد من المعدّل', Boolean(rl.error), 'مرفوض على anon');

  /* ---------------- 2) الأوقات المتاحة ---------------- */
  console.log('\n▶ 2) الأوقات المتاحة للزائر');
  const available = await slots();
  check('الزائر يرى أوقاتًا', available.length > 0, `${available.length} وقت`);

  const gap = (new Date(available[1]) - new Date(available[0])) / 60000;
  check('الخطوة = مدة الخدمة', gap === service.default_duration_minutes, `${gap} دقيقة`);

  await admin.from('branches').update({ is_public: false }).eq('id', ryd.id);
  check('فرع غير منشور ⇒ صفر أوقات', (await slots()).length === 0);
  await admin.from('branches').update({ is_public: true }).eq('id', ryd.id);

  await admin.from('services').update({ is_public: false }).eq('id', service.id);
  check('خدمة غير منشورة ⇒ صفر أوقات', (await slots()).length === 0);
  await admin.from('services').update({ is_public: true }).eq('id', service.id);

  await admin.from('service_providers').update({ is_public: false }).eq('id', provider.id);
  check('مقدّم غير منشور ⇒ صفر أوقات', (await slots()).length === 0);
  await admin.from('service_providers').update({ is_public: true }).eq('id', provider.id);

  await admin.from('organizations').update({ is_public: false }).eq('id', org.id);
  check('منشأة غير منشورة ⇒ صفر أوقات', (await slots()).length === 0, 'البوابة العليا');
  await admin.from('organizations').update({ is_public: true }).eq('id', org.id);

  check('أوقات ماضية لا تُعرض', (await slots(ryd.id, service.id, provider.id, '2020-01-05')).length === 0);

  /* ---------------- 3) الحجز ---------------- */
  console.log('\n▶ 3) دورة الحجز');
  const fresh = await slots();
  const slot = fresh[0];

  const { data: created, error: bookError } = await book({ slot });
  check('حجز صحيح ينجح', !bookError && created?.[0]?.reference_no, bookError?.message ?? '');
  const reference = created?.[0]?.reference_no;
  if (reference) createdRefs.push(reference);
  check('الرقم المرجعي بالصيغة المعتمدة', /^APT-\d{6}$/.test(reference ?? ''), reference ?? '');
  check('ليس إعادة إرسال', created?.[0]?.reused === false);

  const { data: stored } = await admin
    .from('appointments')
    .select('duration_minutes, ends_at, scheduled_at, status_id, branch_id')
    .eq('reference_no', reference)
    .single();
  const { data: statuses } = await admin.from('appointment_statuses').select('id, key');
  const statusKey = statuses.find((s) => s.id === stored.status_id)?.key;

  check('الحالة الابتدائية scheduled', statusKey === 'scheduled', statusKey);
  check('المدة من الخدمة', stored.duration_minutes === service.default_duration_minutes, `${stored.duration_minutes} د`);
  check(
    'نهاية الموعد محسوبة في المحرّك',
    new Date(stored.ends_at).getTime() - new Date(stored.scheduled_at).getTime() ===
      service.default_duration_minutes * 60000,
  );
  check('الحجز في الفرع الصحيح', stored.branch_id === ryd.id);

  const after = await slots();
  check('الوقت المحجوز اختفى', !after.includes(slot));

  const dup = await book({ slot });
  check('حجز نفس الوقت مرفوض', Boolean(dup.error), 'مرفوض');

  /* ---------------- 4) عدم التكرار ---------------- */
  console.log('\n▶ 4) عدم التكرار (double-click)');
  const key = randomUUID();
  const slot2 = after[0];
  const first = await book({ slot: slot2, key });
  check('أول طلب بمفتاح ينشئ حجزًا', first.data?.[0]?.reused === false, first.error?.message ?? '');
  if (first.data?.[0]) createdRefs.push(first.data[0].reference_no);

  const beforeCount = (await admin.from('appointments').select('id', { count: 'exact', head: true })).count;
  const replay = await book({ slot: slot2, key });
  const afterCount = (await admin.from('appointments').select('id', { count: 'exact', head: true })).count;

  check('إعادة الإرسال تُعيد نفس الحجز', replay.data?.[0]?.reused === true);
  check('نفس الرقم المرجعي', replay.data?.[0]?.reference_no === first.data?.[0]?.reference_no);
  check('لم يُنشأ حجز ثانٍ', afterCount === beforeCount, `${beforeCount} → ${afterCount}`);

  /* ---------------- 5) رفض التزوير ---------------- */
  console.log('\n▶ 5) رفض القيم المزوّرة');
  const remaining = await slots();
  const testSlot = remaining[0];

  check('فرع غير منشور مرفوض', Boolean((await book({ slot: testSlot, branch: jed.id })).error), 'مرفوض');

  const hiddenService = services.find((s) => s.id !== service.id);
  if (hiddenService) {
    await admin.from('services').update({ is_public: false }).eq('id', hiddenService.id);
    check(
      'خدمة غير منشورة مرفوضة',
      Boolean((await book({ slot: testSlot, service: hiddenService.id })).error),
      'مرفوض',
    );
  }

  check(
    'وقت خارج ساعات العمل مرفوض',
    Boolean((await book({ slot: `${targetDate}T02:00:00+03:00` })).error),
    'مرفوض',
  );
  check(
    'وقت غير محاذٍ للشبكة مرفوض',
    Boolean((await book({ slot: new Date(new Date(testSlot).getTime() + 7 * 60000).toISOString() })).error),
    'مرفوض',
  );
  check('اسم فارغ مرفوض', Boolean((await book({ slot: testSlot, name: '  ' })).error), 'مرفوض');
  check('هاتف فارغ مرفوض', Boolean((await book({ slot: testSlot, phone: '' })).error), 'مرفوض');

  /* ---------------- 6) صفحة التأكيد ---------------- */
  console.log('\n▶ 6) قراءة التأكيد بدور anon');
  const { data: conf, error: confError } = await visitor().rpc('get_public_booking', {
    p_reference: reference,
  });
  check('الرقم المرجعي يُرجع الموعد', !confError && conf?.length === 1, confError?.message ?? '');

  const payload = JSON.stringify(conf?.[0] ?? {});
  check('لا اسم عميل في الاستجابة', !payload.includes('زائر تحقق'));
  const columns = Object.keys(conf?.[0] ?? {});
  check(
    'لا أعمدة شخصية إطلاقًا',
    !columns.some((c) => /customer|email|notes|phone/.test(c) && c !== 'branch_phone'),
    columns.join(', ').slice(0, 60),
  );

  const { data: missing } = await visitor().rpc('get_public_booking', { p_reference: 'APT-999999' });
  check('رقم غير موجود يُرجع لا شيء', (missing ?? []).length === 0);

  /* ---------------- 7) الحجز يظهر للموظفين ---------------- */
  console.log('\n▶ 7) الحجز يظهر في لوحة الإدارة');
  const { data: internal } = await admin
    .from('appointments')
    .select('reference_no, customer_id')
    .eq('reference_no', reference)
    .single();
  check('الحجز مرئي داخليًا', internal?.reference_no === reference);

  const { data: customer } = await admin
    .from('customers')
    .select('branch_id, full_name_ar')
    .eq('id', internal.customer_id)
    .single();
  check('العميل أُنشئ في نفس الفرع', customer.branch_id === ryd.id);
  check('اسم العميل محفوظ', customer.full_name_ar === 'زائر تحقق');

  /* ---------------- 8) الإلغاء يحرّر الوقت ---------------- */
  console.log('\n▶ 8) الإلغاء يحرّر الوقت');
  const cancelled = statuses.find((s) => s.key === 'cancelled').id;
  await admin.from('appointments').update({ status_id: cancelled }).eq('reference_no', reference);
  const freed = await slots();
  check('الوقت عاد متاحًا', freed.includes(slot));
} finally {
  console.log('\n▶ التنظيف واستعادة الحالة');
  for (const ref of createdRefs) {
    await admin.from('appointments').update({ deleted_at: new Date().toISOString() }).eq('reference_no', ref);
  }
  await admin.from('organizations').update({ is_public: snapshot.org }).eq('id', org.id);
  await admin.from('branches').update({ is_public: snapshot.branch }).eq('id', ryd.id);
  await admin.from('services').update({ is_public: snapshot.service }).eq('id', service.id);
  await admin.from('service_providers').update({ is_public: snapshot.provider }).eq('id', provider.id);
  console.log(`  🗑 ${createdRefs.length} حجز · ↩ حالة النشر مستعادة`);
}

console.log('\n══════════════════════════════════════════════════════════════════════');
console.log(`  النتيجة: ${pass} ناجح · ${fail} فاشل`);
console.log('══════════════════════════════════════════════════════════════════════\n');
if (fail > 0) failures.forEach((f) => console.log(`  ❌ ${f}`));
process.exitCode = fail > 0 ? 1 : 0;
