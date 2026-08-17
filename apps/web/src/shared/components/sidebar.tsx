'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  Bell,
  Building2,
  Calendar,
  Clock,
  Contact,
  Gauge,
  History,
  KeyRound,
  Network,
  Package,
  Receipt,
  Settings,
  Shield,
  ShoppingCart,
  Sparkles,
  Stethoscope,
  Store,
  Truck,
  Users,
  Vault,
  Wallet,
  Warehouse,
  type LucideIcon,
  MapPin,
} from 'lucide-react';
import { cn } from '@erp/ui';
import type { NavIconKey, NavSection } from '@/config/navigation';

const ICONS: Record<NavIconKey, LucideIcon> = {
  gauge: Gauge,
  building: Building2,
  store: Store,
  network: Network,
  users: Users,
  shield: Shield,
  key: KeyRound,
  contact: Contact,
  calendar: Calendar,
  stethoscope: Stethoscope,
  sparkles: Sparkles,
  package: Package,
  warehouse: Warehouse,
  shoppingCart: ShoppingCart,
  truck: Truck,
  wallet: Wallet,
  vault: Vault,
  clock: Clock,
  receipt: Receipt,
  bell: Bell,
  barChart: BarChart3,
  history: History,
  mapPin: MapPin,
  settings: Settings,
};

export interface SidebarProps {
  appName: string;
  sections: readonly NavSection[];
  onNavigate?: () => void;
}

export function Sidebar({ appName, sections, onNavigate }: SidebarProps) {
  const pathname = usePathname();

  return (
    <nav
      className="flex h-full w-64 shrink-0 flex-col border-s border-sidebar-border bg-sidebar text-sidebar-foreground"
      aria-label="القائمة الرئيسية"
    >
      <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Building2 className="size-5" aria-hidden />
        </span>
        <span className="truncate text-sm font-semibold leading-tight">{appName}</span>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        {sections.map((section) => (
          <div key={section.key} className="mb-5">
            <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wide text-sidebar-muted">
              {section.label}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = ICONS[item.icon];
                const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

                return (
                  <li key={item.key}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={isActive ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors',
                        'hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        isActive
                          ? 'bg-primary font-medium text-primary-foreground hover:bg-primary'
                          : 'text-sidebar-foreground',
                      )}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden />
                      <span className="flex-1 truncate">{item.label}</span>
                      {!item.implemented ? (
                        <span
                          className={cn(
                            'rounded px-1.5 py-0.5 text-[10px] font-medium',
                            isActive
                              ? 'bg-primary-foreground/20 text-primary-foreground'
                              : 'bg-sidebar-accent text-sidebar-muted',
                          )}
                          title={`مُخطَّطة للمرحلة ${item.phase}`}
                        >
                          م{item.phase}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-sidebar-border px-4 py-3 text-[11px] text-sidebar-muted">
        الإصدار 0.2.0 · المرحلة 2
      </div>
    </nav>
  );
}
