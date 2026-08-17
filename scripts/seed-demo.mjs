#!/usr/bin/env node
/**
 * ============================================================================
 *  بذرة بيانات التجربة (Demo Seed) — بيئة التطوير/الاختبار فقط
 * ============================================================================
 *
 *  التشغيل:
 *     node scripts/seed-demo.mjs --dry-run     ← يطبع الخطة بلا أي اتصال بالشبكة
 *     node scripts/seed-demo.mjs --confirm     ← ينفّذ فعليًا
 *
 *  ⚠️ ضمانات السلامة (كلها مُفعّلة قبل أي كتابة):
 *     1. قائمة بيضاء لمعرّف المشروع — يرفض العمل على أي مشروع غير مخصص للتجربة.
 *     2. يتطلب --confirm صريحًا؛ بلا وسائط يعمل بوضع dry-run.
 *     3. يتوقف إن وجد بيانات لا تحمل بصمة التجربة.
 *     4. صفر DROP · صفر DELETE · صفر TRUNCATE · صفر تعديل مخطط.
 *     5. معرّفات حتمية (UUID v5) ⇒ إعادة التشغيل لا تُنشئ تكرارًا.
 *     6. الأسرار تُقرأ من apps/web/.env.local ولا تُطبع ولا تُكتب في أي مخرج.
 *
 *  ⛔ هذا الملف **ليس** Migration ولن يُنقل للإنتاج. بيانات التجربة معزولة تمامًا
 *     عن supabase/migrations — راجع docs/DEMO_DATA_PLAN.md §6.
 * ============================================================================
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

/* ========================================================================== */
/*  الحواجز                                                                    */
/* ========================================================================== */

/** مشاريع التطوير المسموح البذر فيها. أي مشروع آخر — بما فيه أي إنتاج — مرفوض. */
const ALLOWED_PROJECT_REFS = ['axtezcgdkdkdyflbdndv'];

/** بصمة تُوسم بها كل السجلات ⇒ قابلة للتمييز والحذف اليدوي لاحقًا. */
const DEMO_ORG_CODE = 'DEMO';
const DEMO_EMAIL_DOMAIN = 'demo.local';

const args = new Set(process.argv.slice(2));
const DRY_RUN = !args.has('--confirm');

/* ========================================================================== */
/*  قراءة البيئة                                                              */
/* ========================================================================== */

function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = { ...loadEnvFile(resolve(root, 'apps/web/.env.local')), ...process.env };

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SECRET_KEY = env.SUPABASE_SECRET_KEY ?? '';
const projectRef = /^https:\/\/([a-z0-9]+)\.supabase\.co/i.exec(SUPABASE_URL)?.[1] ?? '';

/* ========================================================================== */
/*  معرّفات حتمية — نفس المدخل ⇒ نفس المعرّف دائمًا (idempotency)              */
/* ========================================================================== */

