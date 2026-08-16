import type { NextConfig } from 'next';

/**
 * ترويسات أمنية تُطبَّق على كل المسارات.
 * HSTS تُدار من المنصة (Vercel) ولا تُضاف هنا لتجنّب تعارض الإعدادات.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // لا نكشف إصدار الإطار في الترويسات
  poweredByHeader: false,

  // حزم المستودع تُشحن كـ TypeScript مصدري — يجب تحويلها ضمن التطبيق
  transpilePackages: ['@erp/ui', '@erp/core', '@erp/types'],

  typescript: {
    // ممنوع تجاوز أخطاء الأنواع في البناء — البناء المكسور لا يُنشر
    ignoreBuildErrors: false,
  },
  eslint: {
    // الفحص يعمل كخطوة مستقلة (`pnpm lint`) عبر ESLint CLI مباشرة،
    // لأن `next lint` مُهمَل ويُزال في Next 16. الفحص إلزامي في CI.
    ignoreDuringBuilds: true,
  },

  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
