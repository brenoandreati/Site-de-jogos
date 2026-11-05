import { z } from 'zod';
import { emailSchema, passwordSchema, phoneSchema, slugSchema, trimmed } from './common';
import { BUSINESS_CATEGORIES } from './tenant';

export const signupSchema = z.object({
  name: trimmed(2, 80, 'seu nome'),
  email: emailSchema,
  password: passwordSchema,
  storeName: trimmed(2, 80, 'o nome da loja'),
  slug: slugSchema,
  whatsapp: phoneSchema,
  businessCategory: z.enum(BUSINESS_CATEGORIES, 'Escolha o tipo de negócio'),
  acceptTerms: z.literal(true, 'É preciso aceitar os termos de uso e a política de privacidade'),
});
export type SignupInput = z.input<typeof signupSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string('Informe a senha').min(1, 'Informe a senha').max(128),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

export const acceptInviteSchema = z.object({
  token: z.string().min(20).max(200),
  name: trimmed(2, 80, 'seu nome').optional(),
  password: passwordSchema.optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Informe a senha atual').max(128),
  newPassword: passwordSchema,
});

export const updateProfileSchema = z.object({
  name: trimmed(2, 80, 'seu nome'),
});
