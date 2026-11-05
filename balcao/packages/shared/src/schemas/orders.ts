import { z } from 'zod';
import { centsSchema, idSchema, optionalPhoneSchema, optionalText, phoneSchema, trimmed } from './common';
import { addressSchema } from './tenant';
import {
  FULFILLMENT_TYPES,
  MANUAL_ORDER_CHANNELS,
  OFFLINE_PAYMENT_METHODS,
  ORDER_CHANNELS,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  type OrderChannel,
  type PaymentMethod,
} from '../orders';
import { MAX_ITEMS_PER_ORDER, MAX_ITEM_QUANTITY } from '../pricing';

const offlinePayment = z.enum(OFFLINE_PAYMENT_METHODS as [PaymentMethod, ...PaymentMethod[]], 'Escolha a forma de pagamento');
/** No cardápio, o cliente também pode escolher PIX online quando a loja tem um provedor conectado (a API confere). */
const anyPayment = z.enum(PAYMENT_METHODS, 'Escolha a forma de pagamento');

export const cartItemSchema = z.object({
  productId: idSchema,
  quantity: z.number().int().min(1).max(MAX_ITEM_QUANTITY),
  notes: optionalText(280),
  modifiers: z
    .array(z.object({ modifierId: idSchema, quantity: z.number().int().min(1).max(20) }))
    .max(80)
    .default([]),
});
export type CartItemInput = z.input<typeof cartItemSchema>;

const itemsSchema = z
  .array(cartItemSchema)
  .min(1, 'Adicione pelo menos um produto')
  .max(MAX_ITEMS_PER_ORDER, `No máximo ${MAX_ITEMS_PER_ORDER} itens por pedido`);

const orderBase = {
  idempotencyKey: z.uuid('Chave de envio inválida'),
  fulfillment: z.enum(FULFILLMENT_TYPES, 'Escolha entrega, retirada ou consumo no local'),
  address: addressSchema.nullish().transform((v) => v ?? null),
  tableNumber: optionalText(20),
  paymentMethod: offlinePayment,
  changeForCents: centsSchema.nullish().transform((v) => v ?? null),
  notes: optionalText(500),
  items: itemsSchema,
  /** Bairro de entrega cadastrado pela loja (obrigatório quando a loja usa taxa por bairro). */
  deliveryZoneId: idSchema.nullish().transform((v) => v ?? null),
};

function refineOrder(
  v: { fulfillment: string; address: unknown; paymentMethod: string; changeForCents: number | null },
  ctx: z.RefinementCtx,
) {
  if (v.fulfillment === 'delivery' && !v.address) {
    ctx.addIssue({ code: 'custom', message: 'Informe o endereço de entrega', path: ['address'] });
  }
  if (v.paymentMethod !== 'cash' && v.changeForCents !== null) {
    ctx.addIssue({ code: 'custom', message: 'Troco só se aplica a pagamento em dinheiro', path: ['changeForCents'] });
  }
}

/** Pedido enviado pelo cliente no cardápio digital. */
export const publicCheckoutSchema = z
  .object({
    ...orderBase,
    paymentMethod: anyPayment,
    customer: z.object({
      name: trimmed(2, 80, 'seu nome'),
      phone: phoneSchema,
    }),
    /** Consentimento explícito (LGPD) para receber novidades e promoções. */
    marketingOptIn: z.boolean().default(false),
  })
  .superRefine(refineOrder);
export type PublicCheckoutInput = z.input<typeof publicCheckoutSchema>;

/** Pedido lançado pela equipe (balcão, telefone, WhatsApp, Instagram). */
export const manualOrderSchema = z
  .object({
    ...orderBase,
    channel: z.enum(MANUAL_ORDER_CHANNELS as [OrderChannel, ...OrderChannel[]]).default('manual'),
    customer: z.object({
      name: trimmed(2, 80, 'o nome do cliente'),
      phone: optionalPhoneSchema,
    }),
    discountCents: centsSchema.default(0),
    discountReason: optionalText(160),
    deliveryFeeCents: centsSchema.nullish().transform((v) => v ?? null),
  })
  .superRefine((v, ctx) => {
    refineOrder(v, ctx);
    if (v.discountCents > 0 && !v.discountReason) {
      ctx.addIssue({ code: 'custom', message: 'Informe o motivo do desconto', path: ['discountReason'] });
    }
  });
export type ManualOrderInput = z.input<typeof manualOrderSchema>;

export const updateOrderStatusSchema = z
  .object({
    status: z.enum(ORDER_STATUSES),
    reason: optionalText(300),
    /** Status que a tela mostrava; se mudou nesse meio-tempo, a API recusa para evitar sobrescrever outra pessoa. */
    expectedFrom: z.enum(ORDER_STATUSES).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.status === 'canceled' && !v.reason) {
      ctx.addIssue({ code: 'custom', message: 'Informe o motivo do cancelamento', path: ['reason'] });
    }
  });

export const updateOrderItemsSchema = z.object({
  items: itemsSchema,
  reason: optionalText(300),
});

export const addOrderNoteSchema = z.object({
  note: trimmed(1, 500, 'a observação'),
});

export const applyDiscountSchema = z.object({
  discountCents: centsSchema,
  reason: trimmed(2, 160, 'o motivo do desconto'),
});

export const changePaymentSchema = z
  .object({
    paymentMethod: offlinePayment,
    changeForCents: centsSchema.nullish().transform((v) => v ?? null),
  })
  .superRefine((v, ctx) => {
    if (v.paymentMethod !== 'cash' && v.changeForCents !== null) {
      ctx.addIssue({ code: 'custom', message: 'Troco só se aplica a pagamento em dinheiro', path: ['changeForCents'] });
    }
  });

export const paymentStatusSchema = z.object({
  paymentStatus: z.enum(PAYMENT_STATUSES),
});

export const recordNotificationSchema = z.object({
  status: z.enum(ORDER_STATUSES),
});

export const listOrdersQuerySchema = z.object({
  status: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : []))
    .pipe(z.array(z.enum(ORDER_STATUSES))),
  channel: z.enum(ORDER_CHANNELS).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  search: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
