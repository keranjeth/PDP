'use client';

import React from 'react';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'gray';
  size?: 'sm' | 'md';
  className?: string;
}

export function Badge({
  children,
  variant = 'default',
  size = 'md',
  className = '',
}: BadgeProps) {
  const baseStyles = 'inline-flex items-center font-medium rounded-full border';
  
  const variants = {
    default: 'border-[var(--primary)] bg-[var(--primary)] text-white',
    success: 'border-[var(--primary-border)] bg-[var(--primary-soft)] text-[var(--primary-strong)]',
    warning: 'border-yellow-200 bg-yellow-100 text-yellow-800',
    danger: 'border-red-200 bg-red-100 text-red-800',
    info: 'border-[var(--primary-border)] bg-[var(--primary-light)] text-[var(--primary)]',
    gray: 'border-gray-200 bg-gray-100 text-gray-800',
  };
  
  const sizes = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-3 py-1 text-sm',
  };
  
  return (
    <span className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}>
      {children}
    </span>
  );
}
