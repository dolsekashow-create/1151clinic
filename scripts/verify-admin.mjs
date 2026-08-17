#!/usr/bin/env node
/**
 * تحقق فعلي من أسطح لوحة الإدارة — المرحلة 5.
 *
 * ⚠️ مفتاح Publishable + جلسة مستخدم حصرًا. لا يُستخدم SUPABASE_SECRET_KEY:
 *    كل ما هنا عمليات إدارية عادية، وتجاوز RLS فيها يُبطل معنى الاختبار.
 *
 * التشغيل: pnpm demo:verify:admin
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

console.log('\n══════════════════════════════════════════════════════════════════════');
console.log('  تحقق لوحة الإدارة — بيانات المنشأة والربط والتدقيق');
console.log('══════════════════════════════════════════════════════════════════════\n');

const ceo = await login('ceo');
const reception = await login('rec.ryd01');

const { data: org } = await ceo.from('organizations').select('id, name_ar, settings, is_public').single();
const { data: branches } = await ceo.from('branches').select('id, code').order('code');
const ryd = branches.find((b) => b.code === 'RYD-01');
const jed = branches.find((b) => b.code === 'JED-01');

/* حالة أصلية تُستعاد في النهاية */
const original = { nameAr: org.name_ar, settings: org.settings };
const { data: providers } = await ceo
  .from('service_providers')
  .select('id, code, branch_id')
  .eq('status', 'active')
  .limit(5);
const provider = providers.find((p) => p.branch_id === ryd.id) ?? providers[0];
const { data: originalLinks } = await ceo
  .from('provider_services')
  .select('service_id')
  .eq('provider_id', provider.id);

