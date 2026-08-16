import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const config = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'],
  },
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      // الحاجز الفعلي هو `server-only`؛ هذا التحذير يجعل كل استخدام مرئيًا في المراجعة
      'no-restricted-imports': [
        'warn',
        {
          patterns: [
            {
              group: ['**/infrastructure/supabase/admin'],
              importNames: ['createAdminClient'],
              message:
                'عميل الإدارة (service_role) يُستخدم في الخادم فقط ومن مسارات موثوقة — راجع docs/SECURITY.md §4.',
            },
          ],
        },
      ],
    },
  },
];

export default config;
