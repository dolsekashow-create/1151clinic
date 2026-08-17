/**
 * منصة اختبار قاعدة البيانات و RLS.
 *
 * تُشغّل PostgreSQL حقيقيًا (مضمّنًا في node_modules) وتطبّق نفس ملفات الترحيل
 * التي تُطبَّق على Supabase، ثم تنفّذ الاستعلامات بدور `authenticated`
 * وبجلسة مستخدم حقيقية.
 *
 * لماذا Postgres حقيقي وليس محاكاة؟
 *   RLS ميزة في محرّك قاعدة البيانات. أي اختبار لا يمرّ بالمحرّك لا يثبت شيئًا
 *   عن العزل الفعلي — وهو بالضبط ما نحتاج إثباته.
 *
 * ما تُحاكيه هذه المنصة من Supabase (وما لا تُحاكيه):
 *   ✔ الأدوار anon / authenticated / service_role
 *   ✔ مخطط auth و auth.users و auth.uid() بنفس تعريف Supabase
 *   ✔ ملكية الدوال لدور يتجاوز RLS (كما هو حال postgres في Supabase)
 *   ✘ GoTrue و PostgREST و Storage — خارج نطاق اختبار RLS.
 */
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, '../..');
/**
 * مجلد بيانات لكل منفذ.
 *
 * ⚠️ مجلد واحد مشترك يُفشل تشغيل ملفَي اختبار معًا: `node --test` ينفّذهما في
 *    عمليتين متوازيتين، فيحذف الثاني مجلد الأول أو يجد المجلد غير فارغ.
 */
const dataDirFor = (port) => join(repoRoot, '.tmp', `pgdata-${port}`);

/** تعريفات Supabase التي تعتمد عليها الترحيلات ولا تُنشئها هي. */
const SUPABASE_BOOTSTRAP = `
  create role anon nologin noinherit;
  create role authenticated nologin noinherit;
  create role service_role nologin noinherit bypassrls;
  grant usage on schema public to anon, authenticated, service_role;

  create schema if not exists auth;

  -- نسخة مبسّطة من auth.users: ما تحتاجه الترحيلات فقط (المفتاح الأساسي)
  create table if not exists auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique,
    created_at timestamptz not null default now()
  );

  -- نفس تعريف Supabase: يقرأ sub من مطالبات الـ JWT في إعداد الجلسة
  --
  -- ⚠️ nullif تُطبَّق على النص **قبل** التحويل إلى json عمدًا: بعد انتهاء معاملة
  --    استُخدم فيها set_config(..., is_local => true) يعود المتغيّر إلى سلسلة
  --    فارغة لا إلى NULL، و ''::json يرمي خطأ 22P02. هذا هو تعريف Supabase الفعلي.
  create or replace function auth.uid()
  returns uuid
  language sql
  stable
  as $$
    select nullif(nullif(current_setting('request.jwt.claims', true), '')::json->>'sub', '')::uuid;
  $$;

  create or replace function auth.role()
  returns text
  language sql
  stable
  as $$
    select nullif(nullif(current_setting('request.jwt.claims', true), '')::json->>'role', '');
  $$;

  grant usage on schema auth to anon, authenticated, service_role;
  grant select on auth.users to service_role;
`;

function migrationFiles() {
  const dir = join(repoRoot, 'supabase', 'migrations');
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') }));
}

function seedFiles() {
  const dir = join(repoRoot, 'supabase', 'seed');
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') }));
}

/**
 * يُنشئ قاعدة بيانات نظيفة، يطبّق الترحيلات والبذور، ويعيد عميلًا متصلًا.
 */
export async function createTestDatabase({ port = 54329 } = {}) {
  const dataDir = dataDirFor(port);
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* أول تشغيل */
  }

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    // نحذف مجلد البيانات في بداية كل تشغيل بدل نهايته: حذف embedded-postgres
    // عند الإيقاف يعلّق على Windows بسبب أقفال الملفات فلا تنتهي العملية.
    persistent: true,
    // ⚠️ إلزامي: على Windows يختار initdb ترميز WIN1252 من إعدادات النظام،
    //    فتفشل كل الأسماء العربية. Supabase يعمل بـ UTF8 — نطابقه.
    initdbFlags: ['--encoding=UTF8', '--locale=C', '--lc-messages=C'],
    onLog: () => {},
    onError: () => {},
  });

  await pg.initialise();
  await pg.start();

  const client = pg.getPgClient();
  await client.connect();

  await client.query(SUPABASE_BOOTSTRAP);

  const applied = [];
  for (const file of migrationFiles()) {
    try {
      await client.query(file.sql);
      applied.push(file.name);
    } catch (error) {
      throw new Error(`فشل الترحيل ${file.name}: ${error.message}`);
    }
  }

  for (const file of seedFiles()) {
    try {
      await client.query(file.sql);
    } catch (error) {
      throw new Error(`فشلت البذرة ${file.name}: ${error.message}`);
    }
  }

  return {
    client,
    applied,
    /**
     * اتصال إضافي مستقل — لازم لاختبار التزامن الحقيقي.
     * معاملتان على **نفس** الاتصال تتسلسلان، فلا تُثبتان شيئًا عن السباق؛
     * الاتصالان المنفصلان يعيدان إنتاج طلبَي HTTP متزامنين.
     */
    async newClient() {
      const extra = pg.getPgClient();
      await extra.connect();
      return extra;
    },
    async close() {
      await client.end();
      await pg.stop();
    },
  };
}

/**
 * ينفّذ استعلامًا بهوية مستخدم محدد وبدور `authenticated` — أي بنفس الظروف
 * التي ينفّذ بها PostgREST استعلامات العميل.
 *
 * يُستخدم SET LOCAL داخل معاملة حتى لا تتسرّب الهوية بين الاختبارات.
 */
export async function asUser(client, userId, sql, params = []) {
  await client.query('begin');
  try {
    await client.query(`set local role authenticated`);
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId, role: 'authenticated' }),
    ]);
    const result = await client.query(sql, params);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

/** يتوقع فشل العملية (سياسة رافضة أو قيد) ويعيد رسالة الخطأ. */
export async function expectDenied(client, userId, sql, params = []) {
  try {
    await asUser(client, userId, sql, params);
    return null;
  } catch (error) {
    return error.message;
  }
}
