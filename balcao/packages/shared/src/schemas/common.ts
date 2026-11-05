import { z } from 'zod';
import { normalizeBrazilianPhone } from '../phone';
import { cleanDocument, detectDocumentType } from '../document';
import { isValidSlug } from '../slug';

export const MAX_PRICE_CENTS = 100_000_00; // R$ 100.000,00

export const idSchema = z.uuid('Identificador inválido');

export const centsSchema = z
  .number('Informe um valor')
  .int('Valor em centavos deve ser inteiro')
  .min(0, 'O valor não pode ser negativo')
  .max(MAX_PRICE_CENTS, 'Valor acima do permitido');

export const trimmed = (min: number, max: number, label: string) =>
  z
    .string(`Informe ${label}`)
    .trim()
    .min(min, min <= 1 ? `Informe ${label}` : `${capitalize(label)} deve ter pelo menos ${min} caracteres`)
    .max(max, `${capitalize(label)} deve ter no máximo ${max} caracteres`);

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use no máximo ${max} caracteres`)
    .nullish()
    .transform((v) => (v ? v : null));

export const emailSchema = z
  .string('Informe o e-mail')
  .trim()
  .toLowerCase()
  .pipe(z.email('E-mail inválido').max(254, 'E-mail muito longo'));

export const phoneSchema = z.string('Informe o telefone').transform((value, ctx) => {
  const normalized = normalizeBrazilianPhone(value);
  if (!normalized) {
    ctx.addIssue({ code: 'custom', message: 'Telefone inválido. Use DDD + número, ex.: (11) 91234-5678' });
    return z.NEVER;
  }
  return normalized;
});

export const optionalPhoneSchema = z
  .string()
  .nullish()
  .transform((value, ctx) => {
    if (!value || !value.trim()) return null;
    const normalized = normalizeBrazilianPhone(value);
    if (!normalized) {
      ctx.addIssue({ code: 'custom', message: 'Telefone inválido. Use DDD + número, ex.: (11) 91234-5678' });
      return z.NEVER;
    }
    return normalized;
  });

export const documentSchema = z
  .string()
  .nullish()
  .transform((value, ctx) => {
    if (!value || !value.trim()) return null;
    const clean = cleanDocument(value);
    if (!detectDocumentType(clean)) {
      ctx.addIssue({ code: 'custom', message: 'CPF ou CNPJ inválido' });
      return z.NEVER;
    }
    return clean;
  });

export const slugSchema = z
  .string('Informe o endereço da loja')
  .trim()
  .toLowerCase()
  .refine(isValidSlug, 'Use de 3 a 48 letras minúsculas, números e hífens (alguns nomes são reservados)');

export const passwordSchema = z
  .string('Informe a senha')
  .min(8, 'A senha deve ter pelo menos 8 caracteres')
  .max(128, 'A senha deve ter no máximo 128 caracteres');

export const imageUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v.startsWith('/uploads/') || /^https:\/\//.test(v), 'Imagem inválida')
  .nullish()
  .transform((v) => v ?? null);

export const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use uma cor no formato #RRGGBB')
  .nullish()
  .transform((v) => (v ? v.toLowerCase() : null));

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
