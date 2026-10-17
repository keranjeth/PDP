'use client';

import React from 'react';
import { useEffect } from 'react';

import { HeaderDivider } from '@/components/ui/HeaderDivider';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  /** Optional line under the title (e.g. short context for the dialog). */
  subtitle?: string;
  /** @deprecated Unused; all modals share the same header rule (`HeaderDivider`). Kept for call-site compatibility. */
  headerAccent?: boolean;
  /** Classes for the scrollable content region (default allows vertical scroll when tall). */
  contentClassName?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export function Modal({
  isOpen,
  onClose,
  title,
  subtitle,
  headerAccent: _unusedHeaderAccent,
  contentClassName,
  children,
  footer,
  size = 'md',
}: ModalProps) {
  void _unusedHeaderAccent;
  useEffect(() => {
    if (!isOpen) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const sizes = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div
        className="fixed inset-0 bg-slate-950/25 backdrop-blur-[3px] transition-opacity"
        onClick={onClose}
      />

      <div className="flex min-h-screen items-end justify-center p-3 sm:items-center sm:p-6">
        <div
          className={`relative flex max-h-[calc(100dvh-1.5rem)] w-full flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_25px_50px_-12px_rgba(15,23,42,0.25)] ring-1 ring-slate-900/5 transition-all sm:max-h-[calc(100dvh-3rem)] ${sizes[size]}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-4 bg-gradient-to-b from-slate-50/90 to-white px-5 py-5 sm:px-7">
            <div className="min-w-0 pr-2">
              <h3 className="text-lg font-semibold tracking-tight text-slate-900">{title}</h3>
              {subtitle ? <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{subtitle}</p> : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
              aria-label="Close modal"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <HeaderDivider />

          <div
            className={
              contentClassName ??
              'min-h-0 overflow-y-auto px-5 py-5 sm:px-7'
            }
          >
            {children}
          </div>

          {footer ? (
            <div className="flex flex-col-reverse gap-3 border-t border-slate-200/90 bg-slate-50/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
              {footer}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
