import Link from 'next/link';
import { BrandMark } from '@/components/brand';

export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center px-6">
      <div className="max-w-sm text-center">
        <BrandMark className="mx-auto size-10" />
        <h1 className="mt-6 text-xl font-semibold">Página não encontrada</h1>
        <p className="mt-2 text-sm text-muted">O endereço pode estar errado ou a loja não está mais disponível. Confira o link com quem enviou.</p>
        <Link href="/" className="mt-6 inline-flex h-10 items-center rounded-md border border-line-strong px-4 text-sm font-medium hover:bg-sunken">
          Ir para o início
        </Link>
      </div>
    </div>
  );
}
