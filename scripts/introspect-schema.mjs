/**
 * يستخرج الحالة الفعلية للمخطط من قاعدة بيانات مبنية من ملفات الترحيل.
 *
 * الغرض: مراجعة قائمة على وقائع مستخرجة من المحرّك، لا على قراءة ملفات SQL.
 * المخرجات: .tmp/schema-snapshot.json  +  ملخّص نصّي على الشاشة.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createTestDatabase, repoRoot } from '../supabase/tests/harness.mjs';

const db = await createTestDatabase({ port: 54332 });
const { client } = db;
const q = async (sql, params = []) => (await client.query(sql, params)).rows;

const snapshot = {};

snapshot.tables = await q(`
  select c.relname as table_name, n.nspname as schema, c.relrowsecurity as rls_enabled,
         (select count(*) from pg_policies p where p.schemaname = n.nspname and p.tablename = c.relname) as policy_count
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'r' and n.nspname in ('public','integration')
  order by n.nspname, c.relname
`);

snapshot.columns = await q(`
  select table_schema, table_name, column_name, data_type, udt_name,
         is_nullable, column_default, is_generated
  from information_schema.columns
  where table_schema in ('public','integration')
  order by table_name, ordinal_position
`);

snapshot.foreignKeys = await q(`
  select con.conname as name,
         src.relname as table_name,
         (select array_agg(att.attname::text order by k.ord)
            from unnest(con.conkey) with ordinality k(attnum, ord)
            join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k.attnum) as columns,
         tgt.relname as ref_table,
         (select array_agg(att.attname::text order by k.ord)
            from unnest(con.confkey) with ordinality k(attnum, ord)
            join pg_attribute att on att.attrelid = con.confrelid and att.attnum = k.attnum) as ref_columns,
         con.confdeltype as on_delete
  from pg_constraint con
  join pg_class src on src.oid = con.conrelid
  join pg_class tgt on tgt.oid = con.confrelid
  join pg_namespace n on n.oid = src.relnamespace
  where con.contype = 'f' and n.nspname in ('public','integration')
  order by src.relname, con.conname
`);

snapshot.indexes = await q(`
  select t.relname as table_name, i.relname as index_name,
         ix.indisunique as is_unique, ix.indisprimary as is_primary,
         pg_get_indexdef(ix.indexrelid) as definition
  from pg_index ix
  join pg_class i on i.oid = ix.indexrelid
  join pg_class t on t.oid = ix.indrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname in ('public','integration')
  order by t.relname, i.relname
`);

snapshot.constraints = await q(`
  select con.conname as name, rel.relname as table_name, con.contype as type,
         pg_get_constraintdef(con.oid) as definition
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace n on n.oid = rel.relnamespace
  where n.nspname in ('public','integration') and con.contype in ('c','u','p')
  order by rel.relname, con.conname
`);

snapshot.policies = await q(`
  select tablename, policyname, cmd, roles::text as roles, qual, with_check, permissive
  from pg_policies where schemaname = 'public'
  order by tablename, cmd, policyname
`);

snapshot.functions = await q(`
  select n.nspname as schema, p.proname as name,
         p.prosecdef as security_definer,
         p.proconfig::text as config,
         pg_get_function_identity_arguments(p.oid) as args,
         (select array_agg(a.grantee::text)
            from information_schema.routine_privileges a
           where a.routine_schema = n.nspname and a.routine_name = p.proname
             and a.privilege_type = 'EXECUTE') as execute_grantees
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('app','public')
  order by n.nspname, p.proname
`);

snapshot.triggers = await q(`
  select c.relname as table_name, t.tgname as trigger_name,
         pg_get_triggerdef(t.oid) as definition
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where not t.tgisinternal and n.nspname = 'public'
  order by c.relname, t.tgname
`);

snapshot.tableGrants = await q(`
  select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privileges
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee in ('anon','authenticated','service_role')
  group by table_name, grantee
  order by table_name, grantee
`);

/* ---------- تحليل: مفاتيح أجنبية بلا فهرس يبدأ بأعمدتها ---------- */
const indexByTable = new Map();
for (const idx of snapshot.indexes) {
  const cols = /\(([^)]+)\)/.exec(idx.definition)?.[1] ?? '';
  const leading = cols.split(',').map((c) => c.trim().split(' ')[0].replace(/"/g, ''));
  if (!indexByTable.has(idx.table_name)) indexByTable.set(idx.table_name, []);
  indexByTable.get(idx.table_name).push(leading);
}

snapshot.unindexedForeignKeys = snapshot.foreignKeys.filter((fk) => {
  const indexes = indexByTable.get(fk.table_name) ?? [];
  return !indexes.some((leading) => fk.columns.every((col, i) => leading[i] === col));
});

/* ---------- تحليل: جداول تحمل branch_id قابلًا للإفراغ ---------- */
snapshot.nullableBranchTables = snapshot.columns
  .filter((c) => c.column_name === 'branch_id' && c.is_nullable === 'YES' && c.table_schema === 'public')
  .map((c) => c.table_name);

/* ---------- تحليل: دوال SECURITY DEFINER قابلة للتنفيذ من PUBLIC ---------- */
snapshot.publicExecutableDefiners = snapshot.functions.filter(
  (f) => f.security_definer && (f.execute_grantees ?? []).includes('PUBLIC'),
);

/* ---------- تحليل: جداول أبناء بلا ضمان تطابق النطاق مع الأب ---------- */
const parentOf = new Map();
for (const fk of snapshot.foreignKeys) {
  if (fk.columns.length === 1 && fk.columns[0].endsWith('_id') && fk.ref_columns[0] === 'id') {
    if (!parentOf.has(fk.table_name)) parentOf.set(fk.table_name, []);
    parentOf.get(fk.table_name).push({ column: fk.columns[0], parent: fk.ref_table });
  }
}
snapshot.compositeFkCandidates = [];
for (const [table, links] of parentOf) {
  const hasBranch = snapshot.columns.some(
    (c) => c.table_name === table && c.column_name === 'branch_id',
  );
  if (!hasBranch) continue;
  for (const link of links) {
    const parentHasBranch = snapshot.columns.some(
      (c) => c.table_name === link.parent && c.column_name === 'branch_id',
    );
    if (parentHasBranch) {
      snapshot.compositeFkCandidates.push({ table, column: link.column, parent: link.parent });
    }
  }
}

mkdirSync(resolve(repoRoot, '.tmp'), { recursive: true });
writeFileSync(
  resolve(repoRoot, '.tmp/schema-snapshot.json'),
  JSON.stringify(snapshot, null, 2),
  'utf8',
);

console.log('=== ملخّص ===');
console.log('الجداول:', snapshot.tables.length, '| الأعمدة:', snapshot.columns.length);
console.log('المفاتيح الأجنبية:', snapshot.foreignKeys.length, '| الفهارس:', snapshot.indexes.length);
console.log('السياسات:', snapshot.policies.length, '| المحفّزات:', snapshot.triggers.length);
console.log('');
console.log('⚠️ مفاتيح أجنبية بلا فهرس:', snapshot.unindexedForeignKeys.length);
for (const fk of snapshot.unindexedForeignKeys) {
  console.log(`   ${fk.table_name}(${fk.columns.join(',')}) → ${fk.ref_table}`);
}
console.log('');
console.log('⚠️ دوال SECURITY DEFINER قابلة للتنفيذ من PUBLIC:', snapshot.publicExecutableDefiners.length);
for (const f of snapshot.publicExecutableDefiners) {
  console.log(`   ${f.schema}.${f.name}(${f.args})`);
}
console.log('');
console.log('ℹ️ جداول بـ branch_id قابل للإفراغ:', snapshot.nullableBranchTables.join(', '));
console.log('');
console.log('ℹ️ مرشّحات مفاتيح أجنبية مركّبة (تطابق نطاق الأب/الابن):', snapshot.compositeFkCandidates.length);
for (const c of snapshot.compositeFkCandidates) {
  console.log(`   ${c.table}.${c.column} → ${c.parent}`);
}

await db.close();
setTimeout(() => process.exit(0), 250).unref();
