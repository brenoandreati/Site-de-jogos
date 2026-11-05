import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { CheckoutForm } from '@/components/menu/checkout';
import { accentVars, fetchStore } from '@/lib/server-api';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Finalizar pedido', robots: { index: false } };

export default async function CheckoutPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await fetchStore(slug);
  if (!data) notFound();
  return (
    <div style={accentVars(data.store.brandColor)} className="min-h-dvh bg-canvas">
      <CheckoutForm initial={data} slug={slug} />
    </div>
  );
}