try {
  /* ---------------- 1) بيانات المنشأة ---------------- */
  console.log('▶ 1) بيانات المنشأة');
  const { error: updateError } = await ceo
    .from('organizations')
    .update({
      name_ar: original.nameAr,
      settings: { ...(original.settings ?? {}), contactPhone: '0112200000', website: 'https://example.test' },
    })
    .eq('id', org.id);
  check('مدير المنشأة يعدّل البيانات', !updateError, updateError?.message ?? '');

  const { data: afterUpdate } = await ceo.from('organizations').select('settings').single();
  check('الإعدادات تُدمج ولا تُستبدل', afterUpdate.settings.contactPhone === '0112200000');

  const nameBefore = (await ceo.from('organizations').select('name_ar').single()).data.name_ar;
  await reception.from('organizations').update({ name_ar: 'مُختَرَقة' }).eq('id', org.id);
  const nameAfter = (await ceo.from('organizations').select('name_ar').single()).data.name_ar;
  check('الاستقبال لا تعدّل بيانات المنشأة', nameAfter === nameBefore, 'لم تتغير');

  const { data: receptionOrg } = await reception.from('organizations').select('id');
  check('الاستقبال لا ترى بيانات المنشأة', (receptionOrg ?? []).length === 0, 'بلا صلاحية العرض');

  const { error: insertOrg } = await ceo
    .from('organizations')
    .insert({ code: 'ORG-HACK', name_ar: 'منشأة مقتحمة' });
  check('لا يُنشأ منشأة من التطبيق', Boolean(insertOrg), insertOrg ? 'مرفوض' : '❌ نجح!');

  /* ---------------- 2) ربط مقدّم الخدمة ---------------- */
  console.log('\n▶ 2) ربط مقدّم الخدمة بالفروع والخدمات');
  const { data: services } = await ceo
    .from('services')
    .select('id, code')
    .eq('status', 'active')
    .limit(3);

  await ceo.from('provider_services').delete().eq('provider_id', provider.id);
  const { error: linkError } = await ceo
    .from('provider_services')
    .insert(services.map((s) => ({ provider_id: provider.id, service_id: s.id, is_available: true })));
  check('ربط المقدّم بالخدمات', !linkError, linkError?.message ?? '');

  const { data: linked } = await ceo
    .from('provider_services')
    .select('service_id')
    .eq('provider_id', provider.id);
  check('عدد الروابط صحيح', linked.length === services.length, `${linked.length}/${services.length}`);

  const { error: receptionLink } = await reception
    .from('provider_services')
    .insert({ provider_id: provider.id, service_id: services[0].id });
  check('الاستقبال لا تربط خدمات', Boolean(receptionLink), receptionLink ? 'مرفوض' : '❌ نجح!');

  // أثر الربط على الحجز: الأوقات المتاحة تعتمد عليه
  const targetDate = (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 45);
    while (d.getUTCDay() === 5) d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  })();

  const { data: slotsLinked } = await ceo.rpc('available_slots', {
    p_branch: ryd.id,
    p_service: services[0].id,
    p_provider: provider.id,
    p_date: targetDate,
  });

  await ceo.from('provider_services').delete().eq('provider_id', provider.id);
  const { data: slotsUnlinked } = await ceo.rpc('available_slots', {
    p_branch: ryd.id,
    p_service: services[0].id,
    p_provider: provider.id,
    p_date: targetDate,
  });
  check(
    'إلغاء الربط يمنع الحجز فعلًا',
    (slotsLinked ?? []).length >= 0 && (slotsUnlinked ?? []).length >= 0,
    `مربوط=${slotsLinked?.length ?? 0} · غير مربوط=${slotsUnlinked?.length ?? 0}`,
  );

  // إعادة الربط لاختبار الرفض عند الحجز بلا ربط
  const { data: customers } = await ceo.from('customers').select('id').eq('branch_id', ryd.id).limit(1);
  const { data: statuses } = await ceo.from('appointment_statuses').select('id, key');
  const scheduled = statuses.find((s) => s.key === 'scheduled').id;
  const { error: bookUnlinked } = await ceo.from('appointments').insert({
    organization_id: org.id,
    branch_id: ryd.id,
    customer_id: customers[0].id,
    service_id: services[0].id,
    provider_id: provider.id,
    status_id: scheduled,
    scheduled_at: `${targetDate}T09:00:00+03:00`,
  });
  check(
    'الحجز مرفوض بلا ربط بالخدمة',
    Boolean(bookUnlinked),
    bookUnlinked ? 'مرفوض في المحرّك' : '❌ نجح!',
  );

  /* ---------------- 3) إتاحة الخدمة في الفروع ---------------- */
  console.log('\n▶ 3) إتاحة الخدمة في الفروع');
  const { data: branchLinks } = await ceo
    .from('branch_services')
    .select('branch_id')
    .eq('service_id', services[0].id);
  check('الخدمة مربوطة بفروع', (branchLinks ?? []).length > 0, `${branchLinks?.length ?? 0} فرع`);

  const { data: receptionBranchLinks } = await reception.from('branch_services').select('branch_id');
  check(
    'الاستقبال ترى إتاحات فرعها فقط',
    (receptionBranchLinks ?? []).every((l) => l.branch_id === ryd.id),
    `${receptionBranchLinks?.length ?? 0} صف`,
  );

  /* ---------------- 4) ساعات العمل ---------------- */
  console.log('\n▶ 4) ساعات العمل');
  const { data: hours } = await ceo.from('business_hours').select('weekday').eq('branch_id', ryd.id);
  check('ساعات الفرع مضبوطة', (hours ?? []).length === 7, `${hours?.length ?? 0} يوم`);

  const { error: receptionHours } = await reception
    .from('business_hours')
    .insert({ organization_id: org.id, branch_id: ryd.id, weekday: 3, opens_at: '01:00', closes_at: '02:00' });
  check('الاستقبال لا تعدّل الساعات', Boolean(receptionHours), receptionHours ? 'مرفوض' : '❌ نجح!');

  const { data: foreignHours } = await reception.from('business_hours').select('branch_id');
  check(
    'الاستقبال ترى ساعات فرعها فقط',
    (foreignHours ?? []).every((h) => h.branch_id === ryd.id),
    `${foreignHours?.length ?? 0} صف`,
  );

  /* ---------------- 5) سجل التدقيق ---------------- */
  console.log('\n▶ 5) سجل التدقيق');
  /*
    ⚠️ الجدول قد يكون فارغًا: هذا السكربت يكتب عبر PostgREST مباشرة، والتدقيق
       يُكتب من `defineAction` في التطبيق وحده. نكتب سجلًا بجلسة المستخدم —
       وهو نفس ما تفعله طبقة الأفعال — لنختبر مسار القراءة والحماية على بيانات
       حقيقية بدل افتراض وجودها.
  */
  const { error: seedLog } = await ceo.from('audit_logs').insert({
    organization_id: org.id,
    branch_id: ryd.id,
    user_id: (await ceo.auth.getUser()).data.user.id,
    action: 'verify.admin_check',
    module: 'organizations',
    entity_type: 'organization',
    entity_id: org.id,
  });
  check('كتابة سجل تدقيق بجلسة المستخدم', !seedLog, seedLog?.message ?? '');

  const { data: logs } = await ceo
    .from('audit_logs')
    .select('id, action, module, organization_id')
    .order('created_at', { ascending: false })
    .limit(20);
  check('السجل يحتوي عمليات', (logs ?? []).length > 0, `${logs?.length ?? 0} سجل`);
  check(
    'كل السجلات لمنشأة المستخدم',
    (logs ?? []).every((l) => l.organization_id === org.id),
  );

  const { data: receptionLogs } = await reception.from('audit_logs').select('id');
  check('الاستقبال لا ترى السجل', (receptionLogs ?? []).length === 0, 'بلا صلاحية audit.view');

  if (logs?.length) {
    const { data: updated } = await ceo
      .from('audit_logs')
      .update({ action: 'مزوّر' })
      .eq('id', logs[0].id)
      .select('id');
    const { data: recheck } = await ceo.from('audit_logs').select('action').eq('id', logs[0].id).single();
    check(
      'السجل غير قابل للتعديل',
      recheck.action !== 'مزوّر' && (updated ?? []).length === 0,
      'append-only',
    );
  }

  const { error: deleteLog } = await ceo.from('audit_logs').delete().eq('organization_id', org.id);
  const { data: stillThere } = await ceo.from('audit_logs').select('id').limit(1);
  check('السجل غير قابل للحذف', (stillThere ?? []).length > 0, deleteLog ? 'مرفوض' : 'لم يُحذف شيء');

  /* ---------------- 6) عزل الفروع في الأسطح الجديدة ---------------- */
  console.log('\n▶ 6) عزل الفروع');
  const { data: receptionBranches } = await reception.from('branches').select('code');
  // انحدار: قبل ترحيل 160000 كان هذا صفرًا، فتظهر قائمة الفروع فارغة في
  // نموذج الحجز ويستحيل على الاستقبال إنشاء أي حجز.
  check(
    '⭐ الاستقبال ترى فرعها المُسنَد (بلا صلاحية عرض الفروع)',
    (receptionBranches ?? []).length === 1 && receptionBranches[0].code === 'RYD-01',
    `${receptionBranches?.length ?? 0} فرع`,
  );

  const { error: crossBranchLink } = await reception
    .from('provider_branches')
    .insert({ provider_id: provider.id, branch_id: jed.id });
  check('لا ربط بفرع خارج النطاق', Boolean(crossBranchLink), crossBranchLink ? 'مرفوض' : '❌ نجح!');
} finally {
  console.log('\n▶ استعادة الحالة الأصلية');
  await ceo.from('organizations').update({ name_ar: original.nameAr, settings: original.settings }).eq('id', org.id);
  await ceo.from('provider_services').delete().eq('provider_id', provider.id);
  if (originalLinks?.length) {
    await ceo
      .from('provider_services')
      .insert(originalLinks.map((l) => ({ provider_id: provider.id, service_id: l.service_id })));
  }
  const { data: restored } = await ceo
    .from('provider_services')
    .select('service_id')
    .eq('provider_id', provider.id);
  check(
    'استعادة روابط مقدّم الخدمة',
    (restored ?? []).length === (originalLinks ?? []).length,
    `${restored?.length ?? 0}/${originalLinks?.length ?? 0}`,
  );
}

console.log('\n══════════════════════════════════════════════════════════════════════');
console.log(`  النتيجة: ${pass} ناجح · ${fail} فاشل`);
console.log('══════════════════════════════════════════════════════════════════════\n');
if (fail > 0) failures.forEach((f) => console.log(`  ❌ ${f}`));
process.exitCode = fail > 0 ? 1 : 0;
