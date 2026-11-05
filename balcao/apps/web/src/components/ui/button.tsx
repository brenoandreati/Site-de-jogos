'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import Link from 'next/link';
import { cx } from '@/lib/format';
import { Spinner } from './misc';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
type Size = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';

const base =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium select-none transition-[background-color,border-color,color,box-shadow,transform] duration-150 active:translate-y-px disabled:pointer-events-none disabled:opacity-50';

const variants: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-strong shadow-soft',
  secondary: 'bg-surface text-ink border border-line-strong hover:border-ink/30 hover:bg-canvas shadow-soft',
  ghost: 'text-ink-2 hover:bg-sunken hover:text-ink',
  subtle: 'bg-sunken text-ink hover:bg-line',
  danger: 'bg-danger text-white hover:bg-[#9a1d14] shadow-soft',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-[0.8125rem] rounded-md',
  md: 'h-10 px-4 text-sm rounded-md',
  lg: 'h-12 px-5 text-[0.9375rem] rounded-lg',
  icon: 'h-10 w-10 rounded-md',
  'icon-sm': 'h-8 w-8 rounded-md',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(base, variants[variant], sizes[size], className)}
      {...rest}
    >
      {loading ? <Spinner className="size-4" /> : icon}
      {children}
    </button>
  );
});

export function ButtonLink({
  href,
  variant = 'secondary',
  size = 'md',
  icon,
  className,
  children,
  external,
  ...rest
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  className?: string;
  children?: ReactNode;
  external?: boolean;
  'aria-label'?: string;
}) {
  const cls = cx(base, variants[variant], sizes[size], className);
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls} {...rest}>
        {icon}
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={cls} {...rest}>
      {icon}
      {children}
    </Link>
  );
}
