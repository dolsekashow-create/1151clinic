#!/usr/bin/env node
/**
 * تحقق فعلي من الحضور والانصراف على قاعدة التطوير.
 *
 * ⚠️ كل عمليات الموظف بمفتاح Publishable + جلسة حقيقية. مفتاح الخدمة يُستخدم
 *    للتهيئة والتنظيف فقط — لا في أي مسار يُفترض أن يمر بـRLS.
 *
 * التشغيل: pnpm demo:verify:attendance
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
const admin = createClient(URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const creds = JSON.parse(readFileSync(resolve(root, '.demo-credentials/demo-users.json'), 'utf8'));
const pw = new Map(creds.users.map((u) => [u.email, u.password]));

let pass = 0;
let fail = 0;
const failures = [];
function check(name, ok, note = '') {
  ok ? (pass += 1) : (fail += 1);
  if (!ok) failures.push(name);
  console.log(`  ${ok ? '✅' : '❌'} ${name.padEnd(56)} ${note}`);
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

console.log('\n══════════════════════════════════════════════════════════════════════');
console.log('  تحقق الحضور والانصراف — النطاق الجغرافي والعزل');
console.log('══════════════════════════════════════════════════════════════════════\n');

const ceo = await login('ceo');
const reception = await login('rec.ryd01');
const receptionId = (await reception.auth.getUser()).data.user.id;

const { data: branches } = await admin.from('branches').select('id, code, latitude, longitude, geofence_radius_meters').order('code');
const ryd = branches.find((b) => b.code === 'RYD-01');
const jed = branches.find((b) => b.code === 'JED-01');
const snapshot = { lat: ryd.latitude, lng: ryd.longitude, radius: ryd.geofence_radius_meters };

/* موقع تجريبي للفرع + نقاط حوله */
const SITE = { lat: 24.711, lng: 46.674, radius: 150 };
const INSIDE = { lat: 24.7115, lng: 46.674 };   // ~55 م
const OUTSIDE = { lat: 24.721, lng: 46.674 };   // ~1.1 كم

const created = [];

