'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bike, Expand, Printer, ShoppingBag, Shrink, Utensils } from 'lucide-react';
import { KITCHEN_STATUS_LABELS, hasAccess, type FulfillmentType, type OrderStatus } from '@balcao/shared';
import { useAdmin } from '@/components/admin/admin-context';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorNotice, Skeleton } from '@/components/ui/misc';
import { useFeedback } from '@/components/ui/feedback';
import { errorMessage, get, patch } from '@/lib/api';
import { cx, elapsed, formatTime, minutesSince } from '@/lib/format';
import { keys } from '@/lib/queries';
import { playNewOrderSound } from '@/lib/realtime';

interface KitchenOrder {
  id: string;
  number: number;
  status: OrderStatus;
  fulfillment: FulfillmentType;
  customerName: string;
  tableNumber: string | null;
  notes: string | null;
  prepTimeMinutes: number;
  createdAt: string;
  confirmedAt: string | null;
  preparingAt: string | null;
  readyAt: string | null;
  items: { id: string; productName: string; quantity: number; notes: string | null; modifiers: { name: string; quantity: number; groupName: string }[] }[];
}

const FULFILLMENT_ICON = { delivery: Bike, pickup: ShoppingBag, dine_in: Utensils } as const;
const FULFILLMENT_TEXT = { delivery: 'Entrega', pickup: 'Retirada', dine_in: 'Mesa' } as const;

