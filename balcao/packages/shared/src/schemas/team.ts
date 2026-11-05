import { z } from 'zod';
import { emailSchema, trimmed } from './common';
import { ACCESS_LEVELS, MODULE_KEYS, ROLES, type ModuleKey } from '../permissions';

export const permissionOverridesSchema = z
  .partialRecord(z.enum(MODULE_KEYS as [ModuleKey, ...ModuleKey[]]), z.enum(ACCESS_LEVELS))
  .nullish()
  .transform((v) => (v && Object.keys(v).length > 0 ? v : null));

export const inviteMemberSchema = z.object({
  name: trimmed(2, 80, 'o nome'),
  email: emailSchema,
  role: z.enum(ROLES, 'Escolha a função'),
  permissions: permissionOverridesSchema,
});

export const updateMemberSchema = z.object({
  role: z.enum(ROLES, 'Escolha a função'),
  permissions: permissionOverridesSchema,
  isActive: z.boolean(),
});
