import Link from 'next/link';
import type { ReactNode } from 'react';
import { BrandLogo } from './brand';

export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="px-6 py-5">
        <Link href="/" aria-label="Balcão, início">
          <BrandLogo />
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-6 sm:items-center sm:pt-0">
        <div className="w-full max-w-[420px]">
          <div className="rounded-xl border border-line bg-surface p-6 shadow-soft sm:p-8">
            <h1 className="text-[1.375rem] font-semibold tracking-[-0.015em]">{title}</h1>
            {subtitle && <p className="mt-1.5 text-sm text-muted">{subtitle}</p>}
            <div className="mt-6">{children}</div>
          </div>
          {footer && <div className="mt-5 text-center text-sm text-muted">{footer}</div>}
        </div>
      </main>
    </div>
  );
}
