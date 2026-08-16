import { redirect } from 'next/navigation';

/**
 * الجذر يعيد التوجيه إلى لوحة المعلومات.
 * في المرحلة 2 يصبح التوجيه مشروطًا بوجود جلسة (وإلا → /login).
 */
export default function HomePage() {
  redirect('/dashboard');
}
