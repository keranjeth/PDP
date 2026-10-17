'use client';

import { useCallback, useEffect, useSyncExternalStore, useState } from 'react';
import { Sidebar } from '@/components/layout/Sidebar';
import { MainContentChrome } from '@/components/layout/MainContentChrome';

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'pd-plan.sidebar.collapsed';
const SIDEBAR_COLLAPSED_EVENT = 'pd-plan.sidebar-collapsed-change';

function subscribeToSidebarPreference(callback: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key && event.key !== SIDEBAR_COLLAPSED_STORAGE_KEY) {
      return;
    }
    callback();
  };

  const onPreferenceChange = () => callback();

  window.addEventListener('storage', onStorage);
  window.addEventListener(SIDEBAR_COLLAPSED_EVENT, onPreferenceChange);

  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(SIDEBAR_COLLAPSED_EVENT, onPreferenceChange);
  };
}

function getSidebarCollapsedSnapshot() {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function getSidebarCollapsedServerSnapshot() {
  return false;
}

export default function MainAppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const collapsed = useSyncExternalStore(
    subscribeToSidebarPreference,
    getSidebarCollapsedSnapshot,
    getSidebarCollapsedServerSnapshot
  );
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const setCollapsed = useCallback((next: boolean) => {
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, next ? '1' : '0');
      window.dispatchEvent(new Event(SIDEBAR_COLLAPSED_EVENT));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!mobileNavOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)');
    const handleChange = (event: MediaQueryListEvent) => {
      if (event.matches) {
        setMobileNavOpen(false);
      }
    };

    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, []);

  return (
    <div className="flex min-h-screen w-full bg-gray-50 text-slate-900">
      <Sidebar
        collapsed={collapsed}
        setCollapsed={setCollapsed}
        mobileOpen={mobileNavOpen}
        setMobileOpen={setMobileNavOpen}
      />
      <MainContentChrome collapsed={collapsed} onOpenSidebar={() => setMobileNavOpen(true)}>
        {children}
      </MainContentChrome>
    </div>
  );
}
