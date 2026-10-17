import { cn } from '@/lib/utils';

/** Standard 1px rule under page/modal/section titles — primary @ 50% opacity. */
export function HeaderDivider({ className }: { className?: string }) {
  return (
    <div
      role="presentation"
      aria-hidden
      className={cn('h-px w-full shrink-0 bg-[var(--primary)] opacity-50', className)}
    />
  );
}
