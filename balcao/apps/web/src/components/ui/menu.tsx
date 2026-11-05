'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cx } from '@/lib/format';

/** Menu suspenso simples e acessível (Esc fecha, clique fora fecha, setas navegam). */
export function Menu({
  trigger,
  children,
  align = 'end',
  className,
  label,
}: {
  trigger: (props: { open: boolean; toggle: () => void; id: string }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'start' | 'end';
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
        if (!items.length) return;
        e.preventDefault();
        const idx = items.indexOf(document.activeElement as HTMLElement);
        const next = e.key === 'ArrowDown' ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
        items[next]?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {trigger({ open, toggle: () => setOpen((v) => !v), id })}
      {open && (
        <div
          role="menu"
          aria-label={label}
          id={id}
          className={cx(
            'absolute z-50 mt-1.5 min-w-52 animate-rise rounded-lg border border-line bg-surface p-1 shadow-pop',
            align === 'end' ? 'right-0' : 'left-0',
            className,
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  onClick,
  children,
  icon,
  tone,
  disabled,
  href,
  external,
}: {
  onClick?: () => void;
  children: ReactNode;
  icon?: ReactNode;
  tone?: 'danger';
  disabled?: boolean;
  href?: string;
  external?: boolean;
}) {
  const cls = cx(
    'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors disabled:opacity-40',
    tone === 'danger' ? 'text-danger hover:bg-danger-soft' : 'text-ink hover:bg-sunken',
  );
  if (href) {
    return (
      <a role="menuitem" href={href} className={cls} onClick={onClick} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
        {icon && <span className="text-muted [&>svg]:size-4">{icon}</span>}
        {children}
      </a>
    );
  }
  return (
    <button role="menuitem" type="button" className={cls} onClick={onClick} disabled={disabled}>
      {icon && <span className={cx('[&>svg]:size-4', tone === 'danger' ? 'text-danger' : 'text-muted')}>{icon}</span>}
      {children}
    </button>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="px-2.5 pb-1 pt-2 text-2xs font-medium uppercase tracking-[0.06em] text-faint">{children}</div>;
}

export function MenuSeparator() {
  return <div className="my-1 h-px bg-line" role="separator" />;
}