try {
  await admin
    .from('branches')
    .update({ latitude: SITE.lat, longitude: SITE.lng, geofence_radius_meters: SITE.radius })
    .eq('id', ryd.id);
  // نُنظّف أي جلسة مفتوحة سابقة لهذا المستخدم
  await admin.from('attendance_sessions').delete().eq('user_id', receptionId);

  /* ---------------- 1) تسجيل الحضور ---------------- */
  console.log('▶ 1) تسجيل الحضور بالموقع');
  const { data: inRes, error: inErr } = await reception.rpc('attendance_check_in', {
    p_branch: ryd.id,
    p_latitude: INSIDE.lat,
    p_longitude: INSIDE.lng,
  });
  check('موظف داخل النطاق يسجّل حضوره', !inErr && inRes?.[0]?.session_id, inErr?.message ?? '');
  if (inRes?.[0]) created.push(inRes[0].session_id);
  check('المسافة محسوبة في المحرّك', Number(inRes?.[0]?.distance_meters) > 0 && Number(inRes?.[0]?.distance_meters) < SITE.radius, `${Math.round(Number(inRes?.[0]?.distance_meters ?? 0))} م`);

  const { data: stored } = await admin
    .from('attendance_sessions')
    .select('checked_in_at, check_in_latitude, check_in_distance_meters, duration_minutes')
    .eq('id', inRes[0].session_id)
    .single();
  const drift = Math.abs(Date.now() - new Date(stored.checked_in_at).getTime());
  check('الوقت من الخادم لا من الجهاز', drift < 120_000, `فارق ${Math.round(drift / 1000)} ث`);
  check('الإحداثيات محفوظة كدليل', Number(stored.check_in_latitude) === INSIDE.lat);
  check('المدة فارغة قبل الانصراف', stored.duration_minutes === null);

  /* ---------------- 2) منع الازدواج ---------------- */
  console.log('\n▶ 2) منع الجلسات المزدوجة');
  const { error: dupErr } = await reception.rpc('attendance_check_in', {
    p_branch: ryd.id,
    p_latitude: INSIDE.lat,
    p_longitude: INSIDE.lng,
  });
  check('جلسة ثانية مرفوضة', Boolean(dupErr), 'مرفوضة');

  const { count: openCount } = await admin
    .from('attendance_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', receptionId)
    .is('checked_out_at', null);
  check('جلسة مفتوحة واحدة فقط', openCount === 1, `${openCount}`);

  /* ---------------- 3) النطاق الجغرافي ---------------- */
  console.log('\n▶ 3) النطاق الجغرافي');
  await admin.from('attendance_sessions').delete().eq('user_id', receptionId);

  const { error: farErr } = await reception.rpc('attendance_check_in', {
    p_branch: ryd.id,
    p_latitude: OUTSIDE.lat,
    p_longitude: OUTSIDE.lng,
  });
  check('خارج النطاق مرفوض', Boolean(farErr), farErr?.message?.slice(0, 45) ?? '');

  await admin.from('branches').update({ geofence_radius_meters: null }).eq('id', ryd.id);
  const { error: noGeoErr } = await reception.rpc('attendance_check_in', {
    p_branch: ryd.id,
    p_latitude: INSIDE.lat,
    p_longitude: INSIDE.lng,
  });
  check('فرع بلا نطاق لا يقبل حضورًا', Boolean(noGeoErr), 'مرفوض');
  await admin.from('branches').update({ geofence_radius_meters: SITE.radius }).eq('id', ryd.id);

  const { error: otherBranchErr } = await reception.rpc('attendance_check_in', {
    p_branch: jed.id,
    p_latitude: INSIDE.lat,
    p_longitude: INSIDE.lng,
  });
  check('فرع خارج نطاق الموظف مرفوض', Boolean(otherBranchErr), 'مرفوض');

  /* ---------------- 4) منع التزوير ---------------- */
  console.log('\n▶ 4) منع التزوير');
  const { error: insertErr } = await reception.from('attendance_sessions').insert({
    organization_id: (await admin.from('organizations').select('id').single()).data.id,
    branch_id: ryd.id,
    user_id: receptionId,
    check_in_latitude: SITE.lat,
    check_in_longitude: SITE.lng,
    check_in_distance_meters: 0,
  });
  check('لا إدراج مباشر لسجل حضور', Boolean(insertErr), 'مرفوض');

  const { data: fresh } = await reception.rpc('attendance_check_in', {
    p_branch: ryd.id,
    p_latitude: INSIDE.lat,
    p_longitude: INSIDE.lng,
  });
  if (fresh?.[0]) created.push(fresh[0].session_id);

  const beforeDist = (
    await admin.from('attendance_sessions').select('check_in_distance_meters').eq('id', fresh[0].session_id).single()
  ).data.check_in_distance_meters;
  await reception
    .from('attendance_sessions')
    .update({ check_in_distance_meters: 0 })
    .eq('id', fresh[0].session_id);
  const afterDist = (
    await admin.from('attendance_sessions').select('check_in_distance_meters').eq('id', fresh[0].session_id).single()
  ).data.check_in_distance_meters;
  check('الموظف لا يعدّل مسافته المسجّلة', Number(afterDist) === Number(beforeDist), 'لم تتغير');

  const { error: delErr } = await reception.from('attendance_sessions').delete().eq('id', fresh[0].session_id);
  const stillThere = (await admin.from('attendance_sessions').select('id').eq('id', fresh[0].session_id)).data;
  check('لا حذف لسجل حضور', (stillThere ?? []).length === 1, delErr ? 'مرفوض' : 'لم يُحذف');

  /* ---------------- 5) الانصراف والمدة ---------------- */
  console.log('\n▶ 5) الانصراف واحتساب المدة');
  await admin
    .from('attendance_sessions')
    .update({ checked_in_at: new Date(Date.now() - 90 * 60_000).toISOString() })
    .eq('id', fresh[0].session_id);

  const { data: outRes, error: outErr } = await reception.rpc('attendance_check_out', {
    p_latitude: INSIDE.lat,
    p_longitude: INSIDE.lng,
  });
  check('الانصراف ينجح', !outErr, outErr?.message ?? '');
  check(
    'المدة محسوبة في المحرّك',
    outRes?.[0]?.duration_minutes >= 89 && outRes?.[0]?.duration_minutes <= 91,
    `${outRes?.[0]?.duration_minutes} دقيقة`,
  );

  const { error: noSessionErr } = await reception.rpc('attendance_check_out', {
    p_latitude: INSIDE.lat,
    p_longitude: INSIDE.lng,
  });
  check('انصراف بلا جلسة مفتوحة مرفوض', Boolean(noSessionErr), 'مرفوض');

  /* ---------------- 6) العزل ---------------- */
  console.log('\n▶ 6) العزل والصلاحيات');
  const { data: own } = await reception.from('attendance_sessions').select('user_id');
  check(
    'الموظف يرى سجله دائمًا بلا صلاحية',
    (own ?? []).length > 0 && own.every((r) => r.user_id === receptionId),
    `${own?.length ?? 0} سجل`,
  );

  const { data: ceoSees } = await ceo.from('attendance_sessions').select('user_id');
  check('مدير المنشأة يرى سجلات موظفيه', (ceoSees ?? []).length > 0, `${ceoSees?.length ?? 0} سجل`);

  const { data: summary, error: sumErr } = await ceo.rpc('attendance_monthly_summary', {
    p_month: `${new Date().toISOString().slice(0, 7)}-01`,
    p_branch: null,
  });
  check('الملخّص الشهري يعمل', !sumErr && (summary ?? []).length > 0, `${summary?.length ?? 0} موظف`);
  const row = (summary ?? []).find((r) => r.user_id === receptionId);
  check('مجموع الدقائق صحيح', row && row.total_minutes >= 89, `${row?.total_minutes ?? 0} دقيقة`);

  const { data: recSummary } = await reception.rpc('attendance_monthly_summary', {
    p_month: `${new Date().toISOString().slice(0, 7)}-01`,
    p_branch: null,
  });
  check('موظف بلا صلاحية العرض: ملخّص فارغ', (recSummary ?? []).length === 0);

  /* ---------------- 7) anon ---------------- */
  console.log('\n▶ 7) الزائر لا يرى شيئًا');
  const anon = createClient(URL, PUBLISHABLE, { auth: { persistSession: false } });
  const { data: anonData, error: anonErr } = await anon.from('attendance_sessions').select('id').limit(1);
  check('anon لا يقرأ الحضور', Boolean(anonErr) || (anonData ?? []).length === 0, 'محجوب');
  const { error: anonRpc } = await anon.rpc('attendance_check_in', {
    p_branch: ryd.id,
    p_latitude: INSIDE.lat,
    p_longitude: INSIDE.lng,
  });
  check('anon لا يسجّل حضورًا', Boolean(anonRpc), 'مرفوض');
} finally {
  console.log('\n▶ التنظيف واستعادة الحالة');
  await admin.from('attendance_sessions').delete().eq('user_id', receptionId);
  await admin
    .from('branches')
    .update({ latitude: snapshot.lat, longitude: snapshot.lng, geofence_radius_meters: snapshot.radius })
    .eq('id', ryd.id);
  console.log(`  🗑 ${created.length} جلسة · ↩ موقع الفرع مستعاد`);
}

console.log('\n══════════════════════════════════════════════════════════════════════');
console.log(`  النتيجة: ${pass} ناجح · ${fail} فاشل`);
console.log('══════════════════════════════════════════════════════════════════════\n');
if (fail > 0) failures.forEach((f) => console.log(`  ❌ ${f}`));
process.exitCode = fail > 0 ? 1 : 0;