const NAMESPACE = 'erp-demo-seed:v1';
function did(kind, key) {
  const h = createHash('sha1').update(`${NAMESPACE}:${kind}:${key}`).digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50; // النسخة 5
  b[8] = (b[8] & 0x3f) | 0x80; // المتغيّر RFC-4122
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const ORG_ID = did('org', DEMO_ORG_CODE);

/* ========================================================================== */
/*  تعريف البيانات — واقعية ومترابطة، لا عشوائية                              */
/* ========================================================================== */

/** 15 فرعًا لمحاكاة الحجم الحقيقي. */
const BRANCHES = [
  { code: 'RYD-01', name: 'العليا', city: 'الرياض', role: 'main' },
  { code: 'RYD-02', name: 'الملقا', city: 'الرياض', role: 'isolation-pair' },
  { code: 'RYD-03', name: 'حطين', city: 'الرياض', role: 'unassigned' },
  { code: 'RYD-04', name: 'النرجس', city: 'الرياض' },
  { code: 'RYD-05', name: 'الياسمين', city: 'الرياض' },
  { code: 'JED-01', name: 'الروضة', city: 'جدة', role: 'isolation-pair' },
  { code: 'JED-02', name: 'الحمراء', city: 'جدة' },
  { code: 'JED-03', name: 'أبحر', city: 'جدة' },
  { code: 'DMM-01', name: 'الشاطئ', city: 'الدمام', role: 'multi-branch' },
  { code: 'DMM-02', name: 'الفيصلية', city: 'الدمام' },
  { code: 'MED-01', name: 'العزيزية', city: 'المدينة المنورة' },
  { code: 'MKK-01', name: 'العوالي', city: 'مكة المكرمة' },
  { code: 'KHR-01', name: 'الثقبة', city: 'الخبر' },
  { code: 'ABH-01', name: 'المنسك', city: 'أبها' },
  { code: 'TAB-01', name: 'المروج', city: 'تبوك' },
];

const CENTRAL_DEPARTMENTS = [
  { code: 'ADMIN', name: 'الإدارة العامة' },
  { code: 'FIN', name: 'الإدارة المالية' },
  { code: 'PROC', name: 'المشتريات والمخازن' },
  { code: 'HR', name: 'الموارد البشرية' },
];

/** أقسام على مستوى الفرع — للفروع الرئيسية الثلاثة فقط (واقعية لا شاملة). */
const BRANCH_DEPARTMENTS = [
  { code: 'REC', name: 'الاستقبال', branches: ['RYD-01', 'JED-01', 'DMM-01'] },
  { code: 'CLINIC', name: 'العيادات', branches: ['RYD-01', 'JED-01', 'DMM-01'] },
];

/**
 * المستخدمون — 14 حسابًا. كل واحد له غرض اختباري محدد.
 * `branches: null` ⇒ نطاق منشأة (كل الفروع).
 */
const USERS = [
  { key: 'sysadmin', name: 'سعد العتيبي', role: 'super_admin', scope: 'organization', branches: null, purpose: 'وصول كامل' },
  { key: 'ceo', name: 'نورة القحطاني', role: 'company_admin', scope: 'organization', branches: null, purpose: 'يرى الفروع الـ15' },
  { key: 'bm.ryd01', name: 'خالد الشمري', role: 'branch_manager', scope: 'branch', branches: ['RYD-01'], purpose: 'يملك branches.view لكن يرى فرعه فقط' },
  { key: 'bm.ryd02', name: 'ماجد الدوسري', role: 'branch_manager', scope: 'branch', branches: ['RYD-02'], purpose: 'عزل داخل نفس المدينة' },
  { key: 'bm.jed01', name: 'ريم الحربي', role: 'branch_manager', scope: 'branch', branches: ['JED-01'], purpose: 'الطرف المقابل في اختبار العزل' },
  { key: 'rec.ryd01', name: 'هند الزهراني', role: 'reception', scope: 'branch', branches: ['RYD-01'], purpose: 'عملاء وحجوزات · بلا وصول مالي' },
  { key: 'rec.jed01', name: 'لمى الغامدي', role: 'reception', scope: 'branch', branches: ['JED-01'], purpose: 'استقبال في الفرع المقابل' },
  { key: 'acc.multi', name: 'فهد المطيري', role: 'accountant', scope: 'branch', branches: ['RYD-01', 'JED-01'], purpose: 'متعدد الفروع — يرى فرعين لا 15' },
  { key: 'acc.ryd', name: 'عبدالله السبيعي', role: 'accountant', scope: 'branch', branches: ['RYD-01'], purpose: 'محاسب فرع واحد' },
  { key: 'wh.ryd01', name: 'تركي البقمي', role: 'warehouse_manager', scope: 'branch', branches: ['RYD-01'], purpose: 'مخزون · بلا وصول مالي' },
  { key: 'wh.dmm01', name: 'ياسر العمري', role: 'warehouse_manager', scope: 'branch', branches: ['DMM-01'], purpose: 'مخزون في فرع آخر (تحويلات)' },
  { key: 'proc', name: 'بندر الرشيد', role: 'purchasing', scope: 'branch', branches: ['RYD-01'], purpose: 'مشتريات وموردون' },
  { key: 'emp.ryd01', name: 'سلطان الحارثي', role: 'employee', scope: 'branch', branches: ['RYD-01'], purpose: 'عرض فقط — يُمنع من الإنشاء' },
  { key: 'suspended', name: 'مشعل الأحمدي', role: 'reception', scope: 'branch', branches: ['RYD-01'], status: 'suspended', purpose: 'موقوف — يجب أن يرى صفرًا رغم الدور' },
];

/**
 * مقدّمو الخدمة — القرار RQ-02: كيان تشغيلي، والحساب اختياري.
 * `linkedUser: null` ⇒ **طبيب بلا حساب مستخدم** (الحالة التي يجب إثباتها).
 */
const PROVIDERS = [
  { code: 'DR-001', name: 'د. أحمد الفيفي', specialty: 'طب أسنان', branch: 'RYD-01', linkedUser: null },
  { code: 'DR-002', name: 'د. سارة العنزي', specialty: 'جلدية', branch: 'RYD-01', linkedUser: null },
  { code: 'DR-003', name: 'د. عمر الجهني', specialty: 'باطنية', branch: 'RYD-02', linkedUser: null },
  { code: 'DR-004', name: 'د. منال الشهري', specialty: 'طب أسنان', branch: 'JED-01', linkedUser: null },
  { code: 'DR-005', name: 'د. وليد النمر', specialty: 'عظام', branch: 'DMM-01', linkedUser: null },
  // طبيب زائر يعمل في عدة فروع ⇒ branch = null + provider_branches
  { code: 'DR-006', name: 'د. ليلى الصاعدي', specialty: 'تغذية علاجية', branch: null, worksAt: ['RYD-01', 'JED-01', 'DMM-01'], linkedUser: null },
  // الحالة المقابلة: مقدّم خدمة **له** حساب مستخدم (مدير فرع يعالج أيضًا)
  { code: 'DR-007', name: 'د. خالد الشمري', specialty: 'أسنان تجميلي', branch: 'RYD-01', linkedUser: 'bm.ryd01' },
];

const SERVICES = [
  { code: 'SVC-CONS', name: 'استشارة عامة', minutes: 20, shared: true },
  { code: 'SVC-FOLLOW', name: 'زيارة متابعة', minutes: 15, shared: true },
  { code: 'SVC-CHECK', name: 'فحص شامل', minutes: 45, shared: true },
  { code: 'SVC-DENT-CLEAN', name: 'تنظيف أسنان', minutes: 30, shared: false, branches: ['RYD-01', 'JED-01'] },
  { code: 'SVC-DENT-FILL', name: 'حشو أسنان', minutes: 40, shared: false, branches: ['RYD-01', 'JED-01'] },
  { code: 'SVC-DERM', name: 'جلسة جلدية', minutes: 30, shared: false, branches: ['RYD-01'] },
  { code: 'SVC-PHYSIO', name: 'جلسة علاج طبيعي', minutes: 45, shared: false, branches: ['DMM-01'] },
  { code: 'SVC-NUTR', name: 'استشارة تغذية', minutes: 30, shared: false, branches: ['RYD-01', 'JED-01', 'DMM-01'] },
];

/** ⚠️ قائمة تشغيلية للتجربة — ليست اعتمادًا لـP-11. */
const APPOINTMENT_STATUSES = [
  { key: 'scheduled', name: 'مجدول', category: 'open', order: 1 },
  { key: 'confirmed', name: 'مؤكد', category: 'open', order: 2 },
  { key: 'completed', name: 'مكتمل', category: 'done', order: 3 },
  { key: 'cancelled', name: 'ملغى', category: 'cancelled', order: 4 },
  { key: 'no_show', name: 'لم يحضر', category: 'cancelled', order: 5 },
];

const UNITS = [
  { code: 'PC', name: 'حبة' },
  { code: 'BOX', name: 'علبة' },
  { code: 'PK', name: 'عبوة' },
  { code: 'ML', name: 'مليلتر' },
];

const ITEM_CATEGORIES = [
  { code: 'CONS', name: 'مستهلكات طبية' },
  { code: 'MED', name: 'أدوية' },
  { code: 'SUPP', name: 'مستلزمات تشغيلية' },
];

const ITEMS = [
  { code: 'ITM-001', name: 'قفازات فحص (وسط)', cat: 'CONS', unit: 'BOX', reorder: 20 },
  { code: 'ITM-002', name: 'كمامات جراحية', cat: 'CONS', unit: 'BOX', reorder: 30 },
  { code: 'ITM-003', name: 'شاش طبي معقّم', cat: 'CONS', unit: 'PK', reorder: 15 },
  { code: 'ITM-004', name: 'محلول معقّم للأسطح', cat: 'SUPP', unit: 'ML', reorder: 10 },
  { code: 'ITM-005', name: 'إبر تخدير موضعي', cat: 'MED', unit: 'BOX', reorder: 10 },
  { code: 'ITM-006', name: 'مخدر موضعي', cat: 'MED', unit: 'PC', reorder: 12 },
  { code: 'ITM-007', name: 'حشوات أسنان مركّبة', cat: 'CONS', unit: 'PC', reorder: 8 },
  { code: 'ITM-008', name: 'أكياس نفايات طبية', cat: 'SUPP', unit: 'PK', reorder: 25 },
  { code: 'ITM-009', name: 'ورق فحص للأسرّة', cat: 'SUPP', unit: 'PK', reorder: 20 },
  { code: 'ITM-010', name: 'مطهر أيدي', cat: 'CONS', unit: 'ML', reorder: 18 },
  { code: 'ITM-011', name: 'خيوط جراحية', cat: 'CONS', unit: 'PC', reorder: 10 },
  { code: 'ITM-012', name: 'أكواب ورقية للمرضى', cat: 'SUPP', unit: 'PK', reorder: 40 },
];

const SUPPLIERS = [
  { code: 'SUP-001', name: 'مؤسسة الرعاية للمستلزمات الطبية', shared: true },
  { code: 'SUP-002', name: 'شركة الشفاء الدوائية', shared: true },
  { code: 'SUP-003', name: 'الخليج للتجهيزات الطبية', shared: true },
  { code: 'SUP-004', name: 'موردو جدة للمستهلكات', shared: false, branch: 'JED-01' },
  { code: 'SUP-005', name: 'الشرقية للتوريدات', shared: false, branch: 'DMM-01' },
];

const EXPENSE_CATEGORIES = [
  { code: 'EXP-RENT', name: 'إيجارات' },
  { code: 'EXP-SAL', name: 'رواتب وأجور' },
  { code: 'EXP-MAINT', name: 'صيانة وإصلاح' },
  { code: 'EXP-CONS', name: 'مستهلكات' },
  { code: 'EXP-UTIL', name: 'خدمات ومرافق' },
];

/** الفروع التي تتلقى بيانات تشغيلية كاملة (البقية تبقى بهيكل فقط). */
const OPERATIONAL_BRANCHES = ['RYD-01', 'RYD-02', 'JED-01', 'JED-02', 'DMM-01'];

/** توزيع العملاء — RYD-03 يبقى صفرًا كضابط سلبي. */
const CUSTOMER_DISTRIBUTION = {
  'RYD-01': 24,
  'RYD-02': 12,
  'RYD-04': 6,
  'JED-01': 16,
  'JED-02': 8,
  'DMM-01': 9,
  'MED-01': 5,
  'RYD-03': 0,
};

const FIRST_NAMES = ['محمد', 'أحمد', 'عبدالله', 'فاطمة', 'نورة', 'سارة', 'خالد', 'ريم', 'عمر', 'هدى', 'ياسر', 'منال', 'سلمان', 'لمى', 'تركي', 'أمل'];
const LAST_NAMES = ['الشمري', 'العتيبي', 'القحطاني', 'الغامدي', 'الحربي', 'الزهراني', 'الدوسري', 'المطيري', 'السبيعي', 'البقمي', 'الرشيد', 'العنزي'];

const NOTIFICATION_TEMPLATES = [
  { key: 'appointment_reminder', channel: 'sms', subject: null, body: 'عميلنا {{name}}، نذكّرك بموعدك في {{branch}} يوم {{date}} الساعة {{time}}.', vars: ['name', 'branch', 'date', 'time'] },
  { key: 'appointment_confirmed', channel: 'sms', subject: null, body: 'تم تأكيد موعدك في {{branch}} يوم {{date}}. شكرًا لك.', vars: ['branch', 'date'] },
  { key: 'appointment_cancelled', channel: 'sms', subject: null, body: 'نعتذر، تم إلغاء موعدك يوم {{date}}. للحجز مرة أخرى تواصل معنا.', vars: ['date'] },
  // in_app متاحة للقوالب بعد ترحيل 20260817100000 (توحيد قائمتَي القنوات)
  { key: 'shift_closed_notice', channel: 'in_app', subject: 'إغلاق وردية', body: 'تم إغلاق وردية {{shift}} في {{branch}}.', vars: ['shift', 'branch'] },
];

/* ========================================================================== */
/*  أدوات مساعدة                                                              */
/* ========================================================================== */

/** مولّد عشوائي حتمي — يضمن أن كل تشغيل يُنتج نفس البيانات. */
function makeRng(seed) {
  let s = [...seed].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 2147483647, 7);
  return () => ((s = (s * 48271) % 2147483647) / 2147483647);
}
const rng = makeRng(NAMESPACE);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const money = (n) => n.toFixed(2);

