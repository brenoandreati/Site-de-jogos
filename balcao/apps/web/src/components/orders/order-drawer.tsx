'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Ban,
  Bike,
  Copy,
  CreditCard,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Phone,
  Printer,
  RotateCcw,
  Tag,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import {
  CANCEL_REASONS,
  DELIVERY_STATUS_LABELS,
  FULFILLMENT_LABELS,
  NEXT_STATUS_ACTION_LABELS,
  OFFLINE_PAYMENT_METHODS,
  ORDER_CHANNEL_LABELS,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_TRANSACTION_STATUS_LABELS,
  formatBRL,
  formatPhone,
  hasAccess,
  nextStatus,
  whatsappLink,
  type OrderStatus,
  type PaymentMethod,
} from '@balcao/shared';
import { Button } from '@/components/ui/button';
import { Field, Input, MoneyInput, Select, Textarea } from '@/components/ui/field';
import { Menu, MenuItem, MenuSeparator } from '@/components/ui/menu';
import { Badge, ErrorNotice, Skeleton } from '@/components/ui/misc';
import { Modal } from '@/components/ui/modal';
import { useFeedback } from '@/components/ui/feedback';
import { errorMessage, get, patch, post, put } from '@/lib/api';
import { cx, formatAddress, formatDateTime, formatTime } from '@/lib/format';
import { STATUS_TONE, estimatedTime, whatsappUpdate } from '@/lib/orders-ui';
import { keys, useCatalog, useSettings } from '@/lib/queries';
import type { OrderDetail, OrderEvent } from '@/lib/types';
import { useAdmin } from '../admin/admin-context';
import { CartBuilder, linesFromOrderItems, type CartLine } from './cart-builder';

export function OrderDrawerHost() {
  const { openOrderId, openOrder } = useAdmin();
  return (
    <Modal open={!!openOrderId} onClose={() => openOrder(null)} side="right" size="md" hideClose bodyClassName="p-0">
      {openOrderId && <OrderDetailView id={openOrderId} onClose={() => openOrder(null)} />}
    </Modal>
  );
}

