'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { AdminProvider } from '@/components/admin/admin-context';
import { AdminShell } from '@/components/admin/shell';
import { OrderDrawerHost } from '@/components/orders/order-drawer';
import { BrandMark } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { ErrorNotice, Spinner } from '@/components/ui/misc';
import { ApiError, post } from '@/lib/api';
import { useMe } from '@/lib/session';

export default function PainelLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const me = useMe();
  const unauthorized = me.error instanceof ApiError && me.error.status === 401;

  useEffect(() => {
    if (unauthorized) router.replace(`/entrar?next=${encodeURIComponent(pathname)}`);
  }, [unauthorized, router, pathname]);

  if (me.isLoading || unauthorized) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <div className="flex flex-col items-center gap-4 text-muted">
          <BrandMark className="size-9" />
          <Spinner className="size-5" />
        </div>
      </div>
    );
  }

  if (me.error || !me.data) {
    return (
      <div className="mx-auto mt-24 max-w-md px-4">
        <ErrorNotice message={me.error?.message ?? 'Não foi possível carregar sua conta.'} onRetry={() => void me.refetch()} />
      </div>
    );
  }

  if (!me.data.active) {
    return (
      <div className="mx-auto mt-24 max-w-md px-4 text-center">
        <BrandMark className="mx-auto size-10" />
        <h1 className="mt-5 text-lg font-semibold">Sem estabelecimento ativo</h1>
        <p className="mt-2 text-sm text-muted">
          Sua conta não está vinculada a nenhuma loja ativa. Peça um novo convite ao responsável ou entre com outra conta.
        </p>
        <Button
          className="mt-6"
          variant="secondary"
          onClick={async () => {
            await post('/auth/logout').catch(() => undefined);
            router.replace('/entrar');
          }}
        >
          Sair
        </Button>
      </div>
    );
  }

  return (
    <AdminProvider me={me.data}>
      <AdminShell>{children}</AdminShell>
      <OrderDrawerHost />
    </AdminProvider>
  );
}
