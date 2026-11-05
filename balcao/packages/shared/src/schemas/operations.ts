import { z } from 'zod';
import { centsSchema, idSchema, imageUrlSchema, optionalText, phoneSchema, trimmed } from './common';
import { ORDER_STATUSES, type OrderStatus } from '../orders';
import { MESSAGE_TEMPLATE_KEYS, type MessageTemplateKey } from '../messages';

// ───────────────────────────── Cozinha ─────────────────────────────

export const kitchenStatusSchema = z.object({
  status: z.enum(['preparing', 'ready']),
  expectedFrom: z.enum(ORDER_STATUSES).optional(),
});

// ───────────────────────────── Entregas ─────────────────────────────

export const deliveryZoneSchema = z.object({
  name: trimmed(2, 80, 'o bairro ou região'),
  feeCents: centsSchema,
  minOrderCents: centsSchema.nullish().transform((v) => v ?? null),
  etaMinutes: z.number().int().min(0).max(240).nullish().transform((v) => v ?? null),
  isActive: z.boolean().default(true),
});
export type DeliveryZoneInput = z.input<typeof deliveryZoneSchema>;

export const courierSchema = z.object({
  name: trimmed(2, 80, 'o nome'),
  phone: phoneSchema,
  isActive: z.boolean().default(true),
  /** Vínculo opcional com um membro da equipe com a função Entregador (para ele ver as próprias entregas). */
  userId: idSchema.nullish().transform((v) => v ?? null),
});

export const assignCourierSchema = z.object({
  courierId: idSchema.nullable(),
});

export const deliveryProblemSchema = z.object({
  reason: trimmed(2, 300, 'o que aconteceu'),
});

// ───────────────────────────── WhatsApp ─────────────────────────────

export const whatsappConnectSchema = z.object({
  phoneNumberId: z.string().trim().regex(/^\d{6,25}$/, 'Identificador do número inválido (só dígitos)'),
  wabaId: z.string().trim().regex(/^\d{6,25}$/, 'Identificador da conta (WABA) inválido (só dígitos)'),
  accessToken: z.string().trim().min(20, 'Token de acesso inválido').max(1000),
});

export const TEMPLATE_VARIABLES = ['cliente', 'pedido', 'loja', 'total', 'link', 'previsao'] as const;

const templateRef = z.object({
  name: z.string().trim().regex(/^[a-z0-9_]{1,512}$/, 'Use o nome exato do modelo aprovado (minúsculas e _)'),
  language: z.string().trim().regex(/^[a-z]{2}(_[A-Z]{2})?$/, 'Idioma no formato pt_BR'),
  params: z.array(z.enum(TEMPLATE_VARIABLES)).max(10).default([]),
});

export const whatsappSettingsSchema = z.object({
  /** Quais mudanças de status geram mensagem automática ao cliente. */
  autoNotify: z.partialRecord(z.enum(MESSAGE_TEMPLATE_KEYS as unknown as [MessageTemplateKey, ...MessageTemplateKey[]]), z.boolean()).default({}),
  /** Modelos aprovados na Meta, usados quando a janela de 24 h está fechada. */
  templates: z.partialRecord(z.enum(MESSAGE_TEMPLATE_KEYS as unknown as [MessageTemplateKey, ...MessageTemplateKey[]]), templateRef).default({}),
});
export type WhatsappSettings = z.output<typeof whatsappSettingsSchema>;

// ───────────────────────────── Central de atendimento ─────────────────────────────

export const sendMessageSchema = z
  .object({
    text: optionalText(4096),
    imageUrl: imageUrlSchema,
  })
  .refine((v) => v.text || v.imageUrl, 'Escreva uma mensagem ou escolha uma imagem');

export const internalNoteSchema = z.object({
  text: trimmed(1, 2000, 'a observação'),
});

