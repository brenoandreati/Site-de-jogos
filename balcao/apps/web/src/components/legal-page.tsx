import Link from 'next/link';
import type { ReactNode } from 'react';
import { BrandLogo } from './brand';

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-surface">
      <header className="mx-auto max-w-3xl px-6 py-5">
        <Link href="/" aria-label="Balcão, início">
          <BrandLogo />
        </Link>
      </header>
      <main className="mx-auto max-w-3xl px-6 pb-20 pt-6">
        <h1 className="text-[1.75rem] font-semibold tracking-[-0.02em]">{title}</h1>
        <p className="mt-1 text-sm text-muted">Atualizado em {updated}</p>
        <div className="mt-8 space-y-5 text-[0.9375rem] leading-relaxed text-ink-2 [&_h2]:mt-8 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-ink [&_li]:ml-5 [&_li]:list-disc">{children}</div>
      </main>
    </div>
  );
}
