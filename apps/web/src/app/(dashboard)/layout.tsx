import { Sidebar } from '@/shared/components/sidebar';
import { Topbar } from '@/shared/components/topbar';
import { publicEnv } from '@/config/env';

/**
 * تخطيط لوحة التحكم.
 *
 * ⚠️ لا توجد حماية على هذه المسارات في المرحلة 1 — المصادقة تُضاف في المرحلة 2
 *    عبر middleware + فحص جلسة في هذا التخطيط.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const appName = publicEnv.NEXT_PUBLIC_APP_NAME;

  return (
    <div className="flex min-h-dvh">
      <aside className="hidden lg:block">
        <div className="sticky top-0 h-dvh">
          <Sidebar appName={appName} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar appName={appName} />
        <main className="flex-1 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