export const conversationActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('assign_me') }),
  z.object({ action: z.literal('transfer_user'), userId: idSchema }),
  z.object({ action: z.literal('to_ai') }),
  z.object({ action: z.literal('to_human'), reason: optionalText(200) }),
  z.object({ action: z.literal('close') }),
  z.object({ action: z.literal('reopen') }),
]);

export const quickReplySchema = z.object({
  title: trimmed(1, 60, 'o atalho'),
  body: trimmed(1, 2000, 'o texto'),
});

export const customerProfileSchema = z.object({
  name: trimmed(2, 80, 'o nome'),
  notes: optionalText(1000),
  tags: z.array(z.string().trim().min(1).max(30)).max(15).default([]),
});

// ───────────────────────────── Assistente de IA ─────────────────────────────

export const HANDOFF_TRIGGERS = ['complaint', 'payment_problem', 'refund', 'special_order', 'unresolved', 'customer_request'] as const;
export type HandoffTrigger = (typeof HANDOFF_TRIGGERS)[number];
export const HANDOFF_TRIGGER_LABELS: Record<HandoffTrigger, string> = {
  complaint: 'Reclamações',
  payment_problem: 'Problemas com pagamento',
  refund: 'Pedido de reembolso',
  special_order: 'Pedidos especiais (encomendas, eventos)',
  unresolved: 'Dúvida que a IA não consegue resolver',
  customer_request: 'Cliente pede para falar com uma pessoa',
};

export const AI_TONES = ['friendly', 'casual', 'formal'] as const;
export const AI_TONE_LABELS: Record<(typeof AI_TONES)[number], string> = {
  friendly: 'Simpático e acolhedor',
  casual: 'Descontraído',
  formal: 'Formal e objetivo',
};

export const aiSettingsSchema = z.object({
  enabled: z.boolean(),
  assistantName: trimmed(1, 40, 'o nome da atendente'),
  tone: z.enum(AI_TONES),
  personality: optionalText(400),
  greeting: optionalText(400),
  awayMessage: optionalText(400),
  instructions: optionalText(3000),
  salesRules: optionalText(1500),
  restrictions: optionalText(1500),
  recommendedProductIds: z.array(idSchema).max(10).default([]),
  handoffTriggers: z.array(z.enum(HANDOFF_TRIGGERS)).default(['complaint', 'payment_problem', 'refund', 'customer_request', 'unresolved']),
  /** Palavras que transferem na hora, sem passar pela IA. */
  handoffKeywords: z.array(z.string().trim().min(2).max(40)).max(30).default(['atendente', 'humano', 'pessoa', 'reclamação', 'reembolso']),
  faq: z
    .array(z.object({ question: trimmed(2, 300, 'a pergunta'), answer: trimmed(1, 1500, 'a resposta') }))
    .max(60)
    .default([]),
});
export type AiSettingsInput = z.input<typeof aiSettingsSchema>;

export const aiTestSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().trim().min(1).max(2000) }))
    .min(1)
    .max(40),
});

// ───────────────────────────── Pagamentos online ─────────────────────────────

export const mercadoPagoConnectSchema = z.object({
  accessToken: z.string().trim().regex(/^(APP_USR|TEST)-[\w-]{20,}$/, 'Access token inválido (começa com APP_USR- ou TEST-)'),
  /** Pode vir depois: o Mercado Pago só gera a assinatura secreta quando a URL do webhook é cadastrada. */
  webhookSecret: z.string().trim().min(16, 'A assinatura secreta tem pelo menos 16 caracteres').max(200).nullish().transform((v) => v || null),
});

export const mercadoPagoWebhookSecretSchema = z.object({
  webhookSecret: z.string().trim().min(16, 'A assinatura secreta tem pelo menos 16 caracteres').max(200),
});

export const refundSchema = z.object({
  reason: trimmed(2, 200, 'o motivo do estorno'),
});

export type NotifiableStatus = Extract<OrderStatus, MessageTemplateKey>;
