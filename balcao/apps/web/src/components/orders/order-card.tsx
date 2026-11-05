'use client';

import { ArrowRight, Bike, MessageCircle, ShoppingBag, Utensils } from 'lucide-react';
import { NEXT_STATUS_ACTION_LABELS, PAYMENT_METHOD_LABELS, formatBRL, nextStatus, type OrderStatus } from '@balcao/shared';
import { cx, elapsed } from '@/lib/format';
import { fulfillmentShort, lateness } from '@/lib/orders-ui';
import type { Order } from '@/lib/types';

const FULFILLMENT_ICON = { delivery: Bike, pickup: ShoppingBag, dine_in: Utensils } as const;

/**
 * Comanda do quadro de pedidos. O número é o protagonista (como no papel), o cronômetro
 * mostra há quanto tempo o pedido entrou e muda de cor quando passa do tempo previsto.
 */
export function OrderTicket({
  order,
  now,
  onOpen,
  onAdvance,
  advancing,
  canAdvance,
  fresh,
}: {
  order: Order;
  now: number;
  onOpen: () => void;
  onAdvance?: (to: OrderStatus) => void;
  advancing?: boolean;
  canAdvance: boolean;
  fresh?: boolean;
}) {
  const next = nextStatus(order.status, order.fulfillment);
  const late = lateness(order, now);
  const Icon = FULFILLMENT_ICON[order.fulfillment];
  const items = order.items;
  const shown = items.slice(0, 4);

  return (
    <article
      className={cx(
        'group relative rounded-lg border bg-surface shadow-soft transition-[border-color,box-shadow] duration-150 hover:border-line-strong hover:shadow-pop',
        late === 'late' ? 'border-danger/35' : 'border-line',
        fresh && 'animate-arrive',
      )}
    >
      <button type="button" onClick={onOpen} className="block w-full rounded-lg p-3.5 pb-3 text-left" aria-label={`Abrir pedido ${order.number} de ${order.customerName}`}>
        <div className="flex items-start justify-between gap-2">
          <span className="num text-[1.375rem] leading-none font-semibold tracking-[-0.04em] text-ink">#{order.number}</span>
          <span
            className={cx(
              'num rounded px-1.5 py-0.5 text-[0.6875rem] font-medium',
              late === 'late' ? 'bg-danger-soft text-danger' : late === 'soon' ? 'bg-warn-soft text-warn' : 'bg-sunken text-muted',
            )}
            title="Tempo desde que o pedido entrou"
          >
            {elapsed(order.createdAt, now)}
          </span>
        </div>

        <div className="mt-2 flex items-center gap-1.5 text-[0.8125rem]">
          <span className="truncate font-medium text-ink">{order.customerName}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
          <Icon className="size-3.5 shrink-0" aria-hidden="true" />
          <span>{fulfillmentShort(order.fulfillment)}</span>
          {order.fulfillment === 'delivery' && order.address?.neighborhood && <span className="truncate">· {order.address.neighborhood}</span>}
          {order.fulfillment === 'dine_in' && order.tableNumber && <span>· Mesa {order.tableNumber}</span>}
          {order.channel !== 'menu' && (
            <span className="ml-auto inline-flex items-center gap-1 text-faint" title="Lançado pela equipe">
              <MessageCircle className="size-3" aria-hidden="true" />
              {order.channel === 'whatsapp' ? 'WhatsApp' : order.channel === 'instagram' ? 'Instagram' : 'Balcão'}
            </span>
          )}
        </div>

        <ul className="mt-3 space-y-1 border-t border-dashed border-line-strong pt-2.5 text-[0.8125rem] leading-snug">
          {shown.map((item) => (
            <li key={item.id}>
              <span className="num mr-1.5 text-xs text-muted">{item.quantity}×</span>
              <span className="text-ink">{item.productName}</span>
              {item.modifiers.length > 0 && (
                <span className="block pl-6 text-xs text-muted">
                  {item.modifiers.map((m) => (m.quantity > 1 ? `${m.name} ×${m.quantity}` : m.name)).join(' · ')}
                </span>
              )}
              {item.notes && <span className="block pl-6 text-xs italic text-warn">“{item.notes}”</span>}
            </li>
          ))}
          {items.length > shown.length && <li className="pl-6 text-xs text-muted">+ {items.length - shown.length} itens</li>}
        </ul>
        {order.notes && <p className="mt-2 rounded bg-warn-soft px-2 py-1 text-xs text-warn">Obs.: {order.notes}</p>}

        <div className="mt-3 flex items-baseline justify-between text-xs text-muted">
          <span>
            {order.paymentMethod === 'online' ? 'PIX online' : PAYMENT_METHOD_LABELS[order.paymentMethod]}
            {order.paymentStatus === 'paid' && <span className="ml-1 text-brand">· pago</span>}
            {order.status === 'awaiting_confirmation' && <span className="ml-1 text-info">· aguardando o cliente pagar</span>}
          </span>
          <span className="num text-[0.8125rem] font-medium text-ink">{formatBRL(order.totalCents)}</span>
        </div>
      </button>

      {next && canAdvance && onAdvance && (
        <div className="px-3.5 pb-3.5">
          <button
            type="button"
            disabled={advancing}
            onClick={() => onAdvance(next)}
            className={cx(
              'flex h-9 w-full items-center justify-center gap-1.5 rounded-md text-[0.8125rem] font-medium transition-colors disabled:opacity-60',
              order.status === 'new' || order.status === 'awaiting_confirmation'
                ? 'bg-brand text-white hover:bg-brand-strong'
                : 'border border-line-strong text-ink hover:border-ink/30 hover:bg-canvas',
            )}
          >
            {NEXT_STATUS_ACTION_LABELS[next]}
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      )}
    </article>
  );
}
