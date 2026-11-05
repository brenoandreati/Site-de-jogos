'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Plus, Search } from 'lucide-react';
import {
  ORDER_CHANNEL_LABELS,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  formatBRL,
  hasAccess,
  type OrderStatus,
} from '@balcao/shared';
import { useAdmin } from '@/components/admin/admin-context';
import { OrderTicket } from '@/components/orders/order-card';
import { useOrderStatusMutation } from '@/components/orders/order-drawer';
import { ButtonLink } from '@/components/ui/button';
import { Input, Segmented, Select } from '@/components/ui/field';
import { Badge, EmptyState, ErrorNotice, PageHeader, Skeleton } from '@/components/ui/misc';
import { get } from '@/lib/api';
import { cx, formatDateTime } from '@/lib/format';
import { BOARD_COLUMNS, STATUS_TONE, fulfillmentShort } from '@/lib/orders-ui';
import { keys, useBoard } from '@/lib/queries';
import type { Order } from '@/lib/types';

export default function OrdersPage() {
  const [tab, setTab] = useState<'board' | 'history'>('board');
  const { me } = useAdmin();
  const canEdit = hasAccess(me.active!.permissions, 'orders', 'edit');
  return (
    <div>
      <PageHeader
        title="Pedidos"
        actions={
          <>
            <Segmented
              aria-label="Visualização"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'board', label: 'Em andamento' },
                { value: 'history', label: 'Histórico' },
              ]}
            />
            {canEdit && (
              <ButtonLink href="/painel/pedidos/novo" variant="primary" icon={<Plus className="size-4" />}>
                Lançar pedido
              </ButtonLink>
            )}
          </>
        }
      />
      {tab === 'board' ? <Board canEdit={canEdit} /> : <History />}
    </div>
  );
}

function useNow(interval = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(t);
  }, [interval]);
  return now;
}

