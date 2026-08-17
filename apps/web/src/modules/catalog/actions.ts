'use server';

import { revalidatePath } from 'next/cache';
import type { Paginated } from '@erp/types';
import { defineAction, defineQuery } from '@/shared/lib/action';
import {
  createProvider,
  createService,
  listProviders,
  listServices,
  listProviderBranchState,
  listProviderServiceState,
  listServiceBranchState,
  setProviderBranches,
  setProviderPublish,
  setProviderServices,
  setServiceBranches,
  setServicePublish,
  type LinkState,
  updateProvider,
  updateService,
  type ProviderRow,
  type ServiceRow,
} from './repository';
import {
  listQuerySchema,
  providerBranchesSetSchema,
  providerCreateSchema,
  providerServicesSetSchema,
  providerUpdateSchema,
  serviceBranchesSetSchema,
  serviceCreateSchema,
  serviceUpdateSchema,
  setPublishSchema,
} from './schemas';

/** معرّف كيان — نفس شكل الاستعلام في بقية الوحدات. */
const entityIdSchema = setPublishSchema.pick({ id: true });

/** يُبطل ذاكرة الموقع العام بعد أي تغيير في النشر. */
function revalidatePublicSurfaces(paths: readonly string[]): void {
  for (const path of paths) revalidatePath(path);
  revalidatePath('/');
}

/* ------------------------------- الخدمات ---------------------------------- */

export const listServicesAction = defineQuery<
  ReturnType<typeof listQuerySchema.parse>,
  Paginated<ServiceRow>
>({
  permission: 'services.view',
  schema: listQuerySchema,
  handler: async (ctx, input) => {
    const result = await listServices(ctx, input);
    return { data: result, meta: result.meta };
  },
});

export const createServiceAction = defineAction({
  permission: 'services.create',
  schema: serviceCreateSchema,
  handler: async (ctx, input) => {
    const service = await createService(ctx, input);
    revalidatePath('/app/services');
    return service;
  },
  audit: (_ctx, input, output) => ({
    action: 'service.created',
    module: 'services',
    entityType: 'service',
    entityId: output.id,
    branchId: input.branchId ?? null,
    newValues: { code: output.code, nameAr: output.nameAr },
  }),
});

export const updateServiceAction = defineAction({
  permission: 'services.update',
  schema: serviceUpdateSchema,
  handler: async (ctx, input) => {
    const service = await updateService(ctx, input);
    revalidatePath('/app/services');
    return service;
  },
  audit: (_ctx, input, output) => ({
    action: 'service.updated',
    module: 'services',
    entityType: 'service',
    entityId: output.id,
    branchId: output.branchId,
    newValues: { ...input, id: undefined },
  }),
});

export const setServicePublishAction = defineAction({
  permission: 'services.publish',
  schema: setPublishSchema,
  handler: async (ctx, input) => {
    const service = await setServicePublish(ctx, input.id, input.isPublic);
    revalidatePath('/app/services');
    revalidatePublicSurfaces(['/services']);
    return service;
  },
  audit: (_ctx, input, output) => ({
    action: input.isPublic ? 'service.published' : 'service.unpublished',
    module: 'services',
    entityType: 'service',
    entityId: output.id,
    branchId: output.branchId,
    newValues: { isPublic: input.isPublic, code: output.code },
  }),
});

/* --------------------------- مقدّمو الخدمة -------------------------------- */

export const listProvidersAction = defineQuery<
  ReturnType<typeof listQuerySchema.parse>,
  Paginated<ProviderRow>
>({
  permission: 'services.providers.view',
  schema: listQuerySchema,
  handler: async (ctx, input) => {
    const result = await listProviders(ctx, input);
    return { data: result, meta: result.meta };
  },
});

export const createProviderAction = defineAction({
  permission: 'services.providers.manage',
  schema: providerCreateSchema,
  handler: async (ctx, input) => {
    const provider = await createProvider(ctx, input);
    revalidatePath('/app/providers');
    return provider;
  },
  audit: (_ctx, input, output) => ({
    action: 'service_provider.created',
    module: 'services',
    entityType: 'service_provider',
    entityId: output.id,
    branchId: input.branchId ?? null,
    // ⚠️ لا نُسجّل الهاتف والبريد في التدقيق — بيانات تعريف شخصية
    newValues: { code: output.code, nameAr: output.nameAr, specialty: output.specialty },
  }),
});

