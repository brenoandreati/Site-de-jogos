import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { StoreMenu } from '@/components/menu/store-menu';
import { accentVars, fetchStore } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const data = await fetchStore(slug).catch(() => null);
  if (!data) return { title: 'Loja não encontrada' };
  const image = data.store.coverUrl ?? data.store.logoUrl;
  return {
    title: { absolute: `${data.store.name} · Cardápio` },
    description: data.store.description ?? `Peça online na ${data.store.name}.`,
    openGraph: {
      title: data.store.name,
      description: data.store.description ?? `Cardápio e pedidos online da ${data.store.name}.`,
      images: image ? [image] : undefined,
      type: 'website',
      locale: 'pt_BR',
    },
  };
}

export default async function StorePage({ params }: Props) {
  const { slug } = await params;
  const data = await fetchStore(slug);
  if (!data) notFound();
  return (
    <div style={accentVars(data.store.brandColor)} className="min-h-dvh bg-surface sm:bg-canvas">
      <StoreMenu initial={data} slug={slug} />
    </div>
  );
}
