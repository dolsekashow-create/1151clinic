/**
 * يولّد supabase/seed/01_permissions_roles.sql من كتالوج الصلاحيات في الكود.
 *
 * لماذا توليد بدل كتابة SQL يدويًا؟
 *   كتالوج الصلاحيات موجود أصلًا في packages/core (يستخدمه التطبيق للتحقق).
 *   كتابة نسخة ثانية في SQL تعني مصدرَي حقيقة يتفرّعان بصمت — وهو بالضبط
 *   نوع الخطأ الذي يُنتج ثغرة صلاحيات. المصدر الوحيد هو الكود.
 *
 * التشغيل:  pnpm db:seed:generate
 * ملاحظة: يعتمد على تجريد الأنواع المدمج في Node ≥ 22.6 لقراءة ملفات .ts مباشرة.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

// pathToFileURL مطلوب على Windows: مسار مثل C:\… ليس URL صالحًا لمُحمّل ESM
const { PERMISSIONS, INITIAL_ROLES } = await import(
  pathToFileURL(resolve(root, 'packages/core/src/permissions/catalog.ts')).href
);

const sqlString = (value) => `'${String(value).replace(/'/g, "''")}'`;

const lines = [];
lines.push('-- =============================================================================');
lines.push('--  ⚠️  ملف مُولّد آليًا — لا تُعدّله يدويًا.');
lines.push('--  المصدر : packages/core/src/permissions/catalog.ts');
lines.push('--  التوليد: pnpm db:seed:generate');
lines.push('--');
lines.push('--  يحتوي بيانات مرجعية فقط: الصلاحيات والأدوار الأولية.');
lines.push('--  ⛔ ممنوع وضع أي بيانات عملاء أو مالية أو أسرار هنا.');
lines.push('-- =============================================================================');
lines.push('');
lines.push('-- 1) الصلاحيات');
lines.push('insert into public.permissions (key, module, action, name_ar, is_sensitive) values');

const permissionRows = PERMISSIONS.map(
  (p) =>
    `  (${sqlString(p.key)}, ${sqlString(p.module)}, ${sqlString(p.action)}, ` +
    `${sqlString(p.nameAr)}, ${p.sensitive ? 'true' : 'false'})`,
);
lines.push(permissionRows.join(',\n'));
lines.push('on conflict (key) do update set');
lines.push('  module = excluded.module,');
lines.push('  action = excluded.action,');
lines.push('  name_ar = excluded.name_ar,');
lines.push('  is_sensitive = excluded.is_sensitive;');
lines.push('');

lines.push('-- 2) الأدوار النظامية الأولية (organization_id = null ⇒ متاحة لكل المنشآت)');
lines.push('--    ⚠️ بذرة قابلة للتعديل من الواجهة — ليست قرارًا نهائيًا (P-16).');
lines.push('insert into public.roles (organization_id, key, name_ar, is_system) values');
const roleRows = INITIAL_ROLES.map(
  (r) => `  (null, ${sqlString(r.key)}, ${sqlString(r.nameAr)}, ${r.isSystem ? 'true' : 'false'})`,
);
lines.push(roleRows.join(',\n'));
lines.push(
  "on conflict (coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), key) " +
    'do update set name_ar = excluded.name_ar, is_system = excluded.is_system;',
);
lines.push('');

lines.push('-- 3) ربط الأدوار بالصلاحيات');
lines.push('delete from public.role_permissions rp');
lines.push('  using public.roles r');
lines.push(' where rp.role_id = r.id and r.organization_id is null;');
lines.push('');

for (const role of INITIAL_ROLES) {
  lines.push(`-- ${role.nameAr} (${role.key})`);
  if (role.permissions === '*') {
    lines.push('insert into public.role_permissions (role_id, permission_id)');
    lines.push('select r.id, p.id from public.roles r cross join public.permissions p');
    lines.push(` where r.key = ${sqlString(role.key)} and r.organization_id is null`);
    lines.push('on conflict do nothing;');
  } else {
    lines.push('insert into public.role_permissions (role_id, permission_id)');
    lines.push('select r.id, p.id from public.roles r join public.permissions p on p.key in (');
    lines.push(role.permissions.map((key) => `  ${sqlString(key)}`).join(',\n'));
    lines.push(`) where r.key = ${sqlString(role.key)} and r.organization_id is null`);
    lines.push('on conflict do nothing;');
  }
  lines.push('');
}

const outDir = resolve(root, 'supabase/seed');
mkdirSync(outDir, { recursive: true });
const outFile = resolve(outDir, '01_permissions_roles.sql');
writeFileSync(outFile, `${lines.join('\n')}\n`, 'utf8');

console.log(
  `✔ تم توليد ${outFile}\n  الصلاحيات: ${PERMISSIONS.length} · الأدوار: ${INITIAL_ROLES.length}`,
);
