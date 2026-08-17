import { redirect } from 'next/navigation';
import { Sidebar } from '@/shared/components/sidebar';
import { Topbar } from '@/shared/components/topbar';
import { publicEnv } from '@/config/env';
import { visibleNavigation } from '@/config/navigation';
import { getAuthContext } from '@/modules/auth/session';
import { createClient } from '@/infrastructure/supabase/server';

/**
 * تخطيط لوحة التحكم.
 *
 * ⚠️ فحص الجلسة هنا **ثانٍ** بعد الـ middleware، وهو مقصود: الـ middleware
 *    قد يُتجاوَز في بعض حالات التوجيه الداخلي، وهذا التخطيط هو الحاجز الأخير
 *    قبل عرض أي واجهة. أما البيانات نفسها فمحميّة بـ RLS بصرف النظر عن الاثنين.
 *
 * ⚠️ الحساب الموقوف يُطرد من هنا. قاعدة البيانات تُلغي صلاحياته فعلًا، لكن
 *    جلسته تبقى صالحة فيدخل ويرى لوحة فارغة بلا تفسير — وهذا سلوك سيئ يخفي
 *    السبب. الطرد هنا يُوصل الرسالة، والحظر في خادم المصادقة يمنع الجلسة أصلًا.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAuthContext();
  if (!ctx) redirect('/login');
  if (ctx.status !== 'active') redirect('/login?reason=suspended');

  const appName = publicEnv.NEXT_PUBLIC_APP_NAME;
  const sections = visibleNavigation(ctx.permissions);

  const displayName = await loadDisplayName(ctx.userId);
  const branchLabel = ctx.hasOrganizationScope
    ? 'كل الفروع'
    : `${ctx.branchIds.length} ${ctx.branchIds.length === 1 ? 'فرع' : 'فروع'}`;

  return (
    <div className="flex min-h-dvh">
      <aside className="hidden lg:block">
        <div className="sticky top-0 h-dvh">
          <Sidebar appName={appName} sections={sections} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          appName={appName}
          sections={sections}
          user={{ name: displayName, email: ctx.email, branchLabel }}
        />
        <main className="flex-1 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}

async function loadDisplayName(userId: string): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('profiles')
    .select('full_name_ar')
    .eq('id', userId)
    .maybeSingle();
  return data?.full_name_ar ?? 'مستخدم';
}