export const updateProviderAction = defineAction({
  permission: 'services.providers.manage',
  schema: providerUpdateSchema,
  handler: async (ctx, input) => {
    const provider = await updateProvider(ctx, input);
    revalidatePath('/app/providers');
    return provider;
  },
  audit: (_ctx, input, output) => ({
    action: 'service_provider.updated',
    module: 'services',
    entityType: 'service_provider',
    entityId: output.id,
    branchId: output.branchId,
    newValues: { id: undefined, code: input.code, nameAr: input.nameAr, status: input.status },
  }),
});

export const setProviderPublishAction = defineAction({
  permission: 'services.providers.publish',
  schema: setPublishSchema,
  handler: async (ctx, input) => {
    const provider = await setProviderPublish(ctx, input.id, input.isPublic);
    revalidatePath('/app/providers');
    revalidatePublicSurfaces(['/providers']);
    return provider;
  },
  audit: (_ctx, input, output) => ({
    action: input.isPublic ? 'service_provider.published' : 'service_provider.unpublished',
    module: 'services',
    entityType: 'service_provider',
    entityId: output.id,
    branchId: output.branchId,
    newValues: { isPublic: input.isPublic, code: output.code },
  }),
});

/* ============================== جداول الربط ============================== */

/**
 * ⚠️ إتاحة الخدمة في الفروع تُغيّر ما يظهر على الموقع العام وما يمكن حجزه،
 *    فنُبطل ذاكرة السطحين معًا.
 */

export const listProviderBranchStateAction = defineQuery<{ id: string }, readonly LinkState[]>({
  permission: 'services.providers.view',
  schema: entityIdSchema,
  handler: async (_ctx, input) => ({ data: await listProviderBranchState(input.id) }),
});

export const listProviderServiceStateAction = defineQuery<{ id: string }, readonly LinkState[]>({
  permission: 'services.providers.view',
  schema: entityIdSchema,
  handler: async (_ctx, input) => ({ data: await listProviderServiceState(input.id) }),
});

export const listServiceBranchStateAction = defineQuery<{ id: string }, readonly LinkState[]>({
  permission: 'services.view',
  schema: entityIdSchema,
  handler: async (_ctx, input) => ({ data: await listServiceBranchState(input.id) }),
});

export const setProviderBranchesAction = defineAction({
  permission: 'services.providers.manage',
  schema: providerBranchesSetSchema,
  handler: async (ctx, input) => {
    await setProviderBranches(ctx, input);
    revalidatePath('/app/providers');
    revalidatePublicSurfaces(['/providers']);
    return { providerId: input.providerId, count: input.branchIds.length };
  },
  audit: (_ctx, input, output) => ({
    action: 'service_provider.branches_changed',
    module: 'services',
    entityType: 'service_provider',
    entityId: input.providerId,
    branchId: input.branchIds[0] ?? null,
    newValues: { branchCount: output.count, branchIds: input.branchIds },
  }),
});

export const setProviderServicesAction = defineAction({
  permission: 'services.providers.manage',
  schema: providerServicesSetSchema,
  handler: async (ctx, input) => {
    await setProviderServices(ctx, input);
    revalidatePath('/app/providers');
    revalidatePath('/app/appointments');
    revalidatePublicSurfaces(['/providers']);
    return { providerId: input.providerId, count: input.serviceIds.length };
  },
  audit: (_ctx, input, output) => ({
    action: 'service_provider.services_changed',
    module: 'services',
    entityType: 'service_provider',
    entityId: input.providerId,
    branchId: null,
    newValues: { serviceCount: output.count, serviceIds: input.serviceIds },
  }),
});

export const setServiceBranchesAction = defineAction({
  permission: 'services.update',
  schema: serviceBranchesSetSchema,
  handler: async (ctx, input) => {
    await setServiceBranches(ctx, input);
    revalidatePath('/app/services');
    revalidatePath('/app/appointments');
    revalidatePublicSurfaces(['/services']);
    return { serviceId: input.serviceId, count: input.branchIds.length };
  },
  audit: (_ctx, input, output) => ({
    action: 'service.branches_changed',
    module: 'services',
    entityType: 'service',
    entityId: input.serviceId,
    branchId: input.branchIds[0] ?? null,
    newValues: { branchCount: output.count, branchIds: input.branchIds },
  }),
});