export function useOrderStatusMutation() {
  const qc = useQueryClient();
  const { toast } = useFeedback();
  return useMutation({
    mutationFn: ({ id, status, reason, expectedFrom }: { id: string; status: OrderStatus; reason?: string; expectedFrom?: OrderStatus }) =>
      patch<OrderDetail>(`/orders/${id}/status`, { status, reason, expectedFrom }),
    onSuccess: (order) => {
      qc.setQueryData(keys.order(order.id), order);
      void qc.invalidateQueries({ queryKey: ['orders'] });
      toast(order.status === 'canceled' ? `Pedido #${order.number} cancelado.` : `Pedido #${order.number}: ${ORDER_STATUS_LABELS[order.status].toLowerCase()}.`);
    },
    onError: (e) => {
      toast(errorMessage(e), 'error');
      void qc.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}

function OrderDetailView({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { me, openOrder } = useAdmin();
  const { toast, confirm } = useFeedback();
  const perms = me.active!.permissions;
  const canEdit = hasAccess(perms, 'orders', 'edit');
  const canManage = hasAccess(perms, 'orders', 'manage');
  const settings = useSettings();
  const order = useQuery({ queryKey: keys.order(id), queryFn: ({ signal }) => get<OrderDetail>(`/orders/${id}`, signal) });
  const status = useOrderStatusMutation();
  const [modal, setModal] = useState<'items' | 'discount' | 'payment' | null>(null);
  const [note, setNote] = useState('');

  const refresh = (data: OrderDetail) => {
    qc.setQueryData(keys.order(id), data);
    void qc.invalidateQueries({ queryKey: ['orders'] });
  };

  const addNote = useMutation({
    mutationFn: () => post<OrderDetail>(`/orders/${id}/notes`, { note }),
    onSuccess: (d) => {
      refresh(d);
      setNote('');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const paymentStatus = useMutation({
    mutationFn: (paymentStatus: 'paid' | 'pending') => put<OrderDetail>(`/orders/${id}/payment-status`, { paymentStatus }),
    onSuccess: (d) => {
      refresh(d);
      toast(d.paymentStatus === 'paid' ? 'Recebimento registrado.' : 'Recebimento desfeito.');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const refund = useMutation({
    mutationFn: (reason: string) => post<OrderDetail>(`/orders/${id}/refund`, { reason }),
    onSuccess: (d) => {
      refresh(d);
      toast(d.payment?.status === 'refunded' ? 'Estorno feito pelo Mercado Pago.' : 'Estorno solicitado ao Mercado Pago.');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const duplicate = useMutation({
    mutationFn: () => post<OrderDetail>(`/orders/${id}/duplicate`, { idempotencyKey: crypto.randomUUID() }),
    onSuccess: (d) => {
      void qc.invalidateQueries({ queryKey: ['orders'] });
      toast(`Pedido #${d.number} criado a partir do #${order.data?.number}.`);
      openOrder(d.id);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (order.isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-24" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  if (order.error || !order.data) {
    return (
      <div className="p-6">
        <ErrorNotice message={errorMessage(order.error)} onRetry={() => void order.refetch()} />
      </div>
    );
  }

  const o = order.data;
  const next = nextStatus(o.status, o.fulfillment);
  const final = o.status === 'completed' || o.status === 'canceled';
  const isNew = o.status === 'new' || o.status === 'awaiting_confirmation';
  const waUpdate = settings.data ? whatsappUpdate(o, me.active!.tenant.slug, me.active!.tenant.tradeName, settings.data.messages) : null;

  const cancel = async (title: string, confirmLabel: string) => {
    const r = await confirm({
      title,
      description: 'O cliente vê o pedido como cancelado no acompanhamento. Itens com estoque controlado voltam para o estoque.',
      confirmLabel,
      tone: 'danger',
      reason: { label: 'Motivo', required: true, suggestions: CANCEL_REASONS, placeholder: 'Explique o motivo' },
    });
    if (r.confirmed) status.mutate({ id, status: 'canceled', reason: r.reason, expectedFrom: o.status });
  };

  const askRefund = async () => {
    const r = await confirm({
      title: `Estornar ${formatBRL(o.payment!.amountCents)} do pedido #${o.number}?`,
      description: 'O Mercado Pago devolve o valor ao cliente. Essa ação não pode ser desfeita.',
      confirmLabel: 'Estornar',
      tone: 'danger',
      reason: { label: 'Motivo', required: true, suggestions: ['Pedido cancelado', 'Produto em falta', 'Pedido não entregue', 'Cobrança em duplicidade'] },
    });
    if (r.confirmed) refund.mutate(r.reason ?? '');
  };
  const awaitingPix = o.status === 'awaiting_confirmation' && o.paymentMethod === 'online';
  const paidButCanceled = o.status === 'canceled' && o.payment?.status === 'approved';

  const notify = () => {
    if (!waUpdate) return;
    window.open(waUpdate, '_blank', 'noopener');
    void post(`/orders/${id}/notified`, { status: o.status }).then(() => qc.invalidateQueries({ queryKey: keys.order(id) }));
  };

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-line px-5 pb-4 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="num text-[1.75rem] leading-none font-semibold tracking-[-0.04em]">#{o.number}</h2>
              <Badge tone={STATUS_TONE[o.status]} dot>
                {ORDER_STATUS_LABELS[o.status]}
              </Badge>
            </div>
            <p className="mt-2 text-[0.8125rem] text-muted">
              {FULFILLMENT_LABELS[o.fulfillment]} · {ORDER_CHANNEL_LABELS[o.channel]} · {formatDateTime(o.createdAt)}
              {!final && <> · previsão {formatTime(estimatedTime(o))}</>}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Menu
              label="Mais ações"
              trigger={({ toggle, open }) => (
                <Button variant="ghost" size="icon-sm" onClick={toggle} aria-expanded={open} aria-label="Mais ações">
                  <MoreHorizontal className="size-[18px]" />
                </Button>
              )}
            >
              {(close) => (
                <>
                  <MenuItem
                    icon={<Printer />}
                    onClick={() => {
                      close();
                      window.open(`/painel/pedidos/${id}/imprimir`, '_blank', 'noopener,width=420,height=720');
                    }}
                  >
                    Imprimir comanda
                  </MenuItem>
                  {canEdit && (
                    <>
                      <MenuItem icon={<Pencil />} disabled={final || o.status === 'out_for_delivery'} onClick={() => { close(); setModal('items'); }}>
                        Editar itens
                      </MenuItem>
                      <MenuItem icon={<CreditCard />} disabled={final || o.paymentStatus === 'paid' || o.paymentMethod === 'online'} onClick={() => { close(); setModal('payment'); }}>
                        Alterar pagamento
                      </MenuItem>
                    </>
                  )}
                  {canManage && (
                    <MenuItem icon={<Tag />} disabled={final} onClick={() => { close(); setModal('discount'); }}>
                      Aplicar desconto
                    </MenuItem>
                  )}
                  {canEdit && (
                    <MenuItem icon={<Copy />} onClick={() => { close(); duplicate.mutate(); }}>
                      Duplicar pedido
                    </MenuItem>
                  )}
                  {canManage && !final && (
                    <>
                      <MenuSeparator />
                      <MenuItem icon={<Ban />} tone="danger" onClick={() => { close(); void cancel(`Cancelar pedido #${o.number}?`, 'Cancelar pedido'); }}>
                        Cancelar pedido
                      </MenuItem>
                    </>
                  )}
                </>
              )}
            </Menu>
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Fechar">
              <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </Button>
          </div>
        </div>

        {canEdit && !final && (
          <div className="mt-4 flex flex-wrap gap-2">
            {next && (
              <Button
                className="flex-1 sm:flex-none"
                loading={status.isPending}
                onClick={() => status.mutate({ id, status: next, expectedFrom: o.status })}
              >
                {isNew ? 'Confirmar pedido' : NEXT_STATUS_ACTION_LABELS[next]}
              </Button>
            )}
            {isNew && canManage && (
              <Button variant="secondary" onClick={() => void cancel(awaitingPix ? `Cancelar pedido #${o.number}?` : `Recusar pedido #${o.number}?`, awaitingPix ? 'Cancelar pedido e cobrança' : 'Recusar pedido')}>
                {awaitingPix ? 'Cancelar' : 'Recusar'}
              </Button>
            )}
            {o.status === 'confirmed' && o.fulfillment !== 'delivery' && (
              <Button variant="secondary" onClick={() => status.mutate({ id, status: 'ready', expectedFrom: o.status })}>
                Já está pronto
              </Button>
            )}
            {waUpdate && (
              <Button variant="secondary" icon={<MessageCircle className="size-4" />} onClick={notify}>
                Avisar no WhatsApp
              </Button>
            )}
          </div>
        )}
        {awaitingPix && (
          <p className="mt-3 rounded-md bg-info-soft px-3 py-2 text-[0.8125rem] text-info">
            Aguardando o PIX do cliente{o.payment?.expiresAt ? ` até ${formatTime(o.payment.expiresAt)}` : ''}. O pedido entra na fila sozinho quando o Mercado Pago confirmar o pagamento.
          </p>
        )}
        {paidButCanceled && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-danger-soft px-3 py-2 text-[0.8125rem] text-danger">
            <span className="flex items-center gap-1.5">
              <AlertTriangle className="size-4" /> O cliente pagou pelo Mercado Pago, mas o pedido está cancelado.
            </span>
            {canManage && (
              <Button size="sm" variant="secondary" loading={refund.isPending} onClick={() => void askRefund()}>
                Estornar
              </Button>
            )}
          </div>
        )}
        {o.status === 'canceled' && o.cancelReason && (
          <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-[0.8125rem] text-danger">Motivo do cancelamento: {o.cancelReason}</p>
        )}
      </header>

      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
        {/* Cliente */}
        <section aria-labelledby="sec-cliente">
          <h3 id="sec-cliente" className="mb-2 text-2xs font-semibold uppercase tracking-[0.08em] text-faint">Cliente</h3>
          <p className="font-medium">{o.customerName}</p>
          {o.customerPhone && (
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <a href={`tel:+${o.customerPhone}`} className="inline-flex items-center gap-1.5 text-ink-2 hover:text-ink">
                <Phone className="size-3.5" /> {formatPhone(o.customerPhone)}
              </a>
              <a href={whatsappLink(o.customerPhone)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-brand hover:underline">
                <MessageCircle className="size-3.5" /> Conversar
              </a>
            </div>
          )}
          {o.fulfillment === 'delivery' && o.address && (
            <div className="mt-3 flex gap-2 rounded-md bg-canvas px-3 py-2.5 text-sm">
              <Bike className="mt-0.5 size-4 shrink-0 text-muted" />
              <div>
                <p className="text-ink">{formatAddress(o.address)}</p>
                {o.address.reference && <p className="text-xs text-muted">Referência: {o.address.reference}</p>}
                <a
                  className="mt-1 inline-block text-xs text-brand hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(formatAddress(o.address))}`}
                >
                  Abrir no mapa
                </a>
              </div>
            </div>
          )}
          {o.delivery && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem]">
              <Badge tone={o.delivery.status === 'problem' ? 'danger' : o.delivery.status === 'delivered' ? 'brand' : 'neutral'}>{DELIVERY_STATUS_LABELS[o.delivery.status]}</Badge>
              <span className="text-ink-2">{o.delivery.courierName ? `Entregador: ${o.delivery.courierName}` : 'Sem entregador'}</span>
              {o.delivery.zoneName && <span className="text-muted">Bairro: {o.delivery.zoneName}</span>}
              {hasAccess(perms, 'delivery', 'view') && (
                <Link href="/painel/entregas" className="text-brand hover:underline" onClick={onClose}>
                  Ver entregas
                </Link>
              )}
              {o.delivery.problemReason && <p className="w-full rounded bg-danger-soft px-2 py-1 text-xs text-danger">Problema: {o.delivery.problemReason}</p>}
            </div>
          )}
          {o.fulfillment === 'dine_in' && o.tableNumber && <p className="mt-2 text-sm">Mesa {o.tableNumber}</p>}
          {o.customer && (
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
              <Stat label="Pedidos" value={String(o.customer.ordersCount)} />
              <Stat label="Total gasto" value={formatBRL(o.customer.totalSpentCents)} />
              <Stat label="Ticket médio" value={formatBRL(o.customer.averageTicketCents)} />
            </dl>
          )}
          {o.customer && o.customer.previousOrders.length > 0 && (
            <div className="mt-3">
              <p className="mb-1 text-xs text-muted">Pedidos anteriores</p>
              <ul className="flex flex-wrap gap-1.5">
                {o.customer.previousOrders.map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => openOrder(p.id)} className="rounded border border-line px-2 py-1 text-xs hover:border-line-strong">
                      <span className="num">#{p.number}</span> · {formatBRL(p.totalCents)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* Itens */}
        <section aria-labelledby="sec-itens">
          <h3 id="sec-itens" className="mb-2 text-2xs font-semibold uppercase tracking-[0.08em] text-faint">Itens</h3>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {o.items.map((item) => (
              <li key={item.id} className="flex gap-3 px-3.5 py-3">
                <span className="num w-6 shrink-0 text-sm text-muted">{item.quantity}×</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink">{item.productName}</p>
                  {item.modifiers.length > 0 && (
                    <ul className="mt-0.5 text-xs text-muted">
                      {item.modifiers.map((m, i) => (
                        <li key={i}>
                          {m.groupName}: {m.name}
                          {m.quantity > 1 && ` ×${m.quantity}`}
                          {m.priceCents > 0 && <span className="num"> (+{formatBRL(m.totalCents)})</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {item.notes && <p className="mt-1 text-xs italic text-warn">“{item.notes}”</p>}
                </div>
                <span className="num text-[0.8125rem] text-ink">{formatBRL(item.totalCents)}</span>
              </li>
            ))}
          </ul>
          {o.notes && <p className="mt-2 rounded-md bg-warn-soft px-3 py-2 text-[0.8125rem] text-warn">Observação do pedido: {o.notes}</p>}
        </section>

        {/* Valores */}
        <section aria-labelledby="sec-valores">
          <h3 id="sec-valores" className="mb-2 text-2xs font-semibold uppercase tracking-[0.08em] text-faint">Pagamento</h3>
          <dl className="space-y-1.5 text-sm">
            <Row label="Subtotal" value={formatBRL(o.subtotalCents)} />
            {o.discountCents > 0 && <Row label={`Desconto${o.discountReason ? ` (${o.discountReason})` : ''}`} value={`− ${formatBRL(o.discountCents)}`} />}
            {o.fulfillment === 'delivery' && <Row label="Taxa de entrega" value={o.deliveryFeeCents ? formatBRL(o.deliveryFeeCents) : 'Grátis'} />}
            <div className="flex items-baseline justify-between border-t border-line pt-2">
              <dt className="font-semibold">Total</dt>
              <dd className="num text-base font-semibold">{formatBRL(o.totalCents)}</dd>
            </div>
          </dl>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md bg-canvas px-3 py-2.5">
            <div className="text-sm">
              <p className="flex items-center gap-1.5 text-ink">
                <Wallet className="size-4 text-muted" /> {o.paymentMethod === 'online' ? 'PIX online (Mercado Pago)' : PAYMENT_METHOD_LABELS[o.paymentMethod]}
                {o.payment ? (
                  <Badge tone={o.payment.status === 'approved' ? 'brand' : o.payment.status === 'pending' ? 'warn' : o.payment.status === 'refunded' ? 'danger' : 'neutral'} className="ml-1">
                    {PAYMENT_TRANSACTION_STATUS_LABELS[o.payment.status]}
                  </Badge>
                ) : (
                  <Badge tone={o.paymentStatus === 'paid' ? 'brand' : o.paymentStatus === 'refunded' ? 'danger' : 'neutral'} className="ml-1">
                    {PAYMENT_STATUS_LABELS[o.paymentStatus]}
                  </Badge>
                )}
              </p>
              {o.payment && (
                <p className="mt-0.5 text-xs text-muted">
                  {o.payment.approvedAt ? `Confirmado pelo Mercado Pago em ${formatDateTime(o.payment.approvedAt)}` : o.payment.status === 'pending' && o.payment.expiresAt ? `Vence às ${formatTime(o.payment.expiresAt)}` : 'Situação consultada no Mercado Pago'}
                  {o.payment.refundedCents > 0 && ` · estornado ${formatBRL(o.payment.refundedCents)}`}
                  {o.payment.providerPaymentId && <span className="num"> · nº {o.payment.providerPaymentId}</span>}
                </p>
              )}
              {o.paymentMethod === 'cash' && o.changeForCents !== null && (
                <p className="mt-0.5 text-xs text-muted">
                  Troco para {formatBRL(o.changeForCents)} · levar <span className="num">{formatBRL(o.changeForCents - o.totalCents)}</span>
                </p>
              )}
            </div>
            {canEdit && o.status !== 'canceled' && o.paymentMethod !== 'online' && (
              <Button size="sm" variant="secondary" loading={paymentStatus.isPending} onClick={() => paymentStatus.mutate(o.paymentStatus === 'paid' ? 'pending' : 'paid')}>
                {o.paymentStatus === 'paid' ? 'Desfazer recebimento' : 'Registrar recebimento'}
              </Button>
            )}
            {canManage && o.payment?.status === 'approved' && !paidButCanceled && (
              <Button size="sm" variant="secondary" icon={<RotateCcw className="size-4" />} loading={refund.isPending} onClick={() => void askRefund()}>
                Estornar
              </Button>
            )}
          </div>
        </section>

        {/* Histórico */}
        <section aria-labelledby="sec-historico">
          <h3 id="sec-historico" className="mb-3 text-2xs font-semibold uppercase tracking-[0.08em] text-faint">Histórico</h3>
          <ol className="relative space-y-3 border-l border-line pl-4">
            {o.events.map((e) => (
              <li key={e.id} className="relative">
                <span className={cx('absolute -left-[21px] top-1.5 size-2.5 rounded-full border-2 border-surface', e.type === 'status_changed' && e.toStatus === 'canceled' ? 'bg-danger' : e.type === 'note_added' ? 'bg-warn' : 'bg-line-strong')} />
                <p className="text-sm text-ink">{describeEvent(e)}</p>
                <p className="text-xs text-muted">
                  {formatDateTime(e.createdAt)}
                  {e.actorName && ` · ${e.actorType === 'customer' ? 'cliente' : e.actorName}`}
                </p>
              </li>
            ))}
          </ol>
          {canEdit && (
            <form
              className="mt-4 flex items-start gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (note.trim()) addNote.mutate();
              }}
            >
              <Textarea rows={1} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Observação interna (o cliente não vê)" aria-label="Observação interna" className="min-h-10" />
              <Button type="submit" variant="secondary" loading={addNote.isPending} disabled={!note.trim()}>
                Anotar
              </Button>
            </form>
          )}
        </section>
      </div>

      {modal === 'items' && <EditItemsModal order={o} onClose={() => setModal(null)} onSaved={refresh} />}
      {modal === 'discount' && <DiscountModal order={o} onClose={() => setModal(null)} onSaved={refresh} />}
      {modal === 'payment' && <PaymentModal order={o} onClose={() => setModal(null)} onSaved={refresh} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line px-2 py-2">
      <dt className="text-2xs text-muted">{label}</dt>
      <dd className="num mt-0.5 text-[0.8125rem] text-ink">{value}</dd>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="num text-ink">{value}</dd>
    </div>
  );
}

function describeEvent(e: OrderEvent): string {
  const d = e.data as Record<string, unknown>;
  switch (e.type) {
    case 'created':
      return e.actorType === 'customer' ? 'Pedido feito pelo cardápio digital' : 'Pedido lançado pela equipe';
    case 'duplicated_from':
      return 'Pedido criado a partir de outro (duplicado)';
    case 'status_changed':
      return `${ORDER_STATUS_LABELS[e.toStatus!]}${d.reason ? ` — ${String(d.reason)}` : ''}${d.automatic ? ' (automático)' : ''}`;
    case 'items_updated':
      return `Itens alterados: ${formatBRL(Number(d.previousTotalCents))} → ${formatBRL(Number(d.totalCents))}${d.reason ? ` — ${String(d.reason)}` : ''}`;
    case 'note_added':
      return `Observação: ${String(d.note)}`;
    case 'discount_applied':
      return `Desconto de ${formatBRL(Number(d.discountCents))}${d.reason ? ` — ${String(d.reason)}` : ''}`;
    case 'payment_method_changed':
      return `Pagamento alterado: ${String(d.from)} → ${String(d.to)}`;
    case 'payment_status_changed':
      return `Pagamento: ${String(d.from)} → ${String(d.to)}`;
    case 'customer_notified': {
      const label = ORDER_STATUS_LABELS[d.status as OrderStatus] ?? '';
      if (d.via !== 'whatsapp_api') return `Mensagem de “${label}” aberta no WhatsApp para envio`;
      if (d.result === 'sent') return `Aviso de “${label}” enviado pelo WhatsApp`;
      if (d.result === 'skipped') return `Aviso de “${label}” não enviado: ${String(d.reason ?? '')}`;
      return `Falha ao enviar o aviso de “${label}”${d.error ? `: ${String(d.error)}` : ''}`;
    }
    case 'courier_assigned':
      return d.courierName ? `Entrega atribuída a ${String(d.courierName)}` : 'Entregador removido da entrega';
    case 'delivery_problem':
      return `Problema na entrega: ${String(d.reason)}`;
    case 'payment_updated': {
      const to = PAYMENT_TRANSACTION_STATUS_LABELS[d.to as keyof typeof PAYMENT_TRANSACTION_STATUS_LABELS] ?? String(d.to);
      return `Mercado Pago: pagamento ${to.toLowerCase()}${d.amountMatches === false ? ' (valor diferente do total do pedido)' : ''}`;
    }
    case 'printed':
      return 'Comanda impressa';
    default:
      return e.type;
  }
}

function EditItemsModal({ order, onClose, onSaved }: { order: OrderDetail; onClose: () => void; onSaved: (o: OrderDetail) => void }) {
  const catalog = useCatalog();
  const { toast } = useFeedback();
  const [lines, setLines] = useState<CartLine[] | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (catalog.data && lines === null) {
      const r = linesFromOrderItems(order.items, catalog.data);
      setLines(r.lines);
      setMissing(r.missing);
    }
  }, [catalog.data, lines, order.items]);

  const save = useMutation({
    mutationFn: () =>
      put<OrderDetail>(`/orders/${order.id}/items`, {
        items: lines!.map((l) => l.selection),
        reason: reason || null,
      }),
    onSuccess: (d) => {
      onSaved(d);
      toast('Itens atualizados.');
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const total = (lines ?? []).reduce((s, l) => s + l.priced.totalCents, 0);

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={`Editar itens do pedido #${order.number}`}
      description="Os itens são recalculados com os preços atuais do cardápio. A alteração fica registrada no histórico."
      footer={
        <>
          <span className="mr-auto text-sm text-muted">
            Produtos: <span className="num text-ink">{formatBRL(total)}</span>
          </span>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} disabled={!lines?.length} onClick={() => save.mutate()}>
            Salvar itens
          </Button>
        </>
      }
    >
      {!catalog.data || lines === null ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="space-y-4">
          {missing.length > 0 && (
            <p className="rounded-md bg-warn-soft px-3 py-2 text-[0.8125rem] text-warn">
              Não estão mais disponíveis e sairão do pedido se você salvar: {missing.join(', ')}.
            </p>
          )}
          <CartBuilder catalog={catalog.data} lines={lines} onChange={setLines} />
          <Field label="Motivo da alteração" htmlFor="edit-reason" optional>
            <Input id="edit-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Ex.: cliente pediu para trocar o tamanho" />
          </Field>
        </div>
      )}
    </Modal>
  );
}

function DiscountModal({ order, onClose, onSaved }: { order: OrderDetail; onClose: () => void; onSaved: (o: OrderDetail) => void }) {
  const { toast } = useFeedback();
  const [cents, setCents] = useState<number | null>(order.discountCents);
  const [reason, setReason] = useState(order.discountReason ?? '');
  const save = useMutation({
    mutationFn: () => post<OrderDetail>(`/orders/${order.id}/discount`, { discountCents: cents ?? 0, reason }),
    onSuccess: (d) => {
      onSaved(d);
      toast('Desconto aplicado.');
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const invalid = (cents ?? 0) > order.subtotalCents;
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Aplicar desconto"
      description={`Sobre os produtos (${formatBRL(order.subtotalCents)}). Use R$ 0,00 para remover.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} disabled={invalid || reason.trim().length < 2} onClick={() => save.mutate()}>
            Aplicar desconto
          </Button>
        </>
      }
    >
      <div className="space-y-4 pt-1">
        <Field label="Valor do desconto" htmlFor="discount" error={invalid ? 'Maior que o valor dos produtos' : undefined}>
          <MoneyInput id="discount" value={cents} onChange={setCents} invalid={invalid} />
        </Field>
        <div className="flex gap-2">
          {[5, 10, 15].map((p) => (
            <button key={p} type="button" className="rounded-full border border-line-strong px-3 py-1 text-xs hover:border-ink/30" onClick={() => setCents(Math.round((order.subtotalCents * p) / 100))}>
              {p}%
            </button>
          ))}
        </div>
        <Field label="Motivo" htmlFor="discount-reason">
          <Input id="discount-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={160} placeholder="Ex.: atraso na entrega" />
        </Field>
      </div>
    </Modal>
  );
}

function PaymentModal({ order, onClose, onSaved }: { order: OrderDetail; onClose: () => void; onSaved: (o: OrderDetail) => void }) {
  const { toast } = useFeedback();
  const [method, setMethod] = useState<PaymentMethod>(order.paymentMethod === 'online' ? 'pix' : order.paymentMethod);
  const [change, setChange] = useState<number | null>(order.changeForCents);
  const save = useMutation({
    mutationFn: () => put<OrderDetail>(`/orders/${order.id}/payment`, { paymentMethod: method, changeForCents: method === 'cash' ? change : null }),
    onSuccess: (d) => {
      onSaved(d);
      toast('Forma de pagamento alterada.');
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const changeInvalid = method === 'cash' && change !== null && change < order.totalCents;
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Alterar pagamento"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} disabled={changeInvalid} onClick={() => save.mutate()}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4 pt-1">
        <Field label="Forma de pagamento" htmlFor="pay-method">
          <Select id="pay-method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {OFFLINE_PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </Select>
        </Field>
        {method === 'cash' && (
          <Field label="Troco para" htmlFor="pay-change" optional error={changeInvalid ? 'Menor que o total do pedido' : undefined} hint={`Total: ${formatBRL(order.totalCents)}`}>
            <MoneyInput id="pay-change" value={change} onChange={setChange} allowEmpty invalid={changeInvalid} />
          </Field>
        )}
      </div>
    </Modal>
  );
}

