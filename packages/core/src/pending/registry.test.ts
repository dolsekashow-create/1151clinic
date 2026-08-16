import { describe, expect, it } from 'vitest';
import { AppError } from '../errors';
import { isKnownPermission, PERMISSIONS, INITIAL_ROLES } from '../permissions/catalog';
import { businessRulePending, PENDING_RULES } from './registry';

describe('سجل قواعد العمل المعلّقة', () => {
  it('كل قاعدة معلّقة لها معرّف فريد', () => {
    const ids = PENDING_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('استدعاء قاعدة معلّقة يرمي BUSINESS_RULE_PENDING بحالة 501', () => {
    try {
      businessRulePending('P-01');
      expect.unreachable('كان يجب أن يرمي خطأ');
    } catch (error) {
      expect(AppError.isAppError(error)).toBe(true);
      expect((error as AppError).code).toBe('BUSINESS_RULE_PENDING');
      expect((error as AppError).httpStatus).toBe(501);
      expect((error as AppError).details).toMatchObject({ ruleId: 'P-01' });
    }
  });
});

describe('كتالوج الصلاحيات', () => {
  it('لا توجد مفاتيح مكررة', () => {
    const keys = PERMISSIONS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('كل مفتاح بصيغة module.action', () => {
    for (const permission of PERMISSIONS) {
      expect(permission.key).toMatch(/^[a-z]+\.[a-z.]+$/);
      expect(permission.key.startsWith(`${permission.module}.`)).toBe(true);
    }
  });

  it('كل صلاحية في الأدوار الأولية موجودة في الكتالوج', () => {
    for (const role of INITIAL_ROLES) {
      if (role.permissions === '*') continue;
      for (const key of role.permissions) {
        expect(isKnownPermission(key), `صلاحية غير معروفة في الدور ${role.key}: ${key}`).toBe(true);
      }
    }
  });
});
