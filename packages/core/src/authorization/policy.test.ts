import { describe, expect, it } from 'vitest';
import type { AuthContext } from '@erp/types';
import { AppError } from '../errors';
import {
  canAccessBranch,
  hasPermission,
  requireBranchAccess,
  requirePermission,
  resolveBranchFilter,
} from './policy';

const BRANCH_A = '11111111-1111-4111-8111-111111111111';
const BRANCH_B = '22222222-2222-4222-8222-222222222222';
const ORG = '33333333-3333-4333-8333-333333333333';

function makeContext(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: '44444444-4444-4444-8444-444444444444',
    organizationId: ORG,
    email: 'user@example.test',
    status: 'active',
    branchIds: [BRANCH_A],
    hasOrganizationScope: false,
    permissions: ['customers.view'],
    ...overrides,
  };
}

describe('التخويل — الصلاحيات', () => {
  it('يسمح للمستخدم الذي يملك الصلاحية', () => {
    expect(hasPermission(makeContext(), 'customers.view')).toBe(true);
  });

  it('يمنع المستخدم الذي لا يملك الصلاحية', () => {
    expect(hasPermission(makeContext(), 'customers.delete')).toBe(false);
  });

  it('يمنع المستخدم المعطّل حتى لو كانت الصلاحية ممنوحة', () => {
    const ctx = makeContext({ status: 'suspended' });
    expect(hasPermission(ctx, 'customers.view')).toBe(false);
  });

  it('requirePermission يرمي PERMISSION_DENIED', () => {
    try {
      requirePermission(makeContext(), 'finance.approve');
      expect.unreachable('كان يجب أن يرمي خطأ');
    } catch (error) {
      expect(AppError.isAppError(error)).toBe(true);
      expect((error as AppError).code).toBe('PERMISSION_DENIED');
      expect((error as AppError).httpStatus).toBe(403);
    }
  });
});

describe('التخويل — عزل الفروع', () => {
  it('مستخدم الفرع A يصل إلى الفرع A', () => {
    expect(canAccessBranch(makeContext(), BRANCH_A)).toBe(true);
  });

  it('مستخدم الفرع A لا يصل إلى الفرع B', () => {
    expect(canAccessBranch(makeContext(), BRANCH_B)).toBe(false);
  });

  it('صاحب نطاق المنشأة يصل إلى أي فرع', () => {
    const ctx = makeContext({ hasOrganizationScope: true, branchIds: [] });
    expect(canAccessBranch(ctx, BRANCH_B)).toBe(true);
  });

  it('سجل على مستوى المنشأة (branchId = null) يتطلب نطاق منشأة', () => {
    expect(canAccessBranch(makeContext(), null)).toBe(false);
    expect(canAccessBranch(makeContext({ hasOrganizationScope: true }), null)).toBe(true);
  });

  it('requireBranchAccess يرمي BRANCH_ACCESS_DENIED للفرع B', () => {
    try {
      requireBranchAccess(makeContext(), BRANCH_B);
      expect.unreachable('كان يجب أن يرمي خطأ');
    } catch (error) {
      expect((error as AppError).code).toBe('BRANCH_ACCESS_DENIED');
    }
  });
});

describe('resolveBranchFilter', () => {
  it('يُرجع null لصاحب نطاق المنشأة بلا طلب فرع محدد', () => {
    const ctx = makeContext({ hasOrganizationScope: true });
    expect(resolveBranchFilter(ctx)).toBeNull();
  });

  it('يُرجع فروع المستخدم عند عدم تحديد فرع', () => {
    expect(resolveBranchFilter(makeContext())).toEqual([BRANCH_A]);
  });

  it('يرفض طلب فرع خارج نطاق المستخدم', () => {
    expect(() => resolveBranchFilter(makeContext(), BRANCH_B)).toThrow();
  });
});
