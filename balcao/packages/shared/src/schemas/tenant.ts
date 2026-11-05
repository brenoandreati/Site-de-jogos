import { z } from 'zod';
import {
  centsSchema,
  documentSchema,
  emailSchema,
  hexColorSchema,
  imageUrlSchema,
  optionalPhoneSchema,
  optionalText,
  phoneSchema,
  trimmed,
} from './common';
import { OFFLINE_PAYMENT_METHODS, type PaymentMethod } from '../orders';
import { TIME_RE, validateIntervals } from '../hours';

export const BUSINESS_CATEGORIES = [
  'acaiteria',
  'hamburgueria',
  'pizzaria',
  'restaurante',
  'lanchonete',
  'marmitaria',
  'japonesa',
  'doceria',
  'padaria',
  'cafeteria',
  'sorveteria',
  'bar',
  'outro',
] as const;
export type BusinessCategory = (typeof BUSINESS_CATEGORIES)[number];
export const BUSINESS_CATEGORY_LABELS: Record<BusinessCategory, string> = {
  acaiteria: 'Açaiteria',
  hamburgueria: 'Hamburgueria',
  pizzaria: 'Pizzaria',
  restaurante: 'Restaurante',
  lanchonete: 'Lanchonete',
  marmitaria: 'Marmitaria',
  japonesa: 'Comida japonesa',
  doceria: 'Doceria / confeitaria',
  padaria: 'Padaria',
  cafeteria: 'Cafeteria',
  sorveteria: 'Sorveteria',
  bar: 'Bar / petiscaria',
  outro: 'Outro',
};

export const BRAZIL_STATES = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI',
  'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const;

export const BRAZIL_TIMEZONES = [
  'America/Sao_Paulo',
  'America/Bahia',
  'America/Fortaleza',
  'America/Recife',
  'America/Belem',
  'America/Manaus',
  'America/Cuiaba',
  'America/Campo_Grande',
  'America/Porto_Velho',
  'America/Boa_Vista',
  'America/Rio_Branco',
  'America/Noronha',
] as const;

export const companySettingsSchema = z.object({
  tradeName: trimmed(2, 80, 'o nome da loja'),
  legalName: optionalText(120),
  document: documentSchema,
  email: emailSchema.nullish().transform((v) => v ?? null),
  phone: optionalPhoneSchema,
  whatsapp: phoneSchema,
  description: optionalText(300),
  businessCategories: z.array(z.enum(BUSINESS_CATEGORIES)).min(1, 'Escolha pelo menos um tipo de negócio').max(5),
  logoUrl: imageUrlSchema,
  coverUrl: imageUrlSchema,
  brandColor: hexColorSchema,
  instagram: z
    .string()
    .trim()
    .regex(/^@?[A-Za-z0-9._]{1,30}$/, 'Instagram inválido')
    .nullish()
    .or(z.literal(''))
    .transform((v) => (v ? v.replace(/^@/, '') : null)),
});
export type CompanySettingsInput = z.input<typeof companySettingsSchema>;

export const addressSchema = z.object({
  zipCode: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ''))
    .refine((v) => v === '' || v.length === 8, 'CEP inválido')
    .nullish()
    .transform((v) => (v ? v : null)),
  street: trimmed(2, 120, 'a rua'),
  number: trimmed(1, 20, 'o número'),
  complement: optionalText(80),
  neighborhood: trimmed(2, 80, 'o bairro'),
  city: trimmed(2, 80, 'a cidade'),
  state: z.enum(BRAZIL_STATES, 'Escolha o estado'),
  reference: optionalText(120),
});
export type AddressInput = z.input<typeof addressSchema>;

export const branchSettingsSchema = z.object({
  name: trimmed(2, 80, 'o nome da unidade'),
  phone: optionalPhoneSchema,
  whatsapp: optionalPhoneSchema,
  timezone: z.enum(BRAZIL_TIMEZONES, 'Fuso horário inválido'),
  address: addressSchema.nullish().transform((v) => v ?? null),
});

export const openingIntervalSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  opensAt: z.string().regex(TIME_RE, 'Use HH:MM'),
  closesAt: z.string().regex(TIME_RE, 'Use HH:MM'),
});

export const openingHoursSchema = z
  .object({ intervals: z.array(openingIntervalSchema).max(28, 'No máximo 4 intervalos por dia') })
  .superRefine((value, ctx) => {
    const error = validateIntervals(value.intervals);
    if (error) ctx.addIssue({ code: 'custom', message: error, path: ['intervals'] });
  });

export const pauseSchema = z.object({
  paused: z.boolean(),
  /** Minutos até reabrir automaticamente. null = até reabrir manualmente. */
  durationMinutes: z.number().int().min(5).max(60 * 24 * 7).nullish(),
  reason: optionalText(120),
});

export const PIX_KEY_TYPES = ['cpf', 'cnpj', 'email', 'phone', 'random'] as const;

export const orderSettingsSchema = z
  .object({
    acceptsDelivery: z.boolean(),
    acceptsPickup: z.boolean(),
    acceptsDineIn: z.boolean(),
    autoConfirm: z.boolean(),
    minOrderCents: centsSchema,
    deliveryFeeCents: centsSchema,
    freeDeliveryAboveCents: centsSchema.nullish().transform((v) => v ?? null),
    prepTimeMinutes: z.number().int().min(1, 'Informe o tempo de preparo').max(240),
    deliveryTimeMinutes: z.number().int().min(0).max(240),
    paymentMethods: z
      .array(z.enum(OFFLINE_PAYMENT_METHODS as [PaymentMethod, ...PaymentMethod[]]))
      .min(1, 'Escolha pelo menos uma forma de pagamento'),
    pixKey: optionalText(120),
    pixKeyType: z.enum(PIX_KEY_TYPES).nullish().transform((v) => v ?? null),
    pixHolderName: optionalText(80),
    cancellationPolicy: optionalText(400),
  })
  .superRefine((v, ctx) => {
    if (!v.acceptsDelivery && !v.acceptsPickup && !v.acceptsDineIn) {
      ctx.addIssue({ code: 'custom', message: 'Ative pelo menos um tipo de atendimento', path: ['acceptsDelivery'] });
    }
    if (v.paymentMethods.includes('pix') && !v.pixKey) {
      ctx.addIssue({ code: 'custom', message: 'Informe a chave PIX ou desative o PIX', path: ['pixKey'] });
    }
  });
export type OrderSettingsInput = z.input<typeof orderSettingsSchema>;

export const messageTemplatesSchema = z.object({
  templates: z.record(z.string(), z.string().trim().max(500)),
});