function isoDaysFromNow(days, hour = 10, minute = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString();
}

/** كلمة مرور قوية للتجربة — تُعرض مرة واحدة وتُكتب في ملف مُستثنى من Git. */
function generatePassword() {
  return `Demo!${randomBytes(9).toString('base64url')}`;
}

const plan = [];
const record = (stage, entity, count, note = '') => plan.push({ stage, entity, count, note });

/* ========================================================================== */
/*  بناء الخطة (بلا أي اتصال — يعمل في dry-run)                                */
/* ========================================================================== */

const branchDeptCount = BRANCH_DEPARTMENTS.reduce((n, d) => n + d.branches.length, 0);
const customerTotal = Object.values(CUSTOMER_DISTRIBUTION).reduce((a, b) => a + b, 0);
const providerBranchLinks = PROVIDERS.reduce(
  (n, p) => n + (p.worksAt ? p.worksAt.length : p.branch ? 1 : 0),
  0,
);
const branchServiceLinks = SERVICES.reduce(
  (n, s) => n + (s.shared ? OPERATIONAL_BRANCHES.length : (s.branches ?? []).length),
  0,
);
const warehouseCount = OPERATIONAL_BRANCHES.length;
const treasuryCount = OPERATIONAL_BRANCHES.length;
const appointmentCount = 48;
const stockReceiptCount = warehouseCount * 6;
const stockIssueCount = warehouseCount * 3;
const transferPairs = 2;
const revenueTxCount = 18;
const expenseTxCount = 10;
const supplierPaymentCount = 6;
const shiftCount = 5;
const custodyCount = 2;
const notificationCount = 14;

record(0, 'permissions (من الكتالوج)', 56, 'بيانات مرجعية — مطلوبة في كل بيئة');
record(0, 'roles + role_permissions', 8, 'بيانات مرجعية');
record(1, 'organizations', 1, DEMO_ORG_CODE);
record(1, 'branches', BRANCHES.length, '15 فرعًا · RYD-03 بلا مستخدمين (ضابط سلبي)');
record(1, 'departments (مركزية)', CENTRAL_DEPARTMENTS.length, 'branch_id = null ⇒ تختبر HIGH-01');
record(1, 'departments (فرعية)', branchDeptCount);
record(2, 'auth.users + profiles', USERS.length, 'واحد موقوف · واحد متعدد الفروع');
record(2, 'user_roles', USERS.length);
record(2, 'user_branches', USERS.filter((u) => u.branches).reduce((n, u) => n + u.branches.length, 0));
record(3, 'service_providers', PROVIDERS.length, `${PROVIDERS.filter((p) => !p.linkedUser).length} بلا حساب مستخدم (RQ-02)`);
record(3, 'provider_branches', providerBranchLinks, 'طبيب واحد يعمل في 3 فروع');
record(3, 'services', SERVICES.length, `${SERVICES.filter((s) => s.shared).length} مشتركة على مستوى المنشأة`);
record(3, 'branch_services', branchServiceLinks);
record(3, 'provider_services', 'متغيّر', 'الخدمات التي يقدّمها كل طبيب — الغياب = غير متوفّر');
record(3, 'business_hours', OPERATIONAL_BRANCHES.length * 7, '⚠️ بيانات تجريبية · الجمعة مغلق');
record(3, 'appointment_statuses', APPOINTMENT_STATUSES.length, 'معتمدة 2026-08-17 · تُزرع بمحفّز');
record(3, 'units + item_categories', UNITS.length + ITEM_CATEGORIES.length, 'مشتركة');
record(3, 'items', ITEMS.length, 'مشتركة على مستوى المنشأة');
record(3, 'warehouses', warehouseCount, 'مخزن لكل فرع تشغيلي');
record(3, 'suppliers', SUPPLIERS.length, '3 مركزيون + 2 لفروع');
record(3, 'treasuries', treasuryCount, 'خزينة نقدية لكل فرع تشغيلي');
record(3, 'expense_categories', EXPENSE_CATEGORIES.length);
record(4, 'customers', customerTotal, 'RYD-03 = صفر (ضابط سلبي)');
record(4, 'appointments', appointmentCount, 'ماضية وقادمة · حالات مختلفة');
record(5, 'stock_movements (receipt)', stockReceiptCount, 'تُحدّث stock_levels بالمحفّز');
record(5, 'stock_movements (issue)', stockIssueCount);
record(5, 'stock_movements (transfer)', transferPairs * 2, 'زوج out/in بنفس transfer_group_id');
record(6, 'financial_transactions (إيراد)', revenueTxCount, 'خليط draft و posted');
record(6, 'financial_transactions (مصروف)', expenseTxCount);
record(6, 'financial_transactions (دفعة مورد)', supplierPaymentCount);
record(6, 'financial_entries', (revenueTxCount + expenseTxCount + supplierPaymentCount) * 2, '⚠️ account_ref نصّي — لا دليل حسابات (P-02)');
record(6, 'treasury_movements', revenueTxCount + expenseTxCount + supplierPaymentCount, 'دفتر append-only');
record(6, 'shifts', shiftCount, '⚠️ expected_balance/difference تبقى NULL (P-01)');
record(6, 'custody_handovers', custodyCount, 'حالة pending — لا سير عمل (P-04)');
record(6, 'expenses + supplier_payments', expenseTxCount + supplierPaymentCount);
record(7, 'notification_templates', NOTIFICATION_TEMPLATES.length);
record(7, 'notifications', notificationCount, '⚠️ لا إرسال فعلي — مزوّد console');

/* ========================================================================== */
/*  الطباعة                                                                    */
/* ========================================================================== */

