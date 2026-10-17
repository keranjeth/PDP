'use client';

import type { ReactNode } from 'react';
import { TopNavbar } from '@/components/layout/TopNavbar';

export function MainContentChrome({
  children,
  collapsed,
  onOpenSidebar,
}: {
  children: ReactNode;
  collapsed: boolean;
  onOpenSidebar: () => void;
}) {
  return (
    <div
      className={`flex min-h-screen min-w-0 flex-1 flex-col bg-gray-50 ${
        collapsed ? 'md:ml-16' : 'md:ml-48'
      }`}
    >
      <TopNavbar onOpenSidebar={onOpenSidebar} />
      <div className="min-h-0 flex-1 overflow-auto pt-14">
        <div className="px-4 pb-4 pt-3 sm:px-5 md:px-6 md:pb-6 md:pt-4">{children}</div>
      </div>
    </div>
  );
}
