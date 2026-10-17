'use client';

import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...props
}: ButtonProps) {
  const baseStyles =
    'inline-flex items-center justify-center font-medium rounded-lg transition-colors outline-none focus:outline-none focus:ring-0 disabled:opacity-50 disabled:cursor-not-allowed';

  const variants = {
    primary:
      'bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white active:bg-[var(--primary-pressed)]',
    secondary:
      'border border-[var(--primary-border)] bg-white hover:bg-slate-50 text-slate-900',
    danger: 'bg-red-600 hover:bg-red-700 text-white',
    outline:
      'border border-[var(--primary)] text-[var(--primary-strong)] bg-white hover:bg-[var(--primary-light)]',
    ghost:
      'text-slate-600 hover:text-[var(--primary-strong)] hover:bg-[var(--primary-light)]',
  };

  const sizes = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-base',
    lg: 'px-6 py-3 text-lg',
  };

  return (
    <button
      className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
