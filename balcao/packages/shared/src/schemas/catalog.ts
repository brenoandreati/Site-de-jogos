import { z } from 'zod';
import { centsSchema, idSchema, imageUrlSchema, optionalText, trimmed } from './common';

export const categorySchema = z.object({
  name: trimmed(1, 60, 'o nome da categoria'),
  description: optionalText(200),
  isActive: z.boolean().default(true),
});
export type CategoryInput = z.input<typeof categorySchema>;

export const reorderSchema = z.object({
  ids: z.array(idSchema).min(1).max(500),
});

export const productSchema = z
  .object({
    categoryId: idSchema,
    name: trimmed(1, 80, 'o nome do produto'),
    description: optionalText(600),
    imageUrl: imageUrlSchema,
    priceCents: centsSchema,
    sku: optionalText(40),
    prepTimeMinutes: z.number().int().min(0).max(240).nullish().transform((v) => v ?? null),
    isFeatured: z.boolean().default(false),
    isActive: z.boolean().default(true),
    isAvailable: z.boolean().default(true),
    trackStock: z.boolean().default(false),
    stockQuantity: z.number().int().min(0).max(1_000_000).nullish().transform((v) => v ?? null),
    modifierGroupIds: z.array(idSchema).max(20, 'No máximo 20 grupos de adicionais por produto').default([]),
  })
  .superRefine((v, ctx) => {
    if (v.trackStock && v.stockQuantity === null) {
      ctx.addIssue({ code: 'custom', message: 'Informe a quantidade em estoque', path: ['stockQuantity'] });
    }
    if (new Set(v.modifierGroupIds).size !== v.modifierGroupIds.length) {
      ctx.addIssue({ code: 'custom', message: 'Grupo de adicionais repetido', path: ['modifierGroupIds'] });
    }
  });
export type ProductInput = z.input<typeof productSchema>;

export const productAvailabilitySchema = z.object({
  isAvailable: z.boolean(),
});

export const modifierOptionSchema = z.object({
  id: idSchema.optional(),
  name: trimmed(1, 60, 'o nome da opção'),
  description: optionalText(160),
  priceCents: centsSchema,
  maxQuantity: z.number().int().min(1, 'Mínimo 1').max(20, 'Máximo 20').default(1),
  isAvailable: z.boolean().default(true),
});

export const modifierGroupSchema = z
  .object({
    name: trimmed(1, 60, 'o nome do grupo'),
    description: optionalText(160),
    minSelect: z.number().int().min(0).max(50),
    maxSelect: z.number().int().min(1, 'O máximo deve ser pelo menos 1').max(50),
    isActive: z.boolean().default(true),
    options: z.array(modifierOptionSchema).min(1, 'Adicione pelo menos uma opção').max(80),
  })
  .superRefine((v, ctx) => {
    if (v.maxSelect < v.minSelect) {
      ctx.addIssue({ code: 'custom', message: 'O máximo não pode ser menor que o mínimo', path: ['maxSelect'] });
    }
    const available = v.options.filter((o) => o.isAvailable !== false);
    const capacity = available.reduce((sum, o) => sum + (o.maxQuantity ?? 1), 0);
    if (v.minSelect > 0 && capacity < v.minSelect) {
      ctx.addIssue({
        code: 'custom',
        message: 'Não há opções disponíveis suficientes para o mínimo exigido',
        path: ['minSelect'],
      });
    }
    const names = v.options.map((o) => o.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) {
      ctx.addIssue({ code: 'custom', message: 'Há opções com o mesmo nome', path: ['options'] });
    }
  });
export type ModifierGroupInput = z.input<typeof modifierGroupSchema>;
