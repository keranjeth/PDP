'use client';

import type { ReactNode } from 'react';

import { HeaderDivider } from '@/components/ui/HeaderDivider';

export function ImportModalShell({
  isOpen,
  title,
  icon,
  onClose,
  children,
}: {
  isOpen: boolean;
  title: string;
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/10 p-3 backdrop-blur-[3px] sm:items-center sm:p-4">
      <div className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-[760px] flex-col overflow-hidden rounded-[18px] border border-slate-200 bg-white shadow-[0_28px_70px_rgba(15,23,42,0.18)] sm:max-h-[88vh]">
        <div className="flex shrink-0 items-start justify-between gap-4 px-4 py-4 sm:px-6 sm:py-5">
          <div className="flex items-center gap-3">
            {icon ? (
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--primary-light)] text-[var(--primary)]">
                {icon}
              </div>
            ) : null}
            <h3 className="text-[18px] font-semibold text-slate-950">{title}</h3>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 transition-colors hover:text-slate-600"
            aria-label="Close modal"
          >
            {/* X icon kept local to caller to avoid styling drift */}
            <span className="sr-only">Close</span>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              className="h-6 w-6"
              aria-hidden="true"
            >
              <path d="M18 6 6 18" />
              <path d="M6 6l12 12" />
            </svg>
          </button>
        </div>

        <HeaderDivider />

        <div className="min-h-0 flex-1 overflow-auto px-4 py-4 sm:px-6 sm:py-6">{children}</div>
      </div>
    </div>
  );
}

