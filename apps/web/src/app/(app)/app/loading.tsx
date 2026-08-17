import { LoadingState } from '@erp/ui';

/**
 * مؤشر تحميل داخل هيكل لوحة التحكم.
 *
 * كان على مستوى الجذر (app/loading.tsx) فكان يستبدل الشريط الجانبي والعلوي
 * بمؤشر عارٍ، ويترك أثرًا مرئيًا فوق المحتوى بعد اكتمال التحميل.
 * وضعه داخل مجموعة (dashboard) يجعله يظهر في منطقة المحتوى وحدها.
 */
export default function DashboardLoading() {
  return <LoadingState label="جارٍ تحميل الصفحة…" />;
}
