import {
  formatBRL,
  renderTemplate,
  whatsappLink,
  type FulfillmentType,
  type MessageTemplateKey,
  type OrderStatus,
} from '@balcao/shared';
import type { Order, Settings } from './types';
import { formatTime, minutesSince } from './format';

export const STATUS_TONE: Record<OrderStatus, 'brand' | 'info' | 'neutral' | 'warn' | 'danger' | 'outline'> = {
  new: 'brand',
  awaiting_confirmation: 'info',
  confirmed: 'info',
  preparing: 'neutral',
  ready: 'brand',
  out_for_delivery: 'info',
  completed: 'outline',
  canceled: 'danger',
};

/** Colunas do quadro operacional. */
export const BOARD_COLUMNS: { key: string; title: string; statuses: OrderStatus[]; empty: string }[] = [
  { key: 'new', title: 'Novos', statuses: ['new', 'awaiting_confirmation'], empty: 'Pedidos do cardápio chegam aqui para você confirmar.' },
  { key: 'confirmed', title: 'Confirmados', statuses: ['confirmed'], empty: 'Nada aguardando preparo.' },
  { key: 'preparing', title: 'Em preparo', statuses: ['preparing'], empty: 'Cozinha livre.' },
  { key: 'ready', title: 'Prontos', statuses: ['ready'], empty: 'Nenhum pedido esperando retirada ou entregador.' },
  { key: 'out_for_delivery', title: 'Em entrega', statuses: ['out_for_delivery'], empty: 'Nenhuma entrega em rota.' },
];

/** Tempo-alvo do pedido em minutos, a partir da criação. */
export function targetMinutes(o: Pick<Order, 'prepTimeMinutes' | 'deliveryTimeMinutes' | 'fulfillment'>) {
  return o.prepTimeMinutes + (o.fulfillment === 'delivery' ? o.deliveryTimeMinutes : 0);
}

/** "ok" | "soon" (passou de 75% do tempo) | "late" (estourou). Pedidos novos atrasam após 5 min sem confirmação. */
export function lateness(o: Order, now = Date.now()): 'ok' | 'soon' | 'late' {
  if (o.status === 'completed' || o.status === 'canceled') return 'ok';
  const elapsed = minutesSince(o.createdAt, now);
  // Aguardando o PIX do cliente não depende da loja: não conta como atraso.
  if (o.status === 'awaiting_confirmation') return 'ok';
  if (o.status === 'new') return elapsed > 5 ? 'late' : elapsed > 3 ? 'soon' : 'ok';
  const target = targetMinutes(o);
  if (elapsed > target) return 'late';
  if (elapsed > target * 0.75) return 'soon';
  return 'ok';
}

export function estimatedTime(o: Pick<Order, 'createdAt' | 'prepTimeMinutes' | 'deliveryTimeMinutes' | 'fulfillment'>) {
  return new Date(new Date(o.createdAt).getTime() + targetMinutes(o) * 60_000);
}

export function fulfillmentShort(f: FulfillmentType) {
  return f === 'delivery' ? 'Entrega' : f === 'pickup' ? 'Retirada' : 'No local';
}

export function trackingUrl(slug: string, token: string) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/${slug}/pedido/${token}`;
}

const TEMPLATE_FOR: Partial<Record<OrderStatus, MessageTemplateKey>> = {
  new: 'new',
  awaiting_confirmation: 'new',
  confirmed: 'confirmed',
  preparing: 'preparing',
  ready: 'ready',
  out_for_delivery: 'out_for_delivery',
  completed: 'completed',
  canceled: 'canceled',
};

/** Link do WhatsApp com a mensagem de atualização pronta. A equipe revisa e envia. */
export function whatsappUpdate(order: Order, slug: string, storeName: string, templates: Settings['messages'] | undefined) {
  if (!order.customerPhone) return null;
  const key = TEMPLATE_FOR[order.status];
  if (!key || !templates) return null;
  const text = renderTemplate(templates[key], {
    cliente: order.customerName.split(' ')[0] ?? order.customerName,
    pedido: order.number,
    loja: storeName,
    total: formatBRL(order.totalCents),
    link: trackingUrl(slug, order.publicToken),
    previsao: `por volta das ${formatTime(estimatedTime(order))}`,
  });
  return whatsappLink(order.customerPhone, text);
}
