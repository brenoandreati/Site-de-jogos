/**
 * Domínio de pedidos: status, transições permitidas, canais, tipos de atendimento e pagamento.
 * A API é a autoridade: toda transição é validada no servidor com estas regras.
 */

export const ORDER_STATUSES = [
  'new',
  'awaiting_confirmation',
  'confirmed',
  'preparing',
  'ready',
  'out_for_delivery',
  'completed',
  'canceled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  new: 'Novo pedido',
  awaiting_confirmation: 'Aguardando pagamento',
  confirmed: 'Confirmado',
  preparing: 'Em preparação',
  ready: 'Pronto',
  out_for_delivery: 'Saiu para entrega',
  completed: 'Concluído',
  canceled: 'Cancelado',
};

/** Texto exibido para o cliente no acompanhamento do pedido. */
export const ORDER_STATUS_CUSTOMER_LABELS: Record<OrderStatus, string> = {
  new: 'Recebemos seu pedido',
  awaiting_confirmation: 'Aguardando a confirmação do pagamento',
  confirmed: 'Pedido confirmado',
  preparing: 'Estamos preparando seu pedido',
  ready: 'Seu pedido está pronto',
  out_for_delivery: 'Seu pedido saiu para entrega',
  completed: 'Pedido concluído',
  canceled: 'Pedido cancelado',
};

export const ACTIVE_ORDER_STATUSES: readonly OrderStatus[] = [
  'new',
  'awaiting_confirmation',
  'confirmed',
  'preparing',
  'ready',
  'out_for_delivery',
];
export const FINAL_ORDER_STATUSES: readonly OrderStatus[] = ['completed', 'canceled'];

export const FULFILLMENT_TYPES = ['delivery', 'pickup', 'dine_in'] as const;
export type FulfillmentType = (typeof FULFILLMENT_TYPES)[number];
export const FULFILLMENT_LABELS: Record<FulfillmentType, string> = {
  delivery: 'Entrega',
  pickup: 'Retirada',
  dine_in: 'Consumo no local',
};

export const ORDER_CHANNELS = ['menu', 'whatsapp', 'manual', 'instagram', 'other'] as const;
export type OrderChannel = (typeof ORDER_CHANNELS)[number];
export const ORDER_CHANNEL_LABELS: Record<OrderChannel, string> = {
  menu: 'Cardápio digital',
  whatsapp: 'WhatsApp',
  manual: 'Balcão / manual',
  instagram: 'Instagram',
  other: 'Outro canal',
};
/** Canais que a equipe pode escolher ao lançar um pedido manualmente (o pedido foi recebido por fora do sistema). */
export const MANUAL_ORDER_CHANNELS: readonly OrderChannel[] = ['manual', 'whatsapp', 'instagram', 'other'];

/**
 * Formas de pagamento presenciais (na entrega/retirada) disponíveis na Fase 1.
 * "online" fica reservado para a integração com gateway (Fase 2) e não pode ser escolhido
 * enquanto não houver um provedor configurado.
 */
export const PAYMENT_METHODS = ['pix', 'cash', 'credit_card', 'debit_card', 'meal_voucher', 'online'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const OFFLINE_PAYMENT_METHODS: readonly PaymentMethod[] = [
  'pix',
  'cash',
  'credit_card',
  'debit_card',
  'meal_voucher',
];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  pix: 'PIX',
  cash: 'Dinheiro',
  credit_card: 'Cartão de crédito',
  debit_card: 'Cartão de débito',
  meal_voucher: 'Vale-refeição',
  online: 'Pagamento online',
};

export const PAYMENT_STATUSES = ['pending', 'paid', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: 'A receber',
  paid: 'Recebido',
  refunded: 'Estornado',
};

const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  new: ['awaiting_confirmation', 'confirmed', 'canceled'],
  // Pagamento online pendente: entra como novo (ou confirmado) quando o provedor confirmar.
  awaiting_confirmation: ['new', 'confirmed', 'canceled'],
  confirmed: ['preparing', 'ready', 'canceled'],
  preparing: ['ready', 'canceled'],
  ready: ['out_for_delivery', 'completed', 'canceled'],
  out_for_delivery: ['completed', 'canceled'],
  completed: [],
  canceled: [],
};

export function allowedTransitions(from: OrderStatus, fulfillment: FulfillmentType): OrderStatus[] {
  return TRANSITIONS[from].filter((to) => {
    if (to === 'out_for_delivery') return fulfillment === 'delivery';
    // Pedido de entrega só é concluído depois de sair para entrega.
    if (from === 'ready' && to === 'completed') return fulfillment !== 'delivery';
    return true;
  });
}

export function canTransition(from: OrderStatus, to: OrderStatus, fulfillment: FulfillmentType): boolean {
  return allowedTransitions(from, fulfillment).includes(to);
}

