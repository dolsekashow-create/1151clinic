'use client';

import { Bell, Menu, Search, UserRound } from 'lucide-react';
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
import { Sidebar } from './sidebar';

export function Topbar({ appName }: { appName: string }) {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-card/80 px-4 backdrop-blur lg:px-6">
      {/* قائمة الجوال */}
      <Drawer>
        <DrawerTrigger asChild>
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="فتح القائمة">
            <Menu aria-hidden />
          </Button>
        </DrawerTrigger>
        <DrawerContent side="start" size="sm" title="القائمة الرئيسية" className="p-0">
          <div className="-m-5 h-full">
            <Sidebar appName={appName} />
          </div>
        </DrawerContent>
      </Drawer>

      <div className="hidden max-w-sm flex-1 md:block">
        <Input
          type="search"
          placeholder="بحث…"
          startAdornment={<Search aria-hidden />}
          aria-label="بحث"
          disabled
          title="البحث الشامل يُفعَّل في المرحلة 3"
        />
      </div>

      <div className="ms-auto flex items-center gap-1">
        <Button variant="ghost" size="icon" aria-label="الإشعارات" disabled title="تُفعَّل في المرحلة 5">
          <Bell aria-hidden />
        </Button>

        <Dropdown>
          <DropdownTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="حساب المستخدم">
              <UserRound aria-hidden />
            </Button>
          </DropdownTrigger>
          <DropdownContent align="end">
            <DropdownLabel>الحساب</DropdownLabel>
            <DropdownSeparator />
            <DropdownItem disabled>الملف الشخصي — المرحلة 2</DropdownItem>
            <DropdownItem disabled>تسجيل الخروج — المرحلة 2</DropdownItem>
          </DropdownContent>
        </Dropdown>
      </div>
    </header>
  );
}
