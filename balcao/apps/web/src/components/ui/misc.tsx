import type { ReactNode } from 'react';
import { cx } from '@/lib/format';

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx('animate-spin', className ?? 'size-4')} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

type Tone = 'neutral' | 'brand' | 'warn' | 'danger' | 'info' | 'outline';
const tones: Record<Tone, string> = {
  neutral: 'bg-sunken text-ink-2',
  brand: 'bg-brand-soft text-brand-ink',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
  outline: 'border border-line-strong text-ink-2',
};

export function Badge({ tone = 'neutral', children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cx('inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap', tones[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-md bg-sunken', className)} aria-hidden="true" />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      {icon && <div className="mb-4 grid size-11 place-items-center rounded-full bg-sunken text-muted">{icon}</div>}
      <p className="text-[0.9375rem] font-semibold text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3', className)}>
      <div className="min-w-0">
        <h1 className="text-[1.375rem] leading-tight font-semibold tracking-[-0.015em] text-ink">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Bloco de conteúdo. Usado com parcimônia: só quando agrupa algo que se lê junto. */
export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cx('rounded-lg border border-line bg-surface', className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            {title && <h2 className="text-[0.9375rem] font-semibold text-ink">{title}</h2>}
            {description && <p className="mt-0.5 text-[0.8125rem] text-muted">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx('p-5', bodyClassName)}>{children}</div>
    </section>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line-strong bg-surface px-1.5 py-0.5 font-mono text-[0.6875rem] text-muted">{children}</kbd>;
}

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-danger/20 bg-danger-soft px-4 py-3 text-sm text-danger">
      <span>{message}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="font-semibold underline underline-offset-2">
          Tentar de novo
        </button>
      )}
    </div>
  );
}