export default function KitchenPage() {
  const { me, realtime, soundOn } = useAdmin();
  const canEdit = hasAccess(me.active!.permissions, 'kitchen', 'edit');
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const root = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const seen = useRef<Set<string> | null>(null);

  const query = useQuery({
    queryKey: keys.kitchen,
    queryFn: ({ signal }) => get<{ orders: KitchenOrder[] }>('/kitchen/orders', signal),
    refetchInterval: realtime === 'online' ? 60_000 : 15_000,
  });

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      clearInterval(t);
      document.removeEventListener('fullscreenchange', onFs);
    };
  }, []);

  // Toca quando chega pedido novo para preparar.
  useEffect(() => {
    if (!query.data) return;
    const ids = query.data.orders.filter((o) => o.status === 'confirmed').map((o) => o.id);
    if (seen.current && ids.some((id) => !seen.current!.has(id)) && soundOn) playNewOrderSound();
    seen.current = new Set([...(seen.current ?? []), ...ids]);
  }, [query.data, soundOn]);

  const advance = useMutation({
    mutationFn: ({ id, status, from }: { id: string; status: 'preparing' | 'ready'; from: OrderStatus }) => patch(`/kitchen/orders/${id}`, { status, expectedFrom: from }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.kitchen }),
    onError: (e) => {
      toast(errorMessage(e), 'error');
      void qc.invalidateQueries({ queryKey: keys.kitchen });
    },
  });

  const columns = useMemo(() => {
    const list = query.data?.orders ?? [];
    return {
      waiting: list.filter((o) => o.status === 'confirmed'),
      preparing: list.filter((o) => o.status === 'preparing'),
      done: list.filter((o) => o.status !== 'confirmed' && o.status !== 'preparing'),
    };
  }, [query.data]);

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await root.current?.requestFullscreen().catch(() => toast('O navegador não permitiu a tela cheia.', 'error'));
  };

  return (
    <div ref={root} className={cx('min-h-full', fullscreen && 'overflow-y-auto bg-canvas p-6')}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[1.375rem] font-semibold tracking-[-0.015em]">Cozinha</h1>
          <p className="text-sm text-muted">
            {columns.waiting.length} aguardando · {columns.preparing.length} em preparação
            {realtime !== 'online' && ' · atualizando a cada 15 s'}
          </p>
        </div>
        <Button variant="secondary" icon={fullscreen ? <Shrink className="size-4" /> : <Expand className="size-4" />} onClick={toggleFullscreen}>
          {fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
        </Button>
      </div>

      {query.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
        </div>
      ) : query.error ? (
        <ErrorNotice message={query.error.message} onRetry={() => void query.refetch()} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_260px]">
          <Column title={KITCHEN_STATUS_LABELS.confirmed!} count={columns.waiting.length} empty="Nenhum pedido esperando. Os confirmados aparecem aqui na hora.">
            {columns.waiting.map((o) => (
              <Ticket key={o.id} order={o} now={now} canEdit={canEdit} busy={advance.isPending && advance.variables?.id === o.id} action="Iniciar preparo" onAction={() => advance.mutate({ id: o.id, status: 'preparing', from: o.status })} />
            ))}
          </Column>
          <Column title={KITCHEN_STATUS_LABELS.preparing!} count={columns.preparing.length} empty="Nada no fogo agora.">
            {columns.preparing.map((o) => (
              <Ticket key={o.id} order={o} now={now} canEdit={canEdit} busy={advance.isPending && advance.variables?.id === o.id} action="Pronto" onAction={() => advance.mutate({ id: o.id, status: 'ready', from: o.status })} highlight />
            ))}
          </Column>
          <section aria-labelledby="k-done">
            <h2 id="k-done" className="mb-3 text-[0.8125rem] font-semibold text-ink-2">
              {KITCHEN_STATUS_LABELS.ready} <span className="font-normal text-muted">(últimos 30 min)</span>
            </h2>
            {columns.done.length === 0 ? (
              <p className="rounded-lg bg-sunken/60 px-4 py-6 text-center text-xs text-faint">Os pedidos finalizados aparecem aqui.</p>
            ) : (
              <ul className="space-y-2">
                {columns.done.map((o) => (
                  <li key={o.id} className="flex items-center justify-between rounded-lg border border-line bg-surface px-3 py-2.5">
                    <span className="num text-lg font-semibold">#{o.number}</span>
                    <span className="text-xs text-muted">{o.readyAt ? `pronto às ${formatTime(o.readyAt)}` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
      {!canEdit && <p className="mt-6 text-center text-sm text-muted">Você pode ver a fila da cozinha, mas não alterar as etapas.</p>}
    </div>
  );
}

function Column({ title, count, empty, children }: { title: string; count: number; empty: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="min-w-0">
      <h2 className="mb-3 flex items-center gap-2 text-[0.8125rem] font-semibold text-ink-2">
        {title}
        <span className="num rounded-full bg-sunken px-2 py-0.5 text-[0.6875rem] text-muted">{count}</span>
      </h2>
      {count === 0 ? <EmptyState className="rounded-lg border border-dashed border-line-strong bg-surface py-10" title={empty} /> : <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-4">{children}</div>}
    </section>
  );
}

function Ticket({
  order,
  now,
  canEdit,
  busy,
  action,
  onAction,
  highlight,
}: {
  order: KitchenOrder;
  now: number;
  canEdit: boolean;
  busy: boolean;
  action: string;
  onAction: () => void;
  highlight?: boolean;
}) {
  const since = order.confirmedAt ?? order.createdAt;
  const minutes = minutesSince(since, now);
  const late = minutes > order.prepTimeMinutes ? 'late' : minutes > order.prepTimeMinutes * 0.75 ? 'soon' : 'ok';
  const Icon = FULFILLMENT_ICON[order.fulfillment];

  return (
    <article
      className={cx(
        'ticket-edge flex flex-col rounded-b-xl border-x border-b bg-surface pt-5 shadow-soft',
        late === 'late' ? 'border-danger/50' : highlight ? 'border-brand/30' : 'border-line',
      )}
    >
      <header className="flex items-start justify-between gap-3 px-5">
        <div>
          <p className="num text-[2rem] leading-none font-semibold tracking-[-0.05em]">#{order.number}</p>
          <p className="mt-1.5 flex items-center gap-1.5 text-sm text-ink-2">
            <Icon className="size-4 text-muted" aria-hidden="true" />
            {FULFILLMENT_TEXT[order.fulfillment]}
            {order.tableNumber && ` ${order.tableNumber}`} · {order.customerName}
          </p>
        </div>
        <div className="text-right">
          <span
            className={cx(
              'num inline-block rounded-md px-2 py-1 text-base font-semibold',
              late === 'late' ? 'bg-danger text-white' : late === 'soon' ? 'bg-warn-soft text-warn' : 'bg-sunken text-ink-2',
            )}
            title="Tempo desde a confirmação"
          >
            {elapsed(since, now)}
          </span>
          <p className="mt-1 text-2xs text-muted">meta {order.prepTimeMinutes} min</p>
        </div>
      </header>

      <ul className="mt-4 flex-1 space-y-2.5 border-t border-dashed border-line-strong px-5 pt-4">
        {order.items.map((i) => (
          <li key={i.id}>
            <p className="text-[1.0625rem] leading-snug">
              <span className="num mr-2 font-semibold">{i.quantity}×</span>
              <span className="font-medium">{i.productName}</span>
            </p>
            {i.modifiers.length > 0 && (
              <ul className="mt-0.5 pl-8 text-sm text-ink-2">
                {i.modifiers.map((m, idx) => (
                  <li key={idx}>
                    + {m.quantity > 1 ? `${m.quantity}× ` : ''}
                    {m.name}
                  </li>
                ))}
              </ul>
            )}
            {i.notes && <p className="mt-1 ml-8 rounded bg-warn-soft px-2 py-1 text-sm font-medium text-warn">{i.notes}</p>}
          </li>
        ))}
      </ul>
      {order.notes && <p className="mx-5 mt-3 rounded bg-warn-soft px-2 py-1.5 text-sm text-warn">Pedido: {order.notes}</p>}

      <footer className="mt-4 flex gap-2 px-5 pb-5">
        {canEdit && (
          <button
            type="button"
            disabled={busy}
            onClick={onAction}
            className={cx(
              'h-14 flex-1 rounded-lg text-base font-semibold transition-colors active:translate-y-px disabled:opacity-60',
              highlight ? 'bg-brand text-white hover:bg-brand-strong' : 'border border-line-strong bg-surface text-ink hover:bg-canvas',
            )}
          >
            {action}
          </button>
        )}
        <button
          type="button"
          onClick={() => window.open(`/painel/pedidos/${order.id}/imprimir`, '_blank', 'noopener,width=420,height=720')}
          className="grid size-14 place-items-center rounded-lg border border-line-strong text-muted hover:bg-canvas hover:text-ink"
          aria-label={`Imprimir comanda do pedido ${order.number}`}
        >
          <Printer className="size-5" />
        </button>
      </footer>
    </article>
  );
}
