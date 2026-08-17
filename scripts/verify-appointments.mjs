#!/usr/bin/env node
/**
 * تحقق فعلي من نظام الحجز الداخلي على قاعدة التطوير.
 *
 * ⚠️ لا يُستخدم SUPABASE_SECRET_KEY إطلاقًا: الحجز عملية مستخدم عادية،
 *    وتجاوز RLS فيها يُبطل معنى الاختبار. كل شيء بمفتاح Publishable + جلسة.
 *
 * التشغيل: pnpm demo:verify:appointments
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
function check(name, ok, note = '') {
  ok ? (pass += 1) : (fail += 1);
  if (!ok) failures.push(name);
  console.log(`  ${ok ? '✅' : '❌'} ${name.padEnd(58)} ${note}`);
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

const created = [];

console.log('\n══════════════════════════════════════════════════════════════════════');
console.log('  تحقق الحجز الداخلي — التعارض وساعات العمل والعزل');
console.log('══════════════════════════════════════════════════════════════════════\n');

const ceo = await login('ceo');
const reception = await login('rec.ryd01');

const { data: branches } = await ceo.from('branches').select('id, code, timezone').order('code');
const ryd = branches.find((b) => b.code === 'RYD-01');
const jed = branches.find((b) => b.code === 'JED-01');

const { data: statuses } = await ceo.from('appointment_statuses').select('id, key, category');
const statusId = (key) => statuses.find((s) => s.key === key).id;

const { data: services } = await ceo
  .from('services')
  .select('id, code, default_duration_minutes')
  .eq('status', 'active');
const svc = services.find((s) => s.code === 'SVC-CONS'); // مشتركة 20 دقيقة

const { data: bs } = await ceo.from('branch_services').select('service_id').eq('branch_id', ryd.id);
const rydServiceIds = new Set(bs.map((b) => b.service_id));

const { data: ps } = await ceo
  .from('provider_services')
  .select('provider_id')
  .eq('service_id', svc.id);
const capable = new Set(ps.map((p) => p.provider_id));

const { data: provs } = await ceo
  .from('service_providers')
  .select('id, code, branch_id')
  .eq('status', 'active');
const rydProvider = provs.find((p) => p.branch_id === ryd.id && capable.has(p.id));
const jedProvider = provs.find((p) => p.branch_id === jed.id && capable.has(p.id));

const { data: rydCustomers } = await ceo
  .from('customers')
  .select('id')
  .eq('branch_id', ryd.id)
  .limit(2);
const { data: jedCustomers } = await ceo.from('customers').select('id').eq('branch_id', jed.id).limit(1);

/** يوم بعيد في المستقبل لتفادي أي تصادم مع البيانات المزروعة. */
const targetDate = (() => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 60);
  // نتجنّب الجمعة (مغلقة في بذرة ساعات العمل)
  while (d.getUTCDay() === 5) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
})();

const book = (client, fields) =>
  client
    .from('appointments')
    .insert({
      organization_id: fields.org,
      branch_id: fields.branch,
      customer_id: fields.customer,
      service_id: fields.service,
      provider_id: fields.provider,
      status_id: fields.status ?? statusId('scheduled'),
      scheduled_at: fields.at,
    })
    .select('id, duration_minutes, ends_at')
    .single();

const { data: org } = await ceo.from('organizations').select('id').single();

