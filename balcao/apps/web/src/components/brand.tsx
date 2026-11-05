import { cx } from '@/lib/format';

/** Marca do Balcão: uma comanda com o topo serrilhado. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cx('shrink-0', className ?? 'size-7')} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--color-brand)" />
      <path
        d="M9 9.5l1.75-1.5 1.75 1.5 1.75-1.5 1.75 1.5 1.75-1.5 1.75 1.5 1.75-1.5L23 9.5V24a1 1 0 0 1-1 1H10a1 1 0 0 1-1-1z"
        fill="#fff"
      />
      <rect x="12" y="14" width="8" height="1.8" rx=".9" fill="var(--color-brand)" />
      <rect x="12" y="18" width="5" height="1.8" rx=".9" fill="var(--color-brand)" opacity=".45" />
    </svg>
  );
}

export function BrandLogo({ className }: { className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-2', className)}>
      <BrandMark />
      <span className="text-[1.0625rem] font-semibold tracking-[-0.02em] text-ink">Balcão</span>
    </span>
  );
}