function Board({ canEdit }: { canEdit: boolean }) {
  const { realtime, openOrder } = useAdmin();
  const board = useBoard({ poll: realtime !== 'online' });
  const status = useOrderStatusMutation();
  const now = useNow();
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [showFinished, setShowFinished] = useState(false);
  const [mobileCol, setMobileCol] = useState(BOARD_COLUMNS[0]!.key);

  // Destaca por alguns segundos os pedidos que chegaram depois que a tela abriu.
  useEffect(() => {
    if (!board.data) return;
    const ids = board.data.orders.map((o) => o.id);
    if (seen.current === null) {
      seen.current = new Set(ids);
      return;
    }
    const arrived = ids.filter((id) => !seen.current!.has(id));
    arrived.forEach((id) => seen.current!.add(id));
    if (arrived.length) {
      setFresh((s) => new Set([...s, ...arrived]));
      setTimeout(() => setFresh((s) => new Set([...s].filter((id) => !arrived.includes(id)))), 6000);
    }
  }, [board.data]);

  // Título da aba mostra quantos pedidos aguardam confirmação.
  const pending = board.data?.orders.filter((o) => o.status === 'new').length ?? 0;
  useEffect(() => {
    const base = 'Pedidos · Balcão';
    document.title = pending ? `(${pending}) ${base}` : base;
    return () => {
      document.title = 'Balcão';
    };
  }, [pending]);

  const columns = useMemo(() => {
    const orders = board.data?.orders ?? [];
    return BOARD_COLUMNS.map((c) => ({ ...c, orders: orders.filter((o) => c.statuses.includes(o.status)) }));
  }, [board.data]);
  const finished = board.data?.orders.filter((o) => o.status === 'completed' || o.status === 'canceled') ?? [];

  if (board.isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
        {BOARD_COLUMNS.map((c) => (
          <Skeleton key={c.key} className="h-72" />
        ))}
      </div>
    );
  }
  if (board.error) return <ErrorNotice message={board.error.message} onRetry={() => void board.refetch()} />;

  const totalActive = columns.reduce((s, c) => s + c.orders.length, 0);

  return (
    <div>
      {totalActive === 0 && (
        <div className="mb-5 rounded-lg border border-dashed border-line-strong bg-surface">
          <EmptyState
            title="Nenhum pedido em andamento"
            description="Quando um cliente pedir pelo cardápio, o pedido aparece aqui na hora, com aviso sonoro."
          />
        </div>
      )}
      {/* Celular: uma etapa por vez, com contagem em cada aba. */}
      <div className="md:hidden">
        <div className="scrollbar-none -mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4" role="tablist" aria-label="Etapas do pedido">
          {columns.map((col) => (
            <button
              key={col.key}
              type="button"
              role="tab"
              aria-selected={mobileCol === col.key}
              onClick={() => setMobileCol(col.key)}
              className={cx(
                'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[0.8125rem] font-medium transition-colors',
                mobileCol === col.key ? 'border-ink bg-ink text-white' : 'border-line-strong text-ink-2',
              )}
            >
              {col.title}
              <span className={cx('num text-[0.6875rem]', mobileCol === col.key ? 'text-white/80' : 'text-muted')}>{col.orders.length}</span>
            </button>
          ))}
        </div>
        {columns
          .filter((col) => col.key === mobileCol)
          .map((col) => (
            <div key={col.key} role="tabpanel" className="flex flex-col gap-3">
              {col.orders.length === 0 ? (
                <p className="rounded-lg bg-sunken/60 px-4 py-10 text-center text-sm text-faint">{col.empty}</p>
              ) : (
                col.orders.map((order) => (
                  <OrderTicket
                    key={order.id}
                    order={order}
                    now={now}
                    fresh={fresh.has(order.id)}
                    canAdvance={canEdit}
                    advancing={status.isPending && status.variables?.id === order.id}
                    onOpen={() => openOrder(order.id)}
                    onAdvance={(to) => status.mutate({ id: order.id, status: to, expectedFrom: order.status })}
                  />
                ))
              )}
            </div>
          ))}
      </div>

      <div className="-mx-4 hidden overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6 md:block lg:-mx-8 lg:px-8">
        <div className="grid min-w-[1080px] grid-cols-5 gap-4">
          {columns.map((col) => (
            <section key={col.key} aria-labelledby={`col-${col.key}`} className="flex min-w-0 flex-col">
              <header className="mb-3 flex items-center justify-between px-0.5">
                <h2 id={`col-${col.key}`} className="text-[0.8125rem] font-semibold text-ink-2">
                  {col.title}
                </h2>
                <span className={cx('num rounded-full px-2 py-0.5 text-[0.6875rem]', col.orders.length && col.key === 'new' ? 'bg-brand text-white' : 'bg-sunken text-muted')}>
                  {col.orders.length}
                </span>
              </header>
              <div className="flex min-h-40 flex-1 flex-col gap-3 rounded-lg bg-sunken/60 p-2">
                {col.orders.length === 0 ? (
                  <p className="px-3 py-8 text-center text-xs leading-relaxed text-faint">{col.empty}</p>
                ) : (
                  col.orders.map((order) => (
                    <OrderTicket
                      key={order.id}
                      order={order}
                      now={now}
                      fresh={fresh.has(order.id)}
                      canAdvance={canEdit}
                      advancing={status.isPending && status.variables?.id === order.id}
                      onOpen={() => openOrder(order.id)}
                      onAdvance={(to) => status.mutate({ id: order.id, status: to, expectedFrom: order.status })}
                    />
                  ))
                )}
              </div>
            </section>
          ))}
        </div>
      </div>

      <div className="mt-6">
        <button type="button" onClick={() => setShowFinished((v) => !v)} aria-expanded={showFinished} className="text-sm font-medium text-ink-2 hover:text-ink">
          {showFinished ? 'Ocultar' : 'Mostrar'} finalizados nas últimas 12 horas ({finished.length})
        </button>
        {showFinished && finished.length > 0 && <OrdersTable orders={finished} onOpen={openOrder} className="mt-3" />}
      </div>
    </div>
  );
}

