import type { Metadata } from 'next';
import { OrderTracking } from '@/components/menu/order-tracking';
import { accentVars, fetchStore } from '@/lib/server-api';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Acompanhar pedido', robots: { index: false } };

export default async function TrackingPage({ params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = await params;
  const store = await fetchStore(slug).catch(() => null);
  return (
    <div style={accentVars(store?.store.brandColor ?? null)} className="min-h-dvh bg-canvas">
      <OrderTracking slug={slug} token={token} />
    </div>
  );
}
