'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireBranchAccess } from '@erp/core';
import { defineAction, defineQuery } from '@/shared/lib/action';
import {
  createCustomer,
  listCustomers,
  softDeleteCustomer,
  updateCustomer,
  type CustomerRow,
} from './repository';
import { customerCreateSchema, customerListSchema, customerUpdateSchema } from './schemas';
import type { Paginated } from '@erp/types';

/**
 * Server Actions لوحدة العملاء.
 *
 * كل فعل يمر عبر defineAction ⇒ مصادقة، صلاحية، تحقق، تنفيذ، تدقيق.
 * راجع docs/API.md §2.
 */

export const listCustomersAction = defineQuery<
  z.infer<typeof customerListSchema>,
  Paginated<CustomerRow>
>({
  permission: 'customers.view',
  schema: customerListSchema,
  handler: async (ctx, input) => {
    const result = await listCustomers(ctx, input);
    return { data: result, meta: result.meta };
  },
});

export const createCustomerAction = defineAction({
  permission: 'customers.create',
  schema: customerCreateSchema,
  handler: async (ctx, input) => {
    // فحص نطاق الفرع قبل الوصول لقاعدة البيانات: يعطي 403 مفهومًا بدل رفض RLS صامت
    requireBranchAccess(ctx, input.branchId);
    const customer = await createCustomer(ctx, input);
    revalidatePath('/app/customers');
    return customer;
  },
  audit: (_ctx, input, output) => ({
    action: 'customer.created',
    module: 'customers',
    entityType: 'customer',
    entityId: output.id,
    branchId: input.branchId,
    newValues: { fullNameAr: output.fullNameAr, phone: output.phone, code: output.code },
  }),
});

export const updateCustomerAction = defineAction({
  permission: 'customers.update',
  schema: customerUpdateSchema,
  handler: async (ctx, input) => {
    const customer = await updateCustomer(ctx, input);
    revalidatePath('/app/customers');
    return customer;
  },
  audit: (_ctx, input, output) => ({
    action: 'customer.updated',
    module: 'customers',
    entityType: 'customer',
    entityId: output.id,
    branchId: output.branchId,
    newValues: { ...input, id: undefined },
  }),
});

export const deleteCustomerAction = defineAction({
  permission: 'customers.delete',
  schema: z.object({ id: z.string().uuid() }),
  handler: async (ctx, input) => {
    await softDeleteCustomer(ctx, input.id);
    revalidatePath('/app/customers');
    return { id: input.id };
  },
  audit: (_ctx, input) => ({
    action: 'customer.deleted',
    module: 'customers',
    entityType: 'customer',
    entityId: input.id,
    branchId: null,
  }),
});