function OrdersTable({ orders, onOpen, className }: { orders: Order[]; onOpen: (id: string) => void; className?: string }) {
  return (
    <div className={cx('overflow-x-auto rounded-lg border border-line bg-surface', className)}>
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted">
            <th className="px-4 py-2.5 font-medium">Pedido</th>
            <th className="px-4 py-2.5 font-medium">Cliente</th>
            <th className="px-4 py-2.5 font-medium">Status</th>
            <th className="px-4 py-2.5 font-medium">Canal</th>
            <th className="px-4 py-2.5 font-medium">Pagamento</th>
            <th className="px-4 py-2.5 text-right font-medium">Total</th>
            <th className="px-4 py-2.5 text-right font-medium">Data</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {orders.map((o) => (
            <tr key={o.id} className="cursor-pointer hover:bg-canvas" onClick={() => onOpen(o.id)}>
              <td className="px-4 py-2.5">
                <button type="button" className="num font-medium text-ink hover:underline" onClick={(e) => { e.stopPropagation(); onOpen(o.id); }}>
                  #{o.number}
                </button>
              </td>
              <td className="px-4 py-2.5">
                <span className="block text-ink">{o.customerName}</span>
                <span className="text-xs text-muted">{fulfillmentShort(o.fulfillment)}</span>
              </td>
              <td className="px-4 py-2.5">
                <Badge tone={STATUS_TONE[o.status]} dot>
                  {ORDER_STATUS_LABELS[o.status]}
                </Badge>
              </td>
              <td className="px-4 py-2.5 text-ink-2">{ORDER_CHANNEL_LABELS[o.channel]}</td>
              <td className="px-4 py-2.5 text-ink-2">{PAYMENT_METHOD_LABELS[o.paymentMethod]}</td>
              <td className="num px-4 py-2.5 text-right">{formatBRL(o.totalCents)}</td>
              <td className="px-4 py-2.5 text-right text-xs text-muted tabular">{formatDateTime(o.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STATUS_FILTERS: { value: string; label: string; statuses: OrderStatus[] }[] = [
  { value: 'all', label: 'Todos', statuses: [] },
  { value: 'active', label: 'Em andamento', statuses: ['new', 'awaiting_confirmation', 'confirmed', 'preparing', 'ready', 'out_for_delivery'] },
  { value: 'completed', label: 'Concluídos', statuses: ['completed'] },
  { value: 'canceled', label: 'Cancelados', statuses: ['canceled'] },
];

function History() {
  const { openOrder } = useAdmin();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [channel, setChannel] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const params = new URLSearchParams({ page: String(page), pageSize: '25' });
  const statuses = STATUS_FILTERS.find((s) => s.value === statusFilter)!.statuses;
  if (statuses.length) params.set('status', statuses.join(','));
  if (channel) params.set('channel', channel);
  if (debounced) params.set('search', debounced);
  const qs = params.toString();

  const list = useQuery({
    queryKey: keys.orders(qs),
    queryFn: ({ signal }) => get<{ total: number; page: number; pageSize: number; orders: Order[] }>(`/orders?${qs}`, signal),
    placeholderData: (prev) => prev,
  });
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Número, nome ou telefone" className="pl-9" aria-label="Buscar pedidos" />
        </div>
        <Segmented
          size="sm"
          aria-label="Filtrar por status"
          value={statusFilter}
          onChange={(v) => {
            setStatusFilter(v);
            setPage(1);
          }}
          options={STATUS_FILTERS.map((s) => ({ value: s.value, label: s.label }))}
        />
        <Select
          aria-label="Filtrar por canal"
          className="h-8 w-auto text-[0.8125rem]"
          value={channel}
          onChange={(e) => {
            setChannel(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Todos os canais</option>
          {Object.entries(ORDER_CHANNEL_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      </div>

      {list.error && <ErrorNotice message={list.error.message} onRetry={() => void list.refetch()} />}
      {list.isLoading ? (
        <Skeleton className="h-80" />
      ) : list.data && list.data.orders.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface">
          <EmptyState title="Nenhum pedido encontrado" description={debounced || statusFilter !== 'all' || channel ? 'Ajuste os filtros para ver mais pedidos.' : 'Os pedidos da loja aparecem aqui.'} />
        </div>
      ) : list.data ? (
        <>
          <OrdersTable orders={list.data.orders} onOpen={openOrder} />
          <div className="mt-3 flex items-center justify-between text-sm text-muted">
            <span className="tabular">
              {list.data.total} {list.data.total === 1 ? 'pedido' : 'pedidos'}
            </span>
            <div className="flex items-center gap-1">
              <button type="button" className="grid size-8 place-items-center rounded-md hover:bg-sunken disabled:opacity-30" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Página anterior">
                <ChevronLeft className="size-4" />
              </button>
              <span className="tabular px-2">
                {page} de {pages}
              </span>
              <button type="button" className="grid size-8 place-items-center rounded-md hover:bg-sunken disabled:opacity-30" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Próxima página">
                <ChevronRight className="size-4" />
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
