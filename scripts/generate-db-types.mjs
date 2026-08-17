/**
 * يولّد packages/types/src/database.types.ts من مخطط قاعدة البيانات الفعلي.
 *
 * لماذا مولّد خاص بدل `supabase gen types`؟
 *   أمر Supabase يتطلب Supabase CLI + Docker أو مشروعًا مرتبطًا. هذا المولّد
 *   يستخدم نفس منصة الاختبار (PostgreSQL مضمّن) ويطبّق نفس ملفات الترحيل،
 *   فتبقى الأنواع مشتقة من **مصدر الحقيقة نفسه** (ملفات SQL) بلا أدوات إضافية.
 *   عند توفر Supabase CLI يبقى `pnpm db:types` بديلًا صالحًا وينتج نفس الشكل.
 *
 * التشغيل: pnpm db:types:generate
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createTestDatabase, repoRoot } from '../supabase/tests/harness.mjs';

/** خريطة أنواع PostgreSQL → TypeScript (مطابقة لسلوك PostgREST في تسلسل JSON). */
function tsType(dataType, udtName) {
  if (udtName?.startsWith('_')) return `${tsType(null, udtName.slice(1))}[]`;
  switch (dataType) {
    case 'boolean':
      return 'boolean';
    case 'smallint':
    case 'integer':
    case 'bigint':
    case 'numeric':
    case 'real':
    case 'double precision':
      // ⚠️ numeric يُسلسَل كرقم JSON. للحسابات المالية استخدم التجميع في
      //    قاعدة البيانات ولا تعتمد على حساب IEEE-754 في المتصفح.
      return 'number';
    case 'json':
    case 'jsonb':
      return 'Json';
    default:
      return 'string';
  }
}

const db = await createTestDatabase({ port: 54331 });
const { client } = db;

const { rows: columns } = await client.query(`
  select c.table_name,
         c.column_name,
         c.data_type,
         c.udt_name,
         c.is_nullable = 'YES' as is_nullable,
         c.column_default is not null as has_default,
         c.is_identity = 'YES' as is_identity,
         c.is_generated = 'ALWAYS' as is_generated
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema and t.table_name = c.table_name
  where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
  order by c.table_name, c.ordinal_position
`);

const tables = new Map();
for (const column of columns) {
  if (!tables.has(column.table_name)) tables.set(column.table_name, []);
  tables.get(column.table_name).push(column);
}

const out = [];
out.push('/**');
out.push(' * Supabase database types.');
out.push(' *');
out.push(' * ⚠️  ملف مُولّد آليًا — لا تُعدّله يدويًا.');
out.push(' *     التوليد: pnpm db:types:generate   (يشتقّ الأنواع من supabase/migrations)');
out.push(' *');
out.push(` * عدد الجداول: ${tables.size}`);
out.push(' */');
out.push('');
out.push(
  'export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];',
);
out.push('');
out.push('export type Database = {');
out.push('  public: {');
out.push('    Tables: {');

for (const [tableName, cols] of [...tables].sort(([a], [b]) => a.localeCompare(b))) {
  out.push(`      ${tableName}: {`);

  out.push('        Row: {');
  for (const col of cols) {
    const type = tsType(col.data_type, col.udt_name);
    out.push(`          ${col.column_name}: ${type}${col.is_nullable ? ' | null' : ''};`);
  }
  out.push('        };');

  out.push('        Insert: {');
  for (const col of cols) {
    const type = tsType(col.data_type, col.udt_name);
    // العمود اختياري عند الإدراج إذا كان قابلًا للإفراغ أو له قيمة افتراضية
    // أو كان مولّدًا/هوية — أي عمود لا يجب على العميل تزويده.
    const optional = col.is_nullable || col.has_default || col.is_identity || col.is_generated;
    out.push(
      `          ${col.column_name}${optional ? '?' : ''}: ${type}${col.is_nullable ? ' | null' : ''};`,
    );
  }
  out.push('        };');

  out.push('        Update: {');
  for (const col of cols) {
    const type = tsType(col.data_type, col.udt_name);
    out.push(`          ${col.column_name}?: ${type}${col.is_nullable ? ' | null' : ''};`);
  }
  out.push('        };');

  out.push('        Relationships: [];');
  out.push('      };');
}

out.push('    };');
// ⚠️ لا تستخدم Record<string, never> هنا: فهرسها العام يجعل keyof = string،
//    فيصبح تقاطع (Tables & Views) لأي جدول = never وتنهار كل الأنواع.
//    هذا الشكل هو ما يُخرجه مولّد Supabase الرسمي.
out.push('    Views: { [_ in never]: never };');
out.push('    Functions: { [_ in never]: never };');
out.push('    Enums: { [_ in never]: never };');
out.push('    CompositeTypes: { [_ in never]: never };');
out.push('  };');
out.push('};');
out.push('');

const target = resolve(repoRoot, 'packages/types/src/database.types.ts');
writeFileSync(target, out.join('\n'), 'utf8');

await db.close();

console.log(`✔ تم توليد ${target}\n  الجداول: ${tables.size} · الأعمدة: ${columns.length}`);
setTimeout(() => process.exit(0), 250).unref();
