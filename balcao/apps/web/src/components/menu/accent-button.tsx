'use client';

import type { ButtonHTMLAttributes } from 'react';
import { cx } from '@/lib/format';
import { Spinner } from '@/components/ui/misc';

/** Botão principal do cardápio, na cor escolhida pela loja (com texto claro ou escuro conforme o contraste). */
export function AccentButton({ className, loading, children, disabled, type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cx(
        'inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-5 text-[0.9375rem] font-semibold text-[color:var(--accent-ink,#fff)] transition-[background-color,transform] duration-150 hover:bg-[var(--accent-strong)] active:translate-y-px disabled:opacity-50',
        className,
      )}
      {...rest}
    >
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
}