try {
  /* ---------------- 1) الأوقات المتاحة ---------------- */
  console.log(`▶ 1) الأوقات المتاحة (${targetDate})`);
  const { data: slots, error: slotsError } = await ceo.rpc('available_slots', {
    p_branch: ryd.id,
    p_service: svc.id,
    p_provider: rydProvider.id,
    p_date: targetDate,
  });
  check('الدالة تُرجع أوقاتًا', !slotsError && slots.length > 0, `${slots?.length ?? 0} وقت`);

  const times = slots.map((s) => s.slot_start);
  const gap = (new Date(times[1]) - new Date(times[0])) / 60000;
  check('الخطوة = مدة الخدمة', gap === svc.default_duration_minutes, `${gap} دقيقة`);

  const riyadhHour = (iso) =>
    Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Riyadh',
        hour: '2-digit',
        hour12: false,
      }).format(new Date(iso)),
    );
  /*
    ⚠️ لا نُثبّت 08:00 في التوقّع: ساعات الفرع تختلف بين أيام الأسبوع (السبت
       10:00–18:00 وبقية الأيام 08:00–20:00). التوقّع يُقرأ من `business_hours`
       لليوم نفسه — وإلا كان الاختبار يفشل بسبب افتراض خاطئ فيه لا خلل في النظام.
  */
  const weekday = new Date(`${targetDate}T12:00:00+03:00`).getUTCDay();
  const { data: dayHours } = await ceo
    .from('business_hours')
    .select('opens_at, closes_at, is_closed')
    .eq('branch_id', ryd.id)
    .eq('weekday', weekday)
    .eq('is_closed', false)
    .order('opens_at');
  const opensHour = Number(String(dayHours[0].opens_at).slice(0, 2));
  const closesHour = Number(String(dayHours[0].closes_at).slice(0, 2));

  check(
    'أول وقت عند بداية دوام هذا اليوم',
    riyadhHour(times[0]) === opensHour,
    `${riyadhHour(times[0])}:00 · الدوام يبدأ ${opensHour}:00`,
  );
  check(
    'آخر وقت داخل الدوام',
    riyadhHour(times[times.length - 1]) < closesHour,
    `${riyadhHour(times[times.length - 1])}:00 · يغلق ${closesHour}:00`,
  );

  /* ---------------- 2) الحجز والمدة ---------------- */
  console.log('\n▶ 2) الحجز ومدة الخدمة');
  const slot = times[0];
  const { data: a1, error: e1 } = await book(ceo, {
    org: org.id,
    branch: ryd.id,
    customer: rydCustomers[0].id,
    service: svc.id,
    provider: rydProvider.id,
    at: slot,
  });
  check('حجز في وقت متاح ينجح', !e1, e1?.message ?? '');
  if (a1) created.push(a1.id);
  check('المدة مشتقة من الخدمة', a1?.duration_minutes === svc.default_duration_minutes, `${a1?.duration_minutes} د`);
  check(
    'نهاية الموعد = البداية + المدة',
    a1 &&
      new Date(a1.ends_at).getTime() ===
        new Date(slot).getTime() + svc.default_duration_minutes * 60000,
  );

  /* ---------------- 3) منع التعارض ---------------- */
  console.log('\n▶ 3) منع التعارض');
  const { error: dup } = await book(ceo, {
    org: org.id,
    branch: ryd.id,
    customer: rydCustomers[1].id,
    service: svc.id,
    provider: rydProvider.id,
    at: slot,
  });
  check('حجز متطابق مرفوض', Boolean(dup), dup ? 'مرفوض' : '❌ نجح!');

  const overlap = new Date(new Date(slot).getTime() + 5 * 60000).toISOString();
  const { error: partial } = await book(ceo, {
    org: org.id,
    branch: ryd.id,
    customer: rydCustomers[1].id,
    service: svc.id,
    provider: rydProvider.id,
    at: overlap,
  });
  check('تداخل جزئي مرفوض', Boolean(partial), partial ? 'مرفوض' : '❌ نجح!');

  const adjacent = times[1];
  const { data: a2, error: adj } = await book(ceo, {
    org: org.id,
    branch: ryd.id,
    customer: rydCustomers[1].id,
    service: svc.id,
    provider: rydProvider.id,
    at: adjacent,
  });
  check('التلاصق مسموح', !adj, adj?.message ?? '');
  if (a2) created.push(a2.id);

  const { data: slotsAfter } = await ceo.rpc('available_slots', {
    p_branch: ryd.id,
    p_service: svc.id,
    p_provider: rydProvider.id,
    p_date: targetDate,
  });
  const remaining = slotsAfter.map((s) => s.slot_start);
  check('الوقت المحجوز اختفى من المتاح', !remaining.includes(slot));
  check('عدد الأوقات نقص باثنين', remaining.length === times.length - 2, `${times.length} ← ${remaining.length}`);

  /* ---------------- 4) ساعات العمل ---------------- */
  console.log('\n▶ 4) ساعات العمل');
  const beforeOpen = `${targetDate}T04:00:00+03:00`;
  const { error: early } = await book(ceo, {
    org: org.id,
    branch: ryd.id,
    customer: rydCustomers[0].id,
    service: svc.id,
    provider: rydProvider.id,
    at: beforeOpen,
  });
  check('حجز قبل الدوام مرفوض', Boolean(early), early ? 'مرفوض' : '❌ نجح!');

  const friday = (() => {
    const d = new Date(`${targetDate}T00:00:00Z`);
    while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() + 1);
    return `${d.toISOString().slice(0, 10)}T12:00:00+03:00`;
  })();
  const { error: closed } = await book(ceo, {
    org: org.id,
    branch: ryd.id,
    customer: rydCustomers[0].id,
    service: svc.id,
    provider: rydProvider.id,
    at: friday,
  });
  check('حجز في يوم مغلق (الجمعة) مرفوض', Boolean(closed), closed ? 'مرفوض' : '❌ نجح!');

  const { data: fridaySlots } = await ceo.rpc('available_slots', {
    p_branch: ryd.id,
    p_service: svc.id,
    p_provider: rydProvider.id,
    p_date: friday.slice(0, 10),
  });
  check('اليوم المغلق لا يُنتج أوقاتًا', (fridaySlots ?? []).length === 0);

  /* ---------------- 5) تماسك الخدمة والمقدّم ---------------- */
  console.log('\n▶ 5) تماسك الخدمة والمقدّم');
  const { error: wrongBranch } = await book(ceo, {
    org: org.id,
    branch: ryd.id,
    customer: rydCustomers[0].id,
    service: svc.id,
    provider: jedProvider.id,
    at: times[3],
  });
  check('مقدّم من فرع آخر مرفوض', Boolean(wrongBranch), wrongBranch ? 'مرفوض' : '❌ نجح!');

  const { error: wrongCustomer } = await book(ceo, {
    org: org.id,
    branch: ryd.id,
    customer: jedCustomers[0].id,
    service: svc.id,
    provider: rydProvider.id,
    at: times[3],
  });
  check('عميل من فرع آخر مرفوض', Boolean(wrongCustomer), wrongCustomer ? 'مرفوض' : '❌ نجح!');

  const unlinked = services.find((s) => !rydServiceIds.has(s.id) && s.id !== svc.id);
  if (unlinked) {
    const { error: notInBranch } = await book(ceo, {
      org: org.id,
      branch: ryd.id,
      customer: rydCustomers[0].id,
      service: unlinked.id,
      provider: rydProvider.id,
      at: times[3],
    });
    check('خدمة غير متاحة في الفرع مرفوضة', Boolean(notInBranch), notInBranch ? 'مرفوض' : '❌ نجح!');
  } else {
    check('خدمة غير متاحة في الفرع مرفوضة', true, 'تخطّي — كل الخدمات مربوطة');
  }

  /* ---------------- 6) العزل ---------------- */
  console.log('\n▶ 6) عزل الفروع');
  const { error: crossBranch } = await book(reception, {
    org: org.id,
    branch: jed.id,
    customer: jedCustomers[0].id,
    service: svc.id,
    provider: jedProvider.id,
    at: times[4],
  });
  check('استقبال الرياض لا تحجز في جدة', Boolean(crossBranch), crossBranch ? 'مرفوض' : '❌ نجح!');

  const { data: seen } = await reception.from('appointments').select('branch_id');
  check(
    'الاستقبال ترى حجوزات فرعها فقط',
    (seen ?? []).length > 0 && seen.every((a) => a.branch_id === ryd.id),
    `${seen?.length ?? 0} حجز`,
  );

  const { data: ceoSeen } = await ceo.from('appointments').select('branch_id');
  const distinct = new Set((ceoSeen ?? []).map((a) => a.branch_id));
  check('مدير المنشأة يرى كل الفروع', distinct.size > 1, `${distinct.size} فرع`);

  const { data: foreignSlots } = await reception.rpc('available_slots', {
    p_branch: jed.id,
    p_service: svc.id,
    p_provider: jedProvider.id,
    p_date: targetDate,
  });
  check('لا تُكشف أوقات فرع خارج النطاق', (foreignSlots ?? []).length === 0);

  /* ---------------- 7) الإلغاء يحرّر الوقت ---------------- */
  console.log('\n▶ 7) الإلغاء يحرّر الوقت');
  await ceo.from('appointments').update({ status_id: statusId('cancelled') }).eq('id', created[0]);
  const { data: afterCancel } = await ceo.rpc('available_slots', {
    p_branch: ryd.id,
    p_service: svc.id,
    p_provider: rydProvider.id,
    p_date: targetDate,
  });
  check(
    'الوقت عاد متاحًا بعد الإلغاء',
    afterCancel.map((s) => s.slot_start).includes(slot),
  );

  const { data: reused, error: reuseError } = await book(ceo, {
    org: org.id,
    branch: ryd.id,
    customer: rydCustomers[0].id,
    service: svc.id,
    provider: rydProvider.id,
    at: slot,
  });
  check('يمكن حجز الوقت المُفرَّج عنه', !reuseError, reuseError?.message ?? '');
  if (reused) created.push(reused.id);

  /* ---------------- 8) لا منطق مالي ---------------- */
  console.log('\n▶ 8) لا منطق مالي في الحجز');
  const { data: sample } = await ceo.from('appointments').select('*').limit(1).single();
  const financial = Object.keys(sample ?? {}).filter((k) =>
    /price|amount|cost|paid|deposit|invoice|fee|discount/i.test(k),
  );
  check('لا عمود مالي في جدول الحجوزات', financial.length === 0, financial.join(', '));
} finally {
  console.log('\n▶ تنظيف حجوزات التحقق');
  for (const id of created) {
    const { error } = await ceo.from('appointments').update({ deleted_at: new Date().toISOString() }).eq('id', id);
    console.log(`  ${error ? '⚠️' : '🗑'} ${id}${error ? ` — ${error.message}` : ''}`);
  }
}

console.log('\n══════════════════════════════════════════════════════════════════════');
console.log(`  النتيجة: ${pass} ناجح · ${fail} فاشل`);
console.log('══════════════════════════════════════════════════════════════════════\n');
if (fail > 0) failures.forEach((f) => console.log(`  ❌ ${f}`));
process.exitCode = fail > 0 ? 1 : 0;