function printPlan() {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  خطة بذرة بيانات التجربة');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`  المشروع المستهدف : ${projectRef || '(غير محدد)'}`);
  console.log(`  الوضع            : ${DRY_RUN ? 'DRY RUN — لا كتابة ولا اتصال' : 'تنفيذ فعلي'}`);
  console.log('──────────────────────────────────────────────────────────────');
  let stage = -1;
  let total = 0;
  for (const row of plan) {
    if (row.stage !== stage) {
      stage = row.stage;
      console.log(`\n  [المرحلة ${stage}]`);
    }
    total += row.count;
    console.log(`    ${String(row.count).padStart(4)}  ${row.entity.padEnd(34)} ${row.note}`);
  }
  console.log('\n──────────────────────────────────────────────────────────────');
  console.log(`  إجمالي السجلات المتوقعة: ${total}`);
  console.log('──────────────────────────────────────────────────────────────');

  console.log('\n  المستخدمون وأغراضهم الاختبارية:');
  for (const u of USERS) {
    const scope = u.branches ? u.branches.join('+') : 'كل الفروع';
    const st = u.status === 'suspended' ? ' [موقوف]' : '';
    console.log(`    ${(u.key + '@' + DEMO_EMAIL_DOMAIN).padEnd(30)} ${u.role.padEnd(19)} ${scope.padEnd(16)}${st} ${u.purpose}`);
  }

  console.log('\n  مقدّمو الخدمة (RQ-02):');
  for (const p of PROVIDERS) {
    const acct = p.linkedUser ? `مرتبط بحساب ${p.linkedUser}` : 'بلا حساب مستخدم ✅';
    const where = p.worksAt ? p.worksAt.join('+') : (p.branch ?? 'منشأة');
    console.log(`    ${p.code.padEnd(9)} ${p.name.padEnd(22)} ${where.padEnd(22)} ${acct}`);
  }

  console.log('\n  التوقعات الرقمية لاختبار العزل:');
  const ryd01 = CUSTOMER_DISTRIBUTION['RYD-01'];
  const jed01 = CUSTOMER_DISTRIBUTION['JED-01'];
  console.log(`    مدير فرع العليا  → ${ryd01} عميلًا`);
  console.log(`    مدير فرع جدة     → ${jed01} عميلًا`);
  console.log(`    المحاسب (فرعان)  → ${ryd01 + jed01} عميلًا`);
  console.log(`    مدير الشركة      → ${customerTotal} عميلًا`);
  console.log(`    الموظف الموقوف   → 0 (مع امتلاكه الدور)`);
  console.log(`    أي بيانات RYD-03 → 0`);
  console.log('');
}

/* ========================================================================== */
/*  فحص الحواجز                                                                */
/* ========================================================================== */

function checkGuards() {
  const problems = [];
  if (!SUPABASE_URL) problems.push('NEXT_PUBLIC_SUPABASE_URL غير مضبوط في apps/web/.env.local');
  if (!projectRef) problems.push('تعذّر استخراج project ref من العنوان');
  else if (!ALLOWED_PROJECT_REFS.includes(projectRef)) {
    problems.push(
      `⛔ المشروع «${projectRef}» غير مدرج في قائمة مشاريع التجربة.\n` +
        `      المسموح: ${ALLOWED_PROJECT_REFS.join(', ')}\n` +
        '      هذا الحاجز يمنع بذر بيانات وهمية في مشروع إنتاجي بالخطأ.',
    );
  }
  if (!SECRET_KEY) {
    problems.push(
      'SUPABASE_SECRET_KEY فارغ أو غير مضبوط.\n' +
        '      المطلوب: أضف السطر التالي في apps/web/.env.local (الملف مُستثنى من Git):\n' +
        '          SUPABASE_SECRET_KEY=sb_secret_...\n' +
        '      المصدر: Supabase → Project Settings → API Keys → Secret key\n' +
        '      ⚠️ لا تُرسله في أي محادثة ولا تضعه في Git.',
    );
  } else if (!SECRET_KEY.startsWith('sb_secret_')) {
    problems.push('SUPABASE_SECRET_KEY لا يبدأ بـ sb_secret_ — تحقق أنك نسخت المفتاح السري لا العام.');
  }
  return problems;
}

/* ========================================================================== */
/*  التنفيذ                                                                    */
/* ========================================================================== */