/** Próximo passo "natural" usado no botão principal dos cards. */
export function nextStatus(from: OrderStatus, fulfillment: FulfillmentType): OrderStatus | null {
  // Aguardando pagamento: quem avança é a confirmação do provedor, não um botão.
  if (from === 'awaiting_confirmation') return null;
  const options = allowedTransitions(from, fulfillment).filter(
    (s) => s !== 'canceled' && s !== 'awaiting_confirmation',
  );
  if (from === 'confirmed') return 'preparing';
  return options[0] ?? null;
}

export const NEXT_STATUS_ACTION_LABELS: Partial<Record<OrderStatus, string>> = {
  confirmed: 'Confirmar',
  preparing: 'Iniciar preparo',
  ready: 'Marcar como pronto',
  out_for_delivery: 'Saiu para entrega',
  completed: 'Concluir',
};

/** Campos de data registrados em cada etapa. */
export const STATUS_TIMESTAMP_FIELD: Partial<Record<OrderStatus, string>> = {
  confirmed: 'confirmedAt',
  preparing: 'preparingAt',
  ready: 'readyAt',
  out_for_delivery: 'dispatchedAt',
  completed: 'completedAt',
  canceled: 'canceledAt',
};

export const ORDER_EVENT_TYPES = [
  'created',
  'status_changed',
  'items_updated',
  'note_added',
  'discount_applied',
  'payment_method_changed',
  'payment_status_changed',
  'customer_notified',
  'printed',
  'duplicated_from',
  'courier_assigned',
  'delivery_problem',
  'payment_updated',
] as const;
export type OrderEventType = (typeof ORDER_EVENT_TYPES)[number];

export const CANCEL_REASONS = [
  'Cliente desistiu',
  'Produto indisponível',
  'Endereço fora da área de entrega',
  'Loja sem condições de atender',
  'Pedido duplicado',
  'Suspeita de fraude ou trote',
  'Outro motivo',
] as const;

export const KITCHEN_STATUS_LABELS: Partial<Record<OrderStatus, string>> = {
  confirmed: 'Aguardando preparo',
  preparing: 'Em preparação',
  ready: 'Preparação concluída',
};

// ───────────────────────────── Entregas ─────────────────────────────

export const DELIVERY_STATUSES = ['awaiting_courier', 'assigned', 'out_for_delivery', 'delivered', 'problem', 'canceled'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  awaiting_courier: 'Aguardando entregador',
  assigned: 'Entregador atribuído',
  out_for_delivery: 'Saiu para entrega',
  delivered: 'Entregue',
  problem: 'Problema na entrega',
  canceled: 'Cancelada',
};

export const COURIER_STATUSES = ['available', 'busy', 'offline'] as const;
export type CourierStatus = (typeof COURIER_STATUSES)[number];
export const COURIER_STATUS_LABELS: Record<CourierStatus, string> = {
  available: 'Disponível',
  busy: 'Em entrega',
  offline: 'Fora de serviço',
};

// ───────────────────────────── Atendimento ─────────────────────────────

export const CONVERSATION_STATUSES = ['open', 'waiting', 'closed'] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];
export const CONVERSATION_MODES = ['ai', 'human'] as const;
export type ConversationMode = (typeof CONVERSATION_MODES)[number];

export const MESSAGE_DIRECTIONS = ['inbound', 'outbound', 'internal'] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];
export const MESSAGE_SENDERS = ['customer', 'user', 'ai', 'system'] as const;
export type MessageSender = (typeof MESSAGE_SENDERS)[number];
export const MESSAGE_TYPES = ['text', 'image', 'document', 'audio', 'video', 'location', 'template', 'other'] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];
/** received: mensagem do cliente. pending → sent (aceita pela Meta) → delivered → read, ou failed. */
export const MESSAGE_STATUSES = ['received', 'pending', 'sent', 'delivered', 'read', 'failed'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];
export const MESSAGE_STATUS_LABELS: Record<MessageStatus, string> = {
  received: 'Recebida',
  pending: 'Enviando',
  sent: 'Enviada',
  delivered: 'Entregue',
  read: 'Lida',
  failed: 'Falhou',
};

/** A WhatsApp só permite mensagem livre até 24 h depois da última mensagem do cliente. */
export const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

export const PAYMENT_TRANSACTION_STATUSES = ['pending', 'approved', 'rejected', 'cancelled', 'refunded', 'expired'] as const;
export type PaymentTransactionStatus = (typeof PAYMENT_TRANSACTION_STATUSES)[number];
export const PAYMENT_TRANSACTION_STATUS_LABELS: Record<PaymentTransactionStatus, string> = {
  pending: 'Aguardando pagamento',
  approved: 'Aprovado',
  rejected: 'Recusado',
  cancelled: 'Cancelado',
  refunded: 'Estornado',
  expired: 'Vencido',
};
