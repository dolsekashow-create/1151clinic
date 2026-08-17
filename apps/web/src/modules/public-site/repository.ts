import 'server-only';

import { errors } from '@erp/core';
import { createPublicClient } from '@/infrastructure/supabase/public';

/**
 * قراءة محتوى الموقع العام.
 *
 * ⚠️ كل استعلام هنا يمرّ بدور `anon` وبسياسات RLS العامة. لا يوجد أي مسار
 *    يتجاوزها ولا يُستخدم المفتاح السري إطلاقًا.
 * ⚠️ الأعمدة مُحدَّدة صراحةً — منح `anon` على مستوى الأعمدة يجعل `select('*')` يفشل.
 * ⚠️ لا أسعار: جدول الخدمات لا يحتوي أعمدة سعر (P-14 معلّقة).
 */

export interface PublicBranch {
  id: string;
  code: string;
  nameAr: string;
  city: string | null;
  phone: string | null;
  address: string | null;
}

export interface PublicService {
  id: string;
  code: string;
  nameAr: string;
  description: string | null;
  durationMinutes: number | null;
}

export interface PublicProvider {
  id: string;
  code: string;
  nameAr: string;
  specialty: string | null;
}

const BRANCH_COLUMNS = 'id, code, name_ar, city, phone, address';
const SERVICE_COLUMNS = 'id, code, name_ar, description, default_duration_minutes';
const PROVIDER_COLUMNS = 'id, code, full_name_ar, specialty';

export async function listPublicBranches(): Promise<PublicBranch[]> {
  const supabase = createPublicClient();
  const { data, error } = await supabase.from('branches').select(BRANCH_COLUMNS).order('city');
  if (error) throw errors.internal(error);
  return (data ?? []).map((row) => ({
    id: row.id,
    code: row.code,
    nameAr: row.name_ar,
    city: row.city,
    phone: row.phone,
    address: row.address,
  }));
}

export async function listPublicServices(): Promise<PublicService[]> {
  const supabase = createPublicClient();
  const { data, error } = await supabase.from('services').select(SERVICE_COLUMNS).order('name_ar');
  if (error) throw errors.internal(error);
  return (data ?? []).map((row) => ({
    id: row.id,
    code: row.code,
    nameAr: row.name_ar,
    description: row.description,
    durationMinutes: row.default_duration_minutes,
  }));
}

export async function listPublicProviders(): Promise<PublicProvider[]> {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from('service_providers')
    .select(PROVIDER_COLUMNS)
    .order('full_name_ar');
  if (error) throw errors.internal(error);
  return (data ?? []).map((row) => ({
    id: row.id,
    code: row.code,
    nameAr: row.full_name_ar,
    specialty: row.specialty,
  }));
}

/** الخدمات المتوفرة في فرع معيّن — عبر جدول الربط المحكوم بسياسة عامة. */
export async function listPublicBranchServices(branchId: string): Promise<PublicService[]> {
  const supabase = createPublicClient();
  const { data: links, error: linkError } = await supabase
    .from('branch_services')
    .select('service_id')
    .eq('branch_id', branchId);
  if (linkError) throw errors.internal(linkError);

  const serviceIds = (links ?? []).map((row) => row.service_id);
  if (serviceIds.length === 0) return [];

  const { data, error } = await supabase
    .from('services')
    .select(SERVICE_COLUMNS)
    .in('id', serviceIds)
    .order('name_ar');
  if (error) throw errors.internal(error);

  return (data ?? []).map((row) => ({
    id: row.id,
    code: row.code,
    nameAr: row.name_ar,
    description: row.description,
    durationMinutes: row.default_duration_minutes,
  }));
}

/** ملخّص للصفحة الرئيسية — عدّادات فقط بلا تفاصيل. */
export async function getPublicSummary(): Promise<{
  branches: number;
  services: number;
  providers: number;
  cities: string[];
}> {
  const supabase = createPublicClient();
  const [branches, services, providers] = await Promise.all([
    supabase.from('branches').select('id, city'),
    supabase.from('services').select('id'),
    supabase.from('service_providers').select('id'),
  ]);

  const cities = [
    ...new Set((branches.data ?? []).map((row) => row.city).filter((c): c is string => Boolean(c))),
  ];

  return {
    branches: branches.data?.length ?? 0,
    services: services.data?.length ?? 0,
    providers: providers.data?.length ?? 0,
    cities,
  };
}