async function run() {
  printPlan();

  const problems = checkGuards();

  if (DRY_RUN) {
    console.log('  ℹ️  وضع DRY RUN: لم يُنفَّذ أي اتصال ولا كتابة.');
    if (problems.length) {
      console.log('\n  ⚠️  عوائق تمنع التنفيذ الفعلي حاليًا:');
      problems.forEach((p) => console.log(`    • ${p}`));
    } else {
      console.log('  ✅ كل الحواجز مستوفاة — التنفيذ الفعلي متاح بـ --confirm');
    }
    console.log('\n  للتنفيذ: node scripts/seed-demo.mjs --confirm\n');
    return;
  }

  if (problems.length) {
    console.error('\n⛔ التنفيذ متوقف — الحواجز غير مستوفاة:\n');
    problems.forEach((p) => console.error(`  • ${p}`));
    process.exitCode = 1;
    return;
  }

  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(SUPABASE_URL, SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  /* --- حارس البيانات القائمة: نرفض العمل فوق بيانات ليست تجريبية --- */
  const { data: existingOrgs, error: orgErr } = await db.from('organizations').select('id, code');
  if (orgErr) throw new Error(`تعذّر قراءة organizations: ${orgErr.message}`);
  const foreign = (existingOrgs ?? []).filter((o) => o.code !== DEMO_ORG_CODE);
  if (foreign.length > 0) {
    console.error('\n⛔ توقّف: قاعدة البيانات تحتوي منشآت لا تحمل بصمة التجربة:');
    foreign.forEach((o) => console.error(`  • ${o.code}`));
    console.error('  لن أكتب فوق بيانات غير تجريبية. راجع الحالة يدويًا أولًا.');
    process.exitCode = 1;
    return;
  }

  /**
   * الجداول الدفترية (append-only) لا تقبل UPDATE — محفّز يرفضه.
   * لذلك إعادة التشغيل عليها يجب أن تكون «تجاهل الموجود» لا «حدّث الموجود».
   * استخدام upsert عليها يفشل بـ: «هذا السجل غير قابل للتعديل أو الحذف».
   */
  const LEDGER_TABLES = new Set(['stock_movements', 'treasury_movements', 'financial_transactions']);

  const up = async (table, rows, onConflict) => {
    if (rows.length === 0) return;
    const insertOnly = LEDGER_TABLES.has(table);
    const { error } = await db
      .from(table)
      .upsert(rows, { onConflict, ignoreDuplicates: insertOnly });
    if (error) throw new Error(`${table}: ${error.message}`);
    console.log(`  ✔ ${table.padEnd(26)} ${rows.length}${insertOnly ? '  (دفتر: إدراج فقط)' : ''}`);
  };

  /**
   * استبدال صفوف يملكها هذا السكربت وحده.
   *
   * ⚠️ لماذا لا يكفي upsert هنا: جدول الحجوزات عليه **قيد استبعاد** يمنع تداخل
   *    مواعيد المقدّم. عند تحديث دفعة في طلب واحد، تبقى الصفوف التي لم يصلها
   *    الدور بعد حاملةً قيمها القديمة، فينشأ تعارض عابر يُفشل الطلب كله رغم أن
   *    الحالة النهائية سليمة.
   *
   * ⚠️ الحذف مقصور على **المعرّفات التي سنكتبها الآن** — وهي معرّفات حتمية
   *    مشتقة من UUID v5 يملكها هذا السكربت. لا يُحذف أي صف أنشأه مستخدم.
   */
  const replaceOwnRows = async (table, rows) => {
    if (rows.length === 0) return;
    const ids = rows.map((r) => r.id);
    const { error: deleteError } = await db.from(table).delete().in('id', ids);
    if (deleteError) throw new Error(`${table} (حذف صفوف البذرة): ${deleteError.message}`);

    const { error } = await db.from(table).insert(rows);
    if (error) throw new Error(`${table}: ${error.message}`);
    console.log(`  ✔ ${table.padEnd(26)} ${rows.length}  (استبدال صفوف البذرة)`);
  };

  console.log('\n▶ المرحلة 0 — البيانات المرجعية');
  const catalog = await import(
    pathToFileURL(resolve(root, 'packages/core/src/permissions/catalog.ts')).href
  );
  await up(
    'permissions',
    catalog.PERMISSIONS.map((p) => ({
      key: p.key,
      module: p.module,
      action: p.action,
      name_ar: p.nameAr,
      is_sensitive: Boolean(p.sensitive),
    })),
    'key',
  );
  const { data: permRows } = await db.from('permissions').select('id, key');
  const permId = new Map((permRows ?? []).map((p) => [p.key, p.id]));

  await up(
    'roles',
    catalog.INITIAL_ROLES.map((r) => ({
      id: did('role', r.key),
      organization_id: null,
      key: r.key,
      name_ar: r.nameAr,
      is_system: r.isSystem,
    })),
    'id',
  );
  const rolePerms = [];
  for (const r of catalog.INITIAL_ROLES) {
    const keys = r.permissions === '*' ? catalog.PERMISSIONS.map((p) => p.key) : r.permissions;
    for (const k of keys) {
      const pid = permId.get(k);
      if (pid) rolePerms.push({ role_id: did('role', r.key), permission_id: pid });
    }
  }
  await up('role_permissions', rolePerms, 'role_id,permission_id');

  console.log('\n▶ المرحلة 1 — التنظيم');
  await up('organizations', [{ id: ORG_ID, code: DEMO_ORG_CODE, name_ar: 'مجموعة عيادات النخبة الطبية (بيئة تجريبية)', status: 'active' }], 'id');
  const branchId = (code) => did('branch', code);
  await up(
    'branches',
    BRANCHES.map((b, i) => ({
      id: branchId(b.code),
      organization_id: ORG_ID,
      code: b.code,
      name_ar: `فرع ${b.city} – ${b.name}`,
      city: b.city,
      phone: `0112${String(200000 + i * 137).slice(0, 6)}`,
      timezone: 'Asia/Riyadh',
      status: 'active',
    })),
    'id',
  );
  await up(
    'departments',
    [
      ...CENTRAL_DEPARTMENTS.map((d) => ({ id: did('dept', d.code), organization_id: ORG_ID, branch_id: null, code: d.code, name_ar: d.name })),
      ...BRANCH_DEPARTMENTS.flatMap((d) =>
        d.branches.map((bc) => ({ id: did('dept', `${d.code}-${bc}`), organization_id: ORG_ID, branch_id: branchId(bc), code: `${d.code}-${bc}`, name_ar: `${d.name} – ${bc}` })),
      ),
    ],
    'id',
  );

  console.log('\n▶ المرحلة 2 — المستخدمون');
  const credentials = [];
  const userId = new Map();
  const { data: userList } = await db.auth.admin.listUsers({ perPage: 1000 });
  const byEmail = new Map((userList?.users ?? []).map((u) => [u.email, u.id]));

  /*
    ملف الاعتمادات القائم (إن وُجد) — لتفادي إعادة تعيين كلمات مرور صالحة.
    ⚠️ الكتابة تحدث **فور** انتهاء هذه المرحلة لا في نهاية السكربت:
       فشل لاحق في أي مرحلة كان يُفقد كلمات المرور نهائيًا.
  */
  const credFile = resolve(root, '.demo-credentials/demo-users.json');
  const existingCreds = existsSync(credFile)
    ? new Map((JSON.parse(readFileSync(credFile, 'utf8')).users ?? []).map((u) => [u.email, u.password]))
    : new Map();

  for (const u of USERS) {
    const email = `${u.key}@${DEMO_EMAIL_DOMAIN}`;
    let id = byEmail.get(email);

    if (!id) {
      const password = generatePassword();
      const { data, error } = await db.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { demo: true, full_name_ar: u.name },
      });
      if (error) throw new Error(`إنشاء المستخدم ${email}: ${error.message}`);
      id = data.user.id;
      credentials.push({ email, password, name: u.name, role: u.role, purpose: u.purpose });
      console.log(`  ✔ أُنشئ ${email}`);
    } else if (existingCreds.has(email)) {
      credentials.push({ email, password: existingCreds.get(email), name: u.name, role: u.role, purpose: u.purpose });
      console.log(`  ↷ موجود ${email}`);
    } else {
      // الحساب موجود وكلمة مروره غير معروفة (تشغيل سابق فشل قبل الكتابة)
      // ⇒ نعيّن كلمة مرور جديدة حتى تبقى البيئة قابلة للاستخدام فعلًا.
      const password = generatePassword();
      const { error } = await db.auth.admin.updateUserById(id, { password });
      if (error) throw new Error(`إعادة تعيين كلمة مرور ${email}: ${error.message}`);
      credentials.push({ email, password, name: u.name, role: u.role, purpose: u.purpose });
      console.log(`  ↻ أُعيد تعيين كلمة مرور ${email} (كانت مفقودة)`);
    }
    userId.set(u.key, id);
  }

  // الكتابة فورًا — قبل أي مرحلة أخرى قابلة للفشل
  if (credentials.length) {
    mkdirSync(dirname(credFile), { recursive: true });
    writeFileSync(
      credFile,
      JSON.stringify({ project: projectRef, updatedAt: new Date().toISOString(), users: credentials }, null, 2),
      'utf8',
    );
    console.log(`  🔑 كُتبت اعتمادات ${credentials.length} مستخدمًا في .demo-credentials/demo-users.json`);
  }

  await up(
    'profiles',
    USERS.map((u, i) => ({
      id: userId.get(u.key),
      organization_id: ORG_ID,
      full_name_ar: u.name,
      employee_code: `EMP-${String(i + 1).padStart(3, '0')}`,
      phone: `05${String(50000000 + i * 111111).slice(0, 8)}`,
      status: u.status ?? 'active',
      default_branch_id: u.branches ? branchId(u.branches[0]) : null,
    })),
    'id',
  );
  await up(
    'user_roles',
    USERS.map((u) => ({ id: did('urole', u.key), user_id: userId.get(u.key), role_id: did('role', u.role), scope: u.scope })),
    'id',
  );
  await up(
    'user_branches',
    USERS.filter((u) => u.branches).flatMap((u) =>
      u.branches.map((bc, idx) => ({ user_id: userId.get(u.key), branch_id: branchId(bc), is_default: idx === 0 })),
    ),
    'user_id,branch_id',
  );

  console.log('\n▶ المرحلة 3 — الكتالوجات');
  await up(
    'service_providers',
    PROVIDERS.map((p) => ({
      id: did('provider', p.code),
      organization_id: ORG_ID,
      branch_id: p.branch ? branchId(p.branch) : null,
      code: p.code,
      full_name_ar: p.name,
      specialty: p.specialty,
      profile_id: p.linkedUser ? userId.get(p.linkedUser) : null,
      status: 'active',
    })),
    'id',
  );
  await up(
    'provider_branches',
    PROVIDERS.flatMap((p) =>
      (p.worksAt ?? (p.branch ? [p.branch] : [])).map((bc, i) => ({
        provider_id: did('provider', p.code),
        branch_id: branchId(bc),
        is_primary: i === 0,
      })),
    ),
    'provider_id,branch_id',
  );
  await up(
    'services',
    SERVICES.map((s) => ({
      id: did('service', s.code),
      organization_id: ORG_ID,
      branch_id: null,
      code: s.code,
      name_ar: s.name,
      default_duration_minutes: s.minutes,
      status: 'active',
    })),
    'id',
  );
  await up(
    'branch_services',
    SERVICES.flatMap((s) =>
      (s.shared ? OPERATIONAL_BRANCHES : (s.branches ?? [])).map((bc) => ({
        branch_id: branchId(bc),
        service_id: did('service', s.code),
        is_available: true,
      })),
    ),
    'branch_id,service_id',
  );
  /*
    الخدمات التي يقدّمها كل مقدّم خدمة (المرحلة 4).
    ⚠️ الربط صريح لأن الغياب يعني «غير متوفّر»: مقدّم بلا ربط لا يظهر لأي
       خدمة في نموذج الحجز، ومحفّز التحقق يرفض حجزه.
    التوزيع هنا تجريبي بحت ولا يمثّل قاعدة عمل: كل مقدّم يقدّم كل خدمة مشتركة
    وخدمات فروعه.
  */
  await up(
    'provider_services',
    PROVIDERS.flatMap((p) => {
      const worksAt = p.worksAt ?? (p.branch ? [p.branch] : []);
      return SERVICES.filter(
        (s) => s.shared || (s.branches ?? []).some((bc) => worksAt.includes(bc)),
      ).map((s) => ({
        provider_id: did('provider', p.code),
        service_id: did('service', s.code),
        is_available: true,
      }));
    }),
    'provider_id,service_id',
  );

  /*
    ساعات العمل (المرحلة 4).
    ⚠️ الأحد–الخميس 08:00–20:00 والسبت 10:00–18:00 والجمعة مغلق.
       هذه **بيانات تجريبية** لتشغيل الحجز، وليست اعتمادًا لأي دوام رسمي —
       ساعات العمل الحقيقية تُضبط من لوحة الإدارة لكل فرع.
    فرع بلا ساعات = مغلق تمامًا، فبدون هذه البذرة لا يمكن الحجز أصلًا.
  */
  await up(
    'business_hours',
    OPERATIONAL_BRANCHES.flatMap((bc) => [
      ...[0, 1, 2, 3, 4].map((weekday) => ({
        organization_id: ORG_ID,
        branch_id: branchId(bc),
        weekday,
        opens_at: '08:00',
        closes_at: '20:00',
        is_closed: false,
      })),
      {
        organization_id: ORG_ID,
        branch_id: branchId(bc),
        weekday: 5, // الجمعة
        opens_at: '00:00',
        closes_at: '00:00',
        is_closed: true,
      },
      {
        organization_id: ORG_ID,
        branch_id: branchId(bc),
        weekday: 6, // السبت
        opens_at: '10:00',
        closes_at: '18:00',
        is_closed: false,
      },
    ]),
    'branch_id,weekday,opens_at,closes_at',
  );

  /*
    ⚠️ حالات الحجز لم تعد بيانات تجربة: القائمة الخمس اعتُمدت من العميل
       (2026-08-17) وانتقلت إلى ترحيل `20260817150000`، ويزرعها محفّز مع كل
       منشأة تُنشأ. البذر هنا صار `upsert` على المفتاح الطبيعي لا على المعرّف،
       حتى لا يُنشئ صفوفًا موازية بمعرّفات مختلفة للحالات نفسها.
  */
  await up(
    'appointment_statuses',
    APPOINTMENT_STATUSES.map((s) => ({ organization_id: ORG_ID, key: s.key, name_ar: s.name, category: s.category, sort_order: s.order })),
    'organization_id,key',
  );
  await up('units', UNITS.map((u) => ({ id: did('unit', u.code), organization_id: ORG_ID, branch_id: null, code: u.code, name_ar: u.name })), 'id');
  await up('item_categories', ITEM_CATEGORIES.map((c) => ({ id: did('itemcat', c.code), organization_id: ORG_ID, branch_id: null, code: c.code, name_ar: c.name })), 'id');
  await up(
    'items',
    ITEMS.map((it) => ({
      id: did('item', it.code),
      organization_id: ORG_ID,
      branch_id: null,
      category_id: did('itemcat', it.cat),
      base_unit_id: did('unit', it.unit),
      code: it.code,
      name_ar: it.name,
      reorder_level: money(it.reorder),
      status: 'active',
    })),
    'id',
  );
  await up(
    'warehouses',
    OPERATIONAL_BRANCHES.map((bc) => ({ id: did('warehouse', bc), organization_id: ORG_ID, branch_id: branchId(bc), code: `WH-${bc}`, name_ar: `مخزن ${bc}`, is_default: true })),
    'id',
  );
  await up(
    'suppliers',
    SUPPLIERS.map((s) => ({ id: did('supplier', s.code), organization_id: ORG_ID, branch_id: s.shared ? null : branchId(s.branch), code: s.code, name_ar: s.name, status: 'active' })),
    'id',
  );
  await up(
    'treasuries',
    OPERATIONAL_BRANCHES.map((bc) => ({ id: did('treasury', bc), organization_id: ORG_ID, branch_id: branchId(bc), code: `TR-${bc}`, name_ar: `خزينة ${bc}`, currency: 'SAR', type: 'cash', status: 'active' })),
    'id',
  );
  await up(
    'expense_categories',
    EXPENSE_CATEGORIES.map((c) => ({ id: did('expcat', c.code), organization_id: ORG_ID, branch_id: null, code: c.code, name_ar: c.name })),
    'id',
  );

  console.log('\n▶ المرحلة 4 — العملاء والحجوزات');
  const customers = [];
  let cSeq = 0;
  for (const [bc, count] of Object.entries(CUSTOMER_DISTRIBUTION)) {
    for (let i = 0; i < count; i += 1) {
      cSeq += 1;
      const code = `CUS-${String(cSeq).padStart(4, '0')}`;
      customers.push({
        id: did('customer', code),
        organization_id: ORG_ID,
        branch_id: branchId(bc),
        code,
        full_name_ar: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
        phone: `05${String(10000000 + cSeq * 1237).slice(0, 8)}`,
        gender: rng() > 0.5 ? 'male' : 'female',
        status: rng() > 0.94 ? 'inactive' : 'active',
      });
    }
  }
  await up('customers', customers, 'id');

  /*
    معرّفات الحالات تُقرأ من قاعدة البيانات لا تُشتق حتميًا: بعد اعتماد القائمة
    صار يزرعها محفّز `organizations_seed_defaults` بمعرّفات من المحرّك.
  */
  const { data: statusRows, error: statusError } = await db
    .from('appointment_statuses')
    .select('id, key')
    .eq('organization_id', ORG_ID);
  if (statusError) throw new Error(`appointment_statuses: ${statusError.message}`);
  const statusIdByKey = new Map(statusRows.map((s) => [s.key, s.id]));

  const providersByBranch = new Map();
  for (const p of PROVIDERS) {
    for (const bc of p.worksAt ?? (p.branch ? [p.branch] : [])) {
      if (!providersByBranch.has(bc)) providersByBranch.set(bc, []);
      providersByBranch.get(bc).push(p.code);
    }
  }
  /*
    توليد الحجوزات.

    ⚠️ أُعيدت كتابته في المرحلة 4 لأن محفّز التحقق كشف تناقضًا حقيقيًا في
       التوليد السابق: كان يحجز خدمة مشتركة لعميل في فرع **غير تشغيلي** لا
       يملك صف `branch_services`، فيُنتج حجزًا لخدمة غير متاحة في فرعه.
       كان يمر بصمت قبل وجود المحفّز.

    القيود المُلتزَم بها هنا هي نفسها التي يفرضها المحرّك حرفيًا:
      • الفرع تشغيلي (له ساعات عمل وخدمات مربوطة).
      • الخدمة مربوطة بالفرع فعلًا.
      • مقدّم الخدمة يعمل في الفرع ويقدّم تلك الخدمة.
      • الموعد داخل الدوام (08:00–20:00) وليس يوم جمعة.
      • لا تداخل لنفس المقدّم — قيد الاستبعاد يرفضه.
  */
  const providerServiceCodes = new Map();
  for (const p of PROVIDERS) {
    const worksAt = p.worksAt ?? (p.branch ? [p.branch] : []);
    providerServiceCodes.set(
      p.code,
      SERVICES.filter((s) => s.shared || (s.branches ?? []).some((bc) => worksAt.includes(bc))).map(
        (s) => s.code,
      ),
    );
  }
  const branchServiceCodes = new Map(
    OPERATIONAL_BRANCHES.map((bc) => [
      bc,
      SERVICES.filter((s) => s.shared || (s.branches ?? []).includes(bc)).map((s) => s.code),
    ]),
  );

  const appointments = [];
  const bookedSlots = new Set(); // مفتاح: provider|instant — يمنع التداخل قبل الإرسال
  const eligible = customers.filter((c) =>
    OPERATIONAL_BRANCHES.some((bc) => branchId(bc) === c.branch_id),
  );

  let attempt = 0;
  while (appointments.length < appointmentCount && attempt < appointmentCount * 20) {
    attempt += 1;
    const c = eligible[Math.floor(rng() * eligible.length)];
    const bc = BRANCHES.find((b) => branchId(b.code) === c.branch_id)?.code;
    const provs = (providersByBranch.get(bc) ?? []).filter((code) =>
      (providerServiceCodes.get(code) ?? []).some((sc) =>
        (branchServiceCodes.get(bc) ?? []).includes(sc),
      ),
    );
    if (provs.length === 0) continue;

    const providerCode = pick(provs);
    const shared = (providerServiceCodes.get(providerCode) ?? []).filter((sc) =>
      (branchServiceCodes.get(bc) ?? []).includes(sc),
    );
    if (shared.length === 0) continue;
    const serviceCode = pick(shared);
    const i = appointments.length;

    /*
      الوقت مشتق من `attempt` لا من عدد الناجحين: الاشتقاق من العداد الناجح
      يُعيد نفس الفترة عند كل محاولة فاشلة فيتوقف التوليد مبكرًا.
      المساحة هنا 6 ساعات × 20 يومًا لكل مقدّم = فسحة كافية.

      ⚠️ الساعات بتوقيت UTC: 9..14 ⇒ 12:00–17:00 بتوقيت الرياض. النطاق مُضيَّق
         ليسع **السبت** أيضًا (10:00–18:00) لا الأحد–الخميس وحدها (08:00–20:00)،
         وأطول خدمة 45 دقيقة تبقى داخل الدوام في الحالتين.
    */
    const past = attempt % 3 === 0;
    const hour = 9 + (attempt % 6);
    const spread = Math.floor(attempt / 6);
    const dayOffset = past ? -(1 + (spread % 20)) : 1 + (spread % 14);
    const scheduledAt = isoDaysFromNow(dayOffset, hour, 0);

    // الجمعة مغلقة في بذرة ساعات العمل
    if (new Date(scheduledAt).getUTCDay() === 5) continue;

    const providerUuid = did('provider', providerCode);
    const key = `${providerUuid}|${scheduledAt}`;
    if (bookedSlots.has(key)) continue;

    const status = past ? pick(['completed', 'no_show', 'cancelled']) : pick(['scheduled', 'confirmed']);
    // الملغى لا يشغل الوقت في المحرّك، فلا نحجزه في خريطتنا أيضًا
    if (!['cancelled', 'no_show'].includes(status)) bookedSlots.add(key);

    appointments.push({
      id: did('appt', `A-${i}`),
      organization_id: ORG_ID,
      branch_id: c.branch_id,
      reference_no: `APT-${String(i + 1).padStart(4, '0')}`,
      customer_id: c.id,
      service_id: did('service', serviceCode),
      provider_id: providerUuid,
      status_id: statusIdByKey.get(status),
      scheduled_at: scheduledAt,
      // ⚠️ لا نرسل duration_minutes ولا ends_at: المحفّز يشتقهما من الخدمة.
      //    إرسال 30 دقيقة ثابتة كان يخالف مدة الخدمة الفعلية.
    });
  }
  await replaceOwnRows('appointments', appointments);

  console.log('\n▶ المرحلة 5 — حركات المخزون');
  const movements = [];
  let mSeq = 0;
  for (const bc of OPERATIONAL_BRANCHES) {
    for (let i = 0; i < 6; i += 1) {
      const it = ITEMS[(mSeq + i) % ITEMS.length];
      mSeq += 1;
      movements.push({
        id: did('stockmv', `R-${bc}-${i}`),
        organization_id: ORG_ID,
        branch_id: branchId(bc),
        warehouse_id: did('warehouse', bc),
        item_id: did('item', it.code),
        unit_id: did('unit', it.unit),
        movement_type: 'receipt',
        quantity: money(20 + Math.floor(rng() * 80)),
        direction: 1,
        unit_cost: money(5 + rng() * 40),
        currency: 'SAR',
        occurred_at: isoDaysFromNow(-(20 - i)),
        source_module: 'purchasing',
        reference_no: `GRN-${bc}-${i + 1}`,
      });
    }
    for (let i = 0; i < 3; i += 1) {
      const it = ITEMS[(mSeq + i) % ITEMS.length];
      movements.push({
        id: did('stockmv', `I-${bc}-${i}`),
        organization_id: ORG_ID,
        branch_id: branchId(bc),
        warehouse_id: did('warehouse', bc),
        item_id: did('item', it.code),
        unit_id: did('unit', it.unit),
        movement_type: 'issue',
        quantity: money(1 + Math.floor(rng() * 8)),
        direction: -1,
        occurred_at: isoDaysFromNow(-(6 - i)),
        source_module: 'appointments',
        reference_no: `ISS-${bc}-${i + 1}`,
      });
    }
  }
  // تحويلان بين فرعين: زوج out/in بنفس transfer_group_id
  for (let t = 0; t < transferPairs; t += 1) {
    const from = 'RYD-01';
    const to = t === 0 ? 'JED-01' : 'DMM-01';
    const it = ITEMS[t];
    const gid = did('transfer', `T-${t}`);
    const qty = money(10);
    for (const [bc, dir, type] of [
      [from, -1, 'transfer_out'],
      [to, 1, 'transfer_in'],
    ]) {
      movements.push({
        id: did('stockmv', `T-${t}-${type}`),
        organization_id: ORG_ID,
        branch_id: branchId(bc),
        warehouse_id: did('warehouse', bc),
        item_id: did('item', it.code),
        unit_id: did('unit', it.unit),
        movement_type: type,
        quantity: qty,
        direction: dir,
        occurred_at: isoDaysFromNow(-3),
        transfer_group_id: gid,
        source_module: 'inventory',
        reference_no: `TRF-${t + 1}`,
      });
    }
  }
  await up('stock_movements', movements, 'id');

  console.log('\n▶ المرحلة 6 — المالية');
  const txs = [];
  const entries = [];
  const trMoves = [];
  const addTx = (kind, i, bc, type, amount, description, accountDebit, accountCredit, status) => {
    const id = did('fintx', `${kind}-${i}`);
    txs.push({
      id,
      organization_id: ORG_ID,
      branch_id: branchId(bc),
      reference_no: `${kind}-${String(i + 1).padStart(4, '0')}`,
      transaction_type: type,
      amount: money(amount),
      currency: 'SAR',
      occurred_at: isoDaysFromNow(-(1 + (i % 25))),
      status,
      source_module: kind === 'REV' ? 'appointments' : kind === 'EXP' ? 'finance' : 'purchasing',
      description,
    });
    // ⚠️ account_ref نصوص وصفية — ليست دليل حسابات (P-02 معلّقة)
    entries.push(
      { id: did('finentry', `${kind}-${i}-d`), organization_id: ORG_ID, branch_id: branchId(bc), transaction_id: id, direction: 'debit', account_ref: accountDebit, amount: money(amount), currency: 'SAR' },
      { id: did('finentry', `${kind}-${i}-c`), organization_id: ORG_ID, branch_id: branchId(bc), transaction_id: id, direction: 'credit', account_ref: accountCredit, amount: money(amount), currency: 'SAR' },
    );
    if (status === 'posted') {
      trMoves.push({
        id: did('trmv', `${kind}-${i}`),
        organization_id: ORG_ID,
        branch_id: branchId(bc),
        treasury_id: did('treasury', bc),
        transaction_id: id,
        movement_type: type === 'revenue' ? 'revenue' : type === 'expense' ? 'expense' : 'supplier_payment',
        direction: type === 'revenue' ? 1 : -1,
        amount: money(amount),
        currency: 'SAR',
        occurred_at: isoDaysFromNow(-(1 + (i % 25))),
        status: 'posted',
        reference_no: `${kind}-${String(i + 1).padStart(4, '0')}`,
      });
    }
    return id;
  };

  for (let i = 0; i < revenueTxCount; i += 1) {
    const bc = OPERATIONAL_BRANCHES[i % OPERATIONAL_BRANCHES.length];
    addTx('REV', i, bc, 'revenue', 150 + Math.floor(rng() * 900), 'إيراد خدمات عيادة', 'CASH', 'REVENUE', i % 5 === 0 ? 'draft' : 'posted');
  }
  const expenseTxIds = [];
  for (let i = 0; i < expenseTxCount; i += 1) {
    const bc = OPERATIONAL_BRANCHES[i % OPERATIONAL_BRANCHES.length];
    expenseTxIds.push(addTx('EXP', i, bc, 'expense', 200 + Math.floor(rng() * 3000), 'مصروف تشغيلي', 'EXPENSE', 'CASH', i % 4 === 0 ? 'draft' : 'posted'));
  }
  const payTxIds = [];
  for (let i = 0; i < supplierPaymentCount; i += 1) {
    const bc = OPERATIONAL_BRANCHES[i % OPERATIONAL_BRANCHES.length];
    payTxIds.push(addTx('PAY', i, bc, 'supplier_payment', 800 + Math.floor(rng() * 5000), 'دفعة لمورد', 'PAYABLE', 'CASH', 'posted'));
  }

  await up('financial_transactions', txs, 'id');
  await up('financial_entries', entries, 'id');
  await up('treasury_movements', trMoves, 'id');

  await up(
    'expenses',
    expenseTxIds.map((txId, i) => {
      const bc = OPERATIONAL_BRANCHES[i % OPERATIONAL_BRANCHES.length];
      const tx = txs.find((t) => t.id === txId);
      return {
        id: did('expense', `E-${i}`),
        organization_id: ORG_ID,
        branch_id: branchId(bc),
        category_id: did('expcat', EXPENSE_CATEGORIES[i % EXPENSE_CATEGORIES.length].code),
        transaction_id: txId,
        treasury_id: did('treasury', bc),
        reference_no: `EXPR-${String(i + 1).padStart(4, '0')}`,
        amount: tx.amount,
        currency: 'SAR',
        occurred_at: tx.occurred_at,
        status: tx.status,
        description: 'مصروف تجريبي',
      };
    }),
    'id',
  );
  await up(
    'supplier_payments',
    payTxIds.map((txId, i) => {
      const bc = OPERATIONAL_BRANCHES[i % OPERATIONAL_BRANCHES.length];
      const tx = txs.find((t) => t.id === txId);
      return {
        id: did('suppay', `P-${i}`),
        organization_id: ORG_ID,
        branch_id: branchId(bc),
        supplier_id: did('supplier', SUPPLIERS[i % 3].code),
        transaction_id: txId,
        treasury_id: did('treasury', bc),
        reference_no: `SPAY-${String(i + 1).padStart(4, '0')}`,
        amount: tx.amount,
        currency: 'SAR',
        paid_at: tx.occurred_at,
        method: pick(['cash', 'bank_transfer']),
        status: 'posted',
      };
    }),
    'id',
  );

  /*
    الورديات — ⚠️ P-01 معلّقة:
    expected_balance و closing_balance و difference تبقى NULL عمدًا.
    الإغلاق يسجّل الوقت والمسؤول فقط، بلا أي حساب.
  */
  const shiftOwners = ['rec.ryd01', 'rec.jed01', 'acc.ryd', 'rec.ryd01', 'rec.jed01'];
  const shiftBranch = ['RYD-01', 'JED-01', 'RYD-01', 'RYD-01', 'JED-01'];
  await up(
    'shifts',
    shiftOwners.map((ownerKey, i) => {
      const bc = shiftBranch[i];
      const open = i >= shiftOwners.length - 1; // الأخيرة فقط مفتوحة (قيد الوردية الواحدة)
      return {
        id: did('shift', `S-${i}`),
        organization_id: ORG_ID,
        branch_id: branchId(bc),
        treasury_id: did('treasury', bc),
        reference_no: `SH-${String(i + 1).padStart(4, '0')}`,
        opened_by: userId.get(ownerKey),
        opened_at: isoDaysFromNow(-(5 - i), 8, 0),
        closed_by: open ? null : userId.get(ownerKey),
        closed_at: open ? null : isoDaysFromNow(-(5 - i), 20, 0),
        opening_balance: money(500),
        currency: 'SAR',
        status: open ? 'open' : 'closed',
        notes: open ? 'وردية مفتوحة للتجربة' : 'أُغلقت بتسجيل الوقت والمسؤول فقط — معادلة التقفيل معلّقة (P-01)',
      };
    }),
    'id',
  );
  await up(
    'custody_handovers',
    [0, 1].map((i) => ({
      id: did('custody', `C-${i}`),
      organization_id: ORG_ID,
      branch_id: branchId(i === 0 ? 'RYD-01' : 'JED-01'),
      shift_id: did('shift', `S-${i}`),
      treasury_id: did('treasury', i === 0 ? 'RYD-01' : 'JED-01'),
      from_user_id: userId.get(i === 0 ? 'rec.ryd01' : 'rec.jed01'),
      to_user_id: userId.get(i === 0 ? 'acc.ryd' : 'acc.multi'),
      amount: money(1200 + i * 350),
      currency: 'SAR',
      handed_at: isoDaysFromNow(-(4 - i), 20, 30),
      status: 'pending',
      note: 'تسليم عهدة تجريبي — لا سير عمل معتمد (P-04)',
    })),
    'id',
  );

  console.log('\n▶ المرحلة 7 — الإشعارات');
  await up(
    'notification_templates',
    NOTIFICATION_TEMPLATES.map((t) => ({
      id: did('ntpl', t.key),
      organization_id: ORG_ID,
      branch_id: null,
      key: t.key,
      channel: t.channel,
      locale: 'ar',
      subject: t.subject,
      body: t.body,
      variables: t.vars,
      is_active: true,
    })),
    'id',
  );
  await up(
    'notifications',
    Array.from({ length: notificationCount }, (_, i) => {
      const c = customers[i * 3 % customers.length];
      const failed = i === notificationCount - 1;
      return {
        id: did('notif', `N-${i}`),
        organization_id: ORG_ID,
        branch_id: c.branch_id,
        channel: 'sms',
        template_key: 'appointment_reminder',
        recipient: c.phone,
        recipient_customer_id: c.id,
        body: `عميلنا ${c.full_name_ar}، نذكّرك بموعدك غدًا.`,
        status: failed ? 'failed' : i % 3 === 0 ? 'queued' : 'sent',
        attempts: failed ? 3 : 1,
        provider: 'console',
        last_error: failed ? 'مزوّد الإرسال غير مُهيّأ (بيئة تطوير)' : null,
        sent_at: failed || i % 3 === 0 ? null : isoDaysFromNow(-1, 18, 0),
        source_module: 'appointments',
      };
    }),
    'id',
  );

  console.log(`\n  🔑 اعتمادات ${credentials.length} مستخدمًا في .demo-credentials/demo-users.json`);
  console.log('     (مجلد مُستثنى من Git — لا تُشاركه)');

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  ✅ انتهى البذر بنجاح');
  console.log('══════════════════════════════════════════════════════════════\n');
}

run().catch((err) => {
  console.error('\n⛔ فشل البذر:', err.message);
  console.error('   لم يُنفَّذ أي حذف — الحالة جزئية وإعادة التشغيل آمنة (idempotent).');
  process.exitCode = 1;
});
