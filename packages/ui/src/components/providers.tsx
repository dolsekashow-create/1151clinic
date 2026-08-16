'use client';

import * as React from 'react';
import { DirectionProvider } from '@radix-ui/react-direction';

/**
 * مزوّد نظام التصميم.
 * يُبلّغ مكوّنات Radix باتجاه الواجهة حتى تنعكس القوائم والتلميحات
 * ومفاتيح الأسهم بشكل صحيح في RTL.
 */
export function UIProvider({
  children,
  dir = 'rtl',
}: {
  children: React.ReactNode;
  dir?: 'rtl' | 'ltr';
}) {
  return <DirectionProvider dir={dir}>{children}</DirectionProvider>;
}
