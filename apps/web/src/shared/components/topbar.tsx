'use client';

import { useState, useTransition } from 'react';
import { Bell, LogOut, Menu, Search, UserRound } from 'lucide-react';
import {
  Button,
  Drawer,
  DrawerContent,
  DrawerTrigger,
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
  Input,
} from '@erp/ui';
import type { NavSection } from '@/config/navigation';
import { logoutAction } from '@/modules/auth/actions';
import { Sidebar } from './sidebar';

export interface TopbarProps {
  appName: string;
  sections: readonly NavSection[];
  user: { name: string; email: string | null; branchLabel: string };
}

export function Topbar({ appName, sections, user }: TopbarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signingOut, startSignOut] = useTransition();

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-card/80 px-4 backdrop-blur lg:px-6">
      <Drawer open={mobileOpen} onOpenChange={setMobileOpen}>
        <DrawerTrigger asChild>
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="فتح القائمة">
            <Menu aria-hidden />
          </Button>
        </DrawerTrigger>
        <DrawerContent side="start" size="sm" title="القائمة الرئيسية" className="p-0">
          <div className="-m-5 h-full">
            <Sidebar appName={appName} sections={sections} onNavigate={() => setMobileOpen(false)} />
          </div>
        </DrawerContent>
      </Drawer>

      <div className="hidden max-w-sm flex-1 md:block">
        <Input
          type="search"
          placeholder="بحث شامل…"
          startAdornment={<Search aria-hidden />}
          aria-label="بحث"
          disabled
          title="البحث الشامل عبر الوحدات يُفعَّل بعد اكتمال وحدات المرحلة 3"
        />
      </div>

      <div className="ms-auto flex items-center gap-2">
        <span className="hidden rounded-md bg-muted px-2.5 py-1 text-xs text-muted-foreground sm:inline">
          {user.branchLabel}
        </span>

        <Button variant="ghost" size="icon" aria-label="الإشعارات" disabled title="تُفعَّل في المرحلة 5">
          <Bell aria-hidden />
        </Button>

        <Dropdown>
          <DropdownTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="حساب المستخدم">
              <UserRound aria-hidden />
            </Button>
          </DropdownTrigger>
          <DropdownContent align="end" className="min-w-56">
            <DropdownLabel>
              <span className="block truncate font-medium text-foreground">{user.name}</span>
              {user.email ? (
                <span className="block truncate text-xs font-normal" dir="ltr">
                  {user.email}
                </span>
              ) : null}
            </DropdownLabel>
            <DropdownSeparator />
            <DropdownItem disabled>الملف الشخصي — المرحلة 3</DropdownItem>
            <DropdownItem
              destructive
              disabled={signingOut}
              onSelect={(event) => {
                event.preventDefault();
                startSignOut(async () => {
                  await logoutAction();
                });
              }}
            >
              <LogOut aria-hidden />
              تسجيل الخروج
            </DropdownItem>
          </DropdownContent>
        </Dropdown>
      </div>
    </header>
  );
}
